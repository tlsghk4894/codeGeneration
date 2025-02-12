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
const MQTT_BROKER_URL = 'mqtt://203.234.62.109'; 
const client = mqtt.connect(MQTT_BROKER_URL);
//시스템 환경변수 편집
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
        latestData = JSON.parse(message.toString()); // 메시지를 JSON으로 파싱
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
        const columns = ['timestamp'];  // actuatorName을 백틱으로 감쌈
        const values = [data.timestamp];

        // sensor 데이터가 존재하는 경우에만 추가
        if (sensorName && data.sensor_data) {
            columns.push(`\`${sensorName}\``);  // sensorName도 백틱으로 감쌈
            values.push(data.sensor_data);
        }
        if(data.actuator_data){
            columns.push(`\`${actuatorName}\``);
            values.push(data.actuator_data);
        }
        if (data.temperature && !columns.includes('`temperature`')) {
            columns.push('`temperature`');
            values.push(data.temperature);
        }
        if (data.humidity && !columns.includes('`humidity`')) {
            columns.push('`humidity`');
            values.push(data.humidity);
        }
        if (data.dust && !columns.includes('`dust`')) {
            columns.push('`dust`');
            values.push(data.dust);
        }
         // 추가적인 데이터가 존재할 경우 모두 추가
        if (data.rgb_led && !columns.includes('`rgb_led`')) {
            columns.push('`rgb_led`');
            values.push(data.rgb_led);
        }
        if (data.fan && !columns.includes('`fan`')) {
            columns.push('`fan`');
            values.push(data.fan);
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

app.get('/getDeviceData', async (req, res) => {
    const tableName = req.query.table; // 요청에서 테이블 이름을 가져옴
    const sensorNames = req.query.sensors ? req.query.sensors.split(',') : []; // 요청에서 센서 이름 가져오기
    const actuatorNames = req.query.actuators ? req.query.actuators.split(',') : []; // 요청에서 액추에이터 이름 가져오기
    console.log(sensorNames, actuatorNames);
    if (!tableName) {
        return res.status(400).json({ error: 'Table name is required.' });
    }

    try {
        // 최신 데이터를 가져오는 쿼리
        const rows = await query2(`SELECT * FROM ?? ORDER BY timestamp DESC LIMIT 1`, [tableName]);

        if (rows.length === 0) {
            return res.json({
                sensor_data: sensorNames.map(name => ({ name, value: 'No data available' })),
                actuator_data: actuatorNames.map(name => ({ name, value: 'No data available' }))
            });
        }

        const latestData = rows[0];
        console.log('Latest data:', latestData);
        // 센서 및 액추에이터 데이터 매핑
        const sensorData = sensorNames.map(name => ({
            name,
            value: latestData[name] || 'N/A'
        }));

        const actuatorData = actuatorNames.map(name => ({
            name,
            value: latestData[name] || 'N/A'
        }));

        res.json({
            sensor_data: sensorData,
            actuator_data: actuatorData
        });
        console.log(sensorData, actuatorData);
    } catch (error) {
        console.error('Error fetching device data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


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
    const metadata = deviceData.metadata;
    const controlCommands = metadata.control_commands ? metadata.control_commands.split(',') : [];
    

    const messageContent = `
        Generate Arduino code for the following device data:
        {
            "device_id": ${deviceData.device_id},
            "device_name": "${deviceData.device_name}",
            ${Object.keys(metadata).map(key => `"${key}": "${metadata[key]}"`).join(',\n')}
        }

        The device could be an RGB LED, Servo Motor, or LCD Display. Generate **only** the necessary Arduino code for the specific device type, without any conditional statements (e.g., no if-statements for device types).

        1. **Do not include any conditional statements (if-else, For ~:)**:
            - The code should be specific to the provided device data without any conditions to check the device type.

        2. **Do not include code block markers like \`\`\` or comments**:
            - The code should be pure Arduino code without additional markers or comments.

        3. **Variable Declaration**:
        - Declare a variable \`device_id\` with the provided device_id value.
        - Declare a variable \`currentActuatorState\` to store the state of the actuator (e.g., current color for RGB LED, angle for Servo Motor, message for LCD Display).
        - Declare any other necessary variables based on the provided metadata.
        - if the device has library imports, include them at the beginning of the code.

        4. **Setup Function**:
        - Initialize the pins and set up the serial communication in the \`setup()\` function.
        
        5. **Loop Function**:
        - Continuously listen for commands and update the \`currentActuatorState\` based on the command received.
        - For an RGB LED, handle commands like 'ON', 'SET_COLOR_RED', 'SET_COLOR_GREEN', 'SET_COLOR_BLUE', and 'OFF'.
        - For a Servo Motor, handle commands like 'ROTATE_0', 'ROTATE_90', 'ROTATE_180', and 'OFF'.
        - For an LCD Display, handle commands like 'WRITE_TEXT', 'CLEAR', etc.

        6. **Initialize the device and handle commands**:
            - For an **RGB LED**, initialize RGB LED pins and handle commands like 'ON', 'SET_COLOR_RED', 'SET_COLOR_GREEN', 'SET_COLOR_BLUE', and 'OFF'.
            - For a **Servo Motor**, initialize the servo pin and handle commands like 'ROTATE_0', 'ROTATE_90', 'ROTATE_180', and 'OFF'.
            - For an **LCD Display**, initialize LCD pins and handle commands like 'WRITE_TEXT' and 'CLEAR'.

        7. **Send actuator state**:
            if the device has a metadata.sensor_pin, send the sensor data as well in the same format:
                - "{ \\"device_id\\": \\"<device_id>\\", \\"actuator\\": \\"<currentActuatorState>\\", \\"sensor\\": \\"<currentSensorData>\\" }"
            else, send the current state of the actuator (e.g., color for RGB LED, angle for Servo Motor, message for LCD Display) to the Raspberry Pi at regular intervals. Use this format:
            - "{ \\"device_id\\": \\"<device_id>\\", \\"actuator\\": \\"<currentActuatorState>\\" }"
        Ensure the code is specific to the provided device and follows the above requirements. Do not include any unnecessary code, comments, explanations, or conditional logic for different device types.
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
        return code;

    } catch (error) {
        console.error('Error generating code:', error);
    }
}

// 메타데이터 저장 엔드포인트 (갱신 포함)
app.post('/savemetadata', async (req, res) => {
    const { device_id, metadata } = req.body; // device_id와 메타데이터 객체 받음

    if (!device_id || !metadata || Object.keys(metadata).length === 0) {
        return res.status(400).json({ error: 'Device ID and metadata are required' });
    }

    try {
        // 1. 먼저 기존 데이터를 완전히 삭제
        const deleteQuery = `DELETE FROM code_generation_metadata WHERE device_id = ?`;
        await query(deleteQuery, [device_id]);

        // 2. 기존 데이터 삭제 성공 후 새로 메타데이터 삽입
        const queries = [];
        for (const key in metadata) {
            const value = metadata[key];
            const queryStr = `INSERT INTO code_generation_metadata (device_id, \`key\`, \`value\`) VALUES (?, ?, ?)`;
            queries.push(query(queryStr, [device_id, key, value])); 
        }

        // 3. 메타데이터 저장 완료
        await Promise.all(queries);  
        res.status(200).json({ message: 'Metadata saved successfully' });
    } catch (error) {
        console.error('Error saving metadata:', error);
        res.status(500).json({ error: 'Failed to save metadata' });
    }
});

// 메타데이터 조회 엔드포인트
app.get('/getMetadata/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    try {
        const queryStr = `SELECT \`key\`, \`value\` FROM code_generation_metadata WHERE device_id = ?`;
        const rows = await query(queryStr, [deviceId]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'No metadata found for this device' });
        }

        // 메타데이터를 key-value 쌍으로 반환
        const metadata = {};
        rows.forEach(row => {
            metadata[row.key] = row.value;
        });

        res.status(200).json(metadata);
    } catch (error) {
        console.error('Error fetching metadata:', error);
        res.status(500).json({ error: 'Failed to fetch metadata' });
    }
});


// 엔드포인트: 가장 최근의 센서 데이터를 가져오는 API
app.get('/get-sensor-data', async (req, res) => {
    try {
        // CO 센서 데이터를 수집할 테이블 이름 (예: CO 센서 데이터가 저장된 테이블)
        const sensorTable = 'device0001';  // 디바이스 ID에 따라 테이블 이름을 설정
        const sensorColumn = 'MQ7';  // 센서 컬럼 이름
        
        // 가장 최근의 데이터를 조회하는 SQL 쿼리
        const queryStr = `SELECT \`${sensorColumn}\` as co_level FROM ${sensorTable} ORDER BY timestamp DESC LIMIT 1`;
        
        // 데이터베이스 쿼리 실행
        const [rows] = await query2(queryStr);
        
        console.log('Query result:', rows);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No sensor data found' });
        }
        
        // 최신 센서 데이터를 클라이언트로 전송
        const latestData = rows.co_level;
        console.log('Latest sensor data:', latestData);
        res.json({
            co_level: latestData
        });
        
    } catch (error) {
        console.error('Error fetching sensor data:', error);
        res.status(500).json({ error: 'Failed to fetch sensor data' });
    }
});
app.get('/api/get-latest-data', (req, res) => {
    const query = `SELECT * FROM device0004 ORDER BY timestamp DESC LIMIT 1`;

    dbConfig.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching data:', err);
            res.status(500).json({ error: 'Failed to fetch data' });
            return;
        }

        if (results.length === 0) {
            res.status(404).json({ message: 'No data found' });
            return;
        }

        res.json(results[0]);
    });
});


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
            device.sensor = itemSpecificDetails.filter(detail => detail.md_key === 'sensor').map(detail => detail.md_value);
            // device.purpose = itemSpecificDetails.find(detail => detail.md_key === 'purpose')?.md_value || 'N/A';
            // device.Sensor_Pins = itemSpecificDetails.filter(detail => detail.md_key === 'sensor_pin').map(detail => detail.md_value);
            device.actuator = itemSpecificDetails.filter(detail => detail.md_key.includes('actuator')).map(detail => detail.md_value);
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
app.post("/compile/:device_name", (req, res) => {
    const device_name = req.params.device_name;
    const code = req.body.code;

    // MQTT 토픽 설정
    const topic = `compile/${device_name}`;

    console.log(`Sending code to topic: ${topic}`); // 전송할 토픽 확인 로그

    // MQTT로 코드 전송
    client.publish(topic, code, (error) => {
        if (error) {
            console.error("Failed to send code:", error);
            return res.json({ success: false, message: "코드 전송 실패" });
        }

        // 성공적으로 전송된 경우 로그 출력
        console.log(`Code successfully sent to topic: ${topic}`);
        res.json({ success: true, message: "코드가 성공적으로 전송되었습니다. 컴파일 결과를 기다리세요." });
    });
});

// 코드를 업로드하는 엔드포인트
app.post("/upload/:device_name", (req, res) => {
    const code = req.body.code;
    const device_name = req.params.device_name;
    const client = mqtt.connect("mqtt://203.234.62.109:1883");

    client.on("connect", () => {
        client.publish(`UPLOAD/${device_name}`, code, (error) => {
            client.end();
            if (error) {
                return res.json({ success: false, error });
            }
            res.json({ success: true });
        });
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
