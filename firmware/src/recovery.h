// Local automatic recovery (config.local_recovery, protocol.md 5):
// ping each target every interval_s; after fail_threshold consecutive failures:
//   1) kind == "hanwha_sunapi": SUNAPI soft restart (HTTP digest), wait boot_wait_s
//   2) still down and target.ch set: power-cycle that channel (never for
//      poe_switch / optic_converter unless allow_shared), wait boot_wait_s
//   3) otherwise / limit reached: "gave_up" (retry after one hour)
// Power cycles are limited to max_per_hour (sliding window persisted in NVS).
#pragma once

namespace recovery {

void begin();

}  // namespace recovery
