const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mqtt = require('mqtt');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

const app = express();
const port = 3000;
const MQTT_BROKER_URL = 'mqtt://192.168.0.207'; // 라즈베리파이의 IP 주소를 여기에 입력하세요
const client = mqtt.connect(MQTT_BROKER_URL);
const OPENAI_API_KEY = process.env.gptKey;

// MySQL 연결 설정
const dbConfig = {
    host: 'localhost',  // MySQL 서버 호스트
    user: 'root',       // MySQL 사용자
    password: '1234',   // MySQL 비밀번호
    database: 'dipmeasurement'  // 사용할 데이터베이스 이름
};

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let compileResult = null;
let recentGeneratedCode = {}; // 최근 생성된 코드를 저장하기 위한 객체

// MQTT 브로커 연결
client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client.subscribe('compile/result');
    client.subscribe('data/collected');
});

client.on('message', (topic, message) => {
    if (topic == 'compile/result') {
        compileResult = JSON.parse(message.toString());
        console.log('Compile result received:', compileResult);  // 결과 로그 출력
    } else if (topic == 'data/collected') {
        console.log('topic=',topic);
        const data = JSON.parse(message.toString());
        console.log('Data collected:', data);  // 수집된 데이터 로그 출력
        saveDataToDatabase(data);  // 데이터베이스에 데이터 저장
    }
});

async function saveDataToDatabase(data) {
    try {
        const connection = await mysql.createConnection(dbConfig);
        const tableName = `device${currentDeviceId.toString().padStart(4, '0')}`;

        // sensor_data와 sensor_keys를 이용하여 동적으로 컬럼과 값을 설정
        const columns = ['timestamp', ...Object.keys(data.sensors)];
        const values = [data.timestamp, ...Object.values(data.sensors)];

        const placeholders = columns.map(() => '?').join(', ');

        const query = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
        await connection.execute(query, values);
        await connection.end();
    } catch (error) {
        console.error('Error saving data to database:', error);
    }
}

// 데이터 수신 엔드포인트
app.post('/api/data', async (req, res) => {
    const data = req.body;
    try {
        await saveDataToDatabase(data);
        res.status(200).send('Data inserted successfully');
    } catch (error) {
        res.status(500).send('Database insert failed');
    }
});


// OpenAI API 호출 함수
async function generateCodeWithGPT(deviceData) {
    const api_key = OPENAI_API_KEY;
    const url = 'https://api.openai.com/v1/chat/completions';

    const messages = [
        { 
            role: 'user', 
            content: `Generate Arduino code for the following device data:
            {
                "sensors": ${JSON.stringify(deviceData.sensors)},
                "model_name": "${deviceData.model_name}",
                "purpose": "${deviceData.purpose}",
                "pins": ${JSON.stringify(deviceData.pins)},
                "device_name": "${deviceData.device_name}"
            }`
        },
        { role: 'user', content: `You are an Arduino expert. Please write Arduino code that reads from the specified sensors. The code should include the following:
            1. Properly initialize and configure the sensor(s) based on the model_name.
            2. Continuously read data from the sensor(s).
            3. Print the sensor data using Serial.print() and Serial.println().
            4. Include a delay of 5 seconds between readings.
            5. Ensure the code can be compiled and run using the Arduino CLI.
            6. If a library is required for the sensor, include the appropriate import statement.
            7. The purpose of this device is: ${deviceData.purpose}.
            8. The sensor data should be sent to a Raspberry Pi for further processing.
            9. Use the following example code as a reference for gas sensors with ppm units:
            
            #include <Wire.h> // Include the Wire library for I2C communication if needed

            const int sensorPin = A0; // Define the analog pin for sensor reading
            const int delayTime = 5000; // Delay time in milliseconds

            void setup() {
              Serial.begin(9600); // Initialize serial communication
              pinMode(sensorPin, INPUT); // Set sensor pin as input
              // Additional sensor initialization based on model_name if needed
            }

            void loop() {
              int sensorValue = analogRead(sensorPin); // Read sensor value
              float ppmValue = calculatePPM(sensorValue); // Calculate PPM value

              Serial.print("Carbon Monoxide (CO) PPM: ");
              Serial.println(ppmValue); // Print sensor data

              // Send sensor data to Raspberry Pi for further processing
              // You can implement communication protocols like I2C, Serial, etc. here

              delay(delayTime); // Delay before next reading
            }

            float calculatePPM(int sensorValue) {
              // Add your custom calculation based on the sensor's output
              // This function can vary depending on the sensor model
              // Example: conversion formula from sensor value to PPM
              float ppm = sensorValue * 0.1; // Sample conversion for illustration
              return ppm;
            }
            ` }
    ];

    const data = {
        model: 'gpt-3.5-turbo',
        temperature: 0.5,
        n: 1,
        messages: messages,
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${api_key}`,
                'Content-Type': 'application/json',
            },
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error chatting with GPT:', error);
        throw error;
    }
}

// 엔드포인트: 디바이스 목록 가져오기
app.get('/getDevices', async (req, res) => {
    try {
        const response = await axios.get('http://203.234.62.143:10300/deviceList');
        const devices = response.data;

        const arduinoDevices = devices.filter(device => device.system_id.includes('Arduino'));

        for (let device of arduinoDevices) {
            const itemSpecificDetailResponse = await axios.get(`http://203.234.62.143:10300/itemSpecificDetail?item_id=${device.item_id}`);
            const itemSpecificDetails = itemSpecificDetailResponse.data.filter(detail => detail.item_id === device.item_id);

            device.sensors = itemSpecificDetails.filter(detail => detail.md_key === 'sensor').map(detail => detail.md_value);
            device.purpose = itemSpecificDetails.find(detail => detail.md_key === 'purpose')?.md_value || 'N/A';
            device.pins = itemSpecificDetails.filter(detail => detail.md_key === 'pin').map(detail => detail.md_value);
        }

        res.json(arduinoDevices);
    } catch (error) {
        console.error('Error fetching devices:', error);
        res.status(500).json({ error: 'Failed to fetch devices' });
    }
});

// 엔드포인트: 아두이노 코드 생성
app.post('/generateCode', async (req, res) => {
    const deviceData = req.body;
    try {
        const generatedCode = await generateCodeWithGPT(deviceData);
        recentGeneratedCode[deviceData.device_id] = generatedCode; // 최근 생성된 코드를 저장
        res.status(200).json({ code: generatedCode });
    } catch (error) {
        console.error('Failed to generate code:', error);
        res.status(500).json({ error: 'Failed to generate code' });
    }
});

// 최근 생성된 코드를 가져오는 엔드포인트
app.get('/recentCode/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const code = recentGeneratedCode[deviceId];
    if (code) {
        res.status(200).json({ code });
    } else {
        res.status(404).json({ error: 'No recent code found for this device' });
    }
});

// 수집된 데이터를 가져오는 엔드포인트
app.get('/collectedData/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    try {
        const connection = await mysql.createConnection(dbConfig);
        const tableName = `device${deviceId.toString().padStart(4, '0')}`;
        const [columns] = await connection.execute(`SHOW COLUMNS FROM ${tableName}`);
        const [rows] = await connection.execute(`SELECT * FROM ${tableName} ORDER BY timestamp DESC`);
        await connection.end();
        res.json({ columns, rows });
    } catch (error) {
        console.error('Error fetching data from database:', error);
        res.status(500).json({ error: 'Failed to fetch data from database' });
    }
});

// 코드를 컴파일하는 엔드포인트
app.post('/compileCode', (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }

    const mqttMessage = JSON.stringify({ code });

    compileResult = null;

    try {
        client.publish('compile/code', mqttMessage, (err) => {
            if (err) {
                console.error('Failed to send code for compilation via MQTT:', err);
                return res.status(500).json({ error: 'Failed to send code for compilation via MQTT', details: err.message });
            }

            setTimeout(() => {
                if (compileResult) {
                    if (compileResult.success) {
                        res.status(200).json({ message: 'Code compiled successfully', output: compileResult.output });
                    } else {
                        res.status(500).json({ error: 'Compilation failed', details: compileResult.output });
                    }
                } else {
                    res.status(500).json({ error: 'No compilation result received' });
                }
            }, 5000);
        });
    } catch (err) {
        console.error('Error during compilation:', err);
        res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
});

// 코드를 업로드하는 엔드포인트
let currentDeviceId = null;

app.post('/uploadCode', (req, res) => {
    let code, sensor_model, device_id, sensors;
    code = req.body.code;
    sensor_model = req.body.sensor_model;
    device_id = req.body.device_id;
    sensors = req.body.sensors;
    console.log(sensors);

    if (!code) {
        return res.status(400).json({ error: 'No code provided' });
    }
    if (!sensor_model) {
        return res.status(400).json({ error: 'No sensor_model provided' });
    }
    if (!device_id) {
        return res.status(400).json({ error: 'No device_id provided' });
    }
    if (!sensors || !Array.isArray(sensors)) {
        return res.status(400).json({ error: 'No sensors provided or sensors is not an array' });
    }

    currentDeviceId = device_id; // 전역 변수에 저장
    const parsedData = { code, sensor_model, device_id, sensors };

    const mqttMessage = JSON.stringify(parsedData);

    client.publish('upload/code', mqttMessage, (err) => {
        if (err) {
            console.error('Failed to send code via MQTT:', err);
            return res.status(500).json({ error: 'Failed to send code via MQTT', details: err.message });
        }

        res.status(200).json({ message: 'Code sent to Raspberry Pi via MQTT' });
    });
});

// 대시보드 페이지 서빙
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
