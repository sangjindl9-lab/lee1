#include "app_state.h"

#include <Arduino.h>

namespace app {
namespace {
SemaphoreHandle_t g_mtx = nullptr;
cfg::Config* g_cfg = nullptr;
storage::Provisioning* g_prov = nullptr;
Readings g_rd;
const char* g_boot_reason = "other";

struct Lock {
  Lock() { xSemaphoreTake(g_mtx, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(g_mtx); }
};
}  // namespace

void begin() {
  g_mtx = xSemaphoreCreateMutex();
  g_cfg = new cfg::Config();
  g_prov = new storage::Provisioning();
}

cfg::Config config() {
  Lock l;
  return *g_cfg;
}

void set_config(const cfg::Config& c) {
  Lock l;
  *g_cfg = c;
}

int64_t config_version() {
  Lock l;
  return g_cfg->config_version;
}

logic::Contact channel_contact(int ch) {
  Lock l;
  if (ch < 1 || ch > cfg::kChannels) return logic::Contact::NC;
  return g_cfg->channels[ch - 1].contact;
}

const storage::Provisioning& prov() { return *g_prov; }
void set_prov(const storage::Provisioning& p) { *g_prov = p; }

Readings readings() {
  Lock l;
  return g_rd;
}

void update_readings(const std::function<void(Readings&)>& fn) {
  Lock l;
  fn(g_rd);
}

const char* boot_reason() { return g_boot_reason; }
void set_boot_reason(const char* r) { g_boot_reason = r; }

}  // namespace app
