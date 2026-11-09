// Event creation (protocol.md 3.4). Events are queued in RAM (max 64) and
// delivered by mqtt_link in order once connected (QoS1, removed on PUBACK).
#pragma once

#include <ArduinoJson.h>

#include <functional>

namespace events {

void begin(uint32_t boot_counter);

// fill(data) populates the "data" object.
void emit(const char* type, const char* severity, const std::function<void(JsonObject)>& fill);

// One event per fault episode; cleared by sensor_ok() so a later fault re-reports.
void sensor_fault(const char* sensor);
void sensor_ok(const char* sensor);

void local_action(const char* action, int ch, const char* reason);

}  // namespace events
