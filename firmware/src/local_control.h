// Autonomous local functions (work without the server, brief section 3):
//  - io task (20 ms): DI1..DI8 debounce + input_change events, LIS3DH shock,
//    MCP23017 integrity check, local alarm triggers
//  - control task (250 ms tick): sensors (INA226, SHT31, PZEM), fan/heater
//    hysteresis, env alarms, tilt, alarm timers, RTC sync, telemetry schedule
#pragma once

#include <string>

namespace local_control {

void begin();
std::string build_telemetry();
void publish_telemetry_now();

}  // namespace local_control
