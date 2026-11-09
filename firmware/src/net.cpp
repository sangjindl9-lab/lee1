#include "net.h"

#include <Arduino.h>
#include <ETH.h>
#include <WiFi.h>
#include <lwip/inet.h>
#include <ping/ping_sock.h>

#include "board.h"

namespace net {
namespace {
volatile bool g_link = false;
volatile bool g_ip = false;
volatile uint32_t g_ip_epoch = 0;

#if ESP_ARDUINO_VERSION_MAJOR >= 3
void on_event(arduino_event_id_t event, arduino_event_info_t) {
#else
void on_event(WiFiEvent_t event) {
#endif
  switch (event) {
    case ARDUINO_EVENT_ETH_START:
      ETH.setHostname("sb-mb01");
      break;
    case ARDUINO_EVENT_ETH_CONNECTED:
      g_link = true;
      break;
    case ARDUINO_EVENT_ETH_GOT_IP:
      g_ip = true;
      g_ip_epoch = g_ip_epoch + 1;
      break;
    case ARDUINO_EVENT_ETH_DISCONNECTED:
      g_link = false;
      g_ip = false;
      break;
    case ARDUINO_EVENT_ETH_STOP:
      g_link = false;
      g_ip = false;
      break;
    default:
      break;
  }
}
}  // namespace

void begin() {
  // The external 50 MHz oscillator feeds GPIO0 (ETH_CLOCK_GPIO0_IN). It is held
  // disabled by a 10k pull-down so GPIO0 strapping is clean at reset; enable it now.
  pinMode(board::kEthOscEnable, OUTPUT);
  digitalWrite(board::kEthOscEnable, HIGH);
  delay(10);  // oscillator start-up (< 10 ms typ.)

#if ESP_ARDUINO_VERSION_MAJOR >= 3
  Network.onEvent(on_event);
  bool ok = ETH.begin(ETH_PHY_LAN8720, board::kEthPhyAddr, board::kEthMdc, board::kEthMdio,
                      board::kEthPower, ETH_CLOCK_GPIO0_IN);
#else
  WiFi.mode(WIFI_OFF);
  WiFi.onEvent(on_event);
  bool ok = ETH.begin(board::kEthPhyAddr, board::kEthPower, board::kEthMdc, board::kEthMdio,
                      ETH_PHY_LAN8720, ETH_CLOCK_GPIO0_IN);
#endif
  if (!ok) log_e("ETH.begin failed");
}

bool link_up() { return g_link; }
bool has_ip() { return g_ip; }
uint32_t ip_epoch() { return g_ip_epoch; }

std::string ip() { return std::string(ETH.localIP().toString().c_str()); }
std::string mac() {
  std::string m = ETH.macAddress().c_str();
  for (auto& c : m) c = char(tolower((unsigned char)c));
  return m;
}

namespace {
struct PingCtx {
  SemaphoreHandle_t done;
  volatile uint32_t replies;
};
void ping_ok(esp_ping_handle_t, void* arg) { static_cast<PingCtx*>(arg)->replies++; }
void ping_timeout(esp_ping_handle_t, void*) {}
void ping_end(esp_ping_handle_t, void* arg) { xSemaphoreGive(static_cast<PingCtx*>(arg)->done); }
}  // namespace

bool ping(const std::string& ipv4, int count, uint32_t timeout_ms) {
  if (!g_ip) return false;
  ip4_addr_t a4;
  if (!ip4addr_aton(ipv4.c_str(), &a4)) return false;

  // Heap context: the esp_ping worker task calls back asynchronously; if it
  // ever outlives our wait, the context is leaked instead of used after free.
  PingCtx* ctx = new PingCtx();
  ctx->done = xSemaphoreCreateBinary();
  ctx->replies = 0;
  if (!ctx->done) {
    delete ctx;
    return false;
  }

  esp_ping_config_t cfg = ESP_PING_DEFAULT_CONFIG();
  ip_addr_t target;
  memset(&target, 0, sizeof(target));
  ip_addr_copy_from_ip4(target, a4);
  cfg.target_addr = target;
  cfg.count = uint32_t(count);
  cfg.interval_ms = 200;
  cfg.timeout_ms = timeout_ms;
  cfg.task_stack_size = 3072;

  esp_ping_callbacks_t cbs = {};
  cbs.cb_args = ctx;
  cbs.on_ping_success = ping_ok;
  cbs.on_ping_timeout = ping_timeout;
  cbs.on_ping_end = ping_end;

  esp_ping_handle_t h = nullptr;
  bool ok = false;
  bool finished = true;
  if (esp_ping_new_session(&cfg, &cbs, &h) == ESP_OK) {
    esp_ping_start(h);
    uint32_t wait = uint32_t(count) * (timeout_ms + cfg.interval_ms) + 3000;
    finished = xSemaphoreTake(ctx->done, pdMS_TO_TICKS(wait)) == pdTRUE;
    if (!finished) esp_ping_stop(h);
    ok = ctx->replies > 0;
    esp_ping_delete_session(h);  // worker task frees itself
  }
  if (finished) {
    vSemaphoreDelete(ctx->done);
    delete ctx;
  } else {
    log_e("ping worker did not finish; leaking context");
  }
  return ok;
}

}  // namespace net
