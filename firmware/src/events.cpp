#include "events.h"

#include <Arduino.h>

#include <cstring>
#include <string>

#include "mqtt_link.h"
#include "timebase.h"

namespace events {
namespace {
uint32_t g_boot = 0;
uint32_t g_seq = 0;
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

const char* const kSensors[] = {"sht31", "ina226_in", "ina226_batt", "lis3dh",
                                "pzem",  "rtc",       "mcp23017"};
constexpr int kNumSensors = sizeof(kSensors) / sizeof(kSensors[0]);
bool g_faulted[kNumSensors] = {};

int sensor_index(const char* s) {
  for (int i = 0; i < kNumSensors; ++i)
    if (strcmp(kSensors[i], s) == 0) return i;
  return -1;
}
}  // namespace

void begin(uint32_t boot_counter) { g_boot = boot_counter; }

void emit(const char* type, const char* severity, const std::function<void(JsonObject)>& fill) {
  portENTER_CRITICAL(&g_mux);
  uint32_t seq = ++g_seq;
  portEXIT_CRITICAL(&g_mux);

  // id = boot counter + sequence: unique across reboots (boot counter in NVS)
  char id[32];
  snprintf(id, sizeof(id), "e-%u-%u", (unsigned)g_boot, (unsigned)seq);

  JsonDocument doc;
  doc["id"] = id;
  int64_t ts = timebase::now_ms();
  doc["ts"] = ts;
  if (ts == 0) doc["uptime_ms"] = timebase::uptime_ms();
  doc["type"] = type;
  doc["severity"] = severity;
  JsonObject data = doc["data"].to<JsonObject>();
  if (fill) fill(data);
  std::string payload;
  serializeJson(doc, payload);
  log_i("event %s", payload.c_str());
  mqtt_link::enqueue_event(std::move(payload));
}

void sensor_fault(const char* sensor) {
  int i = sensor_index(sensor);
  if (i < 0) return;
  bool first;
  portENTER_CRITICAL(&g_mux);
  first = !g_faulted[i];
  g_faulted[i] = true;
  portEXIT_CRITICAL(&g_mux);
  if (first) emit("sensor_fault", "warning", [&](JsonObject d) { d["sensor"] = sensor; });
}

void sensor_ok(const char* sensor) {
  int i = sensor_index(sensor);
  if (i < 0) return;
  portENTER_CRITICAL(&g_mux);
  g_faulted[i] = false;
  portEXIT_CRITICAL(&g_mux);
}

void local_action(const char* action, int ch, const char* reason) {
  emit("local_action", "info", [&](JsonObject d) {
    d["action"] = action;
    if (ch > 0) d["ch"] = ch;
    d["reason"] = reason;
  });
}

}  // namespace events
