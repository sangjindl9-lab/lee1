#include "power.h"

#include <Arduino.h>

#include "app_state.h"
#include "board.h"
#include "io_expander.h"

namespace power {
namespace {
portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;
Owner g_lock[board::kRelayCount] = {};
uint32_t g_srv_ms[board::kRelayCount] = {};
bool g_srv_seen[board::kRelayCount] = {};
bool g_forced_off[board::kRelayCount] = {};
uint32_t g_alarm_off_at[2] = {0, 0};  // millis deadline, 0 = none
bool g_alarm_timed[2] = {false, false};

bool valid(int ch) { return ch >= 1 && ch <= board::kRelayCount; }
}  // namespace

void begin() {}

bool set_load(int ch, bool on) {
  if (!valid(ch)) return false;
  bool coil = logic::coil_for_load(app::channel_contact(ch), on);
  return ioexp::set_bit(uint8_t(ch - 1), coil);
}

bool coil_on(int ch) { return valid(ch) && ((ioexp::outputs() >> (ch - 1)) & 1u); }

bool load_on(int ch) {
  if (!valid(ch)) return false;
  return logic::load_from_coil(app::channel_contact(ch), coil_on(ch));
}

bool try_lock(int ch, Owner who) {
  if (!valid(ch)) return false;
  bool ok = false;
  portENTER_CRITICAL(&g_mux);
  if (g_lock[ch - 1] == Owner::None || g_lock[ch - 1] == who) {
    g_lock[ch - 1] = who;
    ok = true;
  }
  portEXIT_CRITICAL(&g_mux);
  return ok;
}

void unlock(int ch, Owner who) {
  if (!valid(ch)) return;
  portENTER_CRITICAL(&g_mux);
  if (g_lock[ch - 1] == who) g_lock[ch - 1] = Owner::None;
  portEXIT_CRITICAL(&g_mux);
}

Owner lock_owner(int ch) {
  if (!valid(ch)) return Owner::None;
  portENTER_CRITICAL(&g_mux);
  Owner o = g_lock[ch - 1];
  portEXIT_CRITICAL(&g_mux);
  return o;
}

void note_server_command(int ch, bool load_after) {
  if (!valid(ch)) return;
  portENTER_CRITICAL(&g_mux);
  g_srv_ms[ch - 1] = millis();
  g_srv_seen[ch - 1] = true;
  g_forced_off[ch - 1] = !load_after;
  portEXIT_CRITICAL(&g_mux);
}

uint32_t ms_since_server_command(int ch) {
  if (!valid(ch) || !g_srv_seen[ch - 1]) return UINT32_MAX;
  return millis() - g_srv_ms[ch - 1];
}

bool server_forced_off(int ch) { return valid(ch) && g_forced_off[ch - 1]; }

bool set_alarm(bool siren, bool on, uint32_t duration_s) {
  int i = siren ? 0 : 1;
  bool ok = ioexp::set_bit(siren ? board::kBitSiren : board::kBitStrobe, on);
  portENTER_CRITICAL(&g_mux);
  if (on && duration_s > 0) {
    uint32_t t = millis() + duration_s * 1000UL;
    g_alarm_off_at[i] = t ? t : 1;
    g_alarm_timed[i] = true;
  } else {
    g_alarm_timed[i] = false;
  }
  portEXIT_CRITICAL(&g_mux);
  return ok;
}

bool alarm_state(bool siren) {
  return (ioexp::outputs() >> (siren ? board::kBitSiren : board::kBitStrobe)) & 1u;
}

void service_alarms() {
  uint32_t now = millis();
  for (int i = 0; i < 2; ++i) {
    bool expire = false;
    portENTER_CRITICAL(&g_mux);
    if (g_alarm_timed[i] && int32_t(now - g_alarm_off_at[i]) >= 0) {
      g_alarm_timed[i] = false;
      expire = true;
    }
    portEXIT_CRITICAL(&g_mux);
    if (expire) ioexp::set_bit(i == 0 ? board::kBitSiren : board::kBitStrobe, false);
  }
}

}  // namespace power
