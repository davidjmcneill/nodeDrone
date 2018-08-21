var AHRS = require('ahrs');
var mpu9255 = require('./mpu9255.js');

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
var mpu = new mpu9255({
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
     * smoother estimates, but have higher latency.
     */
    beta: 3
});

if (mpu.initialize()) {   
    var accel = [0,0,0];
    var gyro = [0,0,0];
    var mag = [0,0,0];
    setInterval(function(){
        setInterval(function(){
            mag = mpu.ak8963.getMagAttitude();
        }, 1/100);
        setInterval(function(){
            accel = mpu.getAccel();
            gyro = mpu.getGyro();
        }, 1/1000);
        
        setInterval(function(){
            madgwick.update(gyro[0]*(Math.PI / 180), gyro[1]*(Math.PI / 180), gyro[2]*(Math.PI / 180), accel[0], accel[1], accel[2], mag[0], mag[1], mag[2]);
        }, 1/5000);
        var pyr = madgwick.getEulerAnglesDegrees();
        var direction;
        
        //Determine Cardinal Directions from heading 
        //East = 0 degrees, North = 90 degrees, South = -90 degrees, West = 180 degrees
        //Northeast = 45 degrees, Southeast = -45 degrees, Northwest = 135 degrees, Southwest = -135 degrees
        if(pyr["heading"] > -30 && pyr["heading"] <= 30) {
            //Heading Direction is East
            direction = 'E';
        } else if (pyr["heading"] > -60 && pyr["heading"] <= -30) {
            //Heading Direction is SouthEast
            direction = 'SE';
        } else if (pyr["heading"] > -120 && pyr["heading"] <= -60) {
            //Heading Direction is South
            direction = 'S';
        } else if (pyr["heading"] > -150 && pyr["heading"] <= -120) {
            //Heading Direction is SouthWest
            direction = 'SW';
        } else if (pyr["heading"] > 150 || pyr["heading"] <= -150) {
            //Heading Direction is West
            direction = 'W';
        } else if (pyr["heading"] > 120 && pyr["heading"] <= 150) {
            //Heading Direction is NorthWest
            direction = 'NW';
        } else if (pyr["heading"] > 60 && pyr["heading"] <= 120) {
            //Heading Direction is North
            direction = 'N';
        } else if (pyr["heading"] > 30 && pyr["heading"] <= 60) {
            //Heading Direction is NorthEast
            direction = 'NE';
        }
        
        console.log("Heading: %f\u00B0 ("+direction+")",Math.round(pyr["heading"]));
    }, 100);

}
