// Server command pipeline (protocol.md 3.5, 4):
//   MQTT task --(raw payload)--> rx queue --> cmd_rx task: parse, dedupe
//   (last 32 cmd_id -> re-send last ack), HMAC verify, expiry/replay, params
//   validation, "received" ack --> exec queue --> cmd_exec task (single
//   executor, may block e.g. power_cycle without stalling MQTT) --> done/failed.
#pragma once

#include <string>

namespace commands {

void begin();
// Called from the MQTT task; never blocks.
void submit(std::string&& payload);
// After (re)connect: re-publish acks that could not be delivered while offline.
void on_connected();
// Set by telemetry_now; consumed by the telemetry scheduler.
bool take_telemetry_request();

}  // namespace commands
