// SB-MB01 Rev 0.1 pin map and hardware constants (fixed by the schematic).
#pragma once

#include <cstdint>

#define FW_VERSION "1.0.0"
#define HW_MODEL "SB-MB01"
#define HW_REV "0.1"

namespace board {

// ---- Ethernet LAN8720A (RMII) -------------------------------------------
constexpr int kEthPhyAddr = 0;
constexpr int kEthMdc = 23;
constexpr int kEthMdio = 18;
constexpr int kEthPower = -1;        // PHY reset is tied to EN, no power pin
constexpr int kEthOscEnable = 16;    // 50 MHz oscillator EN (10k pull-down) -> GPIO0 clock in

// ---- I2C -----------------------------------------------------------------
constexpr int kI2cSda = 33;
constexpr int kI2cScl = 32;
constexpr uint32_t kI2cHz = 400000;

constexpr uint8_t kAddrMcp23017 = 0x20;
constexpr uint8_t kAddrInaIn = 0x40;    // +12V input, 10 mOhm shunt
constexpr uint8_t kAddrInaBatt = 0x41;  // battery voltage on VBUS only (shunt shorted)
constexpr uint8_t kAddrSht31 = 0x44;    // external probe, may be absent
constexpr uint8_t kAddrLis3dh = 0x18;
constexpr uint8_t kAddrRtc = 0x51;      // PCF85063A

constexpr float kShuntOhm = 0.010f;

// ---- Interrupt lines (input-only GPIOs, no internal pull-ups) -------------
constexpr int kPinLisInt1 = 34;
constexpr int kPinMcpIntB = 35;

// ---- MCP23017 mapping ----------------------------------------------------
// GPA0..GPA5 -> relay CH1..CH6 coils via ULN2803A (HIGH = coil ON)
// GPA6 -> siren, GPA7 -> strobe
// GPB0..GPB7 <- opto inputs DI1..DI8 (active LOW: contact closed pulls low)
constexpr int kRelayCount = 6;
constexpr uint8_t kBitSiren = 6;
constexpr uint8_t kBitStrobe = 7;

// ---- PZEM-004T v3 (UART2, Modbus-RTU 9600 8N1) ---------------------------
constexpr int kPzemRx = 4;
constexpr int kPzemTx = 17;
constexpr uint32_t kPzemBaud = 9600;
constexpr uint8_t kPzemAddr = 0xF8;  // general address (single slave on the bus)

// ---- RS-485 MAX3485 (Serial1; not used by protocol v1) -------------------
constexpr int kRs485Tx = 13;
constexpr int kRs485Rx = 14;
constexpr int kRs485De = 15;  // HIGH = transmit

// ---- Misc ----------------------------------------------------------------
constexpr int kPinLed = 2;
constexpr int kPinWdi = 5;    // TPS3823 WDI. JP1 must be removed while flashing.

}  // namespace board
