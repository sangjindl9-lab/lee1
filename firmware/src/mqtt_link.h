// MQTT 3.1.1 over TLS 1.2 with mTLS (protocol.md 1-2), built on ESP-IDF esp-mqtt.
//
// Why esp-mqtt and not PubSubClient: the protocol requires QoS1 for status,
// hello, event and ack. PubSubClient can only publish QoS0, so offline-buffered
// events could be lost silently. esp-mqtt gives QoS1 publish + PUBACK
// notification, LWT, client certificates and runs in its own task (a blocking
// command never stalls the MQTT keep-alive). Reconnects are driven by this module
// with exponential backoff (1 s .. 60 s, +-20 % jitter).
#pragma once

#include <cstdint>
#include <functional>
#include <string>

#include "storage.h"

namespace mqtt_link {

using CmdHandler = std::function<void(std::string&& payload)>;
using ConnectedHook = std::function<void()>;

void begin(const storage::Provisioning& prov, CmdHandler on_cmd, ConnectedHook on_connected);
void loop();  // call often from one task (main loop)

bool connected();
uint32_t reconnects();
size_t offline_buffered();

// Publishes to "eum/v1/{device_id}/{sub}". Returns false if not connected.
bool publish(const char* sub, const std::string& payload, int qos, bool retain);

// Thread-safe; delivered in order by loop().
void enqueue_event(std::string&& payload);

// Graceful shutdown: publish {"online":false,ts} (retain) and disconnect.
void go_offline(uint32_t wait_ms);

std::string topic(const char* sub);

}  // namespace mqtt_link
