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
