#include "commands.h"

#include <Arduino.h>
#include <ArduinoJson.h>

#include "app_state.h"
#include "core/command_core.h"
#include "core/json_canon.h"
#include "events.h"
#include "mqtt_link.h"
#include "power.h"
#include "storage.h"
#include "timebase.h"
#include "watchdog.h"

namespace commands {
namespace {

using cmdcore::CmdType;

struct ExecItem {
  std::string cmd_id;
  CmdType type;
  int ch = 0;
  int off_sec = 10;
  bool siren = true;
  bool on = false;
  int duration_s = 0;
  std::string params_json;  // config_set
};

QueueHandle_t g_rx_q = nullptr;    // std::string*
QueueHandle_t g_exec_q = nullptr;  // ExecItem*
SemaphoreHandle_t g_mtx = nullptr; // ack cache + watermark
cmdcore::AckCache* g_cache = nullptr;
int64_t g_watermark = 0;
volatile bool g_telemetry_req = false;
int g_wd_rx = -1, g_wd_exec = -1;

constexpr int kExecDepth = 8;

struct Lock {
  Lock() { xSemaphoreTake(g_mtx, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(g_mtx); }
};

// ---------------------------------------------------------------- acks
void send_ack(const std::string& cmd_id, const char* stage, const std::string& error,
              const std::string& result, bool cache) {
  std::string ack = cmdcore::build_ack(cmd_id, stage, timebase::now_ms(), timebase::uptime_ms(),
                                       error, result);
  bool ok = mqtt_link::publish("ack", ack, 1, false);
  if (cache) {
    Lock l;
    g_cache->put(cmd_id, ack, ok);
  }
  log_i("ack %s %s %s%s", cmd_id.c_str(), stage, error.c_str(), ok ? "" : " (offline, queued)");
}

// ---------------------------------------------------------------- params
bool param_int(const jc::Value& p, const char* k, int64_t lo, int64_t hi, int64_t& out,
               bool required) {
  const jc::Value* v = p.get(k);
  if (!v || v->isNull()) return !required;
  return jc::as_int64(*v, out) && out >= lo && out <= hi;
}

bool param_bool(const jc::Value& p, const char* k, bool& out, bool required) {
  const jc::Value* v = p.get(k);
  if (!v || v->isNull()) return !required;
  if (!v->isBool()) return false;
  out = v->b;
  return true;
}

// Validates params and fills the exec item. err = "invalid_params" | "locked".
bool prepare(const cmdcore::Envelope& e, ExecItem& it, const char*& err) {
  err = "invalid_params";
  it.cmd_id = e.cmd_id;
  it.type = e.type;
  const jc::Value& p = e.params;
  int64_t v = 0;
  switch (e.type) {
    case CmdType::PowerOff:
    case CmdType::PowerOn:
    case CmdType::PowerCycle: {
      if (!param_int(p, "ch", 1, 6, v, true)) return false;
      it.ch = int(v);
      if (e.type == CmdType::PowerCycle) {
        v = app::config().recovery.off_sec;
        if (!param_int(p, "off_sec", 1, 120, v, false)) return false;
        it.off_sec = int(v);
      }
      if (power::lock_owner(it.ch) == power::Owner::Recovery) {
        err = "locked";
        return false;
      }
      return true;
    }
    case CmdType::AlarmOut: {
      const jc::Value* o = p.get("output");
      if (!o || !o->isString() || (o->str != "siren" && o->str != "strobe")) return false;
      it.siren = o->str == "siren";
      if (!param_bool(p, "on", it.on, true)) return false;
      v = 0;
      if (!param_int(p, "duration_s", 0, 86400, v, false)) return false;
      it.duration_s = int(v);
      return true;
    }
    case CmdType::TelemetryNow:
    case CmdType::RebootDevice:
      return true;
    case CmdType::ConfigSet: {
      it.params_json = e.params_canonical;
      // Dry-run validation against the current config.
      JsonDocument doc;
      if (deserializeJson(doc, it.params_json)) return false;
      cfg::Config c = app::config();
      std::string why;
      if (!cfg::merge(doc.as<JsonObjectConst>(), c, why)) {
        log_w("config_set invalid: %s", why.c_str());
        return false;
      }
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------- rx task
void handle_rx(const std::string& payload) {
  cmdcore::Envelope e;
  std::string detail;
  cmdcore::ParseError pe = cmdcore::parse_envelope(payload, e, &detail);
  if (pe == cmdcore::ParseError::NotJson || pe == cmdcore::ParseError::NoCmdId) {
    log_w("dropping cmd: %s", detail.c_str());
    return;  // nothing to ack to
  }

  // Duplicate (retransmission or replay of a recent id): re-send last ack only.
  {
    std::string last;
    bool hit = false;
    {
      Lock l;
      const std::string* a = g_cache->find(e.cmd_id);
      if (a) {
        last = *a;
        hit = true;
      }
    }
    if (hit) {
      bool ok = mqtt_link::publish("ack", last, 1, false);
      if (ok) {
        Lock l;
        g_cache->mark_delivered(e.cmd_id);
      }
      log_i("duplicate cmd %s: last ack re-sent", e.cmd_id.c_str());
      return;
    }
  }

  if (pe == cmdcore::ParseError::BadEnvelope) {
    // Not authenticated -> never cached (a forged copy must not shadow the real one).
    send_ack(e.cmd_id, "rejected", "invalid_params", "", false);
    return;
  }

  const storage::Provisioning& pv = app::prov();
  if (!cmdcore::verify_signature(e, pv.cmd_key, sizeof(pv.cmd_key), pv.cmd_secret_hex)) {
    send_ack(e.cmd_id, "rejected", "bad_signature", "", false);
    return;
  }

  // Authenticated from here on: every outcome is cached.
  int64_t wm;
  {
    Lock l;
    wm = g_watermark;
  }
  if (cmdcore::is_expired(e, timebase::now_ms(), wm)) {
    send_ack(e.cmd_id, "rejected", "expired", "", true);
    return;
  }
  if (e.type == CmdType::Unknown) {
    send_ack(e.cmd_id, "rejected", "unknown_type", "", true);
    return;
  }
  {
    Lock l;
    if (e.ts > g_watermark) {
      g_watermark = e.ts;
      storage::save_cmd_watermark(g_watermark);
    }
  }

  ExecItem* it = new ExecItem();
  const char* err = nullptr;
  if (!prepare(e, *it, err)) {
    delete it;
    send_ack(e.cmd_id, "rejected", err, "", true);
    return;
  }
  // "received" is cached before the item becomes visible to the executor so a
  // fast done/failed can never be overwritten by a late "received".
  send_ack(e.cmd_id, "received", "", "", true);
  if (xQueueSend(g_exec_q, &it, 0) != pdTRUE) {
    delete it;
    send_ack(e.cmd_id, "rejected", "busy", "", true);
  }
}

void rx_task(void*) {
  wdt::twdt_add_current();
  for (;;) {
    std::string* p = nullptr;
    if (xQueueReceive(g_rx_q, &p, pdMS_TO_TICKS(1000)) == pdTRUE && p) {
      handle_rx(*p);
      delete p;
    }
    wdt::kick(g_wd_rx);
    wdt::twdt_reset();
  }
}

// ---------------------------------------------------------------- exec task
void sleep_kicking(uint32_t ms) {
  uint32_t start = millis();
  while (millis() - start < ms) {
    uint32_t left = ms - (millis() - start);
    vTaskDelay(pdMS_TO_TICKS(left > 500 ? 500 : left));
    wdt::kick(g_wd_exec);
    wdt::twdt_reset();
  }
}

std::string result_ch_load(int ch) {
  std::string r = "{\"ch\":" + std::to_string(ch) + ",\"load\":" + (power::load_on(ch) ? "true" : "false") +
                  "}";
  return r;
}

void exec(ExecItem& it) {
  switch (it.type) {
    case CmdType::PowerOff:
    case CmdType::PowerOn: {
      bool want = it.type == CmdType::PowerOn;
      if (!power::try_lock(it.ch, power::Owner::Server)) {
        send_ack(it.cmd_id, "rejected", "locked", "", true);
        return;
      }
      bool ok = power::set_load(it.ch, want);
      power::note_server_command(it.ch, want);
      power::unlock(it.ch, power::Owner::Server);
      if (ok && power::load_on(it.ch) == want)
        send_ack(it.cmd_id, "done", "", result_ch_load(it.ch), true);
      else
        send_ack(it.cmd_id, "failed", "relay_feedback", result_ch_load(it.ch), true);
      return;
    }
    case CmdType::PowerCycle: {
      if (!power::try_lock(it.ch, power::Owner::Server)) {
        send_ack(it.cmd_id, "rejected", "locked", "", true);
        return;
      }
      power::note_server_command(it.ch, false);
      bool ok = power::set_load(it.ch, false);
      if (ok) {
        sleep_kicking(uint32_t(it.off_sec) * 1000);
      }
      // Always try to restore power, even if switching off reported an error.
      bool ok_on = power::set_load(it.ch, true);
      if (!ok_on) {
        delay(50);
        ok_on = power::set_load(it.ch, true);
      }
      power::note_server_command(it.ch, true);
      power::unlock(it.ch, power::Owner::Server);
      std::string res = "{\"ch\":" + std::to_string(it.ch) + ",\"load\":" +
                        (power::load_on(it.ch) ? "true" : "false") +
                        ",\"off_sec\":" + std::to_string(it.off_sec) + "}";
      if (ok && ok_on && power::load_on(it.ch))
        send_ack(it.cmd_id, "done", "", res, true);
      else
        send_ack(it.cmd_id, "failed", "relay_feedback", res, true);
      return;
    }
    case CmdType::AlarmOut: {
      bool ok = power::set_alarm(it.siren, it.on, uint32_t(it.duration_s));
      std::string res = std::string("{\"output\":\"") + (it.siren ? "siren" : "strobe") +
                        "\",\"on\":" + (power::alarm_state(it.siren) ? "true" : "false") +
                        ",\"duration_s\":" + std::to_string(it.duration_s) + "}";
      send_ack(it.cmd_id, ok ? "done" : "failed", ok ? "" : "hw_error", res, true);
      return;
    }
    case CmdType::TelemetryNow:
      g_telemetry_req = true;
      send_ack(it.cmd_id, "done", "", "", true);
      return;
    case CmdType::ConfigSet: {
      JsonDocument doc;
      cfg::Config c = app::config();
      std::string why;
      if (deserializeJson(doc, it.params_json) || !cfg::merge(doc.as<JsonObjectConst>(), c, why)) {
        send_ack(it.cmd_id, "failed", "invalid_params", "", true);
        return;
      }
      if (!storage::save_config(c)) {
        send_ack(it.cmd_id, "failed", "hw_error", "", true);
        return;
      }
      app::set_config(c);
      send_ack(it.cmd_id, "done", "", "{\"config_version\":" + std::to_string(c.config_version) + "}",
               true);
      events::local_action("config_applied", 0, "config_set");
      return;
    }
    case CmdType::RebootDevice: {
      send_ack(it.cmd_id, "done", "", "", true);
      log_w("reboot_device requested");
      // Load power is not touched: NC loads stay powered while the MCU restarts.
      mqtt_link::go_offline(1500);
      delay(200);
      esp_restart();
      return;
    }
    default:
      send_ack(it.cmd_id, "rejected", "unknown_type", "", true);
  }
}

void exec_task(void*) {
  wdt::twdt_add_current();
  for (;;) {
    ExecItem* it = nullptr;
    if (xQueueReceive(g_exec_q, &it, pdMS_TO_TICKS(1000)) == pdTRUE && it) {
      exec(*it);
      delete it;
    }
    wdt::kick(g_wd_exec);
    wdt::twdt_reset();
  }
}

}  // namespace

void begin() {
  g_mtx = xSemaphoreCreateMutex();
  g_cache = new cmdcore::AckCache();
  g_watermark = storage::load_cmd_watermark();
  g_rx_q = xQueueCreate(8, sizeof(std::string*));
  g_exec_q = xQueueCreate(kExecDepth, sizeof(ExecItem*));
  g_wd_rx = wdt::register_channel("cmd_rx", 10000);
  g_wd_exec = wdt::register_channel("cmd_exec", 10000);
  xTaskCreatePinnedToCore(rx_task, "cmd_rx", 8192, nullptr, 4, nullptr, 1);
  xTaskCreatePinnedToCore(exec_task, "cmd_exec", 8192, nullptr, 3, nullptr, 1);
}

void submit(std::string&& payload) {
  if (!g_rx_q) return;
  auto* p = new std::string(std::move(payload));
  if (xQueueSend(g_rx_q, &p, 0) != pdTRUE) {
    delete p;  // server will retransmit (no "received" within 10 s)
    log_w("cmd rx queue full, dropped");
  }
}

void on_connected() {
  std::vector<std::pair<std::string, std::string>> pending;
  {
    Lock l;
    pending = g_cache->undelivered();
  }
  for (auto& kv : pending) {
    if (mqtt_link::publish("ack", kv.second, 1, false)) {
      Lock l;
      g_cache->mark_delivered(kv.first);
    }
  }
}

bool take_telemetry_request() {
  if (!g_telemetry_req) return false;
  g_telemetry_req = false;
  return true;
}

}  // namespace commands
