// Device configuration (protocol.md 4, config_set) with defaults, validation,
// merge (partial config_set keeps unspecified fields) and JSON round-trip for NVS.
// Depends only on ArduinoJson (header-only) so it is host-testable.
#pragma once

#include <ArduinoJson.h>

#include <array>
#include <cstdint>
#include <string>
#include <vector>

#include "control_logic.h"

namespace cfg {

constexpr int kChannels = 6;
constexpr int kInputs = 8;
constexpr size_t kMaxTargets = 16;

// DI1..DI8 names, in GPB0..GPB7 order.
extern const char* const kInputNames[kInputs];
int input_index(const char* name);

struct Channel {
  logic::Contact contact = logic::Contact::NC;
  std::string role = "spare";
};

struct RecoveryTarget {
  std::string ip;
  std::string kind;  // "hanwha_sunapi" | anything else = ping only
  int ch = 0;        // 0 = none (null)
  std::string user;
  // TODO(security): pass_enc is currently treated as PLAIN TEXT. It must be
  // encrypted by the server with a per-device key (e.g. derived from cmd_secret
  // or an eFuse/flash-encryption protected key) and decrypted here.
  std::string pass_enc;
  bool allow_shared = false;
};

struct LocalRecovery {
  bool enabled = true;
  int interval_s = 30;
  int fail_threshold = 5;
  int off_sec = 10;
  int boot_wait_s = 180;
  int max_per_hour = 3;
  bool allow_shared = false;  // extension: permits poe_switch/optic_converter cycling
  std::vector<RecoveryTarget> targets;
};

// Extensions (not in protocol v1 example, optional in config_set):
struct Accel {
  float shock_g = 1.0f;   // LIS3DH INT1 threshold (high-pass filtered)
  float tilt_deg = 10.0f; // tilt event threshold vs. installation reference
};

struct LocalAlarm {
  bool on_door = false;
  bool on_tamper = false;
  bool on_shock = false;
  bool siren = true;
  bool strobe = true;
  int duration_s = 60;
};

struct Config {
  int64_t config_version = 0;
  int telemetry_interval_s = 10;
  logic::FanCfg fan;
  logic::HeaterCfg heater;
  std::array<Channel, kChannels> channels;
  std::array<bool, kInputs> input_nc{};  // false = NO (default)
  LocalRecovery recovery;
  Accel accel;
  logic::EnvAlarmCfg env;
  LocalAlarm local_alarm;
  int manual_override_s = 1800;  // auto fan/heater pause after a server power command

  Config();
  int channel_by_role(const char* role) const;  // 1..6 or 0
};

// Merges `params` (config_set params object) into `inout`. On any validation
// error returns false, leaves `inout` untouched and sets err (field path).
bool merge(JsonObjectConst params, Config& inout, std::string& err);

// Full serialization (used for NVS persistence and hello/channels).
void to_json(const Config& c, JsonObject out);
void channels_to_json(const Config& c, JsonArray out);

const char* contact_str(logic::Contact c);

}  // namespace cfg
