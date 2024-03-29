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
var pigpio = require('pigpio');
var Gpio = pigpio.Gpio;
var bmp180 = require('bmp180-sensor');
var i2c = require('i2c-bus');
var AHRS = require('ahrs');
var mpu9255 = require('./mpu9255.js');
var gpsd = require('node-gpsd');
const Timer = require('timer-node');

//use reference files located in libs directory
app.use('/libs', express.static(__dirname + '/libs'));
//use image files located in images directory
app.use('/images', express.static(__dirname + '/images'));
//use font files located in font directory
app.use('/fonts', express.static(__dirname + '/fonts'));
    
pigpio.configureClock(5, pigpio.CLOCK_PWM);
var motor1Pin = new Gpio(17, {mode: Gpio.PWM_OUTPUT}), //M1
    motor2Pin = new Gpio(27, {mode: Gpio.PWM_OUTPUT}), //M2
    motor3Pin = new Gpio(22, {mode: Gpio.PWM_OUTPUT}), //M3
    motor4Pin = new Gpio(23, {mode: Gpio.PWM_OUTPUT}), //M4
    LandingGearPin = new Gpio(24, {mode: Gpio.OUTPUT}), //Landing Gear Control box
    throttle = 0;

// These values were generated using calibrate_mag.js - you will want to create your own.
var MAG_CALIBRATION = {
    min: { x: -76.25, y: -28.6875, z: -49.55078125 },
    max: { x: 71.484375, y: 132.6796875, z: 118.69140625 },
    offset: { x: -2.3828125, y: 51.99609375, z: 34.5703125 },
    scale: {
        x: 1.6155473294553147,
        y: 1.4790607601065118,
        z: 1.4186208497794288
    }
};

// These values were generated using calibrate_gyro.js - you will want to create your own.
// NOTE: These are temperature dependent.
var GYRO_OFFSET = {
    x: 0.29036641221374027,
    y: -0.0749160305343511,
    z: 0.6830992366412217 
};

// These values were generated using calibrate_accel.js - you will want to create your own.
var ACCEL_CALIBRATION = {
    offset: {
        x: -0.004286092122395833,
        y: 0.04193501790364584,
        z: 0.11595113118489583
    },
    scale: { 
        x: [ -1.00030029296875, 0.9978092447916667 ],
        y: [ -0.9794099934895834, 1.0185904947916666 ],
        z: [ -0.9015592447916667, 1.10750244140625 ]
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
    beta: 3
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

//setup time elapsed objects
//const timer = new Timer('test-timer');
//const timer1 = new Timer('test-timer');
//const timer_GPS = new Timer('test-timer');
var gps_time_elapsed = 0;

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
i2c1.i2cWriteSync(0x48,1,new Buffer.alloc(0x04));
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
var gps_latitude, gps_longitude, gps_altitude, gps_speed, gps_status = 0;//gps data storage    
var heading = 0;//0 = ascending, 1 = descending

//Get current battery voltage and send to listeners
function Battery() {
    setTimeout(function() {
        //check battery voltage
        ADC.PCF8591_Data(i2c1,0x01,function(voltage) {
            if (voltage) {
                //complete calculation of actual battery life
                var vmax = 2.4, vmin = 1.7;
                var vdiff = vmax - vmin;
                voltage = voltage * (3.3 / 255);
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
        ADC.PCF8591_Data(i2c1,0x00,function(distance) {
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
        IMU.GetAltitude(bmp180,function(pressure) {
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
                gps_status = tpv['status'];
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
        IMU.GetOrientation(madgwick,function(pyr) {
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
function Stabilize() {
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
        master_throttle.M1 = Math.round(master_throttle.Unit - roll_change - pitch_change);
        master_throttle.M2 = Math.round(master_throttle.Unit + roll_change + pitch_change);
        master_throttle.M3 = Math.round(master_throttle.Unit + roll_change - pitch_change);
        master_throttle.M4 = Math.round(master_throttle.Unit - roll_change + pitch_change); 

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

        if (master_throttle.M1 >= 100) {
            master_throttle.M1 = 99;
        }
        if (master_throttle.M2 >= 100) {
            master_throttle.M2 = 99;
        }
        if (master_throttle.M3 >= 100) {
            master_throttle.M3 = 99;
        }
        if (master_throttle.M4 >= 100) {
            master_throttle.M4 = 99;
        }

        //output status to client browser
//        io.emit("drone_status",{id:"motor_throttle", name:"motor_unit", throttle: master_throttle.Unit.toFixed(1)});
//        io.emit("drone_status",{id:"motor_throttle", name:"motor1", throttle: master_throttle.M1.toFixed(1)});
//        io.emit("drone_status",{id:"motor_throttle", name:"motor2", throttle: master_throttle.M2.toFixed(1)});
//        io.emit("drone_status",{id:"motor_throttle", name:"motor3", throttle: master_throttle.M3.toFixed(1)});
//        io.emit("drone_status",{id:"motor_throttle", name:"motor4", throttle: master_throttle.M4.toFixed(1)});

        //Set each motor speed 
//        motor_controls.SetMotorSpeed(motor1Pin,master_throttle.M1,function(){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor1", throttle: master_throttle.M1});
//        });
//        motor_controls.SetMotorSpeed(motor2Pin,master_throttle.M2,function(){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor2", throttle: master_throttle.M2});
//        });
//        motor_controls.SetMotorSpeed(motor3Pin,master_throttle.M3,function(){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor3", throttle: master_throttle.M3});
//        });
//        motor_controls.SetMotorSpeed(motor4Pin,master_throttle.M4,function(){
//            io.emit("drone_status",{id:"motor_throttle", name:"motor4", throttle: master_throttle.M4});
//        });
    },50);
    return;
}

function HoverTest() {
    //define variables
    var target_alt = (gps_altitude + 2);//target for 24 inches away from ground
    var initial_alt = gps_altitude;
    var master_throttle_change = 0;

    var hover_test = setInterval(function() {
        Orientation();
        console.log(Math.abs(pitch)+", "+Math.abs(roll));
        //stabilize drone if pitch or roll are off by more than 5 degrees
        if (Math.abs(pitch) > 5 || Math.abs(roll) > 5) {
            console.log("stabilizing..");
            Stabilize();
        } else {
            //for each cycle, determine drone location vs ground
            var error_distance = (target_alt - gps_altitude);
            var Kp = 0.3, Ki = 0.01, inv_dt = 0.5;
            //output feedback to user interface
            io.emit("drone_status",{id:"hover_test", current:gps_altitude, target: target_alt, error: error_distance});

            //check whether drone should be in air or on ground
            if (heading === 0 && gps_altitude < target_alt) { //drone will ascend and try to stabilize 2 meters in the air
                //adjust throttle based on target distance away (larger distance = higher throttle)
                master_throttle_change = (Kp*error_distance) + (Ki*inv_dt*error_distance);//Proportional + Integral (No Derivative)

                //raise landing gear when near hovering level
                if (error_distance < 0.5) {
                    landing_gear.RetractGear(LandingGearPin);
                }

            } else if (heading === 0 && gps_altitude > target_alt) {//drone should  hover at 2m for 60 seconds
                if (timer.isRunning() === false) {
                    timer.start();
                }

                //adjust throttle based on target distance away (larger distance = higher throttle)
                master_throttle_change = -((Kp*error_distance) + (Ki*inv_dt*error_distance));//Proportional + Integral (No Derivative)

                //once drone has hovered for 60 seconds, deploy landing gear and reduce throttle
                if (timer.seconds() > 60) {
                    timer.stop();
                    timer.clear();
                    //deploy landing gear while lowering
                    landing_gear.DeployGear(LandingGearPin);
                    timer1.start();
                }  
                //wait 5 seconds for landing gear to deploy then descend to ground
                if (timer1.seconds() > 5) {
                    timer1.stop();
                    heading = 1;
                }
            } else if (heading === 1 && gps_altitude > initial_alt) {//drone will decend and land on the ground
                if (timer1.seconds() > 5) {
                    //adjust throttle based on target distance away (larger distance = higher throttle)
                    master_throttle_change = -((Kp*error_distance) + (Ki*inv_dt*error_distance));//Proportional + Integral (No Derivative)
                }
                //drone should be resting on the ground, end of test, stop the loop
                if (error_distance < 0.1) {
                    master_throttle.Unit = 0;
                    master_throttle_change = 0;
                    clearInterval(hover_test);
                }
            }

            //Adjust motor throttle based on target distance away
            master_throttle.Unit = master_throttle.Unit + master_throttle_change;

            if (master_throttle.Unit <= 0) {
                master_throttle.Unit = 0;
            }
            if (master_throttle.Unit > 59) {//propeller does not spin until 30%+
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
        }
    }, 500);
    return;
}

////////////////////////////////////////////////////////////////////
//////////////////////////// Quad Loop Activity ////////////////////////////
/////////////////////////////////////////////////////////////////////////////
setInterval(function() {
    //GroundDistance();
    //Battery();
    //Current Sensor: Max.range: 184A · 3.3V ADC · Scale the output voltage to milliamps (1/10th mV/A): 179
}, 1000);

setInterval(function(){
    Altitude();
}, 350);

//    setTimeout(function(){
//        GPS();
//        if (gps_latitude === undefined && timer_GPS.isRunning() === false) {
//            gps_time_elapsed = 0;
//            timer_GPS.start();
//        } else if (gps_latitude === undefined && timer_GPS.isRunning() === true) {
//            timer_GPS.stop();
//            gps_time_elapsed = gps_time_elapsed + timer_GPS.seconds();
//            timer_GPS.start();
//        } else if (gps_latitude !== undefined && timer_GPS.isRunning() === true) {
//            timer_GPS.stop();
//            timer_GPS.clear();
//        }
//        io.emit("gps",{lat:gps_latitude, lon:gps_longitude, alt:gps_altitude, speed:gps_speed, timer:gps_time_elapsed});
//    }, 50);
//    
//setInterval(function() {
//    console.log(motor1Pin.getPwmDutyCycle()+","+motor1Pin.getPwmFrequency()+","+motor1Pin.getPwmRange());
//}, 1000);

setInterval(function() {
    Orientation();
    //stabilize drone if pitch or roll are off by more than 10 degrees
    if (Math.abs(pitch) > 10 || Math.abs(roll) > 10) {
        io.emit("drone_status",{id:"Stabilizing", pitch:Math.abs(pitch), roll: Math.abs(roll)});
        Stabilize();
    }
}, 200);
///////////////////////////////////////////////////////////////////////////
/////////// When client makes request, fulfill and give response////////
///////////////////////////////////////////////////////////////////////////////
io.on('connection', function (client) {// Web Socket Connection    
    client.on('motor_arm', function() { //get button status from client
        motor_controls.ArmMotor(motor1Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 1 Armed!"});
        });
        motor_controls.ArmMotor(motor2Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 2 Armed!"});
        });
        motor_controls.ArmMotor(motor3Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 3 Armed!"});
        });
        motor_controls.ArmMotor(motor4Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 4 Armed!"});
        });
    });
    
    //disarm all motors to prevent accidental running
    client.on('motor_disarm', function() {
        //Update motor throttle speed object (for all motors)
        master_throttle.Unit = 0;
        master_throttle.M1 = master_throttle.Unit;
        master_throttle.M2 = master_throttle.Unit;
        master_throttle.M3 = master_throttle.Unit;
        master_throttle.M4 = master_throttle.Unit;
        //Change actual motor speeds based on user setting and update viewing page
        motor_controls.DisarmMotor(motor1Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 1 Disarmed!"});
        });
        motor_controls.DisarmMotor(motor2Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 2 Disarmed!"});
        });
        motor_controls.DisarmMotor(motor3Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 3 Disarmed!"});
        });
        motor_controls.DisarmMotor(motor4Pin,function(){
            io.emit("drone_status",{id:"motor_status",message:"Motor 4 Disarmed!"});
        });
    });
    
    //run all motors at user selected throttle
    client.on('master_throttle', function(throttle) {
        //Update motor throttle speed object (for all motors)
        master_throttle.Unit = throttle;
        master_throttle.M1 = master_throttle.Unit;
        master_throttle.M2 = master_throttle.Unit;
        master_throttle.M3 = master_throttle.Unit;
        master_throttle.M4 = master_throttle.Unit;
        //Change actual motor speeds based on user setting and update viewing page
        motor_controls.SetMotorSpeed(motor1Pin,master_throttle.M1,function(){
            io.emit("drone_status",{id:"motor_throttle", name:"motor1", throttle: master_throttle.M1.toFixed(1)});
        });
        motor_controls.SetMotorSpeed(motor2Pin,master_throttle.M2,function(){
            io.emit("drone_status",{id:"motor_throttle", name:"motor2", throttle: master_throttle.M2.toFixed(1)});
        });
        motor_controls.SetMotorSpeed(motor3Pin,master_throttle.M3,function(){
            io.emit("drone_status",{id:"motor_throttle", name:"motor3", throttle: master_throttle.M3.toFixed(1)});
        });
        motor_controls.SetMotorSpeed(motor4Pin,master_throttle.M4,function(){
            io.emit("drone_status",{id:"motor_throttle", name:"motor4", throttle: master_throttle.M4.toFixed(1)});
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
        HoverTest();
    });   
});

