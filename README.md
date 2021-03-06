# NodeDrone

Autonomous Drone - RaspberryPi - NodeJS

A fully autonomous drone using the Nodejs framework. Drone broadcasts local Wi-Fi connection for user to connect and provide instructions through a web interface application. 

## To-Do List
- Fine tune motor throttle settings
- Wire GPS in using UART on RPi (no longer use USB) https://learn.adafruit.com/adafruit-ultimate-gps-on-the-raspberry-pi/using-uart-instead-of-usb
- Test website function on mobile browser
- Confirm stabilizing function works in all situations

## Prerequisites

## Parts List - Hardware
### Quad Frame
My choice: Tarot 650 Sport
### Main Controller/Processor
My choice: Raspberry Pi Zero W
### IMU Sensor
My choice:
### PDB
My choice: Raspberry Pi Zero W
### GPS Board
My choice: Adafruit Ultimate GPS Breakout Board
### 4 Props
My choice: 
### 4 Brushless Motors
My choice: 
### 4 ESCs
My choice: 
### Battery
My choice: 
### Battery Charger
My choice: 
### Toggle Switch (On/Off)
My choice: 

## Package List - Software
### Before installing S/W Below!
> sudo apt-get update

> sudo apt-get upgrade
### Install NodeJS Pack
1. Install Node
> sudo apt-get install nodejs
2. Install N for easy node version control
> sudo npm install -g n
3. Install LTS latest official release
> sudo n lts
4. Confirm Node installed
> node -v
### Raspi-config
> sudo raspi-config
- I2C enabled
- SSH enabled
### Referenced NPM Libraries
- socket.io
> npm install socket.io
- express
> npm install express
- ahrs
> npm install ahrs
- i2c-bus
> npm install i2c-bus
- bmp180 (altitude)
> npm install bmp180-sensor
- pigpio
> 1. sudo apt-get install pigpio
> 2. npm install pigpio
- IMU (MPU9255)
> npm install sleep
> npm install extend
- GPS
> npm install node-gpsd
> npm install timer-node

## Built With

## Versioning
