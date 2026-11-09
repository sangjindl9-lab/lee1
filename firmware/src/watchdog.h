// Two-level watchdog:
//  1) External TPS3823 (WDI = GPIO5, timeout ~1.6 s): a dedicated highest-priority
//     task toggles WDI every 100 ms, but ONLY while every registered health
//     channel has checked in recently. A hung task -> WDI stops -> hardware reset.
//  2) ESP-IDF task watchdog (TWDT) for the worker tasks.
#pragma once

#include <cstdint>

namespace wdt {

// Starts the WDI toggling task immediately (call right after the safe output
// init: the TPS3823 starts counting at power-up). Until arm() is called the
// task toggles unconditionally for at most `boot_grace_ms`.
void start_early(uint32_t boot_grace_ms = 60000);

// Registers a health channel; the caller must kick() at least every max_age_ms.
int register_channel(const char* name, uint32_t max_age_ms);
void kick(int ch);

// Boot finished: from now on WDI toggling requires all channels to be healthy.
void arm();

// Adds the calling task to the ESP task watchdog (timeout set in start_early).
void twdt_add_current();
void twdt_reset();

// Stop feeding (used for a deliberate reboot that must also reset the PHY etc.).
void starve();

}  // namespace wdt
