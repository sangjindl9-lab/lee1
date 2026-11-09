// Persistent storage: NVS (config, boot counter, recovery limiter, command
// watermark, tilt reference) and the LittleFS provisioning bundle /prov.json.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "core/device_config.h"

namespace storage {

struct Provisioning {
  bool valid = false;
  std::string device_id;
  std::string cmd_secret_hex;
  uint8_t cmd_key[32] = {0};
  std::string mqtt_host;
  uint16_t mqtt_port = 8883;
  std::string ca_cert_pem;
  std::string client_cert_pem;
  std::string client_key_pem;
  std::vector<std::string> ntp_servers;  // optional "ntp_servers" array
};

bool begin();  // NVS + LittleFS

// Reads and validates /prov.json. err describes the first problem.
bool load_provisioning(Provisioning& out, std::string& err);

uint32_t boot_counter();  // incremented once per boot in begin()

bool load_config(cfg::Config& out);  // false -> defaults kept
bool save_config(const cfg::Config& c);

std::vector<int64_t> load_recovery_log();
bool save_recovery_log(const std::vector<int64_t>& epochs);

int64_t load_cmd_watermark();
void save_cmd_watermark(int64_t ts_ms);

bool load_tilt_ref(float v[3]);
void save_tilt_ref(const float v[3]);

}  // namespace storage
