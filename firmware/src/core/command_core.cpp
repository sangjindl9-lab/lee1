#include "command_core.h"

#include <cstring>

#include "crypto.h"

namespace cmdcore {

namespace {
struct TypeName {
  CmdType t;
  const char* s;
};
const TypeName kTypes[] = {
    {CmdType::PowerOff, "power_off"},         {CmdType::PowerOn, "power_on"},
    {CmdType::PowerCycle, "power_cycle"},     {CmdType::AlarmOut, "alarm_out"},
    {CmdType::TelemetryNow, "telemetry_now"}, {CmdType::ConfigSet, "config_set"},
    {CmdType::RebootDevice, "reboot_device"},
};

bool valid_cmd_id(const std::string& s) {
  if (s.empty() || s.size() > 64) return false;
  for (unsigned char c : s)
    if (c < 0x21 || c > 0x7e || c == '"' || c == '\\') return false;
  return true;
}
}  // namespace

CmdType type_from_string(const std::string& s) {
  for (const auto& t : kTypes)
    if (s == t.s) return t.t;
  return CmdType::Unknown;
}

const char* type_to_string(CmdType t) {
  for (const auto& x : kTypes)
    if (x.t == t) return x.s;
  return "unknown";
}

ParseError parse_envelope(const std::string& payload, Envelope& out, std::string* detail) {
  out = Envelope();
  jc::Value root;
  std::string err;
  if (!jc::parse(payload, root, &err) || !root.isObject()) {
    if (detail) *detail = err.empty() ? "not an object" : err;
    return ParseError::NotJson;
  }
  const jc::Value* id = root.get("cmd_id");
  if (!id || !id->isString() || !valid_cmd_id(id->str)) {
    if (detail) *detail = "missing/invalid cmd_id";
    return ParseError::NoCmdId;
  }
  out.cmd_id = id->str;

  const jc::Value* ts = root.get("ts");
  const jc::Value* exp = root.get("exp");
  const jc::Value* type = root.get("type");
  const jc::Value* params = root.get("params");
  const jc::Value* sig = root.get("sig");

  if (!ts || !jc::as_int64(*ts, out.ts)) {
    if (detail) *detail = "ts";
    return ParseError::BadEnvelope;
  }
  out.ts_raw = ts->raw;
  if (exp && !exp->isNull()) {
    if (!jc::as_int64(*exp, out.exp)) {
      if (detail) *detail = "exp";
      return ParseError::BadEnvelope;
    }
    out.exp_raw = exp->raw;
    out.has_exp = true;
  } else {
    // canonical uses the literal token; a missing exp is serialized as "null"
    out.exp_raw = "null";
  }
  if (!type || !type->isString()) {
    if (detail) *detail = "type";
    return ParseError::BadEnvelope;
  }
  out.type_str = type->str;
  out.type = type_from_string(type->str);
  if (params == nullptr) {
    out.params.type = jc::Value::Object;
  } else if (!params->isObject()) {
    if (detail) *detail = "params";
    return ParseError::BadEnvelope;
  } else {
    out.params = *params;
  }
  out.params_canonical = jc::canonical(out.params, jc::StrMode::Verbatim);
  out.params_canonical_norm = jc::canonical(out.params, jc::StrMode::Normalized);
  if (!sig || !sig->isString()) {
    if (detail) *detail = "sig";
    return ParseError::BadEnvelope;
  }
  out.sig_hex = sig->str;
  return ParseError::None;
}

std::string canonical_string(const Envelope& e, bool normalized_strings) {
  std::string s;
  s.reserve(e.cmd_id.size() + e.params_canonical.size() + 64);
  // type uses the unescaped value: it is plain ASCII for every valid type
  s += e.cmd_id;
  s += '\n';
  s += e.ts_raw;
  s += '\n';
  s += e.exp_raw;
  s += '\n';
  s += e.type_str;
  s += '\n';
  s += normalized_strings ? e.params_canonical_norm : e.params_canonical;
  return s;
}

bool verify_signature(const Envelope& e, const uint8_t* key, size_t key_len,
                      const std::string& secret_hex) {
  uint8_t want[32];
  size_t n = 0;
  if (e.sig_hex.size() != 64 || !crypto::from_hex(e.sig_hex, want, sizeof(want), &n) || n != 32)
    return false;
  uint8_t mac[32];
  bool ok = false;
  const int variants = e.params_canonical_norm == e.params_canonical ? 1 : 2;
  for (int v = 0; v < variants && !ok; ++v) {
    std::string c = canonical_string(e, v == 1);
    crypto::hmac_sha256(key, key_len, c.data(), c.size(), mac);
    ok = crypto::ct_equal(mac, want, 32);
    if (!ok && !secret_hex.empty()) {
      crypto::hmac_sha256(reinterpret_cast<const uint8_t*>(secret_hex.data()), secret_hex.size(),
                          c.data(), c.size(), mac);
      ok = crypto::ct_equal(mac, want, 32);
    }
  }
  memset(mac, 0, sizeof(mac));
  return ok;
}

bool is_expired(const Envelope& e, int64_t now_ms, int64_t watermark_ms) {
  if (!e.has_exp) return false;
  if (now_ms > 0) return e.exp < now_ms;  // trusted clock decides
  // No trusted clock: the newest accepted server ts is a lower bound of server time.
  return watermark_ms > 0 && e.exp < watermark_ms;
}

// ---------------------------------------------------------------- AckCache
const std::string* AckCache::find(const std::string& cmd_id) const {
  for (const auto& en : entries_)
    if (en.cmd_id == cmd_id) return &en.ack;
  return nullptr;
}

void AckCache::put(const std::string& cmd_id, const std::string& ack_json, bool delivered) {
  // Bound RAM use: an oversized ack (huge result) is stored without its body;
  // a re-send then carries only the stage marker.
  std::string ack = ack_json;
  if (ack.size() > kMaxAckLen) {
    ack = "{\"cmd_id\":";
    jc::append_escaped(ack, cmd_id);
    ack += ",\"stage\":\"done\",\"ts\":0}";
  }
  for (auto& en : entries_) {
    if (en.cmd_id == cmd_id) {
      en.ack = ack;
      en.delivered = delivered;
      return;
    }
  }
  if (entries_.size() >= kCapacity) entries_.erase(entries_.begin());
  entries_.push_back({cmd_id, ack, delivered});
}

void AckCache::mark_delivered(const std::string& cmd_id) {
  for (auto& en : entries_)
    if (en.cmd_id == cmd_id) en.delivered = true;
}

std::vector<std::pair<std::string, std::string>> AckCache::undelivered() const {
  std::vector<std::pair<std::string, std::string>> v;
  for (const auto& en : entries_)
    if (!en.delivered) v.emplace_back(en.cmd_id, en.ack);
  return v;
}

std::string build_ack(const std::string& cmd_id, const char* stage, int64_t ts_ms,
                      uint64_t uptime_ms, const std::string& error,
                      const std::string& result_json) {
  std::string s = "{\"cmd_id\":";
  jc::append_escaped(s, cmd_id);
  s += ",\"stage\":\"";
  s += stage;
  s += "\",\"ts\":";
  s += std::to_string(ts_ms);
  if (ts_ms == 0) {
    s += ",\"uptime_ms\":";
    s += std::to_string(uptime_ms);
  }
  if (!error.empty()) {
    s += ",\"error\":";
    jc::append_escaped(s, error);
  }
  if (!result_json.empty()) {
    s += ",\"result\":";
    s += result_json;
  }
  s += '}';
  return s;
}

}  // namespace cmdcore
