//This module is used to run motors at a specific speed and provide feedback after sending signal

//This function is used to setup motor in armed state
//Sends high throttle, followed by low throttle as per spec
function ArmMotor(motor_pin,cb) {
    //maximum frequency of ESC by spec = 600Hz
    var pwm_freq = 600,pwm_range = 250,throttle = 250;

    motor_pin.pwmFrequency(pwm_freq);
    motor_pin.pwmRange(pwm_range);
    motor_pin.pwmWrite(throttle);

    //TURN OFF MOTORS AFTER 2.5 SECONDS
    setTimeout (function() {
        throttle = 5;
        motor_pin.pwmWrite(throttle);
        cb();
    }, 2500);
}

//Disarm motors to prevent accidental running
function DisarmMotor(motor_pin,cb) {
    //this condition disarms motors
    var pwm_freq = 1600,pwm_range = 120,throttle = 120;

    motor_pin.pwmFrequency(pwm_freq);
    motor_pin.pwmRange(pwm_range);
    motor_pin.pwmWrite(throttle);
    cb();
}

//Set specified motor to specified speed
function SetMotorSpeed(motor_pin,throttle,cb) {
    motor_pin.servoWrite(1000);//1000 -> lifted off almost killed me at my desk
    cb(throttle);
}

//Motor throttle climbs from 0 to 100% then 100 - 0%
//Increment scale is 10% every 1 second
function RunMotorTest(motor_pin,cb) {
    //maximum frequency of ESC by spec = 600Hz
    var pwm_freq = 600,pwm_range = 100,throttle = 0;

    //throttle up increment 10% every second
    var up = setInterval(function() {
        throttle = throttle + 10;
        if (throttle === 100) {
            throttle = 99;
        }
        if (throttle > 99) {
            throttle = 0;
            clearInterval(up);
            motor_pin.pwmFrequency(pwm_freq);
            motor_pin.pwmRange(pwm_range);
            motor_pin.pwmWrite(throttle);
            cb(throttle);
        }
        motor_pin.pwmFrequency(pwm_freq);
        motor_pin.pwmRange(pwm_range);
        motor_pin.pwmWrite(throttle);
        cb(throttle);
    }, 1000); 
}

module.exports.ArmMotor = ArmMotor;
module.exports.DisarmMotor = DisarmMotor;
module.exports.SetMotorSpeed = SetMotorSpeed;
module.exports.RunMotorTest = RunMotorTest;
//lowest duty cycle where rotor moves = 22, highest = 99
//throttle range = 0 - 100 (99)
//throttle > 100 disarms motors




