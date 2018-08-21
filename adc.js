//This module is used to get Analog Signal converted to digital through i2c connection
//from the PCF8591 board

function PCF8591_Data(i2c1,hex_addr,cb) {
    var PCF8591_ADDR = 0x48,
    PCF_DATA_LENGTH = 24;
    const ab = new ArrayBuffer(24);
    const buf = Buffer.from(ab);
    for (var i = 0; i < 23; i++) {
        buf[i] = hex_addr;// 0x00 for battery voltage, 0x01 for ultrasonic sensor distance
    }
    var save_data = 0;

    i2c1.i2cWrite(PCF8591_ADDR, PCF_DATA_LENGTH, buf, function (err) {
        if (err) {
            throw err;
        }
        //read 16 measurements, save the hex values, scale to proper value, and output
        i2c1.i2cRead(PCF8591_ADDR, PCF_DATA_LENGTH, buf, function (err) {
            if (err) {
                throw err;
            }
            //add up all data points from buffer, discard first 3
            for (var i = 3; i <= 23; i++) {
                save_data = buf[i] + save_data;
            }
            console.log(buf);
            if (hex_addr > 0)  {
                //get average of data points and scale to inches
                save_data = (save_data / 24) * 1.5;
                
            } else {
                //get average of data points and scale to voltage
                save_data = (save_data / 24) * 3.3 / 255.0;
            }
            //return data through call back
            cb(save_data);
        });
    });
}
module.exports.PCF8591_Data = PCF8591_Data;