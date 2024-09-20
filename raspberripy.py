import paho.mqtt.client as mqtt
import serial
import serial.tools.list_ports
from paho.mqtt.client import Client
from datetime import datetime
import time
import json
import os
import subprocess

# 데이터 저장 경로 설정
data_save_path = './collected_data.txt'

config_file_path = './actuator_config.json'

# 전역 변수로 config를 선언
config = {}

# arduino_config.json 파일 로드
def load_arduino_config():
    global config
    try:
        with open(config_file_path, 'r') as file:
            config = json.load(file)
        print("Config loaded successfully.")
    except Exception as e:
        print(f"Error loading config file: {e}")

# 특정 장치에 해당하는 포트를 찾음
def get_port_for_device(device_name):
    global config
    for port, devices in config.items():
        if device_name in devices:
            return port
    return None

# Arduino 포트 탐색 및 초기화
def find_arduino_ports():
    arduino_ports = []
    ports = list(serial.tools.list_ports.comports())
    for port in ports:
        # 포트의 설명에 'ttyACM' 또는 'USB Serial'이 포함된 경우 Arduino로 간주
        if 'ttyACM' in port.description or 'USB Serial' in port.description:
            arduino_ports.append(port.device)
    return arduino_ports

def initialize_arduino_ports():
    ports = find_arduino_ports()
    arduino_connections = {}
    for port in ports:
        try:
            print(f"Connecting to Arduino on port {port}")
            arduino_connections[port] = serial.Serial(port, baud_rate, timeout=1)
        except Exception as e:
            print(f"Failed to connect to Arduino on port {port}: {e}")
    if not arduino_connections:
        print("No Arduino found.")
    return arduino_connections

# 시리얼 포트와 보드레이트 설정
baud_rate = 9600
arduino_connections = initialize_arduino_ports()

# MQTT 메시지를 수신할 때 호출되는 콜백 함수
def on_message(client, userdata, message):
    msg = message.payload.decode('utf-8')
    topic = message.topic
    print(f"Received message on topic {topic}: {msg}")
    device_name = topic.split('/')[1]
    if topic.startswith("ACTUATOR"):
        # Actuator 제어 관련 메시지 처리
        handle_actuator_message(msg, device_name)
    elif topic.startswith("UPLOAD"):
        # Code 업로드 관련 메시지 처리
        handle_code_upload_message(msg,device_name)
    else:
        print(f"Unknown topic: {topic}")

def check_and_install_library(library_name):
    try:
        # Arduino CLI를 사용해 라이브러리 리스트를 확인
        result = subprocess.run(['arduino-cli', 'lib', 'list'], capture_output=True, text=True)
        
        # 이미 설치된 라이브러리가 있는지 확인
        if library_name in result.stdout:
            print(f"'{library_name}' 라이브러리는 이미 설치되어 있습니다.")
        else:
            # 라이브러리가 없다면 설치
            print(f"'{library_name}' 라이브러리가 설치되지 않았습니다. 설치를 진행합니다.")
            install_result = subprocess.run(['arduino-cli', 'lib', 'install', library_name], capture_output=True, text=True)
            if install_result.returncode == 0:
                print(f"'{library_name}' 라이브러리가 성공적으로 설치되었습니다.")
            else:
                print(f"라이브러리 설치 중 오류 발생: {install_result.stderr}")
    except Exception as e:
        print(f"라이브러리 확인/설치 중 오류 발생: {e}")
        
def handle_actuator_message(msg, device_name):
    port = get_port_for_device(device_name)
    msg_parts = msg.split(':')
    print(msg_parts)
    if len(msg_parts) != 2:
        print("Invalid message format")
        return

    msg_type, msg_content = msg_parts
    try:
        for port, arduino in arduino_connections.items():
            try: 
                if msg_content == "LED_ON":
                    arduino.write(b"ON")
                elif msg_content == "LED_OFF":
                    arduino.write(b"OFF")
                elif msg_content == "SET_COLOR_RED":
                    arduino.write(b"SET_COLOR_RED")
                elif msg_content == "SET_COLOR_GREEN":
                    arduino.write(b"SET_COLOR_GREEN")
                elif msg_content == "SET_COLOR_BLUE":
                    arduino.write(b"SET_COLOR_BLUE")
                elif msg_content == "MOTOR_START":
                    arduino.write(b"MOTOR_START")
                elif msg_content == "MOTOR_STOP":
                    arduino.write(b"MOTOR_STOP")
                elif msg_content.startswith("SERVO_ANGLE"):
                    angle = msg_content.split('_')[2]
                    arduino.write(f"SERVO_{angle}".encode())
                else:
                    print(f"Unknown actuator command {msg_content} for port {port}")
            except Exception as e:
                print(f"Failed to send command {msg_content} to Arduino on port {port}: {e}")
    except (KeyError, json.JSONDecodeError) as e:
        print(f"Failed to parse actuator message: {e}")

def handle_code_upload_message(msg,device_name):
    try:
        sketch_folder = f"./{device_name}"
        print('sketch_folder:', sketch_folder)
        check_and_install_library('Servo')
        # 파일을 디바이스 이름으로 저장
        save_code_and_upload(sketch_folder, device_name, msg)
    except (KeyError, json.JSONDecodeError) as e:
        print(f"Failed to parse upload message: {e}")

def save_code_and_upload(sketch_folder, device_name, code):
    # 스케치 폴더가 없으면 생성
    if not os.path.exists(sketch_folder):
        os.makedirs(sketch_folder)
    
    # 디바이스 이름을 기반으로 파일 경로 설정
    code_save_path = os.path.join(sketch_folder, f"{device_name}.ino")

    # 코드를 파일로 저장
    with open(code_save_path, 'w') as file:
        file.write(code)
    print(f"Code saved to file: {code_save_path}")

    try:
        # Arduino CLI 컴파일 명령어 실행
        compile_command = f"arduino-cli compile --fqbn arduino:avr:uno {sketch_folder}"
        subprocess.run(compile_command, shell=True, check=True)
        print("Code compiled successfully")

        # Arduino CLI 업로드 명령어 실행
        port = get_port_for_device(device_name)
        if port:
            upload_command = f"arduino-cli upload -p {port} --fqbn arduino:avr:uno {sketch_folder}"
            subprocess.run(upload_command, shell=True, check=True)
            print(f"Code uploaded to Arduino on port {port}")
        else:
            print(f"No port found for device {device_name}")
    except subprocess.CalledProcessError as e:
        print(f"Failed to upload code to Arduino: {e}")

# 데이터 수집 및 전송을 위한 쓰레드
data_buffer = []
MAX_BUFFER_SIZE = 10
actuator_state = "ON"

def collect_and_send_data():
    global actuator_state
    client = Client()
    client.connect("203.234.62.109", 1883, 60)  # MQTT 브로커 주소와 포트

    while True:
        for port, arduino in arduino_connections.items():
            if arduino.in_waiting > 0:
                raw_data = arduino.readline().decode('utf-8').strip()
                print(raw_data)
                try:
                    # JSON 문자열 파싱
                    data = json.loads(raw_data)
                    print(data)
                    device_id = data.get("device_id")
                    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                    sensor_data = data.get("sensor")
                    actuator_state = data.get("actuator")

                    # 전송할 데이터 포맷
                    mqtt_message = json.dumps({
                        "device_id": device_id,
                        "timestamp": timestamp,
                        "sensor_data": sensor_data,
                        "actuator_state": actuator_state
                    })
                    client.publish("SENSOR_DATA/STATUS", mqtt_message)
                    print(f"Data sent: {mqtt_message}")
                except json.JSONDecodeError as e:
                    print(f"Error parsing JSON from Arduino: {e}")
        time.sleep(1)


import threading
data_thread = threading.Thread(target=collect_and_send_data)
data_thread.daemon = True
data_thread.start()

# MQTT 클라이언트 설정
client = mqtt.Client()
client.on_message = on_message

# MQTT 브로커 연결
client.connect("203.234.62.109", 1883, 60)

# 토픽 구독
client.subscribe("#")

# Load the initial configuration
load_arduino_config()

# 메시지 루프 시작
client.loop_forever()

