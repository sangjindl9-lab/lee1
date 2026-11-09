#include "io_expander.h"

#include <Arduino.h>

#include "board.h"
#include "i2c_bus.h"

namespace ioexp {
namespace {
// Register map, IOCON.BANK = 0
enum : uint8_t {
  IODIRA = 0x00, IODIRB = 0x01, IPOLA = 0x02, IPOLB = 0x03, GPINTENA = 0x04, GPINTENB = 0x05,
  DEFVALA = 0x06, DEFVALB = 0x07, INTCONA = 0x08, INTCONB = 0x09, IOCON = 0x0A,
  GPPUA = 0x0C, GPPUB = 0x0D, INTFA = 0x0E, INTFB = 0x0F, INTCAPA = 0x10, INTCAPB = 0x11,
  GPIOA = 0x12, GPIOB = 0x13, OLATA = 0x14, OLATB = 0x15,
};
constexpr uint8_t A = board::kAddrMcp23017;

SemaphoreHandle_t g_mtx = nullptr;
volatile uint8_t g_olat = 0x00;
volatile bool g_ok = false;

struct Lock {
  Lock() { xSemaphoreTake(g_mtx, portMAX_DELAY); }
  ~Lock() { xSemaphoreGive(g_mtx); }
};
}  // namespace

bool init_outputs_safe() {
  if (!g_mtx) g_mtx = xSemaphoreCreateMutex();
  Lock l;
  g_olat = 0x00;
  bool ok = false;
  for (int attempt = 0; attempt < 3 && !ok; ++attempt) {
    // Latch LOW first, then switch the port to output, so no pin is ever driven high.
    ok = i2c::write_reg8(A, OLATA, 0x00) && i2c::write_reg8(A, IODIRA, 0x00);
    if (!ok) {
      i2c::recover();
      delay(2);
    }
  }
  if (ok) {
    // IOCON: BANK=0, MIRROR=0, SEQOP=0, ODR=0 (push-pull INT), INTPOL=0 (active low)
    ok = i2c::write_reg8(A, IOCON, 0x00) && i2c::write_reg8(A, IPOLA, 0x00) &&
         i2c::write_reg8(A, GPINTENA, 0x00) && i2c::write_reg8(A, GPPUA, 0x00);
  }
  g_ok = ok;
  return ok;
}

bool init_inputs() {
  Lock l;
  pinMode(board::kPinMcpIntB, INPUT);  // GPIO35: input only, push-pull INTB from MCP
  bool ok = i2c::write_reg8(A, IODIRB, 0xFF) &&
            i2c::write_reg8(A, IPOLB, 0x00) &&
            i2c::write_reg8(A, GPPUB, 0x00) &&      // external 10k pull-ups fitted
            i2c::write_reg8(A, INTCONB, 0x00) &&    // interrupt on any change
            i2c::write_reg8(A, GPINTENB, 0xFF);
  uint8_t dummy;
  ok = ok && i2c::read_reg8(A, GPIOB, dummy);  // clear pending interrupt
  g_ok = ok;
  return ok;
}

bool ok() { return g_ok; }

bool set_bit(uint8_t bit, bool on) {
  if (bit > 7) return false;
  Lock l;
  uint8_t next = on ? uint8_t(g_olat | (1u << bit)) : uint8_t(g_olat & ~(1u << bit));
  bool wrote = i2c::write_reg8(A, OLATA, next);
  uint8_t rb = 0;
  bool latched = wrote && i2c::read_reg8(A, OLATA, rb) && rb == next;
  g_ok = wrote;
  if (!latched) return false;
  g_olat = next;  // shadow follows the latch actually in the chip
  // Pin level read-back (GPIOA) catches a shorted pin / driver fault.
  uint8_t pins = 0;
  return i2c::read_reg8(A, GPIOA, pins) && ((pins >> bit) & 1u) == (on ? 1u : 0u);
}

uint8_t outputs() { return g_olat; }

bool read_inputs(uint8_t& raw) {
  Lock l;
  bool ok = i2c::read_reg8(A, GPIOB, raw);
  g_ok = ok;
  return ok;
}

bool int_pending() { return digitalRead(board::kPinMcpIntB) == LOW; }

bool verify_and_repair() {
  Lock l;
  uint8_t iodir = 0xFF, olat = 0;
  bool ok = i2c::read_reg8(A, IODIRA, iodir) && i2c::read_reg8(A, OLATA, olat);
  if (!ok) {
    i2c::recover();
    g_ok = false;
    return false;
  }
  if (iodir != 0x00 || olat != g_olat) {
    // Expander was reset or corrupted: restore latch first, then direction.
    ok = i2c::write_reg8(A, OLATA, g_olat) && i2c::write_reg8(A, IODIRA, 0x00) &&
         i2c::write_reg8(A, IOCON, 0x00) && i2c::write_reg8(A, IODIRB, 0xFF) &&
         i2c::write_reg8(A, INTCONB, 0x00) && i2c::write_reg8(A, GPINTENB, 0xFF);
    log_w("MCP23017 state repaired (iodir=%02x olat=%02x expected %02x)", iodir, olat, g_olat);
  }
  g_ok = ok;
  return ok;
}

}  // namespace ioexp
