// Pure encoders/decoders for board peripherals: PZEM-004T v3 Modbus-RTU frames,
// SHT31 CRC-8, INA226 scaling, PCF85063A BCD time <-> epoch, LIS3DH helpers,
// HTTP digest authentication (RFC 2617 / 7616).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace hw {

// ---------------------------------------------------------------- Modbus / PZEM
uint16_t crc16_modbus(const uint8_t* p, size_t n);

// Read Input Registers (0x04) request: addr, 0x04, start, count, CRC (8 bytes).
void pzem_build_read(uint8_t addr, uint16_t start, uint16_t count, uint8_t out[8]);

struct PzemReading {
  float v = 0;    // V
  float a = 0;    // A
  float w = 0;    // W
  float kwh = 0;  // kWh
  float hz = 0;   // Hz
  float pf = 0;   // 0..1
  bool alarm = false;
};

// Parses a 25-byte response to "read 10 input registers from 0x0000".
// Checks address (0xF8 general address accepts any responder), function, byte
// count and CRC. Returns false for exception frames / corruption.
bool pzem_parse(const uint8_t* buf, size_t len, uint8_t expect_addr, PzemReading& out);

// ---------------------------------------------------------------- SHT31
uint8_t sht31_crc8(const uint8_t* p, size_t n);
// 6-byte measurement frame -> temperature (C) / RH (%). Returns false on CRC error.
bool sht31_decode(const uint8_t f[6], float& t, float& rh);

// ---------------------------------------------------------------- INA226
// Shunt voltage register LSB 2.5 uV, bus voltage register LSB 1.25 mV.
inline float ina226_bus_v(uint16_t raw) { return raw * 1.25e-3f; }
inline float ina226_shunt_a(int16_t raw, float shunt_ohm) { return raw * 2.5e-6f / shunt_ohm; }

// ---------------------------------------------------------------- RTC / time
inline uint8_t bcd2bin(uint8_t b) { return uint8_t((b >> 4) * 10 + (b & 0x0F)); }
inline uint8_t bin2bcd(uint8_t v) { return uint8_t(((v / 10) << 4) | (v % 10)); }

struct CivilTime {
  int year;   // e.g. 2026
  int month;  // 1..12
  int day;    // 1..31
  int hour, minute, second;
  int weekday;  // 0 = Sunday
};

int64_t civil_to_epoch(const CivilTime& c);  // UTC seconds
CivilTime epoch_to_civil(int64_t epoch);
bool civil_valid(const CivilTime& c);

// ---------------------------------------------------------------- LIS3DH
// INT1_THS value for a threshold in g at the given full scale (2/4/8/16 g).
uint8_t lis3dh_ths(float g, int full_scale_g);
// Angle (deg) between two vectors.
float vec_angle_deg(const float a[3], const float b[3]);

// ---------------------------------------------------------------- HTTP digest
struct DigestChallenge {
  std::string realm, nonce, opaque, qop, algorithm;
  bool stale = false;
};

// Parses the value of a "WWW-Authenticate: Digest ..." header.
bool digest_parse_challenge(const std::string& header, DigestChallenge& out);

// Builds the "Authorization" header value. Supports algorithm MD5 (default) and
// SHA-256; qop "auth" or none. nc is the nonce count, cnonce a random hex string.
std::string digest_authorization(const DigestChallenge& ch, const std::string& user,
                                 const std::string& pass, const std::string& method,
                                 const std::string& uri, uint32_t nc, const std::string& cnonce);

}  // namespace hw
