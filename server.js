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

//use reference files located in libs directory
app.use('/libs', express.static(__dirname + '/libs'));
//use image files located in images directory
app.use('/images', express.static(__dirname + '/images'));
    
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
    beta: 3
});

//Initialize i2c communication bus
var i2c1 = i2c.openSync(1);
    
//define external modules
let test_motor = require('./test_motor.js');
let arm_motor = require('./arm_motor.js');
let run_motor = require('./run_motor.js');
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

//Initialize landing gear
landing_gear.WakeGear(LandingGearPin);

//Initialize IMU
IMU.SetUpdateInterval(mpu9255_obj,madgwick);

//Initialize ADC by sending control byte
i2c1.i2cWriteSync(0x48,1,0x40);

//Store initial altitude measurement
var init_alt = 0;
IMU.GetAltitude(BMP180_obj,function(pressure) {
    if (pressure) {
        var altitude = 44330 * (1 - Math.pow((pressure/100)/1013.25,(1/5.255)));
        init_alt = altitude;
    }
});

//When client connects, provide information on page
io.on('connection', function (client) {// Web Socket Connection
    client.on('altitude', function() { //get status from client
        //Altitude data
        IMU.GetAltitude(BMP180_obj,function(altitude) {
            if (altitude) {
                io.emit("altitude",altitude);
            }
        });
    });
    
    client.on('battery', function() { //get status from client
        //Battery voltage
        ADC.PCF8591_Data(i2c1,0x40,function(bat_voltage) {
            if (bat_voltage) {
                io.emit("battery",bat_voltage);
            }
        });
    });
    
    client.on('D2G', function() { //get status from client
        //Distance from ground (ultrasonic sensor)
        ADC.PCF8591_Data(i2c1,0x41,function(voltage) {
            if (voltage) {
                io.emit("D2G",voltage);
            }
        }); 
    });
        
    client.on('orientation', function() { //get status from client
        //Orientation data
        IMU.GetOrientation(mpu9255_obj,madgwick,function(pyr) {
            if (pyr) {
                io.emit("mpu9255",pyr);
            }
        });
    });
    
    client.on('motor_arm', function() { //get button status from client
        arm_motor.ArmMotor(motor1Pin,function(){
            io.emit("messages","Motor 1 Armed!");
        });
        arm_motor.ArmMotor(motor2Pin,function(){
            io.emit("messages","Motor 2 Armed!");
        });
        arm_motor.ArmMotor(motor3Pin,function(){
            io.emit("messages","Motor 3 Armed!");
        });
        arm_motor.ArmMotor(motor4Pin,function(){
            io.emit("messages","Motor 4 Armed!");
        });
        
    });
  
    client.on('motor1_test', function() { //get button status from client
        test_motor.RunMotorTest(motor1Pin,function(throttle){
            io.emit("messages","Motor 1 Throttle:"+throttle+"%");
        });
    });

    client.on('motor2_test', function() { //get button status from client
        test_motor.RunMotorTest(motor2Pin,function(throttle){
            io.emit("messages","Motor 2 Throttle:"+throttle+"%");
        });
    });

    client.on('motor3_test', function() { //get button status from client
        test_motor.RunMotorTest(motor3Pin,function(throttle){
            io.emit("messages","Motor 3 Throttle:"+throttle+"%");
        });
    });

    client.on('motor4_test', function() { //get button status from client
        test_motor.RunMotorTest(motor4Pin,function(throttle){
            io.emit("messages","Motor 4 Throttle:"+throttle+"%");
        });
    });
    
    client.on('landing_gear_deploy', function() { //get button status from client
        landing_gear.DeployGear(LandingGearPin);
    }); 
    
    client.on('landing_gear_retract', function() { //get button status from client
        landing_gear.RetractGear(LandingGearPin);
    });   
    
    client.on('hover_test', function() { //get button status from client
        //define PID controller variables
        var hover_alt = init_alt + 2.0;//goal to hover 2 meters high
        var current_alt = roll_change = pitch_change = yaw_change = 0;
        var error_x = error_y = error_z = 0;
        var motor1_throttle = motor2_throttle = motor3_throttle = motor4_throttle = throttle = 0;
        var alt_deltaV = 0;
        var Kp = 0.5, Ki = 0.01, inv_dt = 5;
        var target_x = 0,target_y = 0,target_z = 90;//determined by testing
        
        io.emit("messages","Initial Altitude: " + init_alt+" Target: " + hover_alt);

//        //check quad altitude every 400 ms
//        setInterval(function() {
//            //get current height
//            IMU.GetAltitude(BMP180_obj,function(pressure) {
//                if (pressure) {
//                    var altitude = 44330 * (1 - Math.pow((pressure/100)/1013.25,(1/5.255)));
//                    //check if quad has moved by more than 1m, if no increase throttle
//                    alt_deltaV = altitude - current_alt;
//                    io.emit("messages","Current Altitude: " + current_alt.toFixed(2)+" Alt_DeltaV = "+alt_deltaV.toFixed(2));
//                    if (alt_deltaV < 2) {
//                        //quad has not moved, need to go higher -> increase throttle
//                        var motor1_array = {pin: motor1Pin, throttle: motor1_throttle};
//                        var motor2_array = {pin: motor2Pin, throttle: motor2_throttle};
//                        var motor3_array = {pin: motor3Pin, throttle: motor3_throttle};
//                        var motor4_array = {pin: motor4Pin, throttle: motor4_throttle};
//                        //SetAllMotorsSpeed(motor1_array,motor2_array,motor3_array,motor4_array,10,function(throttle) {
//
//                        //});
//                    }
//                    current_alt = altitude;
//                }
//            });
//        }, 400);
        
        //check quad orientation every half second
        setInterval(function() {
            //check orientation
            IMU.GetOrientation(mpu9255_obj,madgwick,function(pyr) {
                if (pyr) {
                    throttle = 50;
                    error_x = pyr["roll"] - target_x;
                    error_y = pyr["pitch"] - target_y;
                    error_z = pyr["heading"] - target_z;
                    
                    //io.emit("messages","R: " + pyr["roll"].toFixed(2)+" P: " + pyr["pitch"].toFixed(2)+" Y: " + pyr["heading"].toFixed(2));
                    
                    roll_change = (Kp*error_x) + (Ki*inv_dt*error_x);//Proportional + Integral + Derivative
                    pitch_change = (Kp*error_y) + (Ki*inv_dt*error_y);
                    yaw_change = (Kp*error_z) + (Ki*inv_dt*error_z);
                    
                    //Adjust motor thottle based on current state
                    motor1_throttle = throttle - roll_change + pitch_change;
                    motor2_throttle = throttle + roll_change - pitch_change;
                    motor3_throttle = throttle + roll_change + pitch_change;
                    motor4_throttle = throttle - roll_change - pitch_change; 
                    
                    if (motor1_throttle <= 0) {
                        motor1_throttle = 0;
                    }
                    if (motor2_throttle <= 0) {
                        motor2_throttle = 0;
                    }
                    if (motor3_throttle <= 0) {
                        motor3_throttle = 0;
                    }
                    if (motor4_throttle <= 0) {
                        motor4_throttle = 0;
                    }
                    
                    //io.emit("messages","M1: " + motor1_throttle.toFixed(1) + "% M2: " + motor2_throttle.toFixed(1) + "% M3: " + motor3_throttle.toFixed(1) + "% M4: " + motor4_throttle.toFixed(1) + "%");
                    
                    //Set each motor speed 
//                    SetMotorSpeed(motor1Pin,motor1_throttle,function(throttle){
//                        io.emit("messages","M1: " + throttle.toFixed(1) + "%");
//                    });
//                    SetMotorSpeed(motor2Pin,motor2_throttle,function(throttle){
//                        io.emit("messages","M2: " + throttle.toFixed(1) + "%");
//                    });
//                    SetMotorSpeed(motor3Pin,motor3_throttle,function(throttle){
//                        io.emit("messages","M3: " + throttle.toFixed(1) + "%");
//                    });
//                    SetMotorSpeed(motor4Pin,motor4_throttle,function(throttle){
//                        io.emit("messages","M4: " + throttle.toFixed(1) + "%");
//                    });
                }
            });
        }, 100);   
        //pick up landing gear once in air
        //landing_gear.RetractGear(LandingGearPin);
    });   
});


