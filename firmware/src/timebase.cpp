#include "timebase.h"

#include <Arduino.h>
#include <esp_sntp.h>
#include <esp_timer.h>
#include <sys/time.h>

#include "sensors.h"

namespace timebase {
namespace {
enum Src : uint8_t { NONE, RTC, SNTP };
volatile Src g_src = NONE;
volatile bool g_sntp_new = false;
uint32_t g_last_rtc_write_ms = 0;
bool g_sntp_started = false;
std::vector<std::string> g_servers;  // must outlive the SNTP client (stores pointers)

constexpr int64_t kMinValidEpoch = 1704067200;  // 2024-01-01

void on_sntp_sync(struct timeval*) {
  g_src = SNTP;
  g_sntp_new = true;
}
}  // namespace

void begin_from_rtc() {
  int64_t e = 0;
  if (sensors::rtc_read(e) && e >= kMinValidEpoch) {
    struct timeval tv = {time_t(e), 0};
    settimeofday(&tv, nullptr);
    g_src = RTC;
    log_i("time from RTC: %lld", (long long)e);
  } else {
    log_w("RTC time not valid; ts=0 until SNTP sync");
  }
}

void start_sntp(const std::vector<std::string>& servers) {
  if (g_sntp_started) return;
  g_sntp_started = true;
  g_servers = servers;
  if (g_servers.empty()) g_servers = {"pool.ntp.org", "time.google.com"};
  sntp_set_time_sync_notification_cb(on_sntp_sync);
  configTime(0, 0, g_servers[0].c_str(), g_servers.size() > 1 ? g_servers[1].c_str() : nullptr,
             g_servers.size() > 2 ? g_servers[2].c_str() : nullptr);
}

void service() {
  uint32_t now = millis();
  bool due = g_src == SNTP && now - g_last_rtc_write_ms > 6UL * 3600UL * 1000UL;
  if (g_sntp_new || due) {
    g_sntp_new = false;
    struct timeval tv;
    gettimeofday(&tv, nullptr);
    if (tv.tv_sec >= kMinValidEpoch) {
      // Write on the second boundary is not needed for +-1 s accuracy.
      if (sensors::rtc_write(int64_t(tv.tv_sec))) g_last_rtc_write_ms = now;
    }
  }
}

bool valid() {
  if (g_src == NONE) return false;
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return tv.tv_sec >= kMinValidEpoch;
}

int64_t now_ms() {
  if (!valid()) return 0;
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return int64_t(tv.tv_sec) * 1000 + tv.tv_usec / 1000;
}

int64_t now_s_or_0() {
  int64_t ms = now_ms();
  return ms ? ms / 1000 : 0;
}

uint64_t uptime_ms() { return uint64_t(esp_timer_get_time() / 1000); }

const char* source() { return g_src == SNTP ? "sntp" : g_src == RTC ? "rtc" : "none"; }

}  // namespace timebase
