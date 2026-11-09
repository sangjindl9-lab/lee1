// Pure control logic: climate hysteresis, environment alarms, the persisted
// hourly power-cycle limiter, channel (NO/NC) semantics.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace logic {

// ---------------------------------------------------------------- climate
struct FanCfg {
  float on_c = 40.0f;
  float off_c = 35.0f;
};
struct HeaterCfg {
  float on_c = 0.0f;   // heater ON at or below
  float off_c = 5.0f;  // heater OFF at or above (cold demand)
  float rh_on = 85.0f; // dehumidify demand ON at or above
  float rh_off = 75.0f;
};

struct ClimateState {
  bool fan = true;       // safe default: fan ON
  bool heater = false;   // safe default: heater OFF
  bool cold = false;     // internal hysteresis latches
  bool humid = false;
  bool hot = false;
};

struct ClimateInput {
  bool valid = false;
  float t = 0;
  float rh = 0;
};

// One control step. Without a valid sensor reading -> fan ON, heater OFF.
// Heater = cold || humid, but never together with the fan (the fan running means
// the cabinet is hot; heating would fight it).
ClimateState climate_step(const ClimateState& prev, const ClimateInput& in, const FanCfg& fan,
                          const HeaterCfg& heater);

// ---------------------------------------------------------------- env alarms
struct EnvAlarmCfg {
  float t_high = 60.0f;
  float t_low = -20.0f;
  float rh_high = 95.0f;
  float t_hyst = 2.0f;
  float rh_hyst = 5.0f;
};

struct EnvAlarmState {
  bool overtemp = false;
  bool undertemp = false;
  bool humidity = false;
};

struct EnvAlarmRaised {
  const char* kind;  // "overtemp" | "undertemp" | "humidity"
  float value;
  float threshold;
};

// Updates latches; returns newly raised alarms (one event per excursion).
std::vector<EnvAlarmRaised> env_alarm_step(EnvAlarmState& st, float t, float rh,
                                           const EnvAlarmCfg& cfg);

// ---------------------------------------------------------------- limiter
// Sliding one-hour window of automatic power cycles (protocol 5.4).
// Time base: "device seconds" (monotonic within a boot). Entries are persisted
// as epoch seconds (0 = recorded while the clock was unknown).
class HourlyLimiter {
 public:
  static constexpr size_t kMaxEntries = 24;
  static constexpr int64_t kWindow = 3600;

  // Rebuilds state from persisted epoch entries.
  // clock_valid/now_epoch: current wall clock; now_dev: current device seconds.
  // Entries with unknown time (0), or any entry when the clock is not valid, are
  // treated conservatively as "just happened".
  void load(const std::vector<int64_t>& epochs, bool clock_valid, int64_t now_epoch,
            int64_t now_dev);
  // Number of power cycles inside the last hour.
  size_t count(int64_t now_dev);
  bool allowed(int64_t now_dev, size_t max_per_hour) { return count(now_dev) < max_per_hour; }
  void record(int64_t now_dev, int64_t now_epoch_or_0);
  // Epoch representation for persistence (prunes expired entries first).
  std::vector<int64_t> persist(int64_t now_dev);

 private:
  struct E {
    int64_t dev;
    int64_t epoch;
  };
  void prune(int64_t now_dev);
  std::vector<E> e_;
};

// ---------------------------------------------------------------- channels
enum class Contact : uint8_t { NO, NC };

// Coil level that gives the requested load state.
inline bool coil_for_load(Contact c, bool load_on) { return c == Contact::NO ? load_on : !load_on; }
inline bool load_from_coil(Contact c, bool coil_on) { return c == Contact::NO ? coil_on : !coil_on; }

// Roles feeding shared infrastructure (protocol 5.3).
bool is_shared_role(const std::string& role);

// Local recovery may power-cycle this channel?
inline bool recovery_power_allowed(const std::string& role, bool allow_shared) {
  return allow_shared || !is_shared_role(role);
}

// Input polarity: hardware reads LOW when the contact is closed.
// NO: closed = active (alarm); NC: open = active.
inline bool input_active(bool pin_level_high, bool polarity_nc) {
  bool closed = !pin_level_high;
  return polarity_nc ? !closed : closed;
}

// ---------------------------------------------------------------- debounce
// Debounce for 8 bit-mapped inputs: a bit changes only after `stable_samples`
// consecutive identical samples.
class Debouncer8 {
 public:
  explicit Debouncer8(uint8_t stable_samples = 3) : need_(stable_samples) {}
  // Returns true once initialized; `changed` gets the bits that toggled.
  bool sample(uint8_t raw, uint8_t& changed);
  uint8_t state() const { return state_; }
  bool initialized() const { return init_; }

 private:
  uint8_t need_;
  uint8_t state_ = 0;
  uint8_t cnt_[8] = {0};
  bool init_ = false;
  uint8_t first_cnt_ = 0;
  uint8_t first_val_ = 0;
};

}  // namespace logic
