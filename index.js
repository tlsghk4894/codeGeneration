const express = require('express');
const mysql = require('mysql');
const app = express();
const port = 10300;

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '1234',
  database: 'DIPDeviceRegistry'
});


connection.connect((err) => {
  if (err) {
    console.error('MySQL 연결 에러:', err);
    return;
  }
  console.log('MySQL 데이터베이스에 연결되었습니다.');
});

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname, 'public','index.html');
});

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


app.post('/confirmModi', upload.none(), (req, res) => {
  const formData = req.body;
  console.log('Received form data:', req.body);
  console.log(`${formData.manufacturer}`);
  const sqlCommon = `UPDATE item_common SET model_name = '${formData.model_name}', device_type = '${formData.device_type}', manufacturer = '${formData.manufacturer}', category = '${formData.category}' WHERE item_id = '${formData.item_id}'`;

  var tableBodyRows = parseInt(formData['tableBodyRows']);
  var rows = parseInt(formData['rows']);

  var deletedRows = JSON.parse(formData.deletedRows);

  if (deletedRows.length > 0) {
      const sqlDeleteRows = `DELETE FROM item_specific WHERE sequence IN (?)`;
      connection.query(sqlDeleteRows, [deletedRows], (err, result) => {
          if (err) {
              console.error('Error executing SQL query for deleting rows:', err);
              res.status(500).json({ error: '데이터베이스 에러' });
              return;
          }
          console.log(`${result.affectedRows} rows deleted successfully from item_specific table`);
      });
  }

  for (let i = 0; i < tableBodyRows; i++) {
      var seq = formData[`Dseq${i}`];
      var group = formData[`Dgroup${i}`];
      var key = formData[`Dkey${i}`];
      var value = formData[`Dvalue${i}`];
      console.log('group: ' + group);
      console.log('key: ' + key);
      console.log('value: ' + value);
      console.log(seq);
      (function (i, seq, group, key, value) {
          var sqlSpecific = `UPDATE item_specific SET md_group = '${group}', md_key = '${key}', md_value = '${value}' WHERE item_id = '${formData.item_id}' AND sequence = '${seq}'`;
          connection.query(sqlSpecific, (err, resultSpecific) => {
              console.log(sqlSpecific);
              if (err) {
                  console.error('Error executing SQL query for item_specific:', err);
                  res.status(500).json({ error: '데이터베이스 에러' });
                  return;
              }
              console.log('Changes saved to item_specific table');
              if (i === tableBodyRows - 1) {
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
              }
          });
      })(i, seq, group, key, value);
  }

  for (let i = tableBodyRows; i < rows; i++) {
      var group = formData[`Dgroup${i}`];
      var key = formData[`Dkey${i}`];
      var value = formData[`Dvalue${i}`];
      var seq = i + 1;
      var checkDuplicateQuery = `SELECT * FROM item_specific WHERE item_id = '${formData.item_id}' AND md_group = '${group}' AND md_key = '${key}'`;
      connection.query(checkDuplicateQuery, (err, rows) => {
          if (err) {
              console.error('Error checking for duplicates:', err);
              res.status(500).json({ error: '데이터베이스 에러' });
              return;
          }
          if (rows.length === 0) {
              var sqlInsert = `INSERT INTO item_specific (item_id, md_group, md_key, md_value, sequence) VALUES ('${formData.item_id}', '${group}', '${key}', '${value}', '${seq}')`;
              connection.query(sqlInsert, (err, resultInsert) => {
                  console.log(sqlInsert);
                  if (err) {
                      console.error('Error executing SQL query for inserting into item_specific:', err);
                      res.status(500).json({ error: '데이터베이스 에러' });
                      return;
                  }
                  console.log('New row inserted into item_specific table');
              });
          } else {
              console.log('Duplicate entry found, skipping insertion');
          }
      });
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
  password: '1234',
  database: 'DIPMeasurement' 
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
// const dotenv = require('dotenv'); // dotenv 패키지를 사용하여 환경 변수 로드
// dotenv.config();
// const axios = require('axios');

// // 환경 변수에서 API 키 가져오기
// const OPENAI_API_KEY = process.env.gptKey; 
// // API 키를 클라이언트로 전달하는 엔드포인트
// app.get('/api/gpt-key', (req, res) => {
//   res.json({ gptApiKey: OPENAI_API_KEY });
// });
// OpenAI API 호출 함수
// async function generateCodeWithGPT(keywords) {
//   const api_key = OPENAI_API_KEY; 
//   const url = 'https://api.openai.com/v1/chat/completions'; 

//   const messages = [
//       { role: 'system', content: 'You are an Arduino expert. answer me arduino code and Write the Arduino code to run right away' },
//       { role: 'system', content: 'if library has value, must use library. but value is "none" just coding' },
//       { role: 'user', content: `${keywords}` },
//       { role: 'user', content: `You are an Arduino expert. Please write Arduino code that reads a sensor value"
//         The code should include the following:
//         1. Read the sensor value from Used Data.
//         2. Convert the sensor value to ppm using a linear mapping (e.g., sensorValue / 1024.0 * 1000.0).
//         3. Print the sensor data using Serial.print() and Serial.println().
//         4. Include a delay 5second between readings.
//         5. Send only the value to be sent .` },
//       { role: 'user', content: `The code currently being written will be executed through the Arduino CLI` },
//       { role: 'user', content: `If you use the library, you have to fill out the import statement correctly` }, 
//     ];

//   const data = {
//       model: 'gpt-3.5-turbo',
//       temperature: 0.5,
//       n: 1,
//       messages: messages,
//   };
//   console.log("data는",data)
//   try {
//       const response = await axios.post(url, data, {
//           headers: {
//               'Authorization': `Bearer ${api_key}`,
//               'Content-Type': 'application/json',
//           },
//       });
//       console.log(response.data)
//       return response.data.choices[0].message.content;
//   } catch (error) {
//       console.error('Error chatting with GPT:', error);
//       throw error;
//   }
// }

// // 라우트 핸들러
// app.post('/generateCode', async (req, res) => {
//   const arduinoDetails = req.body;
//   console.log(arduinoDetails);
//   try {
//       const generatedCode = await generateCodeWithGPT(JSON.stringify(arduinoDetails));
//       res.status(200).json({ code: generatedCode });
//   } catch (error) {
//       console.error('Failed to generate code:', error);
//       res.status(500).json({ error: 'Failed to generate code' });
//   }
// });


// function parseGeneratedText(text) {
//   const codeMatch = text.match(/```cpp([\s\S]*?)```/);
//   const code = codeMatch ? codeMatch[1].trim() : '';
//   return { code };
// }




// let compileResult = null;
// client.on('message', (topic, message) => {
//   if (topic === 'compile/result') {
//       compileResult = JSON.parse(message.toString());
//       console.log('Compile result received:', compileResult);  // 결과 로그 출력
//   }
// });

// // 코드를 컴파일하는 엔드포인트
// app.post('/compileCode', (req, res) => {
//   const { code } = req.body;
//   if (!code) {
//       return res.status(400).json({ error: 'No code provided' });
//   }

//   // MQTT 메시지 형식 지정
//   const mqttMessage = JSON.stringify({ code });

//   // 결과를 초기화
//   compileResult = null;

//   try {
//       // MQTT를 통해 코드를 라즈베리파이로 전송하여 컴파일
//       client.publish('compile/code', mqttMessage, (err) => {
//           if (err) {
//               console.error('Failed to send code for compilation via MQTT:', err);
//               return res.status(500).json({ error: 'Failed to send code for compilation via MQTT', details: err.message });
//           }

//           // 일정 시간 동안 결과를 기다림 (예: 5초)
//           setTimeout(() => {
//               if (compileResult) {
//                   if (compileResult.success) {
//                       res.status(200).json({ message: 'Code compiled successfully', output: compileResult.output });
//                   } else {
//                       res.status(500).json({ error: 'Compilation failed', details: compileResult.output });
//                   }
//               } else {
//                   res.status(500).json({ error: 'No compilation result received' });
//               }
//           }, 5000); // 5초 대기 (필요에 따라 조정)
//       });
//   } catch (err) {
//       console.error('Error during compilation:', err);
//       res.status(500).json({ error: 'Internal Server Error', details: err.message });
//   }
// });



// app.post('/uploadCode', (req, res) => {
//   let code, sensor_model;
//   code = req.body.code;
//   sensor_model = req.body.sensor_model;
//   console.log('Received Code:', code); // 디버깅 출력
//   console.log('Received Sensor Model:', sensor_model); // 디버깅 출력

//   if (!code) {
//     return res.status(400).json({ error: 'No code provided' });
//   }
//   if (!sensor_model) {
//     return res.status(400).json({ error: 'No sensor_model provided' });
//   }

//   // 텍스트를 파싱하여 필요한 정보 추출
//   const parsedData = {code,sensor_model};
//   console.log('Parsed Data:', parsedData); // 디버깅 출력

//   // MQTT 메시지 형식 지정
//   const mqttMessage = JSON.stringify(parsedData);

//   // MQTT를 통해 코드를 라즈베리파이로 전송
//   client.publish('upload/code', mqttMessage, (err) => {
//     if (err) {
//       console.error('Failed to send code via MQTT:', err); // 디버깅 출력
//       return res.status(500).json({ error: 'Failed to send code via MQTT', details: err.message });
//     }

//     res.status(200).json({ message: 'Code sent to Raspberry Pi via MQTT' });
//   });
// });

// const measurementDbConnection = mysql.createConnection({
//   host: 'localhost',
//   user: 'root',
//   password: '1234',
//   database: 'DIPMeasurement' 
// });
// 데이터 수신을 위한 엔드포인트

// const mqtt = require('mqtt');
// const MQTT_BROKER_URL = 'mqtt://192.168.0.207'; // 라즈베리파이의 IP 주소를 여기에 입력하세요
// const client = mqtt.connect(MQTT_BROKER_URL);

// client.on('connect', () => {
//   console.log('Connected to MQTT broker');
//   client.subscribe('compile/result');
// });

// app.post('/api/data', (req, res) => {
//   const { timestamp, ppm } = req.body;

//   const sql = `INSERT INTO device0011 (timestamp, ppm) VALUES (?, ?)`;
//   measurementDbConnection.query(sql, [timestamp, ppm], (err, result) => {
//       if (err) {
//           res.status(500).send('Database insert failed');
//           throw err;
//       }
//       res.send('Data inserted successfully');
//   });
// });

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


app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
});
