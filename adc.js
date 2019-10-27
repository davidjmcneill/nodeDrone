//This module is used to get Analog Signal converted to digital through i2c connection
//from the PCF8591 board

function PCF8591_Data(i2c1,hex_addr,cb) {
    var PCF8591_ADDR = 0x48;
    i2c1.readByte(PCF8591_ADDR,hex_addr, function (err,byte) {
        if (err) {
            throw err;
        }
        //return data through call back
        cb(byte);
    });
        
        
        //read measurements, save the hex values, scale to proper value, and output
//        i2c1.i2cRead(PCF8591_ADDR, PCF_DATA_LENGTH, buf2, function (err) {
//            if (err) {
//                throw err;
//            }
//
//            console.log("Output:");
//            console.log(buf2);
//            
//            if (hex_addr > 0)  {
//                //get average of data points and scale to inches
//                save_data = buf2[4] * 3.3 / 512.0;
//                
//            } else {
//                //get average of data points and scale to voltage
//                save_data = buf2[4] * 3.3 / 255.0;
//            }
//            //return data through call back
//            cb(save_data);
//        });
}
module.exports.PCF8591_Data = PCF8591_Data;