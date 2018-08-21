//This module is used to deploy and retract landing gear arms
var pigpio = require('pigpio'),
    Gpio = pigpio.Gpio;

function WakeGear(pin) {
    pin.servoWrite(1600);//must do this first for short time, not sure why
    setTimeout(function() {
        console.log("Gear Ready");
    }, 500);
}

function DeployGear(pin) {
    pin.servoWrite(0);//deploys gear
    console.log("Deploying Gear");
    setTimeout(function() {
        console.log("Gear Deployed");
    }, 7500);
}

function RetractGear(pin) {
    pin.servoWrite(500);//retracts gear
    console.log("Retracting Gear");
   
    setTimeout(function() {
        console.log("Gear Retracted");
    }, 7500);
}

module.exports.WakeGear = WakeGear;
module.exports.DeployGear = DeployGear;
module.exports.RetractGear = RetractGear;