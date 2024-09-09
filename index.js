const express = require('express');
const mysql = require('mysql');
const app = express();
const port = 10300;

//DB 연결부
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'dsem1010',
  database: 'DIPDeviceRegistry'
});
//파일 입출력 가능 여부
connection.connect((err) => {
  if (err) {
    console.error('MySQL 연결 에러:', err);
    return;
  }
  console.log('MySQL 데이터베이스에 연결되었습니다.');
});

app.use(express.static('public'));

//디폴트로 index.html 켜지게
app.get('/', (req, res) => {
  res.sendFile(__dirname, 'public','index.html');
});

//itemList라우터 포인트 
app.get('/itemList', (req,res)=> {
   connection.query('SELECT item_id, registration_time, model_name, device_type, manufacturer, category FROM item_common', (err, results) => {
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

//device메인화면 라우터
app.get('/deviceList', (req,res)=> {
   const query = `
   SELECT 
     d.device_id, 
     d.device_name, 
     d.system_id, 
     d.table_name, 
     d.item_id, 
     d.deployment_time, 
     d.deployment_location, 
     d.latitude, 
     d.longitude, 
     d.enabled,
     ic.model_name
   FROM devices d
   LEFT JOIN item_common ic ON d.item_id = ic.item_id
 `;
  connection.query(query, (err, results) => {
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

//itemDetail 화면 라우터
app.get('/itemDetail', (req,res)=> {
  const itemId = req.query.item_id;
  const sql = 'SELECT item_id, registration_time, model_name, device_type, manufacturer, category FROM item_common WHERE item_id =?';
  connection.query(sql, [itemId], (err, results) =>{
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

//itemDetail 클릭시 기기 스펙 정보 가져오는 라우터
app.get('/itemSpecificDetail', (req, res) => {
  const sql = 'SELECT * FROM item_specific ORDER BY sequence'; 
  connection.query(sql, (err, results) => {
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

//디바이스 디테일 화면 라우터 
app.get('/deviceDetail', (req, res) => {
  const sql = 'SELECT * FROM devices';
  connection.query(sql, (err, results)=>{
    if(err){
      console.error('쿼리 실행 에러:', err);
      res.status(500).json({ error: '데이터베이스 에러' });
      return;
    }
    if(results.length===0){
      res.status(404).json({message:'아이템 정보가 없습니다.'});
      return;
    }
    res.json(results);
  })
})

const multer = require('multer');
const upload = multer();

//데이터 수정 라우터, 
app.post('/confirmModi', upload.none(), async (req, res) => {
  const formData = req.body;
  console.log('Received form data:', req.body);
  console.log(`${formData.manufacturer}`);
  const sqlCommon = `UPDATE item_common SET model_name = '${formData.model_name}', device_type = '${formData.device_type}', manufacturer = '${formData.manufacturer}', category = '${formData.category}' WHERE item_id = '${formData.item_id}'`;

  //전송할때 폼 데이터에 따로 추가한 변수들 파싱해서 저장
  var tableBodyRows = parseInt(formData['tableBodyRows']);
  var rows = parseInt(formData['rows']);
  var deletedRows = JSON.parse(formData.deletedRows);

  try {
    //삭제할 행이 있으면 작업 수행
    if (deletedRows.length > 0) {
      const sqlDeleteRows = `DELETE FROM item_specific WHERE sequence IN (?)`;
      //비동기 작업 : 삭제 쿼리를 실행
      await new Promise((resolve, reject) => {
        connection.query(sqlDeleteRows, [deletedRows], (err, result) => {
          if (err) {
            console.error('Error executing SQL query for deleting rows:', err);
            return reject('데이터베이스 에러');
          }
          console.log(`${result.affectedRows} rows deleted successfully from item_specific table`);
          resolve(); // 작업이 성공적으로 완료되면 resolve 함수 호출
        });
      });
    }

    //업데이트 수행하는 반복문 (수정 반복문) 기존 행 업데이트
    for (let i = 0; i < tableBodyRows; i++) {
      var seq = formData[`Dseq${i}`];
      var group = formData[`Dgroup${i}`];
      var key = formData[`Dkey${i}`];
      var value = formData[`Dvalue${i}`];
      console.log('group: ' + group);
      console.log('key: ' + key);
      console.log('value: ' + value);
      console.log(seq);

      var sqlSpecific = `UPDATE item_specific SET md_group = '${group}', md_key = '${key}', md_value = '${value}' WHERE item_id = '${formData.item_id}' AND sequence = '${seq}'`;
      //비동기로 업데이트 쿼리 실행
      await new Promise((resolve, reject) => {
        connection.query(sqlSpecific, (err, resultSpecific) => {
          console.log(sqlSpecific);
          if (err) {
            console.error('Error executing SQL query for item_specific:', err);
            return reject('데이터베이스 에러');
          }
          console.log('Changes saved to item_specific table');
          resolve();
        });
      });
    }

    //새로운 행을 item_specific 테이블에 Insert
    for (let i = tableBodyRows; i < rows; i++) {
      var group = formData[`Dgroup${i}`];
      var key = formData[`Dkey${i}`];
      var value = formData[`Dvalue${i}`];
      var seq = i + 1;

      var checkDuplicateQuery = `SELECT * FROM item_specific WHERE item_id = '${formData.item_id}' AND md_group = '${group}' AND md_key = '${key}'`;
      //중복 항목 확인을 위한 쿼리
      await new Promise((resolve, reject) => {
        //중복 항목이 없으면 return값이 0으로 반환됨
        connection.query(checkDuplicateQuery, (err, rows) => {
          if (err) {
            console.error('Error checking for duplicates:', err);
            return reject('데이터베이스 에러');
          }
          //중복 항목이 없다면 INSERT 실행
          if (rows.length === 0) {
            var sqlInsert = `INSERT INTO item_specific (item_id, md_group, md_key, md_value, sequence) VALUES ('${formData.item_id}', '${group}', '${key}', '${value}', '${seq}')`;
            connection.query(sqlInsert, (err, resultInsert) => {
              console.log(sqlInsert);
              if (err) {
                console.error('Error executing SQL query for inserting into item_specific:', err);
                return reject('데이터베이스 에러');
              }
              console.log('New row inserted into item_specific table');
              resolve();
            });
          } else {
            console.log('Duplicate entry found, skipping insertion');
            resolve();
          }
        });
      });
    }

    connection.query(sqlCommon, (err, resultCommon) => {
      console.log(sqlCommon);
      if (err) {
        console.error('Error executing SQL query for item_common:', err);
        res.status(500).json({ error: '데이터베이스 에러' });
        return;
      }
      console.log('Changes saved to item_common table');
      res.status(200).json({ message: '수정이 완료되었습니다.', item_id: formData.item_id });
    });

  } catch (error) {
    console.error('Error executing SQL query:', error);
    res.status(500).json({ error: '데이터베이스 에러' });
  }
});


const bodyParser = require('body-parser');
app.use(bodyParser.json());
app.post('/actionItemRegistration', (req, res) => {
  console.log(req.body);
  const { model_name, device_type, manufacturer, category } = req.body;

  console.log(req.body);
  if (!model_name || !device_type || !manufacturer || !category) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  const getLastItemIdQuery = 'SELECT item_id FROM item_common ORDER BY item_id DESC LIMIT 1';
  connection.query(getLastItemIdQuery, (err, result) => {
    if (err) {
      console.error('Error executing SQL query:', err);
      return res.status(500).json({ error: 'Database error.' });
    }

    const lastItemId = result.length > 0 ? result[0].item_id : 0;
    const newItemId = lastItemId + 1;

    const sql = 'INSERT INTO item_common (item_id, model_name, registration_time, device_type, manufacturer, category) VALUES (?, ?, ?, ?, ?, ?)';
    const registration_time = new Date().toISOString().slice(0, 19).replace('T', ' '); 

    connection.query(sql, [newItemId, model_name, registration_time, device_type, manufacturer, category], (err, result) => {
      if (err) {
        console.error('Error executing SQL query:', err);
        return res.status(500).json({ error: 'Database error.' });
      }
      console.log('New item added to the database:', result);
      res.status(200).json({ message: 'Item added successfully.' });
    });
  });
});


app.delete('/actionDeleteItem', (req, res) => {
  const itemId = req.query.item_id;
  console.log('Item ID:', itemId);

  const deleteItemQuery = `DELETE FROM item_common WHERE item_id = ?`;

  connection.query(deleteItemQuery, [itemId], (err, result) => {
      if (err) {
          console.error('Error deleting item from database:', err);
          return res.status(500).json({ error: 'Database error.' });
      }

      console.log('Item deleted successfully from the database.');
      res.status(200).json({ message: 'Item deleted successfully.' });
  });
});


const measurementDbConnection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'dsem1010',
  database: 'dipmeasurement' 
});

app.post('/registerDevice', (req, res) => {
  const { device_name, system_id, item_id, deployment_time, deployment_location, lat, lon } = req.body;
  
  const selectQuery = `SELECT MAX(device_id) AS max_device_id FROM devices`;
  
  connection.query(selectQuery, (err, result) => {
    if (err) {
      console.error('Error executing MySQL query:', err.stack);
      res.status(500).send('Error registering device.');
      return;
    }
    
    let maxDeviceId = (result[0].max_device_id || 0) + 1;
    const tableName = `device${maxDeviceId.toString().padStart(4, '0')}`;

    const insertQuery = `INSERT INTO devices (device_id, device_name, system_id, table_name, item_id, deployment_time, deployment_location, latitude, longitude, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    connection.query(insertQuery, [maxDeviceId, device_name, system_id, tableName, item_id, deployment_time, deployment_location, lat, lon, 1], (err, result) => {
      if (err) {
        console.error('Error executing MySQL query:', err.stack);
        res.status(500).send('Error registering device.');
        return;
      }
      console.log('Device registered successfully.');
      
      const selectItemSpecificQuery = `SELECT md_value FROM item_specific WHERE item_id = ? AND (md_key = 'sensor' OR md_key = 'actuator')`;

      connection.query(selectItemSpecificQuery, [item_id], (err, results) => {
        if (err) {
          console.error('Error fetching item specifics:', err);
          return;
        }

        let columnsSQL = results.map((row, index) => `\`${row.md_value}\` VARCHAR(255)`).join(', ');
        if (columnsSQL) columnsSQL = ', ' + columnsSQL;

        const completeCreateTableQuery = `
          CREATE TABLE IF NOT EXISTS DIPMeasurement.${tableName} (
            id INT AUTO_INCREMENT PRIMARY KEY,
            timestamp DATETIME NOT NULL
            ${columnsSQL}
          )
        `;

        measurementDbConnection.query(completeCreateTableQuery, (err, result) => {
          if (err) {
            console.error('Error creating new table:', err);
            return;
          }
          console.log('Table created successfully');
          res.status(200).send('Device registered and table created successfully.');
        });
      });
    });
  });
});

app.use(express.urlencoded({ extended: true }));
app.post('/actionDeviceModification', (req, res) => {
  const { device_id, device_name, system_id, table_name, item_id, deployment_time, deployment_location, latitude, longitude } = req.body;
  console.log(device_id);
  const sql = `
      UPDATE devices
      SET
          device_name = ?,
          system_id = ?,
          table_name = ?,
          item_id = ?,
          deployment_time = ?,
          deployment_location = ?,
          latitude = ?,
          longitude = ?
      WHERE device_id = ?
  `;

  const values = [device_name, system_id, table_name, item_id, deployment_time, deployment_location, latitude, longitude, device_id];

  connection.query(sql, values, (error, results) => {
    if (error) {
      console.error('Error updating device:', error);
      res.status(500).send('An error occurred while updating device information.');
      return;
    }

    res.redirect(`/deviceDetail.html?device_id=${device_id}`);
  });
});

app.get('/actionDeleteDevice', (req, res) => {
  const { device_id, type } = req.query;
  if (type === '1') {
    const selectQuery = `SELECT table_name FROM devices WHERE device_id = ?`;

    connection.query(selectQuery, [device_id], (err, results) => {
        if (err) {
            console.error('Error fetching table_name:', err);
            res.status(500).send('An error occurred while fetching device data.');
            return;
        }

        if (results.length > 0) {
            const tableName = results[0].table_name;

            const deleteQuery = `DROP TABLE IF EXISTS DIPMeasurement.\`${tableName}\``;
            measurementDbConnection.query(deleteQuery, (err, result) => {
                if (err) {
                    console.error('Error deleting table:', err);
                    res.status(500).send('An error occurred while deleting the table.');
                    return;
                }

                const deleteDeviceQuery = `DELETE FROM devices WHERE device_id = ?`;

                connection.query(deleteDeviceQuery, [device_id], (err, result) => {
                    if (err) {
                        console.error('Error deleting device:', err);
                        res.status(500).send('An error occurred while deleting the device record.');
                        return;
                    }

                    res.redirect('/deviceList.html');
                });
            });
        } else {
            res.status(404).send('Device not found.');
        }
    });


  } else if (type === '2') {
    const sql = 'DELETE FROM devices WHERE device_id = ?';
    connection.query(sql, [device_id], (error, results) => {
        if(error) {
            console.error('Error deleting device:', error);
            res.status(500).send('An error occurred while deleting the device record.');
            return;
        }

        res.redirect('/deviceList.html');
      });
  }
});

app.get('/getItemSpecificData', (req, res) => {
  const itemId = req.query.item_id; 
  console.log(itemId);
  if (!itemId) {
      res.status(400).json({ error: 'Item_id is missing in the request' });
      return;
  }
  
  const sql = 'SELECT md_group,md_key, md_value FROM item_specific WHERE item_id = ?';
  connection.query(sql, [itemId], (err, results) => {
      if (err) {
          console.error('Error fetching item specific data:', err);
          res.status(500).json({ error: 'Database error' });
          return;
      }
      
      if (results.length === 0) {
          res.status(404).json({ message: 'No data found for the provided item_id' });
          return;
      }
      
      res.json(results);
  });
});

app.get('/arduinoList', (req,res)=> {
  const query = `
  SELECT 
    arduinoId, 
    arduinoType, 
    measurement_cycle,
    power, 
    purpose
  FROM arduinodevices
`;
  connection.query(query, (err, results) => {
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

app.get('/arduinoPinsList', (req,res)=> {
  const query = `
  SELECT 
    pin_id, 
    arduino_id, 
    pin_num, 
    pin_type, 
    sensor_type,
    library
  FROM pins
`;
  connection.query(query, (err, results) => {
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

app.post('/registerArduino', (req, res) => {
  const { arduinoType, connectionType, measurementCycle, power, purpose } = req.body;

  const getMaxIdQuery = 'SELECT MAX(arduinoId) AS maxId FROM arduinodevices';
  connection.query(getMaxIdQuery, (err, results) => {
      if (err) {
          console.error('Error fetching max Arduino ID:', err);
          return res.status(500).send('Error fetching max Arduino ID');
      }

      const maxId = results[0].maxId || 0;
      const newId = maxId + 1;

      const insertArduinoQuery = 'INSERT INTO arduinodevices (arduinoId, arduinoType, connectionType, measurement_cycle, power, purpose) VALUES (?, ?, ?, ?, ?, ?)';
      const arduinoValues = [newId, arduinoType, connectionType, measurementCycle, power, purpose];

      connection.query(insertArduinoQuery, arduinoValues, (err, result) => {
          if (err) {
              console.error('Error inserting Arduino data:', err);
              return res.status(500).send('Error inserting Arduino data');
          }
          res.status(200).send({ message: 'Arduino data inserted successfully', arduinoId: newId });
      });
  });
});

app.post('/registerPin', (req, res) => {
  try {
  const { pinId, arduinoId, pinNum, pinType, sensorType, library } = req.body;

  const query = 'INSERT INTO pins (pin_id, arduino_id, pin_num, pin_type, sensor_type, library) VALUES (?, ?, ?, ?, ?, ?)';
  const values = [pinId, arduinoId, pinNum, pinType, sensorType, library];

  connection.query(query, values, (err, result) => {
      if (err) {
          console.error('Error inserting Pin data:', err);
          return res.status(500).send('Error inserting Pin data');
      }
      res.status(200).send('Pin data inserted successfully');
  });
  }catch (error){
    console.error('Error during pin registration:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }

});
const mqtt = require('mqtt'); // MQTT 클라이언트 추가

// MQTT 브로커 설정 (로컬 브로커 사용 시 'mqtt://localhost' 사용)
const mqttClient = mqtt.connect('mqtt://203.234.62.109:1883');

const cors = require('cors');
app.use(cors()); // 모든 도메인에서의 요청을 허용


mqttClient.on('connect', () => {
  console.log('MQTT Client Connected');
  // 특정 토픽을 구독합니다.
  mqttClient.subscribe('test/topic', (err) => {
    if (err) {
      console.error('MQTT Subscription Error:', err);
    } else {
      console.log('Subscribed to test/topic');
    }
  });
});

mqttClient.on('message', (topic, message) => {
  // 수신한 메시지를 처리합니다.
  console.log(`Received message on ${topic}: ${message.toString()}`);
});

// MQTT 메시지 발행을 위한 엔드포인트 예제
app.post('/send-mqtt', (req, res) => {
  const { topic, message } = req.body;
  mqttClient.publish(topic, message, (err) => {
    if (err) {
      res.status(500).send('Failed to publish MQTT message');
    } else {
      res.send('MQTT message sent successfully');
    }
  });
});

app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
