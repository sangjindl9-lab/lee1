#include "json_canon.h"

#include <algorithm>
#include <cerrno>
#include <cstdlib>
#include <cstring>

namespace jc {

const Value* Value::get(const char* key) const {
  if (type != Object) return nullptr;
  for (const auto& m : members)
    if (m.first == key) return &m.second;
  return nullptr;
}

namespace {

struct Parser {
  const char* p;
  const char* end;
  const char* begin;
  int max_depth;
  std::string err;

  bool fail(const char* msg) {
    if (err.empty()) {
      err = msg;
      err += " at offset ";
      err += std::to_string(p - begin);
    }
    return false;
  }

  void ws() {
    while (p < end && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) ++p;
  }

  static int hexval(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  }

  static void put_utf8(std::string& o, uint32_t cp) {
    if (cp < 0x80) {
      o += char(cp);
    } else if (cp < 0x800) {
      o += char(0xC0 | (cp >> 6));
      o += char(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      o += char(0xE0 | (cp >> 12));
      o += char(0x80 | ((cp >> 6) & 0x3F));
      o += char(0x80 | (cp & 0x3F));
    } else {
      o += char(0xF0 | (cp >> 18));
      o += char(0x80 | ((cp >> 12) & 0x3F));
      o += char(0x80 | ((cp >> 6) & 0x3F));
      o += char(0x80 | (cp & 0x3F));
    }
  }

  bool read_hex4(uint32_t& v) {
    if (end - p < 4) return fail("short \\u escape");
    v = 0;
    for (int i = 0; i < 4; ++i) {
      int h = hexval(p[i]);
      if (h < 0) return fail("bad \\u escape");
      v = (v << 4) | uint32_t(h);
    }
    p += 4;
    return true;
  }

  // Validates one UTF-8 sequence starting at p (p points at lead byte >= 0x80).
  bool utf8_seq(std::string& o) {
    unsigned char c = (unsigned char)*p;
    int n;
    uint32_t cp;
    if (c >= 0xC2 && c <= 0xDF) { n = 1; cp = c & 0x1F; }
    else if (c >= 0xE0 && c <= 0xEF) { n = 2; cp = c & 0x0F; }
    else if (c >= 0xF0 && c <= 0xF4) { n = 3; cp = c & 0x07; }
    else return fail("invalid UTF-8");
    if (end - p < n + 1) return fail("truncated UTF-8");
    for (int i = 1; i <= n; ++i) {
      unsigned char cc = (unsigned char)p[i];
      if ((cc & 0xC0) != 0x80) return fail("invalid UTF-8");
      cp = (cp << 6) | (cc & 0x3F);
    }
    if ((n == 2 && cp < 0x800) || (n == 3 && (cp < 0x10000 || cp > 0x10FFFF)) ||
        (cp >= 0xD800 && cp <= 0xDFFF))
      return fail("invalid UTF-8");
    o.append(p, n + 1);
    p += n + 1;
    return true;
  }

  bool string(std::string& raw, std::string& out) {
    const char* start = p;
    if (p >= end || *p != '"') return fail("expected string");
    ++p;
    out.clear();
    while (true) {
      if (p >= end) return fail("unterminated string");
      unsigned char c = (unsigned char)*p;
      if (c == '"') { ++p; break; }
      if (c < 0x20) return fail("control char in string");
      if (c == '\\') {
        ++p;
        if (p >= end) return fail("bad escape");
        char e = *p++;
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            uint32_t cp;
            if (!read_hex4(cp)) return false;
            if (cp >= 0xD800 && cp <= 0xDBFF) {
              if (end - p < 6 || p[0] != '\\' || p[1] != 'u') return fail("lone surrogate");
              p += 2;
              uint32_t lo;
              if (!read_hex4(lo)) return false;
              if (lo < 0xDC00 || lo > 0xDFFF) return fail("bad surrogate pair");
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
              return fail("lone surrogate");
            }
            put_utf8(out, cp);
            break;
          }
          default:
            return fail("bad escape");
        }
      } else if (c >= 0x80) {
        if (!utf8_seq(out)) return false;
      } else {
        out += char(c);
        ++p;
      }
    }
    raw.assign(start, p - start);
    return true;
  }

  bool number(std::string& raw) {
    const char* start = p;
    if (p < end && *p == '-') ++p;
    if (p >= end) return fail("bad number");
    if (*p == '0') {
      ++p;
    } else if (*p >= '1' && *p <= '9') {
      while (p < end && *p >= '0' && *p <= '9') ++p;
    } else {
      return fail("bad number");
    }
    if (p < end && *p == '.') {
      ++p;
      if (p >= end || *p < '0' || *p > '9') return fail("bad fraction");
      while (p < end && *p >= '0' && *p <= '9') ++p;
    }
    if (p < end && (*p == 'e' || *p == 'E')) {
      ++p;
      if (p < end && (*p == '+' || *p == '-')) ++p;
      if (p >= end || *p < '0' || *p > '9') return fail("bad exponent");
      while (p < end && *p >= '0' && *p <= '9') ++p;
    }
    raw.assign(start, p - start);
    return true;
  }

  bool literal(const char* word, Value& v, Value::Type t, bool b) {
    size_t n = strlen(word);
    if (size_t(end - p) < n || memcmp(p, word, n) != 0) return fail("bad literal");
    v.type = t;
    v.b = b;
    v.raw.assign(p, n);
    p += n;
    return true;
  }

  bool value(Value& v, int depth) {
    if (depth > max_depth) return fail("too deep");
    ws();
    if (p >= end) return fail("unexpected end");
    char c = *p;
    if (c == '{') {
      v.type = Value::Object;
      ++p;
      ws();
      if (p < end && *p == '}') { ++p; return true; }
      while (true) {
        ws();
        std::string kraw, key;
        if (!string(kraw, key)) return false;
        for (const auto& m : v.members)
          if (m.first == key) return fail("duplicate key");
        ws();
        if (p >= end || *p != ':') return fail("expected ':'");
        ++p;
        Value child;
        if (!value(child, depth + 1)) return false;
        v.members.emplace_back(std::move(key), std::move(child));
        v.member_raw_keys.push_back(std::move(kraw));
        ws();
        if (p < end && *p == ',') { ++p; continue; }
        if (p < end && *p == '}') { ++p; return true; }
        return fail("expected ',' or '}'");
      }
    }
    if (c == '[') {
      v.type = Value::Array;
      ++p;
      ws();
      if (p < end && *p == ']') { ++p; return true; }
      while (true) {
        Value child;
        if (!value(child, depth + 1)) return false;
        v.items.push_back(std::move(child));
        ws();
        if (p < end && *p == ',') { ++p; continue; }
        if (p < end && *p == ']') { ++p; return true; }
        return fail("expected ',' or ']'");
      }
    }
    if (c == '"') {
      v.type = Value::String;
      return string(v.raw, v.str);
    }
    if (c == 't') return literal("true", v, Value::Bool, true);
    if (c == 'f') return literal("false", v, Value::Bool, false);
    if (c == 'n') return literal("null", v, Value::Null, false);
    v.type = Value::Number;
    return number(v.raw);
  }
};

}  // namespace

bool parse(const char* text, size_t len, Value& out, std::string* err, const ParseOptions& opt) {
  out = Value();
  if (len > opt.max_len) {
    if (err) *err = "too long";
    return false;
  }
  Parser ps{text, text + len, text, opt.max_depth, {}};
  if (!ps.value(out, 0)) {
    if (err) *err = ps.err;
    return false;
  }
  ps.ws();
  if (ps.p != ps.end) {
    if (err) *err = "trailing characters";
    return false;
  }
  return true;
}

void canonical(const Value& v, std::string& out, StrMode mode) {
  switch (v.type) {
    case Value::Object: {
      std::vector<size_t> idx(v.members.size());
      for (size_t i = 0; i < idx.size(); ++i) idx[i] = i;
      // Byte-wise comparison of UTF-8 == code point order.
      std::sort(idx.begin(), idx.end(), [&](size_t a, size_t b) {
        return v.members[a].first < v.members[b].first;
      });
      out += '{';
      for (size_t k = 0; k < idx.size(); ++k) {
        if (k) out += ',';
        if (mode == StrMode::Verbatim)
          out += v.member_raw_keys[idx[k]];
        else
          append_escaped(out, v.members[idx[k]].first);
        out += ':';
        canonical(v.members[idx[k]].second, out, mode);
      }
      out += '}';
      break;
    }
    case Value::Array:
      out += '[';
      for (size_t i = 0; i < v.items.size(); ++i) {
        if (i) out += ',';
        canonical(v.items[i], out, mode);
      }
      out += ']';
      break;
    case Value::String:
      if (mode == StrMode::Verbatim)
        out += v.raw;
      else
        append_escaped(out, v.str);
      break;
    default:
      out += v.raw;
      break;
  }
}

std::string canonical(const Value& v, StrMode mode) {
  std::string s;
  canonical(v, s, mode);
  return s;
}

bool as_int64(const Value& v, int64_t& out) {
  if (v.type != Value::Number) return false;
  const std::string& r = v.raw;
  if (r.find_first_of(".eE") != std::string::npos) return false;
  errno = 0;
  char* e = nullptr;
  long long x = strtoll(r.c_str(), &e, 10);
  if (errno != 0 || e == nullptr || *e != '\0') return false;
  out = int64_t(x);
  return true;
}

bool as_double(const Value& v, double& out) {
  if (v.type != Value::Number) return false;
  char* e = nullptr;
  out = strtod(v.raw.c_str(), &e);
  return e && *e == '\0';
}

void append_escaped(std::string& out, const std::string& s) {
  static const char* hex = "0123456789abcdef";
  out += '"';
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      default:
        if (c < 0x20) {
          out += "\\u00";
          out += hex[c >> 4];
          out += hex[c & 15];
        } else {
          out += char(c);
        }
    }
  }
  out += '"';
}

}  // namespace jc
