#include "hw_codec.h"

#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "crypto.h"

namespace hw {

uint16_t crc16_modbus(const uint8_t* p, size_t n) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < n; ++i) {
    crc ^= p[i];
    for (int b = 0; b < 8; ++b) crc = (crc & 1) ? uint16_t((crc >> 1) ^ 0xA001) : uint16_t(crc >> 1);
  }
  return crc;
}

void pzem_build_read(uint8_t addr, uint16_t start, uint16_t count, uint8_t out[8]) {
  out[0] = addr;
  out[1] = 0x04;
  out[2] = uint8_t(start >> 8);
  out[3] = uint8_t(start);
  out[4] = uint8_t(count >> 8);
  out[5] = uint8_t(count);
  uint16_t crc = crc16_modbus(out, 6);
  out[6] = uint8_t(crc & 0xFF);  // CRC low byte first
  out[7] = uint8_t(crc >> 8);
}

bool pzem_parse(const uint8_t* b, size_t len, uint8_t expect_addr, PzemReading& o) {
  if (len < 25) return false;
  if (expect_addr != 0xF8 && b[0] != expect_addr) return false;
  if (b[1] != 0x04 || b[2] != 20) return false;
  uint16_t crc = crc16_modbus(b, 23);
  if (b[23] != uint8_t(crc & 0xFF) || b[24] != uint8_t(crc >> 8)) return false;
  uint16_t r[10];
  for (int i = 0; i < 10; ++i) r[i] = uint16_t((b[3 + 2 * i] << 8) | b[4 + 2 * i]);
  o.v = r[0] / 10.0f;
  o.a = (uint32_t(r[1]) | (uint32_t(r[2]) << 16)) / 1000.0f;
  o.w = (uint32_t(r[3]) | (uint32_t(r[4]) << 16)) / 10.0f;
  o.kwh = (uint32_t(r[5]) | (uint32_t(r[6]) << 16)) / 1000.0f;  // register unit: Wh
  o.hz = r[7] / 10.0f;
  o.pf = r[8] / 100.0f;
  o.alarm = r[9] == 0xFFFF;
  return true;
}

uint8_t sht31_crc8(const uint8_t* p, size_t n) {
  uint8_t crc = 0xFF;
  for (size_t i = 0; i < n; ++i) {
    crc ^= p[i];
    for (int b = 0; b < 8; ++b) crc = (crc & 0x80) ? uint8_t((crc << 1) ^ 0x31) : uint8_t(crc << 1);
  }
  return crc;
}

bool sht31_decode(const uint8_t f[6], float& t, float& rh) {
  if (sht31_crc8(f, 2) != f[2] || sht31_crc8(f + 3, 2) != f[5]) return false;
  uint16_t rt = uint16_t((f[0] << 8) | f[1]);
  uint16_t rr = uint16_t((f[3] << 8) | f[4]);
  t = -45.0f + 175.0f * (rt / 65535.0f);
  rh = 100.0f * (rr / 65535.0f);
  if (rh < 0) rh = 0;
  if (rh > 100) rh = 100;
  return true;
}

// Howard Hinnant's days_from_civil / civil_from_days.
int64_t civil_to_epoch(const CivilTime& c) {
  int y = c.year - (c.month <= 2 ? 1 : 0);
  int64_t era = (y >= 0 ? y : y - 399) / 400;
  unsigned yoe = unsigned(y - era * 400);
  unsigned mp = unsigned(c.month + (c.month > 2 ? -3 : 9));
  unsigned doy = (153 * mp + 2) / 5 + unsigned(c.day) - 1;
  unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  int64_t days = era * 146097 + int64_t(doe) - 719468;
  return days * 86400 + c.hour * 3600 + c.minute * 60 + c.second;
}

CivilTime epoch_to_civil(int64_t epoch) {
  int64_t days = epoch >= 0 ? epoch / 86400 : (epoch - 86399) / 86400;
  int64_t secs = epoch - days * 86400;
  CivilTime c{};
  c.hour = int(secs / 3600);
  c.minute = int((secs % 3600) / 60);
  c.second = int(secs % 60);
  c.weekday = int((days % 7 + 11) % 7);  // 1970-01-01 was a Thursday (4)
  int64_t z = days + 719468;
  int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  unsigned doe = unsigned(z - era * 146097);
  unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  int64_t y = int64_t(yoe) + era * 400;
  unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  unsigned mp = (5 * doy + 2) / 153;
  c.day = int(doy - (153 * mp + 2) / 5 + 1);
  c.month = int(mp < 10 ? mp + 3 : mp - 9);
  c.year = int(y + (c.month <= 2 ? 1 : 0));
  return c;
}

bool civil_valid(const CivilTime& c) {
  static const int mdays[] = {31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (c.year < 2024 || c.year > 2099) return false;
  if (c.month < 1 || c.month > 12) return false;
  if (c.day < 1 || c.day > mdays[c.month - 1]) return false;
  if (c.hour < 0 || c.hour > 23 || c.minute < 0 || c.minute > 59 || c.second < 0 || c.second > 59)
    return false;
  return true;
}

uint8_t lis3dh_ths(float g, int fs) {
  // LSB of INT1_THS: 16 mg @2g, 32 mg @4g, 62 mg @8g, 186 mg @16g
  float lsb = fs <= 2 ? 0.016f : fs <= 4 ? 0.032f : fs <= 8 ? 0.062f : 0.186f;
  int v = int(lroundf(g / lsb));
  if (v < 1) v = 1;
  if (v > 127) v = 127;
  return uint8_t(v);
}

float vec_angle_deg(const float a[3], const float b[3]) {
  float dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  float na = sqrtf(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  float nb = sqrtf(b[0] * b[0] + b[1] * b[1] + b[2] * b[2]);
  if (na < 1e-6f || nb < 1e-6f) return 0;
  float c = dot / (na * nb);
  if (c > 1) c = 1;
  if (c < -1) c = -1;
  return acosf(c) * 57.29578f;
}

// ---------------------------------------------------------------- digest
namespace {
std::string lower(std::string s) {
  for (auto& c : s) c = char(tolower((unsigned char)c));
  return s;
}

std::string hash_hex(const std::string& alg, const std::string& s) {
  if (alg == "sha-256") {
    uint8_t d[32];
    crypto::sha256(s.data(), s.size(), d);
    return crypto::to_hex(d, 32);
  }
  uint8_t d[16];
  crypto::md5(s.data(), s.size(), d);
  return crypto::to_hex(d, 16);
}
}  // namespace

bool digest_parse_challenge(const std::string& header, DigestChallenge& out) {
  out = DigestChallenge();
  size_t i = 0;
  while (i < header.size() && isspace((unsigned char)header[i])) ++i;
  if (lower(header.substr(i, 6)) != "digest") return false;
  i += 6;
  while (i < header.size()) {
    while (i < header.size() && (isspace((unsigned char)header[i]) || header[i] == ',')) ++i;
    size_t ks = i;
    while (i < header.size() && header[i] != '=' && header[i] != ',') ++i;
    if (i >= header.size() || header[i] != '=') break;
    std::string key = lower(header.substr(ks, i - ks));
    while (!key.empty() && isspace((unsigned char)key.back())) key.pop_back();
    ++i;
    while (i < header.size() && isspace((unsigned char)header[i])) ++i;
    std::string val;
    if (i < header.size() && header[i] == '"') {
      ++i;
      while (i < header.size() && header[i] != '"') {
        if (header[i] == '\\' && i + 1 < header.size()) ++i;
        val += header[i++];
      }
      ++i;
    } else {
      size_t vs = i;
      while (i < header.size() && header[i] != ',') ++i;
      val = header.substr(vs, i - vs);
      while (!val.empty() && isspace((unsigned char)val.back())) val.pop_back();
    }
    if (key == "realm") out.realm = val;
    else if (key == "nonce") out.nonce = val;
    else if (key == "opaque") out.opaque = val;
    else if (key == "qop") out.qop = val;
    else if (key == "algorithm") out.algorithm = val;
    else if (key == "stale") out.stale = lower(val) == "true";
  }
  return !out.nonce.empty();
}

std::string digest_authorization(const DigestChallenge& ch, const std::string& user,
                                 const std::string& pass, const std::string& method,
                                 const std::string& uri, uint32_t nc, const std::string& cnonce) {
  std::string alg = lower(ch.algorithm.empty() ? "MD5" : ch.algorithm);
  bool sess = false;
  if (alg.size() > 5 && alg.compare(alg.size() - 5, 5, "-sess") == 0) {
    sess = true;
    alg = alg.substr(0, alg.size() - 5);
  }
  if (alg != "md5" && alg != "sha-256") alg = "md5";
  // qop may be a list ("auth,auth-int"): use auth when offered
  bool use_qop = false;
  {
    std::string q = lower(ch.qop);
    size_t p = 0;
    while (p <= q.size()) {
      size_t c = q.find(',', p);
      std::string tok = q.substr(p, c == std::string::npos ? std::string::npos : c - p);
      while (!tok.empty() && isspace((unsigned char)tok.front())) tok.erase(tok.begin());
      while (!tok.empty() && isspace((unsigned char)tok.back())) tok.pop_back();
      if (tok == "auth") use_qop = true;
      if (c == std::string::npos) break;
      p = c + 1;
    }
  }
  char ncbuf[9];
  snprintf(ncbuf, sizeof(ncbuf), "%08x", (unsigned)nc);
  std::string ha1 = hash_hex(alg, user + ":" + ch.realm + ":" + pass);
  if (sess) ha1 = hash_hex(alg, ha1 + ":" + ch.nonce + ":" + cnonce);
  std::string ha2 = hash_hex(alg, method + ":" + uri);
  std::string resp = use_qop
                         ? hash_hex(alg, ha1 + ":" + ch.nonce + ":" + ncbuf + ":" + cnonce + ":auth:" + ha2)
                         : hash_hex(alg, ha1 + ":" + ch.nonce + ":" + ha2);
  std::string h = "Digest username=\"" + user + "\", realm=\"" + ch.realm + "\", nonce=\"" +
                  ch.nonce + "\", uri=\"" + uri + "\", response=\"" + resp + "\"";
  if (!ch.algorithm.empty()) h += ", algorithm=" + ch.algorithm;
  if (!ch.opaque.empty()) h += ", opaque=\"" + ch.opaque + "\"";
  if (use_qop) h += std::string(", qop=auth, nc=") + ncbuf + ", cnonce=\"" + cnonce + "\"";
  return h;
}

}  // namespace hw
