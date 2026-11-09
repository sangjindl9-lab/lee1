// I2C sensors: INA226 x2, SHT31, LIS3DH, PCF85063A RTC.
// Every reader reports presence; callers publish null for absent sensors.
#pragma once

#include <cstdint>

namespace sensors {

struct Dc {
  bool in_ok = false;
  float in_v = 0, in_a = 0;
  bool batt_ok = false;
  float batt_v = 0;
};

struct Env {
  bool ok = false;
  float t = 0, rh = 0;
};

struct Accel {
  bool ok = false;
  float g[3] = {0, 0, 0};  // latest sample, g units
};

void begin();

// INA226 (re-probes automatically after failures).
Dc read_dc();

// SHT31 single-shot high repeatability (blocks ~16 ms).
Env read_env();

// LIS3DH
bool lis_init(float shock_g);
bool lis_set_threshold(float shock_g);
bool lis_read(Accel& out);
bool lis_int_pending();          // INT1 (GPIO34) high
bool lis_clear_int();            // reads INT1_SRC (latched)
bool lis_present();

// PCF85063A
bool rtc_read(int64_t& epoch_s);  // false if absent or oscillator-stop flag set
bool rtc_write(int64_t epoch_s);
bool rtc_present();

}  // namespace sensors
