#include "watchdog.h"

#include <Arduino.h>
#include <esp_idf_version.h>
#include <esp_task_wdt.h>

#include "board.h"

namespace wdt {
namespace {
constexpr int kMaxCh = 8;
constexpr uint32_t kTwdtTimeoutS = 15;

struct Channel {
  const char* name;
  uint32_t max_age_ms;
  volatile uint32_t last_ms;
};
Channel g_ch[kMaxCh];
volatile int g_nch = 0;
volatile bool g_armed = false;
volatile bool g_starve = false;
uint32_t g_grace_ms = 60000;
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

bool healthy(uint32_t now, const char** bad) {
  int n = g_nch;
  for (int i = 0; i < n; ++i) {
    if (now - g_ch[i].last_ms > g_ch[i].max_age_ms) {
      *bad = g_ch[i].name;
      return false;
    }
  }
  return true;
}

void wdi_task(void*) {
  bool level = false;
  const char* last_bad = nullptr;
  for (;;) {
    uint32_t now = millis();
    bool feed;
    const char* bad = nullptr;
    if (g_starve) {
      feed = false;
    } else if (!g_armed) {
      feed = now < g_grace_ms;  // boot must finish within the grace period
      if (!feed) bad = "boot";
    } else {
      feed = healthy(now, &bad);
    }
    if (feed) {
      level = !level;
      digitalWrite(board::kPinWdi, level ? HIGH : LOW);
      last_bad = nullptr;
    } else if (bad != last_bad) {
      // Logged once; the TPS3823 will reset the board in ~1.6 s.
      ets_printf("[wdt] health check failed: %s -> stop feeding TPS3823\n", bad ? bad : "starve");
      last_bad = bad;
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
}  // namespace

void start_early(uint32_t boot_grace_ms) {
  g_grace_ms = boot_grace_ms;
  pinMode(board::kPinWdi, OUTPUT);
  digitalWrite(board::kPinWdi, LOW);
  // Highest priority, pinned to core 0 (Arduino loop runs on core 1).
  xTaskCreatePinnedToCore(wdi_task, "wdi", 2048, nullptr, configMAX_PRIORITIES - 1, nullptr, 0);

#if ESP_IDF_VERSION_MAJOR >= 5
  esp_task_wdt_config_t c = {};
  c.timeout_ms = kTwdtTimeoutS * 1000;
  c.idle_core_mask = 0;
  c.trigger_panic = true;
  if (esp_task_wdt_reconfigure(&c) != ESP_OK) esp_task_wdt_init(&c);
#else
  // Arduino-ESP32 2.x already initialised the TWDT (5 s); this updates it.
  esp_task_wdt_init(kTwdtTimeoutS, true);
#endif
}

int register_channel(const char* name, uint32_t max_age_ms) {
  portENTER_CRITICAL(&g_mux);
  int id = -1;
  if (g_nch < kMaxCh) {
    id = g_nch;
    g_ch[id].name = name;
    g_ch[id].max_age_ms = max_age_ms;
    g_ch[id].last_ms = millis();
    g_nch = g_nch + 1;
  }
  portEXIT_CRITICAL(&g_mux);
  return id;
}

void kick(int ch) {
  if (ch >= 0 && ch < g_nch) g_ch[ch].last_ms = millis();
}

void arm() { g_armed = true; }

void twdt_add_current() { esp_task_wdt_add(nullptr); }
void twdt_reset() { esp_task_wdt_reset(); }

void starve() { g_starve = true; }

}  // namespace wdt
