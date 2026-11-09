// Minimal strict JSON parser + canonical serializer used for command signature
// verification (protocol.md section 4).
//
// canonical form = object keys sorted (byte order of the unescaped UTF-8 key),
// no whitespace, recursively. Scalars (numbers, strings, literals) are emitted
// verbatim as they appeared on the wire, so the device never re-formats a number
// (e.g. 1.5 vs 1.50000001) differently from the server's serializer.
//
// Pure C++ (no Arduino dependency) so it can be unit-tested on the host.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace jc {

struct Value {
  enum Type : uint8_t { Null, Bool, Number, String, Array, Object };
  Type type = Null;
  bool b = false;
  std::string raw;   // verbatim token for Null/Bool/Number/String (strings incl. quotes)
  std::string str;   // unescaped UTF-8 content for String
  std::vector<Value> items;                                // Array
  std::vector<std::pair<std::string, Value>> members;      // Object: (unescaped key, value)
  std::vector<std::string> member_raw_keys;                // Object: verbatim key tokens

  bool isObject() const { return type == Object; }
  bool isString() const { return type == String; }
  bool isNumber() const { return type == Number; }
  bool isBool() const { return type == Bool; }
  bool isNull() const { return type == Null; }

  // Object lookup (nullptr when absent or not an object).
  const Value* get(const char* key) const;
};

struct ParseOptions {
  int max_depth = 12;
  size_t max_len = 8192;
};

// Parses a complete JSON text. Rejects trailing garbage, duplicate object keys,
// invalid escapes / UTF-16 surrogates, leading zeros, etc.
bool parse(const char* text, size_t len, Value& out, std::string* err = nullptr,
           const ParseOptions& opt = ParseOptions());
inline bool parse(const std::string& s, Value& out, std::string* err = nullptr,
                  const ParseOptions& opt = ParseOptions()) {
  return parse(s.data(), s.size(), out, err, opt);
}

// Canonical compact serialization (sorted keys, no whitespace).
// Verbatim: strings/keys keep their wire escaping.
// Normalized: strings/keys are re-escaped like ECMAScript JSON.stringify
// (only ", \\, \\b \\f \\n \\r \\t and other control chars escaped; non-ASCII raw).
// Numbers are always kept verbatim.
enum class StrMode : uint8_t { Verbatim, Normalized };
void canonical(const Value& v, std::string& out, StrMode mode = StrMode::Verbatim);
std::string canonical(const Value& v, StrMode mode = StrMode::Verbatim);

// Strict integer conversion of a Number token (no fraction/exponent).
bool as_int64(const Value& v, int64_t& out);
// Number token to double (accepts fraction/exponent).
bool as_double(const Value& v, double& out);

// JSON string escaping for building payloads by hand.
void append_escaped(std::string& out, const std::string& s);

}  // namespace jc
