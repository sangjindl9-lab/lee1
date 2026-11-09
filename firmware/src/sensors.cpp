#include "sensors.h"

#include <Arduino.h>

#include "board.h"
#include "core/hw_codec.h"
#include "i2c_bus.h"

namespace sensors {
namespace {

// ---------------------------------------------------------------- INA226
constexpr uint8_t INA_CONFIG = 0x00, INA_SHUNT = 0x01, INA_BUS = 0x02, INA_MFG = 0xFE;
// AVG=16, VBUSCT=1.1ms, VSHCT=1.1ms, continuous shunt+bus
constexpr uint16_t INA_CFG_VAL = 0x4000 | (0b010 << 9) | (0b100 << 6) | (0b100 << 3) | 0b111;

bool ina_init(uint8_t addr) {
  uint16_t id = 0;
  if (!i2c::read_reg16be(addr, INA_MFG, id) || id != 0x5449) return false;  // "TI"
  return i2c::write_reg16be(addr, INA_CONFIG, INA_CFG_VAL);
}

bool g_ina_in = false, g_ina_batt = false;
uint32_t g_ina_retry_ms = 0;

// ---------------------------------------------------------------- LIS3DH
constexpr uint8_t LIS_WHO = 0x0F, LIS_CTRL1 = 0x20, LIS_CTRL2 = 0x21, LIS_CTRL3 = 0x22,
                  LIS_CTRL4 = 0x23, LIS_CTRL5 = 0x24, LIS_REF = 0x26, LIS_OUT_X_L = 0x28,
                  LIS_INT1_CFG = 0x30, LIS_INT1_SRC = 0x31, LIS_INT1_THS = 0x32,
                  LIS_INT1_DUR = 0x33;
constexpr int kLisFs = 4;              // +-4 g
constexpr float kLisMgPerLsb = 2.0f;   // HR mode, +-4 g: 2 mg/digit (12-bit left aligned)
bool g_lis = false;

// ---------------------------------------------------------------- PCF85063A
constexpr uint8_t RTC_CTRL1 = 0x00, RTC_SECONDS = 0x04;
bool g_rtc = false;

}  // namespace

void begin() {
  g_ina_in = ina_init(board::kAddrInaIn);
  g_ina_batt = ina_init(board::kAddrInaBatt);
  g_rtc = i2c::probe(board::kAddrRtc);
  if (g_rtc) {
    // CTRL1: 24h mode, normal operation, CAP_SEL per board (7 pF default).
    uint8_t c1 = 0;
    if (i2c::read_reg8(board::kAddrRtc, RTC_CTRL1, c1)) {
      c1 &= uint8_t(~((1u << 5) | (1u << 4) | (1u << 1)));  // clear STOP, SR, 12_24
      i2c::write_reg8(board::kAddrRtc, RTC_CTRL1, c1);
    }
  }
  pinMode(board::kPinLisInt1, INPUT);
}

Dc read_dc() {
  Dc d;
  uint32_t now = millis();
  if ((!g_ina_in || !g_ina_batt) && now - g_ina_retry_ms > 10000) {
    g_ina_retry_ms = now;
    if (!g_ina_in) g_ina_in = ina_init(board::kAddrInaIn);
    if (!g_ina_batt) g_ina_batt = ina_init(board::kAddrInaBatt);
  }
  if (g_ina_in) {
    uint16_t bus = 0, sh = 0;
    if (i2c::read_reg16be(board::kAddrInaIn, INA_BUS, bus) &&
        i2c::read_reg16be(board::kAddrInaIn, INA_SHUNT, sh)) {
      d.in_ok = true;
      d.in_v = hw::ina226_bus_v(bus);
      d.in_a = hw::ina226_shunt_a(int16_t(sh), board::kShuntOhm);
    } else {
      g_ina_in = false;
    }
  }
  if (g_ina_batt) {
    uint16_t bus = 0;
    if (i2c::read_reg16be(board::kAddrInaBatt, INA_BUS, bus)) {
      d.batt_ok = true;
      d.batt_v = hw::ina226_bus_v(bus);  // shunt pins shorted: only VBUS is meaningful
    } else {
      g_ina_batt = false;
    }
  }
  return d;
}

Env read_env() {
  Env e;
  // Single shot, high repeatability, clock stretching disabled
  const uint8_t cmd[2] = {0x24, 0x00};
  if (!i2c::write(board::kAddrSht31, cmd, 2)) return e;
  delay(16);  // max 15.5 ms conversion
  uint8_t f[6];
  if (!i2c::read_raw(board::kAddrSht31, f, 6)) return e;
  e.ok = hw::sht31_decode(f, e.t, e.rh);
  return e;
}

bool lis_set_threshold(float shock_g) {
  if (!g_lis) return false;
  return i2c::write_reg8(board::kAddrLis3dh, LIS_INT1_THS, hw::lis3dh_ths(shock_g, kLisFs));
}

bool lis_init(float shock_g) {
  uint8_t who = 0;
  g_lis = i2c::read_reg8(board::kAddrLis3dh, LIS_WHO, who) && who == 0x33;
  if (!g_lis) return false;
  uint8_t dummy;
  g_lis = i2c::write_reg8(board::kAddrLis3dh, LIS_CTRL1, 0x57) &&  // 100 Hz, XYZ, normal
          i2c::write_reg8(board::kAddrLis3dh, LIS_CTRL2, 0x01) &&  // HP filter on INT1 (removes gravity)
          i2c::write_reg8(board::kAddrLis3dh, LIS_CTRL4, 0x98) &&  // BDU, +-4 g, HR
          i2c::write_reg8(board::kAddrLis3dh, LIS_CTRL5, 0x08) &&  // latch INT1
          i2c::write_reg8(board::kAddrLis3dh, LIS_INT1_DUR, 0x00) &&
          i2c::write_reg8(board::kAddrLis3dh, LIS_INT1_THS, hw::lis3dh_ths(shock_g, kLisFs)) &&
          i2c::write_reg8(board::kAddrLis3dh, LIS_INT1_CFG, 0x2A) &&  // OR of XH/YH/ZH
          i2c::read_reg8(board::kAddrLis3dh, LIS_REF, dummy) &&       // reset HP filter
          i2c::write_reg8(board::kAddrLis3dh, LIS_CTRL3, 0x40) &&     // IA1 -> INT1 pin
          i2c::read_reg8(board::kAddrLis3dh, LIS_INT1_SRC, dummy);
  return g_lis;
}

bool lis_read(Accel& out) {
  out.ok = false;
  if (!g_lis) return false;
  uint8_t b[6];
  if (!i2c::read_regs(board::kAddrLis3dh, LIS_OUT_X_L | 0x80, b, 6)) return false;  // auto-inc
  for (int i = 0; i < 3; ++i) {
    int16_t raw = int16_t(b[2 * i] | (b[2 * i + 1] << 8)) >> 4;  // 12-bit left aligned
    out.g[i] = raw * kLisMgPerLsb / 1000.0f;
  }
  out.ok = true;
  return true;
}

bool lis_int_pending() { return g_lis && digitalRead(board::kPinLisInt1) == HIGH; }

bool lis_clear_int() {
  uint8_t src;
  return g_lis && i2c::read_reg8(board::kAddrLis3dh, LIS_INT1_SRC, src);
}

bool lis_present() { return g_lis; }

bool rtc_read(int64_t& epoch) {
  uint8_t r[7];
  if (!i2c::read_regs(board::kAddrRtc, RTC_SECONDS, r, 7)) {
    g_rtc = false;
    return false;
  }
  g_rtc = true;
  if (r[0] & 0x80) return false;  // OS flag: oscillator stopped -> time invalid
  hw::CivilTime c{};
  c.second = hw::bcd2bin(r[0] & 0x7F);
  c.minute = hw::bcd2bin(r[1] & 0x7F);
  c.hour = hw::bcd2bin(r[2] & 0x3F);
  c.day = hw::bcd2bin(r[3] & 0x3F);
  c.weekday = r[4] & 0x07;
  c.month = hw::bcd2bin(r[5] & 0x1F);
  c.year = 2000 + hw::bcd2bin(r[6]);
  if (!hw::civil_valid(c)) return false;
  epoch = hw::civil_to_epoch(c);
  return true;
}

bool rtc_write(int64_t epoch) {
  hw::CivilTime c = hw::epoch_to_civil(epoch);
  if (!hw::civil_valid(c)) return false;
  uint8_t b[8] = {RTC_SECONDS,
                  hw::bin2bcd(uint8_t(c.second)),  // writing seconds clears OS flag
                  hw::bin2bcd(uint8_t(c.minute)),
                  hw::bin2bcd(uint8_t(c.hour)),
                  hw::bin2bcd(uint8_t(c.day)),
                  uint8_t(c.weekday),
                  hw::bin2bcd(uint8_t(c.month)),
                  hw::bin2bcd(uint8_t(c.year - 2000))};
  g_rtc = i2c::write(board::kAddrRtc, b, sizeof(b));
  return g_rtc;
}

bool rtc_present() { return g_rtc; }

}  // namespace sensors
