//This module is used to get acceleration, angular velocity, and orientation
//from the 10DoF IMU Sensor (B) by Waveshare includes:
//BMP180 chip for temperature and pressure measurements (altitude)
//MPU9255 chip for acceleration & angular velocity
//Internal to chip - Magenetometer AK8963 output value = uT (micro Teslas)
function SetUpdateInterval(mpu,madgwick) {
    if (mpu.initialize()) {   
        var accel = [0,0,0];
        var gyro = [0,0,0];
        var mag = [0,0,0];

        setInterval(function(){
            mag = mpu.ak8963.getMagAttitude();
            accel = mpu.getAccel();
            gyro = mpu.getGyro();
        }, 200);    
        setInterval(function(){
            madgwick.update(gyro[0]*(Math.PI / 180), gyro[1]*(Math.PI / 180), gyro[2]*(Math.PI / 180), accel[0], accel[1], accel[2], mag[0], mag[1], mag[2]);
        }, 50);
    }
}

function GetOrientation(madgwick,cb) {     
    var pyr_degrees = madgwick.getEulerAnglesDegrees();//contains pitch, yaw and roll in degrees

    //console.log("Heading: %f\u00B0 ("+direction+")",Math.round(pyr["heading"]));
    cb(pyr_degrees);
}

function GetAltitude(BMP180,cb) {
    async function readBmp180() {
        const sensor = await bmp180({
            address: 0x77,
            mode: 1
        });

    const data = await sensor.read();

    console.log(data);
    cb(data.pressure);

    await sensor.close();
}
//    BMP180.fetch(function(err, data) {
//        if (err) {
//            //future return error to log
//            cb(err);
//        } else if (data) {
//
//            // Log the pressure value
//            if (data.type === 'Pressure') {
//                cb(data.value);
//                //console.log(data);
//                //console.log(data.value);
//            }
//        }
//    });
}

module.exports.SetUpdateInterval = SetUpdateInterval;
module.exports.GetAltitude = GetAltitude;
module.exports.GetOrientation = GetOrientation;
