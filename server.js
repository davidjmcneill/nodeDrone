var express = require('express');
var app = express();
var server = require('http').createServer(app);  
var io = require('socket.io')(server, {
    //require socket.io module and pass the http object (server)
    serveClient: false,
    pingInterval: 2000,
    pingTimeout: 2000,
    cookie: false
}); 
var fs = require('fs'); //require filesystem module
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
        x: 0.008140869140625,
        y: 0.009057820638020833,
        z: 0.0781829833984375
    },
    scale: { 
        x: [ -0.9945719401041667, 1.00426513671875 ],
        y: [ -0.9799568684895833, 1.0115974934895833 ],
        z: [ 1.0539290364583334, -0.9614567057291666 ] 
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

var i2c1 = i2c.openSync(1);
    
//define external modules
let test_motor = require('./test_motor.js');
let arm_motor = require('./arm_motor.js');
let landing_gear = require('./landing_gear.js');
let IMU = require('./imu.js');
let ADC = require('./adc.js');

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html');
});
 
server.listen(8080);

console.log("Running at Port 8080");

landing_gear.WakeGear(LandingGearPin);

//Orientation data
IMU.SetUpdateInterval(mpu9255_obj,madgwick);

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
        ADC.PCF8591_Data(i2c1,0x00,function(bat_voltage) {
            if (bat_voltage) {
                io.emit("battery",bat_voltage);
            } 
        });
    });
    
    client.on('D2G', function() { //get status from client
        //Distance from ground (ultrasonic sensor)
        ADC.PCF8591_Data(i2c1,0x01,function(voltage) {
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
    
    client.on('liftoff_ground', function() { //get button status from client
        //hover.RetractGear(LandingGearPin);
        
        //pick up landing gear once in air
        landing_gear.RetractGear(LandingGearPin);
    });   
});


