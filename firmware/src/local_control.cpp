#include "local_control.h"

#include <Arduino.h>
#include <ArduinoJson.h>

#include <cmath>

#include "app_state.h"
#include "board.h"
#include "commands.h"
#include "core/control_logic.h"
#include "events.h"
#include "io_expander.h"
#include "mqtt_link.h"
#include "net.h"
#include "power.h"
#include "pzem.h"
#include "sensors.h"
#include "storage.h"
#include "timebase.h"
#include "watchdog.h"

namespace local_control {
namespace {

int g_wd_io = -1, g_wd_ctl = -1;

// Gravity low-pass (written by io task, read by control task)
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
float g_grav[3] = {0, 0, 0};
bool g_grav_valid = false;
uint32_t g_seq = 0;

double r2(float v) { return std::round(double(v) * 100.0) / 100.0; }
double r1(float v) { return std::round(double(v) * 10.0) / 10.0; }

const char* input_severity(int idx, bool active) {
  if (!active) return "info";
  switch (idx) {
    case 0: return "warning";   // door
    case 1: return "warning";   // tamper
    case 2: return "critical";  // ups_ac_fail
    case 3: return "major";     // ups_batt_low
    case 4: return "critical";  // elb_trip
    case 5: return "major";     // spd_fault
    default: return "info";     // di7, di8
  }
}

void trigger_local_alarm(const cfg::LocalAlarm& la, const char* reason) {
  if (la.siren) power::set_alarm(true, true, uint32_t(la.duration_s));
  if (la.strobe) power::set_alarm(false, true, uint32_t(la.duration_s));
  events::local_action("alarm_on", 0, reason);
}

// ================================================================ io task
void io_task(void*) {
  wdt::twdt_add_current();
  logic::Debouncer8 deb(3);  // 3 x 20 ms
  bool reported_init = false;
  uint8_t last_active = 0;
  int read_fail = 0;
  uint32_t last_verify = 0, last_lis_retry = 0, last_grav = 0, shock_until = 0, last_shock = 0;
  bool shock_latched = false;
  float shock_thr_applied = -1;
  cfg::Config c = app::config();
  uint32_t last_cfg = millis();

  for (;;) {
    uint32_t now = millis();
    if (now - last_cfg >= 1000) {  // avoid copying the config at 50 Hz
      last_cfg = now;
      c = app::config();
    }

    // ---- digital inputs
    uint8_t raw = 0;
    if (ioexp::read_inputs(raw)) {
      read_fail = 0;
      uint8_t changed;
      if (deb.sample(raw, changed)) {
        uint8_t active = 0;
        for (int i = 0; i < cfg::kInputs; ++i)
          if (logic::input_active((deb.state() >> i) & 1u, c.input_nc[i])) active |= uint8_t(1u << i);
        uint8_t diff = reported_init ? uint8_t(active ^ last_active) : active;  // boot: report active ones
        for (int i = 0; i < cfg::kInputs; ++i) {
          if (!((diff >> i) & 1u)) continue;
          bool v = (active >> i) & 1u;
          events::emit("input_change", input_severity(i, v), [&](JsonObject d) {
            d["input"] = cfg::kInputNames[i];
            d["value"] = v;
          });
          if (v && reported_init) {
            if (i == 0 && c.local_alarm.on_door) trigger_local_alarm(c.local_alarm, "door");
            if (i == 1 && c.local_alarm.on_tamper) trigger_local_alarm(c.local_alarm, "tamper");
          }
        }
        reported_init = true;
        last_active = active;
        app::update_readings([&](app::Readings& r) {
          r.inputs_ok = true;
          r.inputs_active = active;
        });
      }
    } else if (++read_fail == 5) {
      events::sensor_fault("mcp23017");
      app::update_readings([](app::Readings& r) { r.inputs_ok = false; });
    }

    // ---- expander integrity (outputs) every 5 s
    if (now - last_verify > 5000) {
      last_verify = now;
      if (ioexp::verify_and_repair()) {
        if (read_fail == 0) events::sensor_ok("mcp23017");
      } else {
        events::sensor_fault("mcp23017");
      }
    }

    // ---- accelerometer
    if (!sensors::lis_present()) {
      if (now - last_lis_retry > 30000) {
        last_lis_retry = now;
        if (sensors::lis_init(c.accel.shock_g)) {
          events::sensor_ok("lis3dh");
          shock_thr_applied = c.accel.shock_g;
        } else {
          events::sensor_fault("lis3dh");
          app::update_readings([](app::Readings& r) {
            r.accel_ok = false;
            r.tilt_valid = false;
          });
        }
      }
    } else {
      if (shock_thr_applied != c.accel.shock_g) {
        if (sensors::lis_set_threshold(c.accel.shock_g)) shock_thr_applied = c.accel.shock_g;
      }
      if (now - last_grav >= 100) {
        last_grav = now;
        sensors::Accel a;
        if (sensors::lis_read(a)) {
          portENTER_CRITICAL(&g_mux);
          for (int i = 0; i < 3; ++i)
            g_grav[i] = g_grav_valid ? g_grav[i] * 0.9f + a.g[i] * 0.1f : a.g[i];
          g_grav_valid = true;
          portEXIT_CRITICAL(&g_mux);
        }
      }
      if (sensors::lis_int_pending()) {
        // Collect the peak deviation from gravity for ~100 ms.
        float grav[3];
        portENTER_CRITICAL(&g_mux);
        for (int i = 0; i < 3; ++i) grav[i] = g_grav[i];
        portEXIT_CRITICAL(&g_mux);
        float peak = 0;
        for (int k = 0; k < 10; ++k) {
          sensors::Accel a;
          if (sensors::lis_read(a)) {
            float dx = a.g[0] - grav[0], dy = a.g[1] - grav[1], dz = a.g[2] - grav[2];
            float m = sqrtf(dx * dx + dy * dy + dz * dz);
            if (m > peak) peak = m;
          }
          vTaskDelay(pdMS_TO_TICKS(10));
        }
        sensors::lis_clear_int();
        if (peak < c.accel.shock_g) peak = c.accel.shock_g;  // INT fired: at least threshold
        shock_until = millis() + 10000;
        shock_latched = true;
        if (millis() - last_shock > 10000 || last_shock == 0) {  // 1 event / 10 s
          last_shock = millis();
          float pk = peak;
          events::emit("shock", "warning", [&](JsonObject d) { d["peak_g"] = r2(pk); });
          if (c.local_alarm.on_shock) trigger_local_alarm(c.local_alarm, "shock");
        }
      }
      if (shock_latched && int32_t(millis() - shock_until) >= 0) shock_latched = false;
      bool sl = shock_latched;
      app::update_readings([&](app::Readings& r) {
        r.accel_ok = true;
        r.shock_active = sl;
      });
    }

    wdt::kick(g_wd_io);
    wdt::twdt_reset();
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ================================================================ control task
struct Climate {
  logic::ClimateState st;
  bool have_env_once = false;
  bool last_fan_cmd = true, last_heater_cmd = false;
  bool fan_cmd_init = false, heater_cmd_init = false;
};

// Drives one climate channel (role fan/heater) unless the server owns it.
// Returns whether automatic control is in charge.
bool drive(const cfg::Config& c, const char* role, bool want, bool& last_cmd, bool& init,
           const char* reason) {
  int ch = c.channel_by_role(role);
  if (!ch) return false;
  if (power::lock_owner(ch) != power::Owner::None) return false;
  if (power::server_forced_off(ch) ||
      power::ms_since_server_command(ch) < uint32_t(c.manual_override_s) * 1000UL)
    return false;
  if (power::load_on(ch) != want) {
    if (power::set_load(ch, want)) {
      if (!init || last_cmd != want) {
        char action[24];
        snprintf(action, sizeof(action), "%s_%s", role, want ? "on" : "off");
        events::local_action(action, ch, reason);
      }
    }
  }
  last_cmd = want;
  init = true;
  return true;
}

std::string g_last_telemetry;

void control_task(void*) {
  wdt::twdt_add_current();
  Climate clim;
  logic::EnvAlarmState envst;
  int env_fail = 0, pzem_fail = 0;
  bool pzem_ever_ok = false;
  uint32_t t_dc = 0, t_env = 0, t_pzem = 0, t_tilt = 0, t_time = 0, t_tele = 0, t_rtc = 0;
  float tilt_ref[3];
  bool have_ref = storage::load_tilt_ref(tilt_ref);
  bool tilt_alarm = false;

  if (!sensors::rtc_present()) events::sensor_fault("rtc");

  for (;;) {
    uint32_t now = millis();
    cfg::Config c = app::config();

    power::service_alarms();

    // ---- DC (INA226 x2) every 1 s
    if (now - t_dc >= 1000) {
      t_dc = now;
      sensors::Dc dc = sensors::read_dc();
      if (dc.in_ok) events::sensor_ok("ina226_in"); else events::sensor_fault("ina226_in");
      if (dc.batt_ok) events::sensor_ok("ina226_batt"); else events::sensor_fault("ina226_batt");
      app::update_readings([&](app::Readings& r) { r.dc = dc; });
    }

    // ---- environment + climate every 2 s
    if (now - t_env >= 2000) {
      t_env = now;
      sensors::Env env = sensors::read_env();
      if (env.ok) {
        env_fail = 0;
        events::sensor_ok("sht31");
      } else if (++env_fail >= 2) {
        events::sensor_fault("sht31");
      }
      bool valid = env.ok || (env_fail < 2 && clim.have_env_once);
      if (env.ok) clim.have_env_once = true;
      app::Readings prev = app::readings();
      sensors::Env use = env.ok ? env : prev.env;
      use.ok = valid;
      logic::ClimateInput in{valid, use.t, use.rh};
      clim.st = logic::climate_step(clim.st, in, c.fan, c.heater);

      char reason[48];
      if (valid)
        snprintf(reason, sizeof(reason), "t=%.1f rh=%.1f", use.t, use.rh);
      else
        snprintf(reason, sizeof(reason), "sht31_unavailable_safe_state");
      bool fan_auto = drive(c, "fan", clim.st.fan, clim.last_fan_cmd, clim.fan_cmd_init, reason);
      bool heat_auto =
          drive(c, "heater", clim.st.heater, clim.last_heater_cmd, clim.heater_cmd_init, reason);

      if (env.ok) {
        for (const auto& a : logic::env_alarm_step(envst, env.t, env.rh, c.env)) {
          events::emit("env_alarm", "warning", [&](JsonObject d) {
            d["kind"] = a.kind;
            d["value"] = r1(a.value);
            d["threshold"] = r1(a.threshold);
          });
        }
      }
      app::update_readings([&](app::Readings& r) {
        r.env = use;
        r.fan_auto = fan_auto;
        r.heater_auto = heat_auto;
      });
    }

    // ---- AC (PZEM) every 2 s
    if (now - t_pzem >= 2000) {
      t_pzem = now;
      hw::PzemReading ac;
      bool ok = pzem::read(ac);
      if (ok) {
        pzem_fail = 0;
        pzem_ever_ok = true;
        events::sensor_ok("pzem");
      } else if (++pzem_fail == 3) {
        events::sensor_fault("pzem");
      }
      bool ac_ok = ok || (pzem_fail < 3 && pzem_ever_ok);
      app::update_readings([&](app::Readings& r) {
        if (ok) r.ac = ac;
        r.ac_ok = ac_ok;
      });
    }

    // ---- tilt every 1 s
    if (now - t_tilt >= 1000) {
      t_tilt = now;
      float g[3];
      bool gv;
      portENTER_CRITICAL(&g_mux);
      gv = g_grav_valid;
      for (int i = 0; i < 3; ++i) g[i] = g_grav[i];
      portEXIT_CRITICAL(&g_mux);
      if (gv && sensors::lis_present()) {
        if (!have_ref && now > 15000) {
          // First installation: store the current orientation as reference.
          for (int i = 0; i < 3; ++i) tilt_ref[i] = g[i];
          storage::save_tilt_ref(tilt_ref);
          have_ref = true;
        }
        if (have_ref) {
          float deg = hw::vec_angle_deg(g, tilt_ref);
          if (!tilt_alarm && deg >= c.accel.tilt_deg) {
            tilt_alarm = true;
            events::emit("tilt", "warning", [&](JsonObject d) { d["tilt_deg"] = r1(deg); });
          } else if (tilt_alarm && deg < c.accel.tilt_deg * 0.5f) {
            tilt_alarm = false;
          }
          app::update_readings([&](app::Readings& r) {
            r.tilt_valid = true;
            r.tilt_deg = deg;
          });
        }
      }
    }

    // ---- time keeping
    if (now - t_time >= 10000) {
      t_time = now;
      timebase::service();
    }
    if (now - t_rtc >= 60000) {
      t_rtc = now;
      int64_t e;
      if (sensors::rtc_read(e) || sensors::rtc_present()) events::sensor_ok("rtc");
      else events::sensor_fault("rtc");
    }

    // ---- telemetry
    bool req = commands::take_telemetry_request();
    if (req || now - t_tele >= uint32_t(c.telemetry_interval_s) * 1000UL) {
      t_tele = now;
      if (mqtt_link::connected()) mqtt_link::publish("telemetry", build_telemetry(), 0, false);
    }

    wdt::kick(g_wd_ctl);
    wdt::twdt_reset();
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

}  // namespace

std::string build_telemetry() {
  app::Readings r = app::readings();
  JsonDocument d;
  int64_t ts = timebase::now_ms();
  d["ts"] = ts;
  d["uptime_ms"] = timebase::uptime_ms();
  d["seq"] = ++g_seq;

  if (r.ac_ok) {
    JsonObject ac = d["ac"].to<JsonObject>();
    ac["v"] = r1(r.ac.v);
    ac["a"] = std::round(double(r.ac.a) * 1000.0) / 1000.0;
    ac["w"] = r1(r.ac.w);
    ac["kwh"] = std::round(double(r.ac.kwh) * 1000.0) / 1000.0;
    ac["hz"] = r1(r.ac.hz);
    ac["pf"] = r2(r.ac.pf);
  } else {
    d["ac"] = nullptr;
  }

  if (r.dc.in_ok || r.dc.batt_ok) {
    JsonObject dc = d["dc"].to<JsonObject>();
    if (r.dc.in_ok) {
      dc["in_v"] = r2(r.dc.in_v);
      dc["in_a"] = r2(r.dc.in_a);
    } else {
      dc["in_v"] = nullptr;
      dc["in_a"] = nullptr;
    }
    if (r.dc.batt_ok) dc["batt_v"] = r2(r.dc.batt_v); else dc["batt_v"] = nullptr;
  } else {
    d["dc"] = nullptr;
  }

  if (r.env.ok) {
    JsonObject env = d["env"].to<JsonObject>();
    env["t"] = r1(r.env.t);
    env["rh"] = r1(r.env.rh);
  } else {
    d["env"] = nullptr;
  }

  JsonArray relays = d["relays"].to<JsonArray>();
  JsonArray loads = d["loads"].to<JsonArray>();
  for (int ch = 1; ch <= board::kRelayCount; ++ch) {
    relays.add(power::coil_on(ch));
    loads.add(power::load_on(ch));
  }
  JsonObject ao = d["alarm_out"].to<JsonObject>();
  ao["siren"] = power::alarm_state(true);
  ao["strobe"] = power::alarm_state(false);

  if (r.inputs_ok) {
    JsonObject in = d["inputs"].to<JsonObject>();
    for (int i = 0; i < cfg::kInputs; ++i) in[cfg::kInputNames[i]] = bool((r.inputs_active >> i) & 1u);
  } else {
    d["inputs"] = nullptr;
  }

  if (r.accel_ok) {
    JsonObject ac = d["accel"].to<JsonObject>();
    ac["shock"] = r.shock_active;
    if (r.tilt_valid) ac["tilt_deg"] = r1(r.tilt_deg); else ac["tilt_deg"] = nullptr;
  } else {
    d["accel"] = nullptr;
  }

  JsonObject n = d["net"].to<JsonObject>();
  n["eth_link"] = net::link_up();
  n["mqtt_reconnects"] = mqtt_link::reconnects();
  n["offline_buffered"] = mqtt_link::offline_buffered();

  JsonObject au = d["auto"].to<JsonObject>();
  au["fan"] = r.fan_auto;
  au["heater"] = r.heater_auto;

  std::string s;
  serializeJson(d, s);
  return s;
}

void publish_telemetry_now() {
  if (mqtt_link::connected()) mqtt_link::publish("telemetry", build_telemetry(), 0, false);
}

void begin() {
  ioexp::init_inputs();
  cfg::Config c = app::config();
  if (!sensors::lis_init(c.accel.shock_g)) events::sensor_fault("lis3dh");
  g_wd_io = wdt::register_channel("io", 3000);
  g_wd_ctl = wdt::register_channel("control", 10000);
  xTaskCreatePinnedToCore(io_task, "io", 6144, nullptr, 5, nullptr, 1);
  xTaskCreatePinnedToCore(control_task, "control", 8192, nullptr, 4, nullptr, 1);
}

}  // namespace local_control
