#include "storage.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>

#include "core/crypto.h"

namespace storage {
namespace {
Preferences g_prefs;
SemaphoreHandle_t g_mtx = nullptr;
uint32_t g_boot = 0;
bool g_fs = false;

struct Lock {
  Lock() { xSemaphoreTake(g_mtx, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(g_mtx); }
};

constexpr const char* kNs = "sb";

bool valid_device_id(const std::string& s) {
  if (s.size() != 15 || s.compare(0, 3, "SB-") != 0) return false;
  for (size_t i = 3; i < s.size(); ++i) {
    char c = s[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

bool pem_ok(const std::string& p, const char* marker) {
  return p.find("-----BEGIN") != std::string::npos && p.find(marker) != std::string::npos &&
         p.find("-----END") != std::string::npos;
}
}  // namespace

bool begin() {
  if (!g_mtx) g_mtx = xSemaphoreCreateMutex();
  Lock l;
  bool ok = g_prefs.begin(kNs, false);
  g_boot = g_prefs.getUInt("boot_cnt", 0) + 1;
  g_prefs.putUInt("boot_cnt", g_boot);
  // Do not auto-format: a corrupt FS should stay visible instead of silently
  // destroying the provisioning bundle.
  g_fs = LittleFS.begin(false);
  if (!g_fs) log_e("LittleFS mount failed (run: pio run -t uploadfs)");
  return ok;
}

uint32_t boot_counter() { return g_boot; }

bool load_provisioning(Provisioning& p, std::string& err) {
  p = Provisioning();
  if (!g_fs) {
    err = "littlefs_not_mounted";
    return false;
  }
  File f = LittleFS.open("/prov.json", "r");
  if (!f) {
    err = "prov.json_missing";
    return false;
  }
  JsonDocument doc;
  DeserializationError de = deserializeJson(doc, f);
  f.close();
  if (de) {
    err = std::string("prov.json_parse:") + de.c_str();
    return false;
  }
  p.device_id = doc["device_id"] | "";
  p.cmd_secret_hex = doc["cmd_secret"] | "";
  p.mqtt_host = doc["mqtt_host"] | "";
  p.mqtt_port = doc["mqtt_port"] | 8883;
  p.ca_cert_pem = doc["ca_cert_pem"] | "";
  p.client_cert_pem = doc["client_cert_pem"] | "";
  p.client_key_pem = doc["client_key_pem"] | "";
  for (JsonVariantConst s : doc["ntp_servers"].as<JsonArrayConst>())
    if (s.is<const char*>() && p.ntp_servers.size() < 3) p.ntp_servers.push_back(s.as<const char*>());

  size_t n = 0;
  if (!valid_device_id(p.device_id)) err = "device_id";
  else if (p.cmd_secret_hex.size() != 64 || !crypto::from_hex(p.cmd_secret_hex, p.cmd_key, 32, &n) || n != 32)
    err = "cmd_secret";
  else if (p.mqtt_host.empty()) err = "mqtt_host";
  else if (p.mqtt_port == 0) err = "mqtt_port";
  else if (!pem_ok(p.ca_cert_pem, "CERTIFICATE")) err = "ca_cert_pem";
  else if (!pem_ok(p.client_cert_pem, "CERTIFICATE")) err = "client_cert_pem";
  else if (!pem_ok(p.client_key_pem, "PRIVATE KEY")) err = "client_key_pem";
  // Lower-case the hex secret so the hex-text HMAC fallback is deterministic.
  for (auto& c : p.cmd_secret_hex) c = char(tolower((unsigned char)c));
  p.valid = err.empty();
  return p.valid;
}

bool load_config(cfg::Config& out) {
  Lock l;
  // Stored as a blob: NVS strings are limited to 4000 bytes, a config with
  // 16 recovery targets can exceed that.
  size_t len = g_prefs.getBytesLength("cfg");
  if (len == 0 || len > 16384) return false;
  std::string s(len, '\0');
  if (g_prefs.getBytes("cfg", &s[0], len) != len) return false;
  JsonDocument doc;
  if (deserializeJson(doc, s)) {
    log_e("stored config is corrupt, using defaults");
    return false;
  }
  cfg::Config c;  // merge onto defaults
  std::string err;
  if (!cfg::merge(doc.as<JsonObjectConst>(), c, err)) {
    log_e("stored config invalid (%s), using defaults", err.c_str());
    return false;
  }
  out = c;
  return true;
}

bool save_config(const cfg::Config& c) {
  JsonDocument doc;
  cfg::to_json(c, doc.to<JsonObject>());
  std::string s;
  serializeJson(doc, s);
  Lock l;
  return g_prefs.putBytes("cfg", s.data(), s.size()) == s.size();
}

std::vector<int64_t> load_recovery_log() {
  Lock l;
  std::vector<int64_t> v;
  size_t len = g_prefs.getBytesLength("rec_log");
  if (len == 0 || len % sizeof(int64_t) != 0 || len > 64 * sizeof(int64_t)) return v;
  v.resize(len / sizeof(int64_t));
  g_prefs.getBytes("rec_log", v.data(), len);
  return v;
}

bool save_recovery_log(const std::vector<int64_t>& e) {
  Lock l;
  if (e.empty()) {
    g_prefs.remove("rec_log");
    return true;
  }
  return g_prefs.putBytes("rec_log", e.data(), e.size() * sizeof(int64_t)) == e.size() * sizeof(int64_t);
}

int64_t load_cmd_watermark() {
  Lock l;
  return g_prefs.getLong64("cmd_wm", 0);
}

void save_cmd_watermark(int64_t ts) {
  Lock l;
  g_prefs.putLong64("cmd_wm", ts);
}

bool load_tilt_ref(float v[3]) {
  Lock l;
  if (g_prefs.getBytesLength("tilt_ref") != 3 * sizeof(float)) return false;
  return g_prefs.getBytes("tilt_ref", v, 3 * sizeof(float)) == 3 * sizeof(float);
}

void save_tilt_ref(const float v[3]) {
  Lock l;
  g_prefs.putBytes("tilt_ref", v, 3 * sizeof(float));
}

}  // namespace storage
