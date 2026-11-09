// MCP23017 driver: port A = relay coils CH1..6 + siren + strobe (outputs),
// port B = opto inputs DI1..DI8 (active LOW).
#pragma once

#include <cstdint>

namespace ioexp {

// MUST be the first hardware action at boot: drives every port-A output LOW
// (all coils OFF -> NC loads powered, siren/strobe off). Returns false if the
// MCP23017 did not answer (outputs then stay high-Z = ULN2803 inputs off).
bool init_outputs_safe();

// Configures port B inputs + interrupt-on-change (INTB -> GPIO35).
bool init_inputs();

bool ok();  // last transaction succeeded

// Sets/clears one port-A bit (0..7). Verifies by reading OLATA back.
bool set_bit(uint8_t bit, bool on);
uint8_t outputs();  // shadow of OLATA

// Raw GPIOB (bit = 1 -> pin high -> contact open). Clears pending INTB.
bool read_inputs(uint8_t& raw);

// INTB asserted (active low)?
bool int_pending();

// Re-checks IODIRA/OLATA against the shadow and rewrites if the expander was
// reset (brown-out) or corrupted. Returns false on I2C failure.
bool verify_and_repair();

}  // namespace ioexp
