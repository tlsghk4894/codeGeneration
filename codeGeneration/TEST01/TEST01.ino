int redPin = 9;
int greenPin = 10;
int bluePin = 11;

void setup() {
  Serial.begin(9600);
  pinMode(redPin, OUTPUT);
  pinMode(greenPin, OUTPUT);
  pinMode(bluePin, OUTPUT);
}

void loop() {
  if (Serial.available() > 0) {
    String command = Serial.readString();
    
    if (command == "OFF") {
      digitalWrite(redPin, LOW);
      digitalWrite(greenPin, LOW);
      digitalWrite(bluePin, LOW);
    } else if (command == "ON") {
      setColor(255, 0, 0);
    } else if (command == "SET_COLOR_RED") {
      setColor(255, 0, 0);
    } else if (command == "SET_COLOR_GREEN") {
      setColor(0, 255, 0);
    } else if (command == "SET_COLOR_BLUE") {
      setColor(0, 0, 255);
    } else {
      Serial.println("Unsupported command");
    }
  }
}

void setColor(int red, int green, int blue) {
  analogWrite(redPin, red);
  analogWrite(greenPin, green);
  analogWrite(bluePin, blue);
}