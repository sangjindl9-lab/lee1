#include "control_logic.h"

#include <algorithm>

namespace logic {

ClimateState climate_step(const ClimateState& prev, const ClimateInput& in, const FanCfg& fan,
                          const HeaterCfg& heater) {
  ClimateState s = prev;
  if (!in.valid) {
    s.fan = true;
    s.heater = false;
    s.cold = s.humid = s.hot = false;
    return s;
  }
  // Fan: ON at >= on_c, OFF at <= off_c.
  if (s.hot) {
    if (in.t <= fan.off_c) s.hot = false;
  } else {
    if (in.t >= fan.on_c) s.hot = true;
  }
  // Cold: ON at <= on_c, OFF at >= off_c.
  if (s.cold) {
    if (in.t >= heater.off_c) s.cold = false;
  } else {
    if (in.t <= heater.on_c) s.cold = true;
  }
  // Humid: ON at >= rh_on, OFF at <= rh_off.
  if (s.humid) {
    if (in.rh <= heater.rh_off) s.humid = false;
  } else {
    if (in.rh >= heater.rh_on) s.humid = true;
  }
  s.fan = s.hot;
  s.heater = (s.cold || s.humid) && !s.fan;
  return s;
}

std::vector<EnvAlarmRaised> env_alarm_step(EnvAlarmState& st, float t, float rh,
                                           const EnvAlarmCfg& cfg) {
  std::vector<EnvAlarmRaised> out;
  if (!st.overtemp && t >= cfg.t_high) {
    st.overtemp = true;
    out.push_back({"overtemp", t, cfg.t_high});
  } else if (st.overtemp && t <= cfg.t_high - cfg.t_hyst) {
    st.overtemp = false;
  }
  if (!st.undertemp && t <= cfg.t_low) {
    st.undertemp = true;
    out.push_back({"undertemp", t, cfg.t_low});
  } else if (st.undertemp && t >= cfg.t_low + cfg.t_hyst) {
    st.undertemp = false;
  }
  if (!st.humidity && rh >= cfg.rh_high) {
    st.humidity = true;
    out.push_back({"humidity", rh, cfg.rh_high});
  } else if (st.humidity && rh <= cfg.rh_high - cfg.rh_hyst) {
    st.humidity = false;
  }
  return out;
}

// ---------------------------------------------------------------- limiter
void HourlyLimiter::load(const std::vector<int64_t>& epochs, bool clock_valid, int64_t now_epoch,
                         int64_t now_dev) {
  e_.clear();
  for (int64_t ep : epochs) {
    if (e_.size() >= kMaxEntries) break;
    if (clock_valid && ep > 0) {
      int64_t age = now_epoch - ep;
      if (age >= kWindow) continue;   // expired
      if (age < 0) age = 0;           // clock went backwards: treat as now
      e_.push_back({now_dev - age, ep});
    } else {
      // Unknown age: assume it just happened (conservative).
      e_.push_back({now_dev, ep});
    }
  }
}

void HourlyLimiter::prune(int64_t now_dev) {
  e_.erase(std::remove_if(e_.begin(), e_.end(),
                          [&](const E& x) { return now_dev - x.dev >= kWindow; }),
           e_.end());
}

size_t HourlyLimiter::count(int64_t now_dev) {
  prune(now_dev);
  return e_.size();
}

void HourlyLimiter::record(int64_t now_dev, int64_t now_epoch_or_0) {
  prune(now_dev);
  if (e_.size() >= kMaxEntries) e_.erase(e_.begin());
  e_.push_back({now_dev, now_epoch_or_0});
}

std::vector<int64_t> HourlyLimiter::persist(int64_t now_dev) {
  prune(now_dev);
  std::vector<int64_t> v;
  for (const auto& x : e_) v.push_back(x.epoch);
  return v;
}

bool is_shared_role(const std::string& role) {
  return role == "poe_switch" || role == "optic_converter";
}

// ---------------------------------------------------------------- debounce
bool Debouncer8::sample(uint8_t raw, uint8_t& changed) {
  changed = 0;
  if (!init_) {
    if (first_cnt_ == 0 || raw != first_val_) {
      first_val_ = raw;
      first_cnt_ = 1;
    } else {
      ++first_cnt_;
    }
    if (first_cnt_ >= need_) {
      init_ = true;
      state_ = raw;
      changed = 0;
    }
    return init_;
  }
  for (int i = 0; i < 8; ++i) {
    uint8_t m = uint8_t(1u << i);
    bool cur = state_ & m;
    bool in = raw & m;
    if (cur == in) {
      cnt_[i] = 0;
      continue;
    }
    if (++cnt_[i] >= need_) {
      cnt_[i] = 0;
      state_ ^= m;
      changed |= m;
    }
  }
  return true;
}

}  // namespace logic
