import paho.mqtt.publish as publish

# 라즈베리파이의 IP 주소를 입력하세요.
raspberry_pi_ip = "192.168.0.207"  # 라즈베리파이의 실제 IP 주소로 변경하세요

def upload_code_to_raspberry_pi(code):
    publish.single("upload/code", code, hostname=raspberry_pi_ip, port=1883)
    print("Code sent to Raspberry Pi")

# 예제 코드
generated_code = """
void setup() {
  Serial.begin(9600);
}

void loop() {
  Serial.println("Hello, World!");
  delay(1000);
}
"""

upload_code_to_raspberry_pi(generated_code)
