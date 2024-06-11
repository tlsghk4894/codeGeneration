import bluetooth

target_address = "98:DA:60:0B:C8:C6"  # 라즈베리 파이의 블루투스 주소로 대체
port = 10010

def receive_message(sock):
    while True:
        try:
            data = sock.recv(1024)
            if data:
                print("Received:", data.decode())
                send_message(sock, data)
        except KeyboardInterrupt:
            break

def send_message(sock, message):
    try:
        sock.send(message)
        print("Sent:", message.decode())
    except Exception as e:
        print("Failed to send message:", e)

def main():
    nearby_devices = bluetooth.discover_devices(duration=8, lookup_names=True, flush_cache=True)

    if target_address not in [addr for addr, _ in nearby_devices]:
        print("Cannot find target device")
        return

    print("Target device found successfully")

    sock = bluetooth.BluetoothSocket(bluetooth.RFCOMM)
    sock.connect((target_address, port))
    print("Bluetooth connection successful")

    try:
        receive_message(sock)
    except Exception as e:
        print("Error:", e)
    finally:
        sock.close()

if __name__ == "__main__":
    main()
