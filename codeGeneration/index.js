const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const mqtt = require('mqtt');
const dotenv = require('dotenv');
const mysql = require('mysql');
const util = require('util');

dotenv.config();

const app = express();
const port = 3000;
const MQTT_BROKER_URL = 'mqtt://203.234.62.109'; // 라즈베리파이의 IP 주소를 여기에 입력하세요
const client = mqtt.connect(MQTT_BROKER_URL);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// MySQL 연결 설정 - 데이터 수집 DB
const dbConfig = mysql.createConnection({
    host: 'localhost',  // MySQL 서버 호스트
    user: 'root',       // MySQL 사용자
    password: 'dsem1010',   // MySQL 비밀번호
    database: 'dipmeasurement'  // 사용할 데이터베이스 이름
});
dbConfig.connect((err) => {
    if (err) {
        console.error('MySQL 연결 오류:', err);
        return;
    }
    console.log('dbConfig 연결 성공');
});
// MySQL 연결 설정
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'dsem1010',
    database: 'dipdeviceregistry'
  });

connection.connect((err) => {
    if (err) {
        console.error('MySQL 연결 오류:', err);
        return;
    }
    console.log('MySQL 연결 성공');
});

// Middleware
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

let compileResult = null;
let recentGeneratedCode = {}; // 최근 생성된 코드를 저장하기 위한 객체

// MQTT 브로커 연결
client.on('connect', () => {
    console.log('Connected to MQTT broker');
    client.subscribe('SENSOR_DATA/STATUS');
});

client.on('message', async (topic, message) => {
    if (topic == 'SENSOR_DATA/STATUS') {
        const data = JSON.parse(message.toString());
        console.log('Compile result received:', data);  // 결과 로그 출력
        // 메시지가 오면 DB에 저장하는 함수 호출
        await saveDataToDatabase(data);
    }
});

// Promisify를 통해 connection.query를 promise로 사용
const query = util.promisify(connection.query).bind(connection);
const query2 = util.promisify(dbConfig.query).bind(dbConfig);

async function saveDataToDatabase(data) {
    try {
        // device_id로부터 해당 디바이스의 sensor 이름을 조회
        const sensorResult = await query(
            'SELECT md_value AS sensor_name FROM item_specific WHERE item_id = ? AND md_key = "sensor"', 
            [data.device_id]
        );
        const actuatorResult = await query(
            'SELECT md_value AS actuator_name FROM item_specific WHERE item_id = ? AND md_key = "actuator"', 
            [data.device_id]
        );
        
        // sensor_name과 actuator_name 설정
        const sensorName = sensorResult.length > 0 ? sensorResult[0].sensor_name : null;
        const actuatorName = actuatorResult.length > 0 ? actuatorResult[0].actuator_name : null;
        
        if (!actuatorName) {
            console.error(`No actuator found for device: ${data.device_id}`);
            return;
        }

        const tableName = `device${data.device_id.toString().padStart(4, '0')}`;

        // 동적으로 컬럼과 값을 설정
        const columns = ['timestamp', `\`${actuatorName}\``];  // actuatorName을 백틱으로 감쌈
        const values = [data.timestamp, data.actuator_state];

        // sensor 데이터가 존재하는 경우에만 추가
        if (sensorName && data.sensor_data) {
            columns.push(`\`${sensorName}\``);  // sensorName도 백틱으로 감쌈
            values.push(data.sensor_data);
        }

        // 컬럼과 값을 ?로 매핑
        const placeholders = columns.map(() => '?').join(', ');

        // 동적 SQL 쿼리 생성
        const queryStr = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
        await query2(queryStr, values);

        console.log(`Data saved successfully for device ${data.device_id}`);
    } catch (error) {
        console.error('Error saving data to database:', error);
    } 
}



app.get('/itemSpecificDetail', (req, res) => {
    const itemId = req.query.item_id; // 클라이언트에서 item_id 받기
  
    // 데이터베이스 쿼리 실행
    const sql = 'SELECT * FROM item_specific WHERE item_id = ?';
    connection.query(sql, [itemId], (err, results) => {
      if (err) {
        console.error('쿼리 실행 에러:', err);
        res.status(500).json({ error: '데이터베이스 에러' });
        return;
      }
  
      if (results.length === 0) {
        res.status(404).json({ message: '아이템 정보가 없습니다.' });
        return;
      }
  
      res.json(results);
    });
  });


async function generateCodeWithGPT(deviceData) {
    const api_key = OPENAI_API_KEY;
    const url = 'https://api.openai.com/v1/chat/completions';

    // 메타데이터 파싱
    const metadata = deviceData.itemSpecificDetails.reduce((acc, detail) => {
        acc[detail.md_key] = detail.md_value;
        return acc;
    }, {});
    const controlCommands = metadata.control_commands ? metadata.control_commands.split(',') : [];
    


    // 하나의 파일에 모든 명령어에 대한 코드를 생성하도록 messages 준비
    const messageContent = `
        Generate Arduino code for the following device data:
        {
            "device_id": ${deviceData.device_id},
            "device_name": "${deviceData.device_name}",
            "model_name": "${deviceData.model_name}",
            "purpose": "${deviceData.purpose}",
            ${Object.keys(metadata).map(key => `"${key}": "${metadata[key]}"`).join(',\n')}
        }
        Please create an Arduino program that handles the following commands: ${controlCommands.join(', ')}.

        Generate Arduino code that:

        1. Initializes the sensor pins and actuator pins based on the actuator type (e.g., RGB LED, Servo Motor, or LCD Display).
        2. Creates variables based on the device data.
        3. Creates a variable to store the actuator state with the initial value of metadata.initial_value.
        4. Listens for commands from the Raspberry Pi to control the actuator:
        
            **If the actuator type is "RGBLED"**:
            
                Here is the structure for the code. Follow this format to generate the Arduino program:

                1. **Setup:**
                    - Initialize the pins for the actuator.
                    - Set up the serial communication.

                2. **Loop:**
                    - Continuously read commands from the serial input.
                    - Handle different RGB LED commands such as 'ON', 'SET_COLOR_RED', 'SET_COLOR_GREEN', 'SET_COLOR_BLUE', and 'OFF'.
                    - After executing a command, send the current color as actuator state to the Raspberry Pi.
                    - Ensure that the actuator state is sent in the following format:
                        - "{ \\"device_id\\": \\"<device_id>\\", \\"sensor\\": \\"N/A\\", \\"actuator\\": \\"<currentColor>\\" }"               
                    - The actuator state should be sent at a regular interval (e.g., every second).
                    - Include functions for setting the color of the RGB LED based on the command received.
                    - Ensure that the code is modular and easy to understand.
                    - Declare and output the name and status of the RGB LED as a variable. The name of the variable should be the name of the actuator, and the value of that variable should represent the status of the RGB LED.
                    - The "delay" value should not default to 1000 unless specifically provided in the metadata. Instead, it should be based on the provided "delay" metadata for this device.
                 3. **Example Code:**
                    - The following is an example code snippet for an RGB LED actuator:
                        int redPin = 9;
                        int greenPin = 10;
                        int bluePin = 11;
                        int delay = 5000;
                        String currentColor = "255 0 0";

                        void setup() {
                            pinMode(redPin, OUTPUT);
                            pinMode(greenPin, OUTPUT);
                            pinMode(bluePin, OUTPUT);
                            Serial.begin(9600);
                        }

                        void loop() {
                            if (Serial.available() > 0) {
                                String command = Serial.readStringUntil('\\n');
                                if (command == "ON") {
                                    setColor(currentColor);
                                } else if (command == "SET_COLOR_RED") {
                                    currentColor = "255 0 0";
                                    setColor(currentColor);
                                } else if (command == "SET_COLOR_GREEN") {
                                    currentColor = "0 255 0";
                                    setColor(currentColor);
                                } else if (command == "SET_COLOR_BLUE") {
                                    currentColor = "0 0 255";
                                    setColor(currentColor);
                                } else if (command == "OFF") {
                                    setColor("0 0 0");
                                }
                            }

                            // Send current state
                            Serial.print("{ \"device_id\": \"1\", \"actuator\": \"" + currentColor + "\" }");
                        }

                        void setColor(String color) {
                            int redValue = color.substring(0, color.indexOf(' ')).toInt();
                            color = color.substring(color.indexOf(' ') + 1);
                            int greenValue = color.substring(0, color.indexOf(' ')).toInt();
                            int blueValue = color.substring(color.indexOf(' ') + 1).toInt();

                            analogWrite(redPin, redValue);
                            analogWrite(greenPin, greenValue);
                            analogWrite(bluePin, blueValue);
                        }

            **If the actuator type is "ServoMotor"**:
                Here is the structure for the code. Follow this format to generate the Arduino program:

                1. **Setup:**
                    - Initialize the Servo motor pin.
                    - Set up the serial communication.

                2. **Loop:**
                    - Continuously read commands from the serial input.
                    - Handle Servo motor angle control commands such as 'SERVO_ANGLE_0', 'SERVO_ANGLE_90', 'SERVO_ANGLE_180', and 'OFF'.
                    - After executing a command, send the current servo angle as actuator state to the Raspberry Pi.
                3. **Example Code:**
                    #include <Servo.h>
                    Servo servoMotor;
                    int currentServoAngle = 0;

                    void setup() {
                        servoMotor.attach(9);  // Attach the Servo motor to pin 9
                        Serial.begin(9600);    // Initialize serial communication
                    }

                    void loop() {
                        if (Serial.available() > 0) {
                            String command = Serial.readStringUntil('\\n');
                            handleServoCommand(command);
                        }

                        // Send current servo angle as actuator state
                        Serial.print("{ \"device_id\": \"2\", \"actuator\": \"" + String(currentServoAngle) + "\" }");

                        delay(5000); 
                    }

                    // Handle Servo motor angle commands
                    void handleServoCommand(String command) {
                        if (command == "ROTATE_0") {
                            servoMotor.write(0);
                            currentServoAngle = 0;
                        } else if (command == "ROTATE_90") {
                            servoMotor.write(90);
                            currentServoAngle = 90;
                        } else if (command == "ROTATE_180") {
                            servoMotor.write(180);
                            currentServoAngle = 180;
                        } else if (command == "OFF") {
                            servoMotor.write(0);  // Reset the Servo motor to 0 degrees
                            currentServoAngle = 0;
                        }
                    }
            **If the actuator type is "LcdDisplay"**:
                Here is the structure for the code. Follow this format to generate the Arduino program:
                DO NOT INCLUDE SERVO MOTOR CODE IN THE LCD DISPLAY CODE.
                1. **Setup:**
                    - Initialize the LCD display with the corresponding pin setup.
                    - Set up the serial communication.
                    - Display an initial message on the LCD (e.g., "Welcome!").

                2. **Loop:**
                    - Continuously listen for commands from the Raspberry Pi to control the LCD.
                    - Handle commands such as 'CLEAR' to clear the display and 'WRITE_TEXT' to write text on the LCD.
                3. **Example Code:**
                    #include <LiquidCrystal.h>
                    // LCD pins: RS, EN, D4, D5, D6, D7
                    LiquidCrystal lcd(3, 4, 10, 11, 12, 13);
                    String currentMessage = "Welcome!";

                    void setup() {
                        lcd.begin(16, 2);  // Initialize the LCD with 16 columns and 2 rows
                        lcd.print(currentMessage);  // Display the initial message
                        Serial.begin(9600);         // Initialize serial communication
                    }

                    void loop() {
                        if (Serial.available() > 0) {
                            String command = Serial.readStringUntil('\\n');
                            handleLcdCommand(command);
                        }

                        // Send the current message displayed on the LCD as actuator state
                        Serial.print("{ \"device_id\": \"3\", \"actuator\": \"" + currentMessage + "\" }");

                        delay(5000);
                    }

                    // Handle LCD display commands
                    void handleLcdCommand(String command) {
                        if (command == "CLEAR") {
                            lcd.clear();  // Clear the display
                            currentMessage = "";  // Update the actuator state
                        } else if (command.startsWith("WRITE_TEXT")) {
                            String text = command.substring(11);  // Extract the text to display
                            lcd.clear();  // Clear the display before writing new text
                            lcd.print(text);
                            currentMessage = text;  // Update the actuator state
                        }
                    }
        5. Continuously collect sensor data from the specified sensor pins and store it in the sensor variable created earlier (if applicable).
        6. Continuously monitor and update the actuator state.
        7. Implement logic to send both the sensor data and the actuator state to the Raspberry Pi via "Serial.print()". The format should be:
            - "{ \\"device_id\\": \\"<device_id>\\", \\"sensor\\": \\"<sensorValue>\\", \\"actuator\\": \\"<actuatorState>\\" }"
        8. Ensure that sensor data and actuator state are sent continuously at a regular interval (e.g., every second).
        9. Include functions for handling incoming commands, updating the actuator state, and sending data to the Raspberry Pi.
        10. Ensure that the code is modular, clear, and free from unnecessary comments or explanations.
        11. Declare and output the name and status of each actuator as a variable. The name of the actuator should be the name of the variable, and the value of that variable should represent the status of that actuator.
        12. The "delay" value should not default to 1000 unless specifically provided in the metadata. Instead, it should be based on the provided "delay" metadata for this device.

        Focus on:
        - Continuously sending formatted sensor data and actuator state.
        - Sending both sensor data and actuator state at regular intervals.
        - Maintaining a clear and organized code structure with no additional explanations or comments.

        Provide only the Arduino code without additional explanations or comments.

        Requirements for the code:
        1. Use the Arduino programming language.
        2. Include the necessary libraries for sensor and actuator interfacing.
        3. Implement the code in a modular and reusable manner.
        4. Do not use any symbol or character that is not supported by the Arduino IDE.
        5. Do not use any sentence that is not related to the code generation task.
        6. Only include the necessary code to fulfill the requirements mentioned above.
        7. Continuously transmit both the sensor data and the actuator state to the Raspberry Pi via Serial communication.
        8. Only include the Arduino code. **Do not include any language tags, explanations, or comments** (like cpp etc.).
    `;




    const messages = [
        {
            role: 'user',
            content: messageContent
        }
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

        const code = response.data.choices[0].message.content;

        // // device_name을 파일명으로 사용하여 모든 명령어를 하나의 파일로 저장
        // const fileName = `${deviceData.device_name.replace(/\s+/g, '_')}.ino`; // 파일명에 공백을 언더스코어로 대체
        // fs.writeFileSync(`./${fileName}`, code, 'utf8');
        // console.log(`${fileName} 파일이 생성되었습니다.`);
        // MQTT 클라이언트를 사용하여 파일 내용을 전송
        const mqttClient = mqtt.connect('mqtt://203.234.62.109:1883');
        mqttClient.on('connect', () => {
            console.log('MQTT 클라이언트가 연결되었습니다.');

            // device_name을 사용하여 토픽 정의
            const topic = `UPLOAD/${deviceData.device_name.replace(/\s+/g, '_')}`; // 공백을 언더스코어로 대체
            mqttClient.publish(topic, code, (err) => {
                if (err) {
                    console.error('MQTT 메시지 전송 실패:', err);
                } else {
                    console.log(`MQTT 메시지가 ${topic} 토픽으로 전송되었습니다.`);
                }
                mqttClient.end();
            });
        });
        return code;

    } catch (error) {
        console.error('Error generating code:', error);
    }
}


// 엔드포인트: 디바이스 목록 가져오기
app.get('/getDevices', async (req, res) => {
    try {
        //디바이스 레지스트리에서 디바이스 목록 가져오기
        const response = await axios.get('http://203.234.62.142:10300/deviceList');
        const devices = response.data;
        console.log('devices:',devices);
        //System_id를 통해 필터링 진행 (Arduino에 관련된 값만 가져오기 위해)
        const arduinoDevices = devices.filter(device => device.system_id.includes('Arduino'));

        //필터링 된 기기들의 정보를 가져오기 위한 반복문
        for (let device of arduinoDevices) {
            const itemSpecificDetailResponse = await axios.get(`http://203.234.62.142:10300/itemSpecificDetail?item_id=${device.item_id}`);
            const itemSpecificDetails = itemSpecificDetailResponse.data.filter(detail => detail.item_id === device.item_id);
            
            //코드 생성에 필요하다고 생각되는 것들을 리스트업
            device.sensors = itemSpecificDetails.filter(detail => detail.md_key === 'sensor').map(detail => detail.md_value);
            device.purpose = itemSpecificDetails.find(detail => detail.md_key === 'purpose')?.md_value || 'N/A';
            // device.Sensor_Pins = itemSpecificDetails.filter(detail => detail.md_key === 'sensor_pin').map(detail => detail.md_value);
            device.Actuator_Pins = itemSpecificDetails.filter(detail => detail.md_key.includes('pin')).map(detail => detail.md_value);
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
    console.log("deviceData: ",deviceData);
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
app.get('/monitoring', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Monitoring.html'));
});

// 대시보드 페이지 서빙
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
