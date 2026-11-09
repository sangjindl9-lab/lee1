// SB-MB01 Rev 0.1 CCTV smartbox main board firmware.
// Device <-> server contract: docs/protocol.md (EUM smartbox protocol v1).
//
// Boot order matters:
//   1. I2C + MCP23017 port A latched LOW (all relay coils OFF -> NC loads powered,
//      siren/strobe off) before anything slow.
//   2. External watchdog (TPS3823) feeder task starts.
//   3. NVS / config / RTC time / sensors / UARTs.
//   4. Ethernet + MQTT (TLS), command pipeline, local control, local recovery.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_system.h>

#include "app_state.h"
#include "board.h"
#include "commands.h"
#include "events.h"
#include "i2c_bus.h"
#include "io_expander.h"
#include "local_control.h"
#include "mqtt_link.h"
#include "net.h"
#include "power.h"
#include "pzem.h"
#include "recovery.h"
#include "sensors.h"
#include "storage.h"
#include "timebase.h"
#include "watchdog.h"

static_assert(ARDUINOJSON_USE_LONG_LONG, "64-bit integers are required for epoch-ms timestamps");

namespace {

int g_wd_main = -1;
bool g_sntp_started = false;

const char* map_reset_reason(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON:
      // NOTE: a TPS3823 reset pulls EN low and is reported by the chip as a
      // power-on reset; it cannot be told apart from a real power cycle.
      return "power_on";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:
      return "watchdog";
    case ESP_RST_SW:
      return "sw_reset";
    case ESP_RST_BROWNOUT:
      return "brownout";
    case ESP_RST_PANIC:
    case ESP_RST_EXT:
    case ESP_RST_DEEPSLEEP:
    case ESP_RST_SDIO:
    default:
      return "other";
  }
}

std::string build_hello() {
  JsonDocument d;
  int64_t ts = timebase::now_ms();
  d["ts"] = ts;
  d["uptime_ms"] = timebase::uptime_ms();
  d["hw"] = HW_MODEL;
  d["hw_rev"] = HW_REV;
  d["fw"] = FW_VERSION;
  d["mac"] = net::mac();
  d["ip"] = net::ip();
  d["boot_reason"] = app::boot_reason();
  cfg::Config c = app::config();
  d["config_version"] = c.config_version;
  cfg::channels_to_json(c, d["channels"].to<JsonArray>());
  std::string s;
  serializeJson(d, s);
  return s;
}

void on_mqtt_connected() {
  mqtt_link::publish("hello", build_hello(), 1, false);
  commands::on_connected();
  local_control::publish_telemetry_now();
}

// Status LED: fast blink = no Ethernet, slow blink = Ethernet but no MQTT,
// short heartbeat flash every 2 s = online.
void led_service() {
  uint32_t t = millis();
  bool on;
  if (!net::has_ip()) on = (t / 125) % 2;
  else if (!mqtt_link::connected()) on = (t / 500) % 2;
  else on = (t % 2000) < 60;
  digitalWrite(board::kPinLed, on ? HIGH : LOW);
}

}  // namespace

void setup() {
  // ---- 1. outputs to safe state FIRST
  i2c::begin();
  bool mcp_ok = ioexp::init_outputs_safe();

  // ---- 2. external watchdog feeder (TPS3823 counts from power-up)
  wdt::start_early(60000);

  Serial.begin(115200);
  pinMode(board::kPinLed, OUTPUT);
  digitalWrite(board::kPinLed, HIGH);
  log_i("SB-MB01 fw %s boot", FW_VERSION);

  // ---- 3. storage, config, time, sensors
  app::begin();
  app::set_boot_reason(map_reset_reason(esp_reset_reason()));
  storage::begin();
  {
    cfg::Config c;
    if (storage::load_config(c)) app::set_config(c);
  }
  events::begin(storage::boot_counter());
  mqtt_link::begin(storage::Provisioning(), nullptr, nullptr);  // event queue ready early
  if (!mcp_ok) events::sensor_fault("mcp23017");

  sensors::begin();
  timebase::begin_from_rtc();
  pzem::begin();
  rs485::begin();
  power::begin();

  events::emit("boot", "info", [](JsonObject d) {
    d["boot_reason"] = app::boot_reason();
    d["fw"] = FW_VERSION;
  });

  storage::Provisioning prov;
  std::string perr;
  if (!storage::load_provisioning(prov, perr)) {
    log_e("provisioning invalid (%s): running local-only (no MQTT)", perr.c_str());
  }
  app::set_prov(prov);

  // ---- 4. network + server link + workers
  mqtt_link::begin(app::prov(), commands::submit, on_mqtt_connected);
  net::begin();
  commands::begin();
  local_control::begin();
  recovery::begin();

  g_wd_main = wdt::register_channel("main", 20000);
  enableLoopWDT();
  wdt::arm();
  log_i("boot complete (reason=%s, config_version=%lld, time=%s)", app::boot_reason(),
        (long long)app::config_version(), timebase::source());
}

void loop() {
  mqtt_link::loop();
  if (!g_sntp_started && net::has_ip()) {
    g_sntp_started = true;
    timebase::start_sntp(app::prov().ntp_servers);
  }
  led_service();
  wdt::kick(g_wd_main);
  delay(20);
}
