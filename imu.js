//This module is used to get acceleration, angular velocity, and orientation
//from the 10DoF IMU Sensor (B) by Waveshare includes:
//BMP180 chip for temperature and pressure measurements (altitude)
//MPU9255 chip for acceleration & angular velocity
//Internal to chip - Magenetometer AK8963 output value = uT (micro Teslas)
function GetOrientation(mpu,madgwick,cb) {   
    if (mpu.initialize()) {   
        var accel = [0,0,0];
        var gyro = [0,0,0];
        var mag = [0,0,0];

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

        //console.log("Heading: %f\u00B0 ("+direction+")",Math.round(pyr["heading"]));
        cb(direction);
    }
}

function GetAltitude(BMP180,cb) {
    BMP180.fetch(function(err, data) {
        if (err) {
            //future return error to log
            cb(err);
        } else if (data) {

            // Log the pressure value
            if (data.type === 'Pressure') {
                cb(data.value);
                //console.log(data);
                //console.log(data.value);
            }
        }
    });
}

module.exports.GetAltitude = GetAltitude;
module.exports.GetOrientation = GetOrientation;
