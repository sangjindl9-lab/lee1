#include "pzem.h"

#include <Arduino.h>

#include "board.h"

namespace pzem {

static HardwareSerial& port() { return Serial2; }

void begin() {
  port().begin(board::kPzemBaud, SERIAL_8N1, board::kPzemRx, board::kPzemTx);
  port().setTimeout(50);
}

bool read(hw::PzemReading& out) {
  uint8_t req[8];
  hw::pzem_build_read(board::kPzemAddr, 0x0000, 10, req);
  while (port().available()) port().read();  // drop stale bytes
  port().write(req, sizeof(req));
  port().flush();

  uint8_t buf[25];
  size_t got = 0;
  uint32_t start = millis();
  uint32_t last = start;
  while (got < sizeof(buf)) {
    int c = port().read();
    uint32_t now = millis();
    if (c >= 0) {
      buf[got++] = uint8_t(c);
      last = now;
      // An exception reply is 5 bytes: function | 0x80
      if (got == 5 && (buf[1] & 0x80)) break;
      continue;
    }
    if (now - start > 250) break;                 // overall timeout
    if (got > 0 && now - last > 20) break;        // inter-frame gap (UART driver delivers in bursts)
    vTaskDelay(pdMS_TO_TICKS(2));
  }
  return hw::pzem_parse(buf, got, board::kPzemAddr, out);
}

}  // namespace pzem

namespace rs485 {

void begin(uint32_t baud) {
  pinMode(board::kRs485De, OUTPUT);
  digitalWrite(board::kRs485De, LOW);  // receive by default
  Serial1.begin(baud, SERIAL_8N1, board::kRs485Rx, board::kRs485Tx);
}

void send(const uint8_t* data, size_t n) {
  digitalWrite(board::kRs485De, HIGH);
  Serial1.write(data, n);
  Serial1.flush();  // returns after the TX FIFO has drained
  digitalWrite(board::kRs485De, LOW);
}

size_t receive(uint8_t* buf, size_t n, uint32_t timeout_ms) {
  size_t got = 0;
  uint32_t last = millis();
  while (got < n) {
    int c = Serial1.read();
    if (c >= 0) {
      buf[got++] = uint8_t(c);
      last = millis();
    } else if (millis() - last > timeout_ms) {
      break;
    } else {
      vTaskDelay(pdMS_TO_TICKS(1));
    }
  }
  return got;
}

}  // namespace rs485
