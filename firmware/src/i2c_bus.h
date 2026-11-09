// Shared I2C bus (Wire) with a FreeRTOS mutex so register transactions from
// different tasks never interleave.
#pragma once

#include <cstddef>
#include <cstdint>

namespace i2c {

void begin();
bool probe(uint8_t addr);
bool write(uint8_t addr, const uint8_t* data, size_t n);
bool write_reg8(uint8_t addr, uint8_t reg, uint8_t val);
bool write_reg16be(uint8_t addr, uint8_t reg, uint16_t val);
bool read_regs(uint8_t addr, uint8_t reg, uint8_t* out, size_t n);
bool read_reg8(uint8_t addr, uint8_t reg, uint8_t& out);
bool read_reg16be(uint8_t addr, uint8_t reg, uint16_t& out);
// Raw read without register pointer write (SHT31 measurement read).
bool read_raw(uint8_t addr, uint8_t* out, size_t n);

// Attempts bus recovery (9 SCL clocks + STOP) after a stuck-bus error.
void recover();

}  // namespace i2c
