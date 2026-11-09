// Wall clock: SNTP when the network is up, otherwise the PCF85063A RTC
// (CR1220 backed). Protocol rule: ts = 0 while the clock is not trusted.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace timebase {

void begin_from_rtc();                                  // boot: system time <- RTC if valid
void start_sntp(const std::vector<std::string>& servers);
void service();                                          // periodic: RTC <- SNTP after sync
bool valid();
int64_t now_ms();                                        // epoch ms, 0 if not valid
int64_t now_s_or_0();
uint64_t uptime_ms();
const char* source();                                    // "sntp" | "rtc" | "none"

}  // namespace timebase
