//This module is used to setup motor in armed state
//sends high throttle, followed by low throttle as per spec

function ArmMotor(motor_pin,cb) {
    var pwm_freq = 1600,pwm_range = 100,throttle = 99;

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
module.exports.ArmMotor = ArmMotor;
//lowest duty cycle where rotor moves = 22, highest = 99
//throttle range = 0 - 100 (99)




