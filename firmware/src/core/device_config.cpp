#include "device_config.h"

#include <cmath>
#include <cstdio>
#include <cstring>

namespace cfg {

const char* const kInputNames[kInputs] = {"door",     "tamper",    "ups_ac_fail", "ups_batt_low",
                                          "elb_trip", "spd_fault", "di7",         "di8"};

int input_index(const char* name) {
  for (int i = 0; i < kInputs; ++i)
    if (strcmp(kInputNames[i], name) == 0) return i;
  return -1;
}

const char* contact_str(logic::Contact c) { return c == logic::Contact::NO ? "NO" : "NC"; }

Config::Config() {
  // Defaults fixed by the board design (SB-MB01 Rev 0.1).
  const struct {
    logic::Contact c;
    const char* role;
  } def[kChannels] = {
      {logic::Contact::NC, "poe_switch"}, {logic::Contact::NC, "optic_converter"},
      {logic::Contact::NO, "fan"},        {logic::Contact::NO, "heater"},
      {logic::Contact::NC, "spare"},      {logic::Contact::NC, "spare"},
  };
  for (int i = 0; i < kChannels; ++i) {
    channels[i].contact = def[i].c;
    channels[i].role = def[i].role;
  }
}

int Config::channel_by_role(const char* role) const {
  for (int i = 0; i < kChannels; ++i)
    if (channels[i].role == role) return i + 1;
  return 0;
}

namespace {

bool get_num(JsonObjectConst o, const char* key, float lo, float hi, float& out, std::string& err,
             const std::string& path) {
  JsonVariantConst v = o[key];
  if (v.isNull()) return true;
  if (!v.is<float>() && !v.is<int>()) {
    err = path + key;
    return false;
  }
  float x = v.as<float>();
  if (!std::isfinite(x) || x < lo || x > hi) {
    err = path + key;
    return false;
  }
  out = x;
  return true;
}

bool get_int(JsonObjectConst o, const char* key, long lo, long hi, int& out, std::string& err,
             const std::string& path) {
  JsonVariantConst v = o[key];
  if (v.isNull()) return true;
  if (!v.is<long>()) {
    err = path + key;
    return false;
  }
  long x = v.as<long>();
  if (x < lo || x > hi) {
    err = path + key;
    return false;
  }
  out = int(x);
  return true;
}

bool get_bool(JsonObjectConst o, const char* key, bool& out, std::string& err,
              const std::string& path) {
  JsonVariantConst v = o[key];
  if (v.isNull()) return true;
  if (!v.is<bool>()) {
    err = path + key;
    return false;
  }
  out = v.as<bool>();
  return true;
}

bool get_str(JsonObjectConst o, const char* key, size_t maxlen, std::string& out, std::string& err,
             const std::string& path) {
  JsonVariantConst v = o[key];
  if (v.isNull()) return true;
  if (!v.is<const char*>()) {
    err = path + key;
    return false;
  }
  const char* s = v.as<const char*>();
  if (strlen(s) > maxlen) {
    err = path + key;
    return false;
  }
  out = s;
  return true;
}

bool valid_ipv4(const std::string& s) {
  int parts = 0;
  size_t i = 0;
  while (i <= s.size()) {
    size_t j = i;
    int val = 0, digits = 0;
    while (j < s.size() && s[j] >= '0' && s[j] <= '9') {
      val = val * 10 + (s[j] - '0');
      if (++digits > 3) return false;
      ++j;
    }
    if (digits == 0 || val > 255) return false;
    if (digits > 1 && s[i] == '0') return false;
    ++parts;
    if (j == s.size()) break;
    if (s[j] != '.') return false;
    i = j + 1;
  }
  return parts == 4;
}

bool valid_role(const std::string& r) {
  if (r.empty() || r.size() > 24) return false;
  for (char c : r)
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')) return false;
  return true;
}

bool parse_contact(JsonVariantConst v, logic::Contact& out) {
  if (!v.is<const char*>()) return false;
  const char* s = v.as<const char*>();
  if (strcmp(s, "NO") == 0) { out = logic::Contact::NO; return true; }
  if (strcmp(s, "NC") == 0) { out = logic::Contact::NC; return true; }
  return false;
}

}  // namespace

bool merge(JsonObjectConst p, Config& inout, std::string& err) {
  Config c = inout;
  err.clear();
  if (p.isNull()) {
    err = "params";
    return false;
  }

  if (!p["config_version"].isNull()) {
    if (!p["config_version"].is<long long>() || p["config_version"].as<long long>() < 0) {
      err = "config_version";
      return false;
    }
    c.config_version = p["config_version"].as<long long>();
  }
  if (!get_int(p, "telemetry_interval_s", 5, 3600, c.telemetry_interval_s, err, "")) return false;
  if (!get_int(p, "manual_override_s", 0, 86400, c.manual_override_s, err, "")) return false;

  if (!p["fan"].isNull()) {
    JsonObjectConst f = p["fan"];
    if (f.isNull()) { err = "fan"; return false; }
    if (!get_num(f, "on_c", -40, 100, c.fan.on_c, err, "fan.")) return false;
    if (!get_num(f, "off_c", -40, 100, c.fan.off_c, err, "fan.")) return false;
  }
  if (!(c.fan.off_c < c.fan.on_c)) { err = "fan.off_c"; return false; }

  if (!p["heater"].isNull()) {
    JsonObjectConst h = p["heater"];
    if (h.isNull()) { err = "heater"; return false; }
    if (!get_num(h, "on_c", -40, 100, c.heater.on_c, err, "heater.")) return false;
    if (!get_num(h, "off_c", -40, 100, c.heater.off_c, err, "heater.")) return false;
    if (!get_num(h, "rh_on", 0, 100, c.heater.rh_on, err, "heater.")) return false;
    if (!get_num(h, "rh_off", 0, 100, c.heater.rh_off, err, "heater.")) return false;
  }
  if (!(c.heater.on_c < c.heater.off_c)) { err = "heater.off_c"; return false; }
  if (!(c.heater.rh_off < c.heater.rh_on)) { err = "heater.rh_off"; return false; }
  // heater must stop before the fan starts, otherwise they would fight
  if (!(c.heater.off_c < c.fan.off_c)) { err = "heater.off_c"; return false; }

  if (!p["channels"].isNull()) {
    JsonArrayConst arr = p["channels"];
    if (arr.isNull() || arr.size() > size_t(kChannels)) { err = "channels"; return false; }
    bool seen[kChannels] = {false};
    for (JsonObjectConst ch : arr) {
      if (ch.isNull() || !ch["ch"].is<int>()) { err = "channels.ch"; return false; }
      int n = ch["ch"].as<int>();
      if (n < 1 || n > kChannels || seen[n - 1]) { err = "channels.ch"; return false; }
      seen[n - 1] = true;
      Channel& dst = c.channels[n - 1];
      if (!ch["contact"].isNull() && !parse_contact(ch["contact"], dst.contact)) {
        err = "channels.contact";
        return false;
      }
      if (!ch["role"].isNull()) {
        if (!ch["role"].is<const char*>() || !valid_role(ch["role"].as<const char*>())) {
          err = "channels.role";
          return false;
        }
        dst.role = ch["role"].as<const char*>();
      }
    }
  }
  // fan/heater roles must be unique so the controller knows which channel to drive
  {
    int fan = 0, heat = 0;
    for (const auto& ch : c.channels) {
      fan += ch.role == "fan";
      heat += ch.role == "heater";
    }
    if (fan > 1 || heat > 1) { err = "channels.role"; return false; }
  }

  if (!p["inputs_polarity"].isNull()) {
    JsonObjectConst ip = p["inputs_polarity"];
    if (ip.isNull()) { err = "inputs_polarity"; return false; }
    for (JsonPairConst kv : ip) {
      int idx = input_index(kv.key().c_str());
      logic::Contact ct;
      if (idx < 0 || !parse_contact(kv.value(), ct)) {
        err = std::string("inputs_polarity.") + kv.key().c_str();
        return false;
      }
      c.input_nc[idx] = ct == logic::Contact::NC;
    }
  }

  if (!p["local_recovery"].isNull()) {
    JsonObjectConst r = p["local_recovery"];
    if (r.isNull()) { err = "local_recovery"; return false; }
    const std::string P = "local_recovery.";
    if (!get_bool(r, "enabled", c.recovery.enabled, err, P)) return false;
    if (!get_int(r, "interval_s", 5, 3600, c.recovery.interval_s, err, P)) return false;
    if (!get_int(r, "fail_threshold", 1, 100, c.recovery.fail_threshold, err, P)) return false;
    if (!get_int(r, "off_sec", 1, 120, c.recovery.off_sec, err, P)) return false;
    if (!get_int(r, "boot_wait_s", 10, 1800, c.recovery.boot_wait_s, err, P)) return false;
    if (!get_int(r, "max_per_hour", 0, int(logic::HourlyLimiter::kMaxEntries), c.recovery.max_per_hour, err, P))
      return false;
    if (!get_bool(r, "allow_shared", c.recovery.allow_shared, err, P)) return false;
    if (!r["targets"].isNull()) {
      JsonArrayConst ta = r["targets"];
      if (ta.isNull() || ta.size() > kMaxTargets) { err = P + "targets"; return false; }
      std::vector<RecoveryTarget> tv;
      for (JsonObjectConst t : ta) {
        const std::string TP = P + "targets.";
        if (t.isNull()) { err = TP; return false; }
        RecoveryTarget x;
        if (!t["ip"].is<const char*>() || !valid_ipv4(t["ip"].as<const char*>())) {
          err = TP + "ip";
          return false;
        }
        x.ip = t["ip"].as<const char*>();
        if (!get_str(t, "kind", 32, x.kind, err, TP)) return false;
        if (!t["ch"].isNull()) {
          if (!t["ch"].is<int>() || t["ch"].as<int>() < 1 || t["ch"].as<int>() > kChannels) {
            err = TP + "ch";
            return false;
          }
          x.ch = t["ch"].as<int>();
        }
        if (!get_str(t, "user", 64, x.user, err, TP)) return false;
        if (!get_str(t, "pass_enc", 128, x.pass_enc, err, TP)) return false;
        if (!get_bool(t, "allow_shared", x.allow_shared, err, TP)) return false;
        tv.push_back(std::move(x));
      }
      c.recovery.targets = std::move(tv);
    }
  }

  if (!p["accel"].isNull()) {
    JsonObjectConst a = p["accel"];
    if (a.isNull()) { err = "accel"; return false; }
    if (!get_num(a, "shock_g", 0.05f, 3.9f, c.accel.shock_g, err, "accel.")) return false;
    if (!get_num(a, "tilt_deg", 1, 90, c.accel.tilt_deg, err, "accel.")) return false;
  }

  if (!p["env_alarm"].isNull()) {
    JsonObjectConst e = p["env_alarm"];
    if (e.isNull()) { err = "env_alarm"; return false; }
    if (!get_num(e, "t_high", -40, 125, c.env.t_high, err, "env_alarm.")) return false;
    if (!get_num(e, "t_low", -40, 125, c.env.t_low, err, "env_alarm.")) return false;
    if (!get_num(e, "rh_high", 0, 100, c.env.rh_high, err, "env_alarm.")) return false;
    if (!(c.env.t_low < c.env.t_high)) { err = "env_alarm.t_low"; return false; }
  }

  if (!p["local_alarm"].isNull()) {
    JsonObjectConst a = p["local_alarm"];
    if (a.isNull()) { err = "local_alarm"; return false; }
    const std::string P = "local_alarm.";
    if (!get_bool(a, "on_door", c.local_alarm.on_door, err, P)) return false;
    if (!get_bool(a, "on_tamper", c.local_alarm.on_tamper, err, P)) return false;
    if (!get_bool(a, "on_shock", c.local_alarm.on_shock, err, P)) return false;
    if (!get_bool(a, "siren", c.local_alarm.siren, err, P)) return false;
    if (!get_bool(a, "strobe", c.local_alarm.strobe, err, P)) return false;
    if (!get_int(a, "duration_s", 1, 3600, c.local_alarm.duration_s, err, P)) return false;
  }

  inout = std::move(c);
  return true;
}

void channels_to_json(const Config& c, JsonArray out) {
  for (int i = 0; i < kChannels; ++i) {
    JsonObject o = out.add<JsonObject>();
    o["ch"] = i + 1;
    o["contact"] = contact_str(c.channels[i].contact);
    o["role"] = c.channels[i].role;
  }
}

void to_json(const Config& c, JsonObject o) {
  o["config_version"] = c.config_version;
  o["telemetry_interval_s"] = c.telemetry_interval_s;
  o["manual_override_s"] = c.manual_override_s;
  JsonObject f = o["fan"].to<JsonObject>();
  f["on_c"] = c.fan.on_c;
  f["off_c"] = c.fan.off_c;
  JsonObject h = o["heater"].to<JsonObject>();
  h["on_c"] = c.heater.on_c;
  h["off_c"] = c.heater.off_c;
  h["rh_on"] = c.heater.rh_on;
  h["rh_off"] = c.heater.rh_off;
  channels_to_json(c, o["channels"].to<JsonArray>());
  JsonObject ip = o["inputs_polarity"].to<JsonObject>();
  for (int i = 0; i < kInputs; ++i) ip[kInputNames[i]] = c.input_nc[i] ? "NC" : "NO";
  JsonObject r = o["local_recovery"].to<JsonObject>();
  r["enabled"] = c.recovery.enabled;
  r["interval_s"] = c.recovery.interval_s;
  r["fail_threshold"] = c.recovery.fail_threshold;
  r["off_sec"] = c.recovery.off_sec;
  r["boot_wait_s"] = c.recovery.boot_wait_s;
  r["max_per_hour"] = c.recovery.max_per_hour;
  r["allow_shared"] = c.recovery.allow_shared;
  JsonArray ta = r["targets"].to<JsonArray>();
  for (const auto& t : c.recovery.targets) {
    JsonObject x = ta.add<JsonObject>();
    x["ip"] = t.ip;
    x["kind"] = t.kind;
    if (t.ch) x["ch"] = t.ch; else x["ch"] = nullptr;
    x["user"] = t.user;
    x["pass_enc"] = t.pass_enc;
    if (t.allow_shared) x["allow_shared"] = true;
  }
  JsonObject a = o["accel"].to<JsonObject>();
  a["shock_g"] = c.accel.shock_g;
  a["tilt_deg"] = c.accel.tilt_deg;
  JsonObject e = o["env_alarm"].to<JsonObject>();
  e["t_high"] = c.env.t_high;
  e["t_low"] = c.env.t_low;
  e["rh_high"] = c.env.rh_high;
  JsonObject la = o["local_alarm"].to<JsonObject>();
  la["on_door"] = c.local_alarm.on_door;
  la["on_tamper"] = c.local_alarm.on_tamper;
  la["on_shock"] = c.local_alarm.on_shock;
  la["siren"] = c.local_alarm.siren;
  la["strobe"] = c.local_alarm.strobe;
  la["duration_s"] = c.local_alarm.duration_s;
}

}  // namespace cfg
