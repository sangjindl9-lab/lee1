// Command envelope parsing, signature verification, expiry/replay checks and
// the last-32 cmd_id ack cache (protocol.md sections 3.5 and 4).
// Pure C++ for host testing.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "json_canon.h"

namespace cmdcore {

enum class CmdType : uint8_t {
  Unknown,
  PowerOff,
  PowerOn,
  PowerCycle,
  AlarmOut,
  TelemetryNow,
  ConfigSet,
  RebootDevice,
};

CmdType type_from_string(const std::string& s);
const char* type_to_string(CmdType t);

struct Envelope {
  std::string cmd_id;
  std::string type_str;
  CmdType type = CmdType::Unknown;
  std::string ts_raw, exp_raw;  // verbatim integer tokens used in canonical string
  int64_t ts = 0;
  int64_t exp = 0;
  bool has_exp = false;
  std::string sig_hex;
  jc::Value params;             // parsed params object
  std::string params_canonical;      // sorted-key compact JSON, wire string escaping
  std::string params_canonical_norm; // same, JSON.stringify-style string escaping
};

enum class ParseError : uint8_t { None, NotJson, NoCmdId, BadEnvelope };

// Parses the cmd JSON. On NoCmdId/NotJson no ack can be sent.
// On BadEnvelope the cmd_id is filled so an "invalid_params" rejection can be sent
// (it cannot be signature-verified, so it must not be cached).
ParseError parse_envelope(const std::string& payload, Envelope& out, std::string* detail = nullptr);

// canonical = cmd_id \n ts \n exp \n type \n params_json
std::string canonical_string(const Envelope& e, bool normalized_strings = false);

// Signature check. The protocol describes cmd_secret as "32 bytes (64 hex chars)";
// the HMAC key is the raw 32 decoded bytes. For interoperability with server
// implementations that pass the hex text itself as key (Node's
// createHmac('sha256', hexString)), the ASCII-hex form is accepted as a fallback.
// Both forms derive from the same secret, so this does not weaken the check.
// params_json is tried with the wire string escaping first and then with
// JSON.stringify-style escaping (differs only if params contain \u escapes).
// TODO(protocol): pin key form + string escaping in protocol.md, drop fallbacks.
bool verify_signature(const Envelope& e, const uint8_t* key, size_t key_len,
                      const std::string& secret_hex);

// Expiry: when the device clock is synced (now_ms > 0), exp < now is expired.
// Without a trusted clock, a command whose exp is older than the newest accepted
// command's ts ("server time watermark", persisted in NVS) is expired - this
// blocks replays of old signed commands that fell out of the 32-entry cache
// while the device clock is not synced (e.g. RTC battery empty, no SNTP).
bool is_expired(const Envelope& e, int64_t now_ms, int64_t watermark_ms);

// ---------------------------------------------------------------- ack cache
class AckCache {
 public:
  static constexpr size_t kCapacity = 32;
  static constexpr size_t kMaxAckLen = 512;

  // Returns pointer to the last ack JSON for cmd_id, or nullptr.
  const std::string* find(const std::string& cmd_id) const;
  // Inserts or updates the last ack for cmd_id. Evicts the oldest entry when full.
  void put(const std::string& cmd_id, const std::string& ack_json, bool delivered);
  void mark_delivered(const std::string& cmd_id);
  // Entries whose latest ack could not be published (device offline).
  std::vector<std::pair<std::string, std::string>> undelivered() const;
  size_t size() const { return entries_.size(); }

 private:
  struct Entry {
    std::string cmd_id;
    std::string ack;
    bool delivered;
  };
  std::vector<Entry> entries_;  // oldest first
};

// Builds an ack JSON. result_json / error may be empty.
std::string build_ack(const std::string& cmd_id, const char* stage, int64_t ts_ms,
                      uint64_t uptime_ms, const std::string& error,
                      const std::string& result_json);

}  // namespace cmdcore
