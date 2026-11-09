// Shared runtime state (config, provisioning, latest readings) guarded by a mutex.
#pragma once

#include <cstdint>
#include <functional>
#include <string>

#include "core/device_config.h"
#include "core/hw_codec.h"
#include "sensors.h"
#include "storage.h"

namespace app {

struct Readings {
  sensors::Dc dc;
  sensors::Env env;
  bool ac_ok = false;
  hw::PzemReading ac;
  bool accel_ok = false;
  bool shock_active = false;   // latched for a few seconds after a shock event
  bool tilt_valid = false;
  float tilt_deg = 0;
  bool inputs_ok = false;
  uint8_t inputs_active = 0;   // bit i = input i active (polarity applied)
  bool fan_auto = false;       // automatic fan control currently in charge
  bool heater_auto = false;
};

void begin();

cfg::Config config();                       // copy
void set_config(const cfg::Config& c);
int64_t config_version();
logic::Contact channel_contact(int ch);     // cheap accessor (no config copy)

const storage::Provisioning& prov();        // immutable after boot
void set_prov(const storage::Provisioning& p);

Readings readings();                        // copy
void update_readings(const std::function<void(Readings&)>& fn);

const char* boot_reason();
void set_boot_reason(const char* r);

}  // namespace app
