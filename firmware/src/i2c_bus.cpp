#include "i2c_bus.h"

#include <Arduino.h>
#include <Wire.h>

#include "board.h"

namespace i2c {
namespace {
SemaphoreHandle_t g_mtx = nullptr;

struct Lock {
  Lock() { xSemaphoreTakeRecursive(g_mtx, portMAX_DELAY); }
  ~Lock() { xSemaphoreGiveRecursive(g_mtx); }
};
}  // namespace

void begin() {
  if (!g_mtx) g_mtx = xSemaphoreCreateRecursiveMutex();
  Wire.begin(board::kI2cSda, board::kI2cScl, board::kI2cHz);
  Wire.setTimeOut(20);  // ms; a missing device must not stall control loops
}

bool probe(uint8_t addr) {
  Lock l;
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool write(uint8_t addr, const uint8_t* data, size_t n) {
  Lock l;
  Wire.beginTransmission(addr);
  Wire.write(data, n);
  return Wire.endTransmission() == 0;
}

bool write_reg8(uint8_t addr, uint8_t reg, uint8_t val) {
  uint8_t b[2] = {reg, val};
  return write(addr, b, 2);
}

bool write_reg16be(uint8_t addr, uint8_t reg, uint16_t val) {
  uint8_t b[3] = {reg, uint8_t(val >> 8), uint8_t(val)};
  return write(addr, b, 3);
}

bool read_regs(uint8_t addr, uint8_t reg, uint8_t* out, size_t n) {
  Lock l;
  Wire.beginTransmission(addr);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  size_t got = Wire.requestFrom(addr, (uint8_t)n);
  if (got != n) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (size_t i = 0; i < n; ++i) out[i] = uint8_t(Wire.read());
  return true;
}

bool read_reg8(uint8_t addr, uint8_t reg, uint8_t& out) { return read_regs(addr, reg, &out, 1); }

bool read_reg16be(uint8_t addr, uint8_t reg, uint16_t& out) {
  uint8_t b[2];
  if (!read_regs(addr, reg, b, 2)) return false;
  out = uint16_t((b[0] << 8) | b[1]);
  return true;
}

bool read_raw(uint8_t addr, uint8_t* out, size_t n) {
  Lock l;
  size_t got = Wire.requestFrom(addr, (uint8_t)n);
  if (got != n) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (size_t i = 0; i < n; ++i) out[i] = uint8_t(Wire.read());
  return true;
}

void recover() {
  Lock l;
  Wire.end();
  pinMode(board::kI2cSda, INPUT_PULLUP);
  pinMode(board::kI2cScl, OUTPUT_OPEN_DRAIN);
  for (int i = 0; i < 9 && digitalRead(board::kI2cSda) == LOW; ++i) {
    digitalWrite(board::kI2cScl, LOW);
    delayMicroseconds(5);
    digitalWrite(board::kI2cScl, HIGH);
    delayMicroseconds(5);
  }
  // STOP: SDA low -> high while SCL high
  pinMode(board::kI2cSda, OUTPUT_OPEN_DRAIN);
  digitalWrite(board::kI2cSda, LOW);
  delayMicroseconds(5);
  digitalWrite(board::kI2cScl, HIGH);
  delayMicroseconds(5);
  digitalWrite(board::kI2cSda, HIGH);
  delayMicroseconds(5);
  Wire.begin(board::kI2cSda, board::kI2cScl, board::kI2cHz);
  Wire.setTimeOut(20);
}

}  // namespace i2c
