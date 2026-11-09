#include "mqtt_link.h"

#include <Arduino.h>
#include <esp_idf_version.h>
#include <esp_random.h>
#include <mqtt_client.h>

#include <utility>
#include <vector>

#include "core/event_queue.h"
#include "net.h"
#include "timebase.h"

namespace mqtt_link {
namespace {

constexpr uint32_t kBackoffMinMs = 1000;
constexpr uint32_t kBackoffMaxMs = 60000;
constexpr size_t kMaxInflight = 8;
constexpr uint32_t kInflightTimeoutMs = 35000;  // > esp-mqtt outbox expiry (30 s)
constexpr size_t kMaxRxPayload = 8192;

esp_mqtt_client_handle_t g_client = nullptr;
std::string g_prefix;  // eum/v1/{device_id}/
std::string g_uri, g_client_id, g_lwt_topic, g_ca, g_cert, g_key;
const char* const kLwtMsg = "{\"online\":false}";

CmdHandler g_on_cmd;
ConnectedHook g_on_connected;

// Locking rule: the esp-mqtt task (event handler) never takes g_mtx - it holds
// the client API lock while dispatching, and loop() calls the client API, so
// taking g_mtx there would invert lock order. PUBACKs and disconnects are passed
// to loop() through g_puback_q / g_reset_inflight instead. g_mtx is never held
// while calling the MQTT client.
SemaphoreHandle_t g_mtx = nullptr;  // guards g_events
evq::EventQueue* g_events = nullptr;
QueueHandle_t g_puback_q = nullptr;   // msg_ids acknowledged by the broker
volatile bool g_reset_inflight = false;

volatile bool g_connected = false;
volatile bool g_just_connected = false;
volatile bool g_started = false;
volatile bool g_waiting = false;      // client is in WAIT_RECONNECT
volatile uint32_t g_next_try_ms = 0;
uint32_t g_backoff_ms = kBackoffMinMs;
volatile uint32_t g_reconnects = 0;
bool g_ever_connected = false;
uint32_t g_seen_ip_epoch = 0;

// RX reassembly (runs in the esp-mqtt task only)
std::string g_rx;
bool g_rx_is_cmd = false;

struct Lock {
  Lock() { xSemaphoreTake(g_mtx, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(g_mtx); }
};

void schedule_retry() {
  uint32_t jitter = g_backoff_ms / 5;
  uint32_t delay_ms = g_backoff_ms - jitter + (jitter ? esp_random() % (2 * jitter + 1) : 0);
  g_next_try_ms = millis() + delay_ms;
  log_w("MQTT reconnect in %u ms", (unsigned)delay_ms);
  g_backoff_ms = g_backoff_ms * 2 > kBackoffMaxMs ? kBackoffMaxMs : g_backoff_ms * 2;
}

void on_mqtt_event(void*, esp_event_base_t, int32_t id, void* data) {
  auto* ev = static_cast<esp_mqtt_event_handle_t>(data);
  switch (esp_mqtt_event_id_t(id)) {
    case MQTT_EVENT_CONNECTED:
      g_connected = true;
      g_waiting = false;
      g_just_connected = true;
      g_backoff_ms = kBackoffMinMs;
      if (g_ever_connected) g_reconnects = g_reconnects + 1;
      g_ever_connected = true;
      log_i("MQTT connected");
      break;
    case MQTT_EVENT_DISCONNECTED:
      g_connected = false;
      g_waiting = true;
      g_reset_inflight = true;
      schedule_retry();
      break;
    case MQTT_EVENT_ERROR:
      if (ev && ev->error_handle) {
        log_e("MQTT error type=%d tls_err=0x%x sock_errno=%d rc=%d", ev->error_handle->error_type,
              ev->error_handle->esp_tls_last_esp_err, ev->error_handle->esp_transport_sock_errno,
              ev->error_handle->connect_return_code);
      }
      break;
    case MQTT_EVENT_PUBLISHED: {
      int mid = ev->msg_id;
      xQueueSend(g_puback_q, &mid, 0);  // full queue: event is re-sent later (dup ok)
      break;
    }
    case MQTT_EVENT_DATA: {
      if (ev->current_data_offset == 0) {
        std::string t(ev->topic, ev->topic_len);
        g_rx_is_cmd = t == g_prefix + "cmd";
        g_rx.clear();
        if (ev->total_data_len > int(kMaxRxPayload)) g_rx_is_cmd = false;  // drop oversized
        else g_rx.reserve(ev->total_data_len);
      }
      if (!g_rx_is_cmd) break;
      g_rx.append(ev->data, ev->data_len);
      if (ev->current_data_offset + ev->data_len >= ev->total_data_len) {
        if (g_on_cmd) g_on_cmd(std::move(g_rx));
        g_rx = std::string();
        g_rx_is_cmd = false;
      }
      break;
    }
    default:
      break;
  }
}

void start_client() {
  esp_mqtt_client_config_t c = {};
#if ESP_IDF_VERSION_MAJOR >= 5
  c.broker.address.uri = g_uri.c_str();
  c.broker.verification.certificate = g_ca.c_str();
  c.credentials.client_id = g_client_id.c_str();
  c.credentials.authentication.certificate = g_cert.c_str();
  c.credentials.authentication.key = g_key.c_str();
  c.session.last_will.topic = g_lwt_topic.c_str();
  c.session.last_will.msg = kLwtMsg;
  c.session.last_will.qos = 1;
  c.session.last_will.retain = 1;
  c.session.keepalive = 30;
  c.network.disable_auto_reconnect = true;
  c.network.timeout_ms = 10000;
  c.buffer.size = 4096;
  c.buffer.out_size = 4096;
  c.task.stack_size = 8192;
#else
  c.uri = g_uri.c_str();
  c.cert_pem = g_ca.c_str();
  c.client_id = g_client_id.c_str();
  c.client_cert_pem = g_cert.c_str();
  c.client_key_pem = g_key.c_str();
  c.lwt_topic = g_lwt_topic.c_str();
  c.lwt_msg = kLwtMsg;
  c.lwt_msg_len = 0;
  c.lwt_qos = 1;
  c.lwt_retain = 1;
  c.keepalive = 30;
  c.disable_auto_reconnect = true;
  c.network_timeout_ms = 10000;
  c.buffer_size = 4096;
  c.out_buffer_size = 4096;
  c.task_stack = 8192;
#endif
  g_client = esp_mqtt_client_init(&c);
  if (!g_client) {
    log_e("esp_mqtt_client_init failed");
    return;
  }
  esp_mqtt_client_register_event(g_client, esp_mqtt_event_id_t(ESP_EVENT_ANY_ID), on_mqtt_event,
                                 nullptr);
  if (esp_mqtt_client_start(g_client) == ESP_OK) g_started = true;
}

void on_connected_sequence() {
  // 1) commands first so nothing sent right after connect is missed
  esp_mqtt_client_subscribe(g_client, topic("cmd").c_str(), 1);
  // 2) retained online status
  std::string st = "{\"online\":true,\"ts\":" + std::to_string(timebase::now_ms());
  if (timebase::now_ms() == 0) st += ",\"uptime_ms\":" + std::to_string(timebase::uptime_ms());
  st += "}";
  publish("status", st, 1, true);
  // 3) hello + undelivered acks (owned by main / commands)
  if (g_on_connected) g_on_connected();
}

void flush_events() {
  {
    Lock l;
    int mid;
    while (xQueueReceive(g_puback_q, &mid, 0) == pdTRUE) g_events->ack(mid);
    if (g_reset_inflight) {
      g_reset_inflight = false;
      g_events->reset_inflight();
    }
  }
  if (!g_connected) return;
  std::vector<std::pair<uint32_t, std::string>> batch;
  {
    Lock l;
    g_events->expire_inflight(millis(), kInflightTimeoutMs);
    size_t inflight = g_events->inflight();
    if (inflight >= kMaxInflight) return;
    batch = g_events->take_pending(kMaxInflight - inflight);
  }
  const std::string t = topic("event");
  for (auto& it : batch) {
    // Order is preserved: items are published oldest first from this one task.
    int id = esp_mqtt_client_publish(g_client, t.c_str(), it.second.data(), int(it.second.size()), 1, 0);
    if (id <= 0) break;  // connection problem; retried on the next loop
    Lock l;
    g_events->set_inflight_seq(it.first, id, millis());
  }
}

}  // namespace

std::string topic(const char* sub) { return g_prefix + sub; }

void begin(const storage::Provisioning& p, CmdHandler on_cmd, ConnectedHook on_connected) {
  if (!g_mtx) g_mtx = xSemaphoreCreateMutex();
  if (!g_events) g_events = new evq::EventQueue();
  if (!g_puback_q) g_puback_q = xQueueCreate(32, sizeof(int));
  g_on_cmd = std::move(on_cmd);
  g_on_connected = std::move(on_connected);
  if (!p.valid) return;  // local-only operation; events stay buffered
  g_prefix = "eum/v1/" + p.device_id + "/";
  g_client_id = p.device_id;
  g_lwt_topic = g_prefix + "status";
  g_uri = "mqtts://" + p.mqtt_host + ":" + std::to_string(p.mqtt_port);
  g_ca = p.ca_cert_pem;
  g_cert = p.client_cert_pem;
  g_key = p.client_key_pem;
}

void loop() {
  if (g_uri.empty()) return;
  if (!g_started) {
    if (net::has_ip()) {
      g_seen_ip_epoch = net::ip_epoch();
      start_client();
    }
    return;
  }
  if (g_just_connected) {
    g_just_connected = false;
    on_connected_sequence();
  }
  if (!g_connected && g_waiting) {
    // New DHCP lease after a link loss: try right away.
    if (net::ip_epoch() != g_seen_ip_epoch && net::has_ip()) {
      g_seen_ip_epoch = net::ip_epoch();
      g_next_try_ms = millis();
    }
    if (net::has_ip() && int32_t(millis() - g_next_try_ms) >= 0) {
      if (esp_mqtt_client_reconnect(g_client) == ESP_OK) {
        g_waiting = false;  // attempt in progress; DISCONNECTED/ERROR will reschedule
      } else {
        g_next_try_ms = millis() + 1000;
      }
    }
  }
  flush_events();
}

bool connected() { return g_connected; }
uint32_t reconnects() { return g_reconnects; }

size_t offline_buffered() {
  if (!g_mtx) return 0;
  Lock l;
  return g_events->size() - g_events->inflight();
}

bool publish(const char* sub, const std::string& payload, int qos, bool retain) {
  if (!g_connected || !g_client) return false;
  int id = esp_mqtt_client_publish(g_client, topic(sub).c_str(), payload.data(), int(payload.size()),
                                   qos, retain ? 1 : 0);
  return qos == 0 ? id >= 0 : id > 0;
}

void enqueue_event(std::string&& payload) {
  if (!g_mtx) return;
  Lock l;
  if (g_events->push(std::move(payload))) log_w("event buffer full: oldest event dropped");
}

void go_offline(uint32_t wait_ms) {
  if (!g_connected) return;
  std::string st = "{\"online\":false,\"ts\":" + std::to_string(timebase::now_ms()) + "}";
  publish("status", st, 1, true);
  uint32_t start = millis();
  while (millis() - start < wait_ms) {
    flush_events();
    delay(50);
  }
  esp_mqtt_client_disconnect(g_client);
  delay(100);
}

}  // namespace mqtt_link
