#include "recovery.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <esp_random.h>

#include <map>
#include <string>
#include <vector>

#include "app_state.h"
#include "core/control_logic.h"
#include "core/crypto.h"
#include "core/hw_codec.h"
#include "events.h"
#include "net.h"
#include "power.h"
#include "storage.h"
#include "timebase.h"
#include "watchdog.h"

namespace recovery {
namespace {

int g_wd = -1;
logic::HourlyLimiter g_limiter;

enum class Phase : uint8_t { Monitor, SoftWait, CycleOff, BootWait, GaveUp };

struct TargetState {
  Phase phase = Phase::Monitor;
  int fails = 0;
  bool soft_tried = false;
  bool cycle_tried = false;
  uint32_t next_ping_s = 0;   // device seconds
  uint32_t phase_until_s = 0;
  bool incident = false;      // threshold reached at least once
};

// Keyed by "ip|ch" so a config_set keeps the state of unchanged targets.
std::map<std::string, TargetState> g_state;
uint32_t g_hold_until_s[7] = {0};  // per channel: monitoring paused (boot wait)

uint32_t dev_s() { return uint32_t(timebase::uptime_ms() / 1000); }

std::string key_of(const cfg::RecoveryTarget& t) { return t.ip + "|" + std::to_string(t.ch); }

void persist_limiter() { storage::save_recovery_log(g_limiter.persist(int64_t(dev_s()))); }

void emit_recovery(const cfg::RecoveryTarget& t, const char* step, const std::string& result) {
  size_t attempts = g_limiter.count(int64_t(dev_s()));
  events::emit("recovery", "warning", [&](JsonObject d) {
    d["target_ip"] = t.ip;
    if (t.ch) d["ch"] = t.ch;
    d["step"] = step;
    d["result"] = result;
    d["attempts_in_hour"] = attempts;
  });
}

// ---------------------------------------------------------------- SUNAPI
// GET /stw-cgi/system.cgi?msubmenu=power&action=control&Type=Restart with
// HTTP digest auth. Returns "ok" or an error string.
std::string sunapi_restart(const cfg::RecoveryTarget& t) {
  // TODO(security): pass_enc is used as plain text. It must be encrypted by the
  // server with a device key and decrypted here before use.
  const std::string& pass = t.pass_enc;
  const std::string uri = "/stw-cgi/system.cgi?msubmenu=power&action=control&Type=Restart";
  const std::string url = "http://" + t.ip + uri;
  const char* hdrs[] = {"WWW-Authenticate"};

  WiFiClient client;
  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(4000);
  http.setReuse(false);
  if (!http.begin(client, url.c_str())) return "http_begin";
  http.collectHeaders(hdrs, 1);
  int code = http.GET();
  wdt::twdt_reset();
  if (code == 200) {
    http.end();
    return "ok";  // camera without auth
  }
  if (code != 401) {
    http.end();
    return code < 0 ? std::string("http_error_") + std::to_string(-code)
                    : "http_" + std::to_string(code);
  }
  std::string challenge = http.header("WWW-Authenticate").c_str();
  http.end();

  hw::DigestChallenge ch;
  if (!hw::digest_parse_challenge(challenge, ch)) return "no_digest_challenge";
  uint8_t rnd[8];
  esp_fill_random(rnd, sizeof(rnd));
  std::string auth = hw::digest_authorization(ch, t.user, pass, "GET", uri, 1, crypto::to_hex(rnd, 8));

  WiFiClient client2;
  HTTPClient http2;
  http2.setConnectTimeout(3000);
  http2.setTimeout(4000);
  http2.setReuse(false);
  if (!http2.begin(client2, url.c_str())) return "http_begin";
  http2.addHeader("Authorization", auth.c_str());
  code = http2.GET();
  wdt::twdt_reset();
  http2.end();
  if (code == 200) return "ok";
  if (code == 401) return "auth_failed";
  return code < 0 ? std::string("http_error_") + std::to_string(-code) : "http_" + std::to_string(code);
}

// ---------------------------------------------------------------- state machine
bool channel_blocked_by_server(int ch) {
  return power::server_forced_off(ch) || power::lock_owner(ch) == power::Owner::Server;
}

void recovered(const cfg::RecoveryTarget& t, TargetState& s) {
  if (s.incident) events::local_action("recovery_ok", t.ch, ("ping_restored " + t.ip).c_str());
  s = TargetState();
}

void give_up(const cfg::RecoveryTarget& t, TargetState& s, const char* why, uint32_t now) {
  emit_recovery(t, "gave_up", why);
  s.phase = Phase::GaveUp;
  s.phase_until_s = now + 3600;  // try a new incident after one hour
}

void escalate(const cfg::Config& c, const cfg::RecoveryTarget& t, TargetState& s, uint32_t now) {
  const auto& lr = c.recovery;
  s.incident = true;
  if (t.kind == "hanwha_sunapi" && !s.soft_tried) {
    s.soft_tried = true;
    std::string r = sunapi_restart(t);
    emit_recovery(t, "soft_restart", r);
    s.phase = Phase::SoftWait;
    s.phase_until_s = now + uint32_t(lr.boot_wait_s);
    return;
  }
  if (t.ch && !s.cycle_tried) {
    const cfg::Channel& chc = c.channels[t.ch - 1];
    if (!logic::recovery_power_allowed(chc.role, lr.allow_shared || t.allow_shared)) {
      give_up(t, s, "shared_channel_blocked", now);
      return;
    }
    if (channel_blocked_by_server(t.ch)) {
      give_up(t, s, "channel_controlled_by_server", now);
      return;
    }
    if (!g_limiter.allowed(int64_t(now), size_t(lr.max_per_hour))) {
      give_up(t, s, "rate_limited", now);
      return;
    }
    if (!power::try_lock(t.ch, power::Owner::Recovery)) {
      // Busy (server command in progress): retry on the next ping round.
      s.next_ping_s = now + uint32_t(lr.interval_s);
      return;
    }
    s.cycle_tried = true;
    if (!power::set_load(t.ch, false)) {
      power::set_load(t.ch, true);
      power::unlock(t.ch, power::Owner::Recovery);
      emit_recovery(t, "power_cycle", "relay_feedback");
      give_up(t, s, "relay_feedback", now);
      return;
    }
    g_limiter.record(int64_t(now), timebase::now_s_or_0());
    persist_limiter();
    emit_recovery(t, "power_cycle", "off");
    s.phase = Phase::CycleOff;
    s.phase_until_s = now + uint32_t(lr.off_sec);
    g_hold_until_s[t.ch] = now + uint32_t(lr.off_sec) + uint32_t(lr.boot_wait_s);
    return;
  }
  give_up(t, s, t.ch ? "still_down" : "no_power_channel", now);
}

void tick_target(const cfg::Config& c, const cfg::RecoveryTarget& t, TargetState& s, uint32_t now) {
  const auto& lr = c.recovery;
  switch (s.phase) {
    case Phase::CycleOff:
      if (now >= s.phase_until_s) {
        bool ok = power::set_load(t.ch, true);
        if (!ok) {
          delay(50);
          ok = power::set_load(t.ch, true);
        }
        power::unlock(t.ch, power::Owner::Recovery);
        emit_recovery(t, "power_cycle", ok ? "ok" : "relay_feedback");
        s.phase = Phase::BootWait;
        s.phase_until_s = now + uint32_t(lr.boot_wait_s);
      }
      return;
    case Phase::SoftWait:
    case Phase::BootWait:
      if (now < s.phase_until_s) return;
      if (net::ping(t.ip)) {
        recovered(t, s);
      } else {
        s.phase = Phase::Monitor;
        escalate(c, t, s, now);
      }
      return;
    case Phase::GaveUp:
      if (now >= s.next_ping_s) {
        s.next_ping_s = now + uint32_t(lr.interval_s);
        if (net::ping(t.ip)) {
          recovered(t, s);
          return;
        }
      }
      if (now >= s.phase_until_s) {
        s = TargetState();  // new incident may start (subject to max_per_hour)
        s.next_ping_s = now + uint32_t(lr.interval_s);
      }
      return;
    case Phase::Monitor:
      break;
  }

  if (now < s.next_ping_s) return;
  s.next_ping_s = now + uint32_t(lr.interval_s);
  // Do not blame the target for our own problems / intentional power-offs.
  if (!net::link_up() || !net::has_ip()) return;
  if (t.ch && (now < g_hold_until_s[t.ch] || channel_blocked_by_server(t.ch) ||
               power::lock_owner(t.ch) != power::Owner::None))
    return;

  if (net::ping(t.ip)) {
    if (s.fails) log_i("recovery: %s answers again", t.ip.c_str());
    s.fails = 0;
    return;
  }
  ++s.fails;
  log_w("recovery: %s ping failed (%d/%d)", t.ip.c_str(), s.fails, lr.fail_threshold);
  if (s.fails >= lr.fail_threshold) escalate(c, t, s, now);
}

void task(void*) {
  wdt::twdt_add_current();
  // Wait for the network and a possibly late SNTP sync before judging targets.
  uint32_t start = dev_s();
  for (;;) {
    uint32_t now = dev_s();
    cfg::Config c = app::config();
    if (c.recovery.enabled && now - start >= 60) {
      // Drop state of targets removed by config_set (release their locks).
      std::map<std::string, TargetState> next;
      for (const auto& t : c.recovery.targets) {
        std::string k = key_of(t);
        auto it = g_state.find(k);
        next[k] = it != g_state.end() ? it->second : TargetState();
      }
      for (auto& kv : g_state) {
        if (!next.count(kv.first) && kv.second.phase == Phase::CycleOff) {
          // Removed while its channel was off: restore power now.
          size_t bar = kv.first.rfind('|');
          int ch = atoi(kv.first.c_str() + bar + 1);
          if (ch) {
            power::set_load(ch, true);
            power::unlock(ch, power::Owner::Recovery);
          }
        }
      }
      g_state.swap(next);
      for (const auto& t : c.recovery.targets) {
        tick_target(c, t, g_state[key_of(t)], dev_s());
        wdt::kick(g_wd);
        wdt::twdt_reset();
      }
    } else if (!c.recovery.enabled) {
      // Disabled: finish any cycle in progress (never leave a load off).
      for (auto& kv : g_state) {
        if (kv.second.phase == Phase::CycleOff) {
          size_t bar = kv.first.rfind('|');
          int ch = atoi(kv.first.c_str() + bar + 1);
          if (ch) {
            power::set_load(ch, true);
            power::unlock(ch, power::Owner::Recovery);
          }
        }
      }
      g_state.clear();
    }
    wdt::kick(g_wd);
    wdt::twdt_reset();
    vTaskDelay(pdMS_TO_TICKS(1000));
  }
}

}  // namespace

void begin() {
  int64_t now_dev = int64_t(dev_s());
  g_limiter.load(storage::load_recovery_log(), timebase::valid(), timebase::now_s_or_0(), now_dev);
  log_i("recovery: %u power cycles in the last hour (persisted)",
        (unsigned)g_limiter.count(now_dev));
  // Health budget: up to 16 targets x (ping ~3 s) + SUNAPI (~14 s) per round.
  g_wd = wdt::register_channel("recovery", 30000);
  xTaskCreatePinnedToCore(task, "recovery", 8192, nullptr, 2, nullptr, 0);
}

}  // namespace recovery
