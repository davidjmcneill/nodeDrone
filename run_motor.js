//This module is used to run motors at a specific speed and provide feedback after sending signal

function SetMotorSpeed(motor_pin,throttle,cb) {
    var pwm_freq = 1600, pwm_range = 100;

    if (throttle >= 100) {
        throttle = 99;
    }
    motor_pin.pwmFrequency(pwm_freq);
    motor_pin.pwmRange(pwm_range);
    motor_pin.pwmWrite(throttle);
    cb(throttle);
}

function SetAllMotorsSpeed(motor1_info,motor2_info,motor3_info,motor4_info,throttle,cb) {
    var pwm_freq = 1600, pwm_range = 100;

    if (throttle >= 100) {
        throttle = 99;
    }
    motor1_info.pin.pwmFrequency(pwm_freq);
    motor1_info.pin.pwmRange(pwm_range);
    motor1_info.pin.pwmWrite(throttle+motor1_info.throttle);
    motor2_info.pin.pwmFrequency(pwm_freq);
    motor2_info.pin.pwmRange(pwm_range);
    motor2_info.pin.pwmWrite(throttle+motor2_info.throttle);
    motor3_info.pin.pwmFrequency(pwm_freq);
    motor3_info.pin.pwmRange(pwm_range);
    motor3_info.pin.pwmWrite(throttle+motor3_info.throttle);
    motor4_info.pin.pwmFrequency(pwm_freq);
    motor4_info.pin.pwmRange(pwm_range);
    motor4_info.pin.pwmWrite(throttle+motor4_info.throttle);
    cb(throttle);
}

module.exports.SetMotorSpeed = SetMotorSpeed;
module.exports.SetAllMotorsSpeed = SetAllMotorsSpeed;
//lowest duty cycle where rotor moves = 22, highest = 99
//throttle range = 0 - 100 (99)




