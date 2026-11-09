// Load-power semantics on top of the relay coils (NO/NC per channel config),
// channel locks (server power_cycle vs. local recovery) and alarm outputs.
#pragma once

#include <cstdint>

namespace power {

enum class Owner : uint8_t { None, Server, Recovery };

void begin();

// ch = 1..6. Sets the LOAD state (coil derived from contact type).
// Returns false on I2C / read-back failure (relay_feedback).
bool set_load(int ch, bool on);
bool load_on(int ch);
bool coil_on(int ch);

// Exclusive lock for timed operations (power_cycle).
bool try_lock(int ch, Owner who);
void unlock(int ch, Owner who);
Owner lock_owner(int ch);

// Server bookkeeping: last server power command time and "forced off" flag
// (load off because of power_off; local automation must not touch it).
void note_server_command(int ch, bool load_after);
uint32_t ms_since_server_command(int ch);  // UINT32_MAX if never
bool server_forced_off(int ch);

// Alarm outputs (GPA6 siren, GPA7 strobe). duration_s > 0 -> auto off.
bool set_alarm(bool siren, bool on, uint32_t duration_s);
bool alarm_state(bool siren);
void service_alarms();  // auto-off timers (call periodically)

}  // namespace power
