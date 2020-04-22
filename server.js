var express = require('express');
var app = express();
var server = require('http').createServer(app);  
var io = require('socket.io')(server, {
    //require socket.io module and pass the http object (server)
    serveClient: false,
    pingInterval: 1000,
    pingTimeout: 5000,
    reconnection: true,
    reconnectionAttempts: 15
}); 
//pull in Raspberrypi / NPM Modules
var fs = require('fs'); 
var Gpio = require('pigpio').Gpio;
var RaspiSensors = require('raspi-sensors');
var i2c = require('i2c-bus');
var AHRS = require('ahrs');
var mpu9255 = require('./mpu9255.js');
var gpsd = require('node-gpsd');

//use reference files located in libs directory
app.use('/libs', express.static(__dirname + '/libs'));
//use image files located in images directory
app.use('/images', express.static(__dirname + '/images'));
//use font files located in font directory
app.use('/fonts', express.static(__dirname + '/fonts'));
    
var motor1Pin = new Gpio(17, {mode: Gpio.OUTPUT}), //M1
    motor2Pin = new Gpio(27, {mode: Gpio.OUTPUT}), //M2
    motor3Pin = new Gpio(22, {mode: Gpio.OUTPUT}), //M3
    motor4Pin = new Gpio(23, {mode: Gpio.OUTPUT}), //M4
    LandingGearPin = new Gpio(24, {mode: Gpio.OUTPUT}), //Landing Gear Control box
    pwm_freq = 1600,
    pwm_range = 100,
    throttle = 0;
    
var BMP180_obj = new RaspiSensors.Sensor({
    type    : "BMP180",
    address : 0X77
}, "Altitude Sensor");  // An additional name can be provided after the sensor's configuration

// These values were generated using calibrate_mag.js - you will want to create your own.
var MAG_CALIBRATION = {
    min: { x: -81.015625, y: -35.859375, z: -53.0078125 },
    max: { x: 82.20703125, y: 136.265625, z: 131.3671875 },
    offset: { x: 0.595703125, y: 50.203125, z: 39.1796875 },
    scale: {
        x: 1.592066531051813,
        y: 1.5097244916485113,
        z: 1.409417372881356
    }
};

// These values were generated using calibrate_gyro.js - you will want to create your own.
// NOTE: These are temperature dependent.
var GYRO_OFFSET = {
    x: 0.48407633587786203,
    y: -0.1822290076335877,
    z: 0.6753740458015269
};

// These values were generated using calibrate_accel.js - you will want to create your own.
var ACCEL_CALIBRATION = {
    offset: {
        x: 0.0026436360677083333,
        y: 0.0690252685546875,
        z: 0.0532501220703125
    },
    scale: { 
        x: [ 0.9910611979166667, -1.0054142252604166 ],
        y: [ -0.9826920572916666, 1.0140657552083334 ],
        z: [ -0.9496875, 1.0560416666666668 ] 
    }
};

// Instantiate and initialize.
var mpu9255_obj = new mpu9255({
    // i2c path (default is '/dev/i2c-1')
    device: '/dev/i2c-1',

    // mpu9250 address (default is 0x68)
    address: 0x68,

    // Enable/Disable magnetometer data (default false)
    UpMagneto: true,

    // If true, all values returned will be scaled to actual units (default false).
    // If false, the raw values from the device will be returned.
    scaleValues: true,

    // Enable/Disable debug mode (default false)
    DEBUG: false,

    // ak8963 (magnetometer / compass) address (default is 0x0C)
    ak_address: 0x0C,

    // Set the Accelerometer sensitivity (default 2), where:
    //      0 => +/- 2 g
    //      1 => +/- 4 g
    //      2 => +/- 8 g
    //      3 => +/- 16 g
    ACCEL_FS: 0,
    magCalibration: MAG_CALIBRATION,
    gyroBiasOffset: GYRO_OFFSET,
    accelCalibration: ACCEL_CALIBRATION
});

//define value correction system
var madgwick = new AHRS({
    /*
     * The sample interval, in Hz.
     */
    sampleInterval: 20,

    /*
     * Choose from the `Madgwick` or `Mahony` filter.
     */
    algorithm: 'Madgwick',

    /*
     * The filter noise value, smaller values have
     * smoother estimates, but have higher latency. was 3
     */
    beta: 1.5
});

//setup GPS daemon service
var daemon = new gpsd.Daemon({
    program: 'gpsd',
    device: '/dev/ttyUSB0',
    port: 2947,
    pid: '/tmp/gpsd.pid',
    readOnly: false,
    logger: {
        info: function() {},
        warn: console.warn,
        error: console.error
    }
});

//setup GPS listener service
var listener = new gpsd.Listener({
    port: 2947,
    hostname: 'localhost',
    logger:  {
        info: function() {},
        warn: console.warn,
        error: console.error
    },
    parse: true
});

//Initialize i2c communication bus
var i2c1 = i2c.openSync(1);
    
//define external modules
let motor_controls = require('./motor_controls.js');
let landing_gear = require('./landing_gear.js');
let IMU = require('./imu.js');
let ADC = require('./adc.js');

//default/root file path for client connection
app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});
 
 //Start broadcasting server over specified port
server.listen(8080);
console.log("Running at Port 8080");

//////////////////////////////////////////////////////////////////////////////
////////////////INITIALIZE all electronic control units to READY state //////
//////////////////////////////////////////////////////////////////////////////
//Landing Gear
landing_gear.WakeGear(LandingGearPin);
//IMU
IMU.SetUpdateInterval(mpu9255_obj,madgwick);
//ADC by sending control byte
i2c1.i2cWriteSync(0x48,1,0x40);
///////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////////////////
//////////////// Setup System status variables /////////////////////////
//////////////////////////////////////////////////////////////////////////////
var master_throttle = {Unit:0,M1:0,M2:0,M3:0,M4:0};
var landing_gear_status = 0; //0 = Deployed, 1 = Retracted
var batt_voltage = 0;
var ground_distance = 0;
var initial_altitude, current_altitude = 0;
var direction = 0;
var pitch = 0, roll = 0, yaw = 0;
var gps_latitude, gps_longitude, gps_altitude, gps_speed = 0;     

//Get current battery voltage and send to listeners
function Battery() {
    setTimeout(function() {
        //check battery voltage
        ADC.PCF8591_Data(i2c1,0x41,function(voltage) {
            if (voltage) {
                //complete calculation of actual battery life
                var vmax = 2.20, vmin = 1.90;
                var vdiff = vmax - vmin;
                voltage = voltage * (3.3 / 255) - 0.25;
                var percent = Math.round((1 - ((vmax - voltage) / vdiff)) * 100);
                if (percent > 100) { percent = 100;}
                if (percent < 0) { percent = 0;}
                /////////////////////////////
                //add in data logging to log file with timestamp
                batt_voltage = voltage;
                io.emit("battery",{voltage:batt_voltage, indicator:percent});
            }
        });
    },50);
    return;
}

//Get current ground distance and send to listeners
function GroundDistance() {
    setTimeout(function() {
        //Distance from ground (ultrasonic sensor)
        ADC.PCF8591_Data(i2c1,0x40,function(distance) {
            if (distance) {
                /////////////////////////////
                //add in data logging to log file with timestamp
                ground_distance = distance;
                io.emit("ground_distance",ground_distance);
            }
        });
    },50);
    return;
}

//Get current altitude and send to listeners
function Altitude() {
    setTimeout(function() {
        IMU.GetAltitude(BMP180_obj,function(pressure) {
            if (pressure) {
                current_altitude = 44330 * (1 - Math.pow((pressure/100)/1013.25,(1/5.255)));
                /////////////////////////////
                //add in data logging to log file with timestamp
                io.emit("altitude",current_altitude);
            }
        });
    },50);
    return;
}

function GPS() {
    setTimeout(function() {
        daemon.start(function() {
            var listener = new gpsd.Listener();

            listener.on('TPV', function (tpv) {
                console.log(tpv);
                gps_latitude = tpv['lat'];
                gps_longitude = tpv['lon'];
                gps_altitude = tpv['alt'];
                gps_speed = tpv['speed'];
            });

            listener.connect(function() {
                listener.watch();
            });
        });
    },50);
    return;
}

//Get current orientation and send to listeners
function Orientation() {
    setTimeout(function() {
        IMU.GetOrientation(mpu9255_obj,madgwick,function(pyr) {
            if (pyr) {
                //Determine Cardinal Directions from heading 
                //East = 0 degrees, North = -90 degrees, South = 90 degrees, West = 180 degrees
                //Northeast = -45 degrees, Southeast = 45 degrees, Northwest = -135 degrees, Southwest = 135 degrees
                pitch = pyr["pitch"];
                roll = pyr["roll"];
                yaw = pyr["heading"];
                if(yaw > -30 && yaw <= 30) {
                    //Heading Direction is East
                    direction = 'E';
                } else if (yaw > -60 && yaw <= -30) {
                    //Heading Direction is NorthEast
                    direction = 'NE';
                } else if (yaw > -120 && yaw <= -60) {
                    //Heading Direction is North
                    direction = 'N';
                } else if (yaw > -150 && yaw <= -120) {
                    //Heading Direction is NorthWest
                    direction = 'NW';
                } else if (yaw > 150 || yaw <= -150) {
                    //Heading Direction is West
                    direction = 'W';
                } else if (yaw > 120 && yaw <= 150) {
                    //Heading Direction is SouthWest
                    direction = 'SW';
                } else if (yaw > 60 && yaw <= 120) {
                    //Heading Direction is South
                    direction = 'S';
                } else if (yaw > 30 && yaw <= 60) {
                    //Heading Direction is SouthEast
                    direction = 'SE';
                }
                /////////////////////////////
                //add in data logging to log file with timestamp
                io.emit("orientation",{pitch:pitch, roll:roll, yaw:yaw, direction:direction});
            }
        });
    },50);
    return;
}

//Check Orientation and correct
function StabilityCheck() {
    Orientation();
    setTimeout(function() {
        var roll_change = pitch_change = yaw_change = 0;
        var error_x = error_y = error_z = 0;
        var Kp = 0.5, Ki = 0.01, inv_dt = 5;
        var target_x = 0,target_y = 0,target_z = -90;//determined by testing (face directly north)

        error_x = roll - target_x;
        error_y = pitch - target_y;
        error_z = yaw - target_z;

        roll_change = (Kp*error_x) + (Ki*inv_dt*error_x);//Proportional + Integral (No Derivative)
        pitch_change = (Kp*error_y) + (Ki*inv_dt*error_y);
        yaw_change = (Kp*error_z) + (Ki*inv_dt*error_z);

        //Adjust motor thottle based on current state
        master_throttle.M1 = master_throttle.Unit - roll_change - pitch_change;
        master_throttle.M2 = master_throttle.Unit + roll_change + pitch_change;
        master_throttle.M3 = master_throttle.Unit + roll_change - pitch_change;
        master_throttle.M4 = master_throttle.Unit - roll_change + pitch_change; 

        if (master_throttle.M1 <= 0) {
            master_throttle.M1 = 0;
        }
        if (master_throttle.M2 <= 0) {
            master_throttle.M2 = 0;
        }
        if (master_throttle.M3 <= 0) {
            master_throttle.M3 = 0;
        }
        if (master_throttle.M4 <= 0) {
            master_throttle.M4 = 0;
        }

        if (master_throttle.M1 > 99) {
            master_throttle.M1 = 100;
        }
        if (master_throttle.M2 > 99) {
            master_throttle.M2 = 100;
        }
        if (master_throttle.M3 > 99) {
            master_throttle.M3 = 100;
        }
        if (master_throttle.M4 > 99) {
            master_throttle.M4 = 100;
        }

        //output status to client browser
        //io.emit("drone_status",{id:"motor_throttle", name:"motor_unit", throttle: master_throttle.Unit.toFixed(1)});
        io.emit("drone_status",{id:"motor_throttle", name:"motor1", throttle: master_throttle.M1.toFixed(1)});
        io.emit("drone_status",{id:"motor_throttle", name:"motor2", throttle: master_throttle.M2.toFixed(1)});
        io.emit("drone_status",{id:"motor_throttle", name:"motor3", throttle: master_throttle.M3.toFixed(1)});
        io.emit("drone_status",{id:"motor_throttle", name:"motor4", throttle: master_throttle.M4.toFixed(1)});

        //Set each motor speed 
//        SetMotorSpeed(motor1Pin,master_throttle.M1,function(throttle){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor1", throttle: master_throttle.M1.toFixed(1)});
//        });
//        SetMotorSpeed(motor2Pin,motor2_throttle,function(throttle){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor2", throttle: master_throttle.M2.toFixed(1)});
//        });
//        SetMotorSpeed(motor3Pin,motor3_throttle,function(throttle){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor3", throttle: master_throttle.M3.toFixed(1)});
//        });
//        SetMotorSpeed(motor4Pin,motor4_throttle,function(throttle){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor4", throttle: master_throttle.M4.toFixed(1)});
//        });
    },100);
    return;
}

////////////////////////////////////////////////////////////////////
////////////////////// Initial Data Readings //////////////////////////
/////////////////////////////////////////////////////////////////////////////

//get first battery reading
setTimeout(function() {
    Battery();
}, 1000);

//get first ground distance reading
setTimeout(function() {
    GroundDistance();
}, 2000);

//get first altitude reading
setTimeout(function(){
    Altitude();
}, 3000);

//get first orientation reading
setTimeout(function(){
    Orientation();
}, 4000);


////////////////////////////////////////////////////////////////////
//////////////////////////// Routine Checks //////////////////////////////////
/////////////////////////////////////////////////////////////////////////////
function RoutineChecks() {
    setTimeout(function() {
        Battery();
    }, 100);
    setTimeout(function() {
        GroundDistance();
    }, 200);
    setTimeout(function(){
        Altitude();
    }, 300);
    setTimeout(function(){
        Orientation();
    }, 400);
    setTimeout(function(){
        GPS();
        io.emit("gps",{lat:gps_latitude, lon:gps_longitude, alt:gps_altitude, speed:gps_speed});
    }, 500);
}

////////////////////////////////////////////////////////////////////
//////////////////////////// Quad Activity ////////////////////////////
/////////////////////////////////////////////////////////////////////////////
setInterval(function(){
    RoutineChecks();
}, 1000);
///////////////////////////////////////////////////////////////////////////
/////////// When client makes request, fulfill and give response////////
///////////////////////////////////////////////////////////////////////////////
io.on('connection', function (client) {// Web Socket Connection    
    client.on('motor_arm', function() { //get button status from client
        motor_controls.ArmMotor(motor1Pin,function(){
            io.emit("drone_status","Motor 1 Armed!");
        });
        motor_controls.ArmMotor(motor2Pin,function(){
            io.emit("drone_status","Motor 2 Armed!");
        });
        motor_controls.ArmMotor(motor3Pin,function(){
            io.emit("drone_status","Motor 3 Armed!");
        });
        motor_controls.ArmMotor(motor4Pin,function(){
            io.emit("drone_status","Motor 4 Armed!");
        });
    });
  
    //test motor 1 (M1)
    client.on('motor1_test', function() {
        motor_controls.RunMotorTest(motor1Pin,function(throttle){
            io.emit("drone_status",{id:"motor_throttle", name:"motor1", throttle: throttle});
        });
    });
    
    //test motor 2 (M2)
    client.on('motor2_test', function() {
        motor_controls.RunMotorTest(motor2Pin,function(throttle){
            io.emit("drone_status",{id:"motor_throttle", name:"motor2", throttle: throttle});
        });
    });

    //test motor 3 (M3)
    client.on('motor3_test', function() {
        motor_controls.RunMotorTest(motor3Pin,function(throttle){
            io.emit("drone_status",{id:"motor_throttle", name:"motor3", throttle: throttle});
        });
    });

    //test motor 4 (M4)
    client.on('motor4_test', function() {
        motor_controls.RunMotorTest(motor4Pin,function(throttle){
            io.emit("drone_status",{id:"motor_throttle", name:"motor4", throttle: throttle});
        });
    });
    
    //Deploy landing gear
    client.on('landing_gear_deploy', function() {
        landing_gear.DeployGear(LandingGearPin);
    });
    
    //Retract landing gear
    client.on('landing_gear_retract', function() {
        landing_gear.RetractGear(LandingGearPin);
    });
    
    client.on('hover_test', function() { //get button status from client
        //define PID controller variables
        var drone_target = 24;//target for 24 inches away from ground
        var initial_ground_distance = ground_distance;
        var current_ground_distance = initial_ground_distance;
        var target_distance = drone_target - current_ground_distance;

        setInterval(function() {
            //for each cycle, determine drone location vs ground
            current_ground_distance = ground_distance;
            target_distance = drone_target - current_ground_distance;
            var Kp = 0.3, Ki = 0.01, inv_dt = 0.5;
            //output feedback to user interface
            io.emit("drone_status",{id:"hover_test", current:current_ground_distance, target: target_distance});
            
            //check whether drone should be in air or on ground
            if (drone_target === 24) { //drone should be in air and trying to stabilize at 24 inches from ground
                //if drone is below 24 inches, adjust throttle based on target distance away (larger distance = higher throttle)
                master_throttle_change = (Kp*target_distance) + (Ki*inv_dt*target_distance);//Proportional + Integral (No Derivative)
                
                //raise landing gear when near hovering level
                if (target_distance < 2) {
                    //landing_gear.RetractGear(LandingGearPin);
                }
                
            } else if (drone_target === 10) {
                //deploy landing gear while lowering
                //landing_gear.DeployGear(LandingGearPin);
                
                //if drone is in-air, above ground, adjust throttle based on target distance away (larger distance = higher throttle)
                master_throttle_change = -((Kp*target_distance) + (Ki*inv_dt*target_distance));//Proportional + Integral (No Derivative)
            }

            //Adjust motor throttle based on target distance away
            master_throttle.Unit = master_throttle.Unit + master_throttle_change;

            if (master_throttle.Unit <= 0) {
                master_throttle.Unit = 0;
            }
            if (master_throttle.Unit > 59) {
                master_throttle.Unit = 60;
            }

            //send new throttle value to each motor
//            var motor1_array = {pin: motor1Pin, throttle: master_throttle.Unit};
//            var motor2_array = {pin: motor2Pin, throttle: master_throttle.Unit};
//            var motor3_array = {pin: motor3Pin, throttle: master_throttle.Unit};
//            var motor4_array = {pin: motor4Pin, throttle: master_throttle.Unit};
            //SetAllMotorsSpeed(motor1_array,motor2_array,motor3_array,motor4_array,10,function(throttle)

            //output status to client browser
            io.emit("drone_status",{id:"motor_throttle", name:"motor1", throttle: master_throttle.Unit.toFixed(1)});
            io.emit("drone_status",{id:"motor_throttle", name:"motor2", throttle: master_throttle.Unit.toFixed(1)});
            io.emit("drone_status",{id:"motor_throttle", name:"motor3", throttle: master_throttle.Unit.toFixed(1)});
            io.emit("drone_status",{id:"motor_throttle", name:"motor4", throttle: master_throttle.Unit.toFixed(1)});
        }, 500);
    });   
});

