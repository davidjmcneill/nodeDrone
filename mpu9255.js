var i2c = require('i2c-bus');
var sleep = require('sleep');
var extend = require('extend');
var i2c1 = i2c.openSync(1);

/*****************/
/** MPU9250 MAP **/
/*****************/
// documentation:
//   https://www.invensense.com/products/motion-tracking/9-axis/mpu-9250/
//   https://www.invensense.com/wp-content/uploads/2015/02/MPU-9250-Datasheet.pdf
//   https://www.invensense.com/wp-content/uploads/2015/02/MPU-9250-Register-Map.pdf

var MPU9255 = {
    I2C_ADDRESS_AD0_LOW: 0x68,
    I2C_ADDRESS_AD0_HIGH: 0x69,
    WHO_AM_I: 0x75,

    RA_CONFIG: 0x1A,
    RA_GYRO_CONFIG: 0x1B,
    RA_ACCEL_CONFIG_1: 0x1C,
    RA_ACCEL_CONFIG_2: 0x1D,

    RA_INT_PIN_CFG: 0x37,
    INTCFG_BYTE: 0x02,// BY_PASS_MODE: 0x02,

    ACCEL_XOUT_H: 0x3B,
    ACCEL_XOUT_L: 0x3C,
    ACCEL_YOUT_H: 0x3D,
    ACCEL_YOUT_L: 0x3E,
    ACCEL_ZOUT_H: 0x3F,
    ACCEL_ZOUT_L: 0x40,
    TEMP_OUT_H: 0x41,
    TEMP_OUT_L: 0x42,
    GYRO_XOUT_H: 0x43,
    GYRO_XOUT_L: 0x44,
    GYRO_YOUT_H: 0x45,
    GYRO_YOUT_L: 0x46,
    GYRO_ZOUT_H: 0x47,
    GYRO_ZOUT_L: 0x48,

    RA_USER_CTRL: 0x6A,
    RA_PWR_MGMT_1: 0x6B,
    RA_PWR_MGMT_2: 0x6C,
    PWR1_DEVICE_RESET_BYTE: 0x80,

    GYRO_FS_250: 0x00,
    GYRO_FS_500: 0x01,
    GYRO_FS_1000: 0x02,
    GYRO_FS_2000: 0x03,
    GYRO_SCALE_FACTOR: [131, 65.5, 32.8, 16.4],

    ACCEL_FS_2: 0x00,
    ACCEL_FS_4: 0x01,
    ACCEL_FS_8: 0x02,
    ACCEL_FS_16: 0x03,
    ACCEL_SCALE_FACTOR: [16384, 8192, 4096, 2048],

    CLOCK_INTERNAL: 0x00,
    CLOCK_PLL_XGYRO: 0x01,
    CLOCK_PLL_YGYRO: 0x02,
    CLOCK_PLL_ZGYRO: 0x03,
    CLOCK_KEEP_RESET: 0x07,
    CLOCK_PLL_EXT32K: 0x04,
    CLOCK_PLL_EXT19M: 0x05,

    USERCTRL_BYTE: 0x00,

    DEFAULT_GYRO_OFFSET: { x: 0, y: 0, z: 0 },
    DEFAULT_ACCEL_CALIBRATION: {
        offset: {x: 0, y: 0, z: 0},
        scale: {
            x: [-1, 1],
            y: [-1, 1],
            z: [-1, 1]
        }
    }
};

/****************/
/** AK8963 MAP **/
/****************/
// Technical documentation available here: https://www.akm.com/akm/en/file/datasheet/AK8963C.pdf
var AK8963 = {
    ADDRESS: 0x0C,
    WHO_AM_I: 0x00, // should return 0x48,
    WHO_AM_I_RESPONSE: 0x48,
    INFO: 0x01,
    ST1: 0x02,  // data ready status bit 0
    XOUT_L: 0x03,  // data
    XOUT_H: 0x04,
    YOUT_L: 0x05,
    YOUT_H: 0x06,
    ZOUT_L: 0x07,
    ZOUT_H: 0x08,
    ST2: 0x09,  // Data overflow bit 3 and data read error status bit 2
    CNTL: 0x0A,  // Power down (0000), single-measurement (0001), self-test (1000) and Fuse ROM (1111) modes on bits 3:0
    ASTC: 0x0C,  // Self test control
    
    ASAX: 0x10,  // Fuse ROM x-axis sensitivity adjustment value
    ASAY: 0x11,  // Fuse ROM y-axis sensitivity adjustment value
    ASAZ: 0x12,

    CNTL_MODE_OFF: 0x00, // Power-down mode
    CNTL_MODE_SINGLE_MEASURE: 0x01, // Single measurement mode
    CNTL_MODE_CONTINUE_MEASURE_1: 0x02, // Continuous measurement mode 1 - Sensor is measured periodically at 8Hz
    CNTL_MODE_CONTINUE_MEASURE_2: 0x06, // Continuous measurement mode 2 - Sensor is measured periodically at 100Hz
    CNTL_MODE_EXT_TRIG_MEASURE: 0x04, // External trigger measurement mode
    CNTL_MODE_SELF_TEST_MODE: 0x08, // Self-test mode
    CNTL_MODE_FUSE_ROM_ACCESS: 0x0F,  // Fuse ROM access mode

    DEFAULT_CALIBRATION: {
        offset: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
    }
};

////////////////////////////////////////////////////////////////////////////////////
// /** ---------------------------------------------------------------------- **/ //
//  *                   MPU Configuration				   *  //
// /** ---------------------------------------------------------------------- **/ //
////////////////////////////////////////////////////////////////////////////////////

var mpu9255 = function(cfg) {
    cfg = cfg || {};
    if (typeof cfg !== 'object') {
        cfg = {};
    }

    var _default = {
        device: '/dev/i2c-1',
        address: MPU9255.I2C_ADDRESS_AD0_LOW,
        UpMagneto: false,
        DEBUG: false,
        scaleValues: false,
        ak_address: AK8963.ADDRESS,
        GYRO_FS: 0,
        ACCEL_FS: 2,
        gyroBiasOffset: MPU9255.DEFAULT_GYRO_OFFSET,
        accelCalibration: MPU9255.DEFAULT_ACCEL_CALIBRATION
    };

    var config = extend({}, _default, cfg);
    this._config = config;
};

mpu9255.prototype.initialize = function() {
    this.debug = new debugConsole(this._config.DEBUG);
    this.debug.Log('INFO', 'Initialization MPU9250 ....');

    // clear configuration
    i2c1.writeByteSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.RA_PWR_MGMT_1, MPU9255.PWR1_DEVICE_RESET_BYTE);
    this.debug.Log('INFO', 'Reset configuration MPU9250.');
    sleep.usleep(10000);

    // define clock source
    this.setClockSource(MPU9255.CLOCK_PLL_XGYRO);
    sleep.usleep(10000);

    // define gyro range
    var gyro_fs = [MPU9255.GYRO_FS_250, MPU9255.GYRO_FS_500, MPU9255.GYRO_FS_1000, MPU9255.GYRO_FS_2000];
    var gyro_value = MPU9255.GYRO_FS_250;
    if (this._config.GYRO_FS > -1 && this._config.GYRO_FS < 4) gyro_value = gyro_fs[this._config.GYRO_FS];
    this.setFullScaleGyroRange(gyro_value);
    sleep.usleep(10000);

    // define accel range
    var accel_fs = [MPU9255.ACCEL_FS_2, MPU9255.ACCEL_FS_4, MPU9255.ACCEL_FS_8, MPU9255.ACCEL_FS_16];
    var accel_value = MPU9255.ACCEL_FS_8;
    if (this._config.ACCEL_FS > -1 && this._config.ACCEL_FS < 4) accel_value = accel_fs[this._config.ACCEL_FS];
    this.setFullScaleAccelRange(accel_value);
    sleep.usleep(10000);

    if (this._config.UpMagneto) {
        this.debug.Log('INFO', 'Enabled magnetometer. Starting initialization ....');
        this.enableMagnetometer();
        this.debug.Log('INFO', 'END of magnetometer initialization.');
    }

    this.debug.Log('INFO', 'END of MPU9150 initialization.');

    // Print out the configuration
    if (this._config.DEBUG) {
        this.printSettings();
        this.printAccelSettings();
        this.printGyroSettings();
        if (this.ak8963) {
            this.ak8963.printSettings();
        }
    }
    return this.testDevice();
};

mpu9255.prototype.testDevice = function() {
    return (this.getIDDevice() === 0x73);
};

mpu9255.prototype.enableMagnetometer = function() {
    if (i2c1) {
        this.setUSER_CTRL(MPU9255.USERCTRL_BYTE);
        sleep.usleep(100000);

        this.setINT_CFG(MPU9255.INTCFG_BYTE);
        sleep.usleep(100000);

        this.ak8963 = new ak8963(this._config);
        return true;
    }
    return false;
};

mpu9255.prototype.getIDDevice = function() {
    if (i2c1) {
        return i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.WHO_AM_I);
    }
    return false;
};

/**
 * This wee function just simplifies the code.  It scales the Accelerometer values appropriately.
 * The values are scaled to 1g and the offset it taken into account.
 */
function scaleAccel(val, offset, scalerArr) {
    if (val < 0) {
        return -(val - offset) / (scalerArr[0] - offset);
    } else {
        return (val - offset) / (scalerArr[1] - offset);
    }
}

mpu9255.prototype.getMotion6 = function() {
    if (i2c1) {
        const buffer = Buffer.from(new ArrayBuffer(14));
        i2c1.readI2cBlockSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.ACCEL_XOUT_H, 14, buffer);
        var gCal = this._config.gyroBiasOffset;
        var aCal = this._config.accelCalibration;

        var xAccel = buffer.readInt16BE(0) * this.accelScalarInv;
        var yAccel = buffer.readInt16BE(2) * this.accelScalarInv;
        var zAccel = buffer.readInt16BE(4) * this.accelScalarInv;

        return [
            scaleAccel(xAccel, aCal.offset.x, aCal.scale.x),
            scaleAccel(yAccel, aCal.offset.y, aCal.scale.y),
            scaleAccel(zAccel, aCal.offset.z, aCal.scale.z),
            // Skip Temperature - bytes 6:7
            buffer.readInt16BE(8) * this.gyroScalarInv + gCal.x,
            buffer.readInt16BE(10) * this.gyroScalarInv + gCal.y,
            buffer.readInt16BE(12) * this.gyroScalarInv + gCal.z
        ];
    }
    return false;
};

mpu9255.prototype.getMotion9 = function() {
    if (i2c1) {
        var mpudata = this.getMotion6();
    var magdata;
        if (this.ak8963) {
            magdata = this.ak8963.getMagAttitude();
        } else {
            magdata = [0, 0, 0];
        }
        return mpudata.concat(magdata);
    }
    return false;
};

mpu9255.prototype.getAccel = function() {
    if (i2c1) {
        const buffer = Buffer.from(new ArrayBuffer(6));
        i2c1.readI2cBlockSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.ACCEL_XOUT_H, 6, buffer);
        var aCal = this._config.accelCalibration;

        var xAccel = buffer.readInt16BE(0) * this.accelScalarInv;
        var yAccel = buffer.readInt16BE(2) * this.accelScalarInv;
        var zAccel = buffer.readInt16BE(4) * this.accelScalarInv;

        return [
            scaleAccel(xAccel, aCal.offset.x, aCal.scale.x),
            scaleAccel(yAccel, aCal.offset.y, aCal.scale.y),
            scaleAccel(zAccel, aCal.offset.z, aCal.scale.z)
        ];
    }
    return false;
};

mpu9255.prototype.getGyro = function() {
    if (i2c1) {
        const buffer = Buffer.from(new ArrayBuffer(6));
        i2c1.readI2cBlockSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.GYRO_XOUT_H, 6, buffer);
        var gCal = this._config.gyroBiasOffset;
        return [
            buffer.readInt16BE(0) * this.gyroScalarInv + gCal.x,
            buffer.readInt16BE(2) * this.gyroScalarInv + gCal.y,
            buffer.readInt16BE(4) * this.gyroScalarInv + gCal.z
        ];
    }
    return false;
};

mpu9255.prototype.getClockSource = function() {
    if (i2c1) {
        return i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.RA_PWR_MGMT_1) & 0x07;
    }
    return false;
};

mpu9255.prototype.getFullScaleGyroRange = function() {
    if (i2c1) {
        var byte = i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.RA_GYRO_CONFIG);
        byte = byte & 0x18;
        byte = byte >> 3;
        return byte;
    }
    return false;
};

mpu9255.prototype.getGyroPowerSettings = function() {
    if (i2c1) {
        return i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.RA_PWR_MGMT_2);
    }
    return false;
};

mpu9255.prototype.getAccelPowerSettings = function() {
    if (i2c1) {
        return i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.RA_PWR_MGMT_2);
    }
    return false;
};

mpu9255.prototype.getFullScaleAccelRange = function() {
    if (i2c1) {
        return i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.RA_ACCEL_CONFIG_1);
    }
    return false;
};

mpu9255.prototype.getINT_CFG = function() {
    if (i2c1) {
        return i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.RA_INT_PIN_CFG);
    }
    return false;
};

mpu9255.prototype.getUSER_CTRL = function() {
    if (i2c1) {
        return i2c1.readByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.RA_USER_CTRL);
    }
    return false;
};

//Rotation in degrees X direction
mpu9255.prototype.getRoll = function(value) {
    var roll_accel = (Math.atan2(value[0], value[2]) + Math.PI) * (180 / Math.PI) - 180;
    var roll = (0.98*value[3] + 0.02*roll_accel);//use weights of gyro and accel
    return roll;
};

//Rotation in degrees Y direction
mpu9255.prototype.getPitch = function(value) {
    var pitch_accel = (Math.atan2(value[1], value[2]) + Math.PI) * (180 / Math.PI) - 180;
    var pitch = (0.98*value[4] + 0.02*pitch_accel);//use weights of gyro and accel
    return pitch; 
};

//Rotation in degrees Z direction
mpu9255.prototype.getYaw = function(value) {
    var roll_accel = (Math.atan2(value[0], value[2]) + Math.PI) * (180 / Math.PI) - 180;
    var roll = (0.98*value[3] + 0.02*roll_accel);//use weights of gyro and accel
    var pitch_accel = (Math.atan2(value[1], value[2]) + Math.PI) * (180 / Math.PI) - 180;
    var pitch = (0.98*value[4] + 0.02*pitch_accel);//use weights of gyro and accel
    var yaw = Math.atan2(-pitch,roll) * (180 / Math.PI);
    if (yaw > 360) {
        yaw -= 360;
    } else if (yaw < 0) {
        yaw += 360;
    }
    return yaw;
    //return (Math.atan2(value[2]/Math.sqrt(value[0]*value[0] + value[2]*value[2])) * (180 / Math.PI));
};

/**---------------------|[ SET ]|--------------------**/

mpu9255.prototype.setClockSource = function(adrs) {
    if (i2c1) {
        return i2c1.writeByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.RA_PWR_MGMT_1,adrs);
    }
    return false;
};

mpu9255.prototype.setFullScaleGyroRange = function(adrs) {
    if (i2c1) {
        if (this._config.scaleValues) {
            this.gyroScalarInv = 1 / MPU9255.GYRO_SCALE_FACTOR[adrs];
        } else {
            this.gyroScalarInv = 1;
        }
        return i2c1.writeByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.RA_GYRO_CONFIG, adrs);
    }
    return false;
};

mpu9255.prototype.setFullScaleAccelRange = function(adrs) {
    if (i2c1) {
        if (this._config.scaleValues) {
            this.accelScalarInv = 1 / MPU9255.ACCEL_SCALE_FACTOR[adrs];
        } else {
            this.accelScalarInv = 1;
        }
        return i2c1.writeByteSync(MPU9255.I2C_ADDRESS_AD0_LOW,MPU9255.RA_ACCEL_CONFIG_1, adrs);
    }
    return false;
};

mpu9255.prototype.setUSER_CTRL = function(adrs) {
    if (i2c1) {
        return i2c1.writeByteSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.RA_USER_CTRL, adrs);
    }
    return false;
};

mpu9255.prototype.setINT_CFG = function(adrs) {
    if (i2c1) {
        return i2c1.writeByteSync(MPU9255.I2C_ADDRESS_AD0_LOW, MPU9255.RA_INT_PIN_CFG, adrs);
    }
    return false;
};

/**---------------------|[ Print ]|--------------------**/

mpu9255.prototype.printSettings = function() {
    var CLK_RNG = [
        '0 (Internal 20MHz oscillator)',
        '1 (Auto selects the best available clock source)',
        '2 (Auto selects the best available clock source)',
        '3 (Auto selects the best available clock source)',
        '4 (Auto selects the best available clock source)',
        '5 (Auto selects the best available clock source)',
        '6 (Internal 20MHz oscillator)',
        '7 (Stops the clock and keeps timing generator in reset)'
    ];
    this.debug.Log('INFO', 'MPU9250:');
	this.debug.Log('INFO', '--> Device address: 0x' + this._config.address.toString(16));
	this.debug.Log('INFO', '--> i2c bus: ' + this._config.device);
    this.debug.Log('INFO', '--> Device ID: 0x' + this.getIDDevice().toString(16));
    this.debug.Log('INFO', '--> BYPASS enabled: ' + (this.getINT_CFG ? 'Yes' : 'No'));
	this.debug.Log('INFO', '--> i2c Master Mode: ' + (this.getUSER_CTRL === 1 ? 'Enabled' : 'Disabled'));
    this.debug.Log('INFO', '--> Power Management (0x6B, 0x6C):');
    this.debug.Log('INFO', '  --> Clock Source: ' + CLK_RNG[this.getClockSource()]);
    this.debug.Log('INFO', '  --> Accel enabled (x, y, z): ' + vectorToYesNo(this.getAccelPowerSettings()));
    this.debug.Log('INFO', '  --> Gyro enabled (x, y, z): ' + vectorToYesNo(this.getGyroPowerSettings()));
};

function vectorToYesNo(v) {
    var str = '(';
    str += v[0] ? 'No, ' : 'Yes, ';
    str += v[1] ? 'No, ' : 'Yes, ';
    str += v[2] ? 'No' : 'Yes';
    str += ')';
    return str;
}

mpu9255.prototype.printAccelSettings = function() {
    var FS_RANGE = [ '±2g (0)', '±4g (1)', '±8g (2)', '±16g (3)' ];
	this.debug.Log('INFO', 'Accelerometer:');
	this.debug.Log('INFO', '--> Full Scale Range (0x1C): ' + FS_RANGE[this.getFullScaleAccelRange()]);
	this.debug.Log('INFO', '--> Scalar: 1/' + (1 / this.accelScalarInv));
	this.debug.Log('INFO', '--> Calibration:');
	this.debug.Log('INFO', '  --> Offset: ');
	this.debug.Log('INFO', '    --> x: ' + this._config.accelCalibration.offset.x);
	this.debug.Log('INFO', '    --> y: ' + this._config.accelCalibration.offset.y);
	this.debug.Log('INFO', '    --> z: ' + this._config.accelCalibration.offset.z);
	this.debug.Log('INFO', '  --> Scale: ');
	this.debug.Log('INFO', '    --> x: ' + this._config.accelCalibration.scale.x);
	this.debug.Log('INFO', '    --> y: ' + this._config.accelCalibration.scale.y);
	this.debug.Log('INFO', '    --> z: ' + this._config.accelCalibration.scale.z);
};

mpu9255.prototype.printGyroSettings = function() {
    var FS_RANGE = ['+250dps (0)', '+500 dps (1)', '+1000 dps (2)', '+2000 dps (3)'];
	this.debug.Log('INFO', 'Gyroscope:');
    this.debug.Log('INFO', '--> Full Scale Range (0x1B): ' + FS_RANGE[this.getFullScaleGyroRange()]);
	this.debug.Log('INFO', '--> Scalar: 1/' + (1 / this.gyroScalarInv));
	this.debug.Log('INFO', '--> Bias Offset:');
	this.debug.Log('INFO', '  --> x: ' + this._config.gyroBiasOffset.x);
	this.debug.Log('INFO', '  --> y: ' + this._config.gyroBiasOffset.y);
	this.debug.Log('INFO', '  --> z: ' + this._config.gyroBiasOffset.z);
};

////////////////////////////////////////////////////////////////////////////////////
// /** ---------------------------------------------------------------------- **/ //
//  *                   Magnetometer Configuration			   *  //
// /** ---------------------------------------------------------------------- **/ //
////////////////////////////////////////////////////////////////////////////////////

var ak8963 = function(config, callback) {
    callback = callback || function() {};
    this._config = config;
    this.debug = new debugConsole(config.DEBUG);
    this._config.ak_address = this._config.ak_address || AK8963.ADDRESS;
    this._config.magCalibration = this._config.magCalibration || AK8963.DEFAULT_CALIBRATION;

    // connection with magnetometer
    sleep.usleep(10000);
    var buffer = this.getIDDevice();

    if (buffer & AK8963.WHO_AM_I_RESPONSE) {
        this.getSensitivityAdjustmentValues();
        sleep.usleep(10000);
        this.setCNTL(AK8963.CNTL_MODE_CONTINUE_MEASURE_2);
    } else {
        this.debug.Log('ERROR', 'AK8963: Device ID is not equal to 0x' + AK8963.WHO_AM_I_RESPONSE.toString(16) + ', device value is 0x' + buffer.toString(16));
    }
    callback(true);
};

ak8963.prototype.printSettings = function() {
    var MODE_LST = {
        0: '0x00 (Power-down mode)',
        1: '0x01 (Single measurement mode)',
        2: '0x02 (Continuous measurement mode 1: 8Hz)',
        6: '0x06 (Continuous measurement mode 2: 100Hz)',
        4: '0x04 (External trigger measurement mode)',
        8: '0x08 (Self-test mode)',
        15: '0x0F (Fuse ROM access mode)'
    };

    this.debug.Log('INFO', 'Magnetometer (Compass):');
    this.debug.Log('INFO', '--> i2c address: 0x' + this._config.ak_address.toString(16));
    this.debug.Log('INFO', '--> Device ID: 0x' + this.getIDDevice().toString(16));
    this.debug.Log('INFO', '--> Mode: ' + MODE_LST[this.getCNTL() & 0x0F]);
    this.debug.Log('INFO', '--> Scalars:');
    this.debug.Log('INFO', '  --> x: ' + this.asax);
    this.debug.Log('INFO', '  --> y: ' + this.asay);
    this.debug.Log('INFO', '  --> z: ' + this.asaz);
};

/**------------------|[ FUNCTION ]|------------------**/

/**---------------------|[ GET ]|--------------------**/

ak8963.prototype.getDataReady = function() {
    if (i2c1) {
        return i2c1.readByteSync(AK8963.ADDRESS, AK8963.ST1);
    }
    return false;
};

ak8963.prototype.getIDDevice = function() {
    if (i2c1) {
        return i2c1.readByteSync(AK8963.ADDRESS, AK8963.WHO_AM_I);
    }
    return false;
};

ak8963.prototype.getSensitivityAdjustmentValues = function () {
    if (!this._config.scaleValues) {
        this.asax = 1;
        this.asay = 1;
        this.asaz = 1;
        return;
    }

    // Need to set to Fuse mode to get valid values from this.
    var currentMode = this.getCNTL();
    this.setCNTL(AK8963.CNTL_MODE_FUSE_ROM_ACCESS);
    sleep.usleep(10000);

    // Get the ASA* values
    this.asax = ((i2c1.readByteSync(AK8963.ADDRESS,AK8963.ASAX) - 128) * 0.5 / 128 + 1);
    this.asay = ((i2c1.readByteSync(AK8963.ADDRESS,AK8963.ASAY) - 128) * 0.5 / 128 + 1);
    this.asaz = ((i2c1.readByteSync(AK8963.ADDRESS,AK8963.ASAZ) - 128) * 0.5 / 128 + 1);

    // Return the mode we were in before
    this.setCNTL(currentMode);
};

ak8963.prototype.getMagAttitude = function() {
    // Get the actual data
    const buffer = Buffer.from(new ArrayBuffer(6));
    i2c1.readI2cBlockSync(AK8963.ADDRESS,AK8963.XOUT_L, 6, buffer);
    var cal = this._config.magCalibration;

    // For some reason when we read ST2 (Status 2) just after reading byte, this ensures the
    // next reading is fresh.  If we do it before without a pause, only 1 in 15 readings will
    // be fresh.  The setTimeout ensures this read goes to the back of the queue, once all other
    // computation is done.
    setTimeout(function () {
        i2c1.readByteSync(AK8963.ADDRESS,AK8963.ST2);
    }, 0);

    return [
        ((buffer.readInt16LE(0) * this.asax) - cal.offset.x) * cal.scale.x,
        ((buffer.readInt16LE(2) * this.asay) - cal.offset.y) * cal.scale.y,
        ((buffer.readInt16LE(4) * this.asaz) - cal.offset.z) * cal.scale.z
    ];
};

ak8963.prototype.getCNTL = function() {
    if (i2c1) {
        return i2c1.readByteSync(AK8963.ADDRESS,AK8963.CNTL);
    }
    return false;
};

ak8963.prototype.setCNTL = function(mode) {
    if (i2c1) {
        return i2c1.writeByteSync(AK8963.ADDRESS,AK8963.CNTL, mode);
    }
    return false;
};

ak8963.prototype.constructor = ak8963;

////////////////////////////////////////////////////////////////////////////////////
// /** ---------------------------------------------------------------------- **/ //
//  *                   Kalman filter					   *  //
// /** ---------------------------------------------------------------------- **/ //
////////////////////////////////////////////////////////////////////////////////////

mpu9255.prototype.Kalman_filter = function() {
    this.Q_angle = 0.001;
    this.Q_bias = 0.003;
    this.R_measure = 0.03;

    this.angle = 0;
    this.bias = 0;
    this.rate = 0;

    this.P = [[0, 0], [0, 0]];

    this.S = 0;
    this.K = [];
    this.Y = 0;

    this.getAngle = function(newAngle, newRate, dt) {

        this.rate = newRate - this.bias;
        this.angle += dt * this.rate;

        this.P[0][0] += dt * (dt * this.P[1][1] - this.P[0][1] - this.P[1][0] + this.Q_angle);
        this.P[0][1] -= dt * this.P[1][1];
        this.P[1][0] -= dt * this.P[1][1];
        this.P[1][1] += this.Q_bias * dt;

        this.S = this.P[0][0] + this.R_measure;

        this.K[0] = this.P[0][0] / this.S;
        this.K[1] = this.P[1][0] / this.S;

        this.Y = newAngle - this.angle;

        this.angle += this.K[0] * this.Y;
        this.bias += this.K[1] * this.Y;

        this.P[0][0] -= this.K[0] * this.P[0][0];
        this.P[0][1] -= this.K[0] * this.P[0][1];
        this.P[1][0] -= this.K[1] * this.P[0][0];
        this.P[1][1] -= this.K[1] * this.P[0][1];

        return this.angle;
    };

    this.getRate     = function() { return this.rate; };
    this.getQangle   = function() { return this.Q_angle; };
    this.getQbias    = function() { return this.Q_bias; };
    this.getRmeasure = function() { return this.R_measure; };

    this.setAngle    = function(value) { this.angle = value; };
    this.setQangle   = function(value) { this.Q_angle = value; };
    this.setQbias    = function(value) { this.Q_bias = value; };
    this.setRmeasure = function(value) { this.R_measure = value; };
};

////////////////////////////////////////////////////////////////////////////////////
// /** ---------------------------------------------------------------------- **/ //
//  *                   Debug Console Configuration			   *  //
// /** ---------------------------------------------------------------------- **/ //
////////////////////////////////////////////////////////////////////////////////////

var debugConsole = function(debug) {
    this.enabled = debug || false;
};

debugConsole.prototype.Log = function(type, str) {
    if (this.enabled) {
        var date = new Date();
        var strdate = date.getDate() + '/' + (date.getMonth() + 1) + '/' + date.getFullYear();
        var strhour = date.getHours() + ':' + date.getMinutes();
        console.log('[' + type.toUpperCase() + '][' + strhour + ' ' + strdate + ']:' + str);
    }
};

debugConsole.prototype.constructor = debugConsole;

/*******************************/
/** export the module to node **/
/*******************************/

module.exports = mpu9255;