// PZEM-004T v3 on UART2 (Modbus-RTU, function 0x04, 10 input registers from 0x0000).
#pragma once

#include "core/hw_codec.h"

namespace pzem {

void begin();
// Blocking poll (~60 ms typical, 250 ms timeout). Returns false on no/invalid reply.
bool read(hw::PzemReading& out);

}  // namespace pzem

// RS-485 (MAX3485) helper on Serial1. Not used by protocol v1.
namespace rs485 {

void begin(uint32_t baud = 9600);
// Half-duplex transmit: DE high, write, wait for the last stop bit, DE low.
void send(const uint8_t* data, size_t n);
// Reads up to n bytes until `timeout_ms` of silence. Returns number read.
size_t receive(uint8_t* buf, size_t n, uint32_t timeout_ms);

}  // namespace rs485
