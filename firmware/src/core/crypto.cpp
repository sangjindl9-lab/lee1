#include "crypto.h"

#include <cstring>

namespace crypto {

// ---------------------------------------------------------------- SHA-256
namespace {
const uint32_t K256[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2};

inline uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
inline uint32_t rotl(uint32_t x, int n) { return (x << n) | (x >> (32 - n)); }
}  // namespace

void Sha256::reset() {
  static const uint32_t init[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  memcpy(h_, init, sizeof(h_));
  len_ = 0;
  used_ = 0;
}

void Sha256::block(const uint8_t* p) {
  uint32_t w[64];
  for (int i = 0; i < 16; ++i)
    w[i] = (uint32_t(p[4 * i]) << 24) | (uint32_t(p[4 * i + 1]) << 16) |
           (uint32_t(p[4 * i + 2]) << 8) | uint32_t(p[4 * i + 3]);
  for (int i = 16; i < 64; ++i) {
    uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = h_[0], b = h_[1], c = h_[2], d = h_[3], e = h_[4], f = h_[5], g = h_[6],
           h = h_[7];
  for (int i = 0; i < 64; ++i) {
    uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = h + S1 + ch + K256[i] + w[i];
    uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = S0 + mj;
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  h_[0] += a; h_[1] += b; h_[2] += c; h_[3] += d;
  h_[4] += e; h_[5] += f; h_[6] += g; h_[7] += h;
}

void Sha256::update(const void* data, size_t len) {
  const uint8_t* p = static_cast<const uint8_t*>(data);
  len_ += len;
  while (len) {
    size_t n = 64 - used_;
    if (n > len) n = len;
    memcpy(buf_ + used_, p, n);
    used_ += n; p += n; len -= n;
    if (used_ == 64) { block(buf_); used_ = 0; }
  }
}

void Sha256::finish(uint8_t out[32]) {
  uint64_t bits = len_ * 8;
  uint8_t pad = 0x80;
  update(&pad, 1);
  uint8_t z = 0;
  while (used_ != 56) update(&z, 1);
  uint8_t lb[8];
  for (int i = 0; i < 8; ++i) lb[i] = uint8_t(bits >> (56 - 8 * i));
  update(lb, 8);
  for (int i = 0; i < 8; ++i) {
    out[4 * i] = uint8_t(h_[i] >> 24);
    out[4 * i + 1] = uint8_t(h_[i] >> 16);
    out[4 * i + 2] = uint8_t(h_[i] >> 8);
    out[4 * i + 3] = uint8_t(h_[i]);
  }
  reset();
}

// ---------------------------------------------------------------- MD5
namespace {
const uint32_t KMD5[64] = {
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
    0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
    0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
    0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
    0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
    0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
    0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
    0xeb86d391};
const uint8_t RMD5[64] = {7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
                          5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20, 5, 9,  14, 20,
                          4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
                          6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21};
}  // namespace

void Md5::reset() {
  h_[0] = 0x67452301; h_[1] = 0xefcdab89; h_[2] = 0x98badcfe; h_[3] = 0x10325476;
  len_ = 0;
  used_ = 0;
}

void Md5::block(const uint8_t* p) {
  uint32_t m[16];
  for (int i = 0; i < 16; ++i)
    m[i] = uint32_t(p[4 * i]) | (uint32_t(p[4 * i + 1]) << 8) | (uint32_t(p[4 * i + 2]) << 16) |
           (uint32_t(p[4 * i + 3]) << 24);
  uint32_t a = h_[0], b = h_[1], c = h_[2], d = h_[3];
  for (int i = 0; i < 64; ++i) {
    uint32_t f;
    int g;
    if (i < 16) { f = (b & c) | (~b & d); g = i; }
    else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
    else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
    else { f = c ^ (b | ~d); g = (7 * i) & 15; }
    uint32_t t = d;
    d = c;
    c = b;
    b = b + rotl(a + f + KMD5[i] + m[g], RMD5[i]);
    a = t;
  }
  h_[0] += a; h_[1] += b; h_[2] += c; h_[3] += d;
}

void Md5::update(const void* data, size_t len) {
  const uint8_t* p = static_cast<const uint8_t*>(data);
  len_ += len;
  while (len) {
    size_t n = 64 - used_;
    if (n > len) n = len;
    memcpy(buf_ + used_, p, n);
    used_ += n; p += n; len -= n;
    if (used_ == 64) { block(buf_); used_ = 0; }
  }
}

void Md5::finish(uint8_t out[16]) {
  uint64_t bits = len_ * 8;
  uint8_t pad = 0x80;
  update(&pad, 1);
  uint8_t z = 0;
  while (used_ != 56) update(&z, 1);
  uint8_t lb[8];
  for (int i = 0; i < 8; ++i) lb[i] = uint8_t(bits >> (8 * i));
  update(lb, 8);
  for (int i = 0; i < 4; ++i)
    for (int j = 0; j < 4; ++j) out[4 * i + j] = uint8_t(h_[i] >> (8 * j));
  reset();
}

// ---------------------------------------------------------------- helpers
void sha256(const void* data, size_t len, uint8_t out[32]) {
  Sha256 s;
  s.update(data, len);
  s.finish(out);
}

void md5(const void* data, size_t len, uint8_t out[16]) {
  Md5 m;
  m.update(data, len);
  m.finish(out);
}

void hmac_sha256(const uint8_t* key, size_t key_len, const void* msg, size_t msg_len,
                 uint8_t out[32]) {
  uint8_t k0[64] = {0};
  if (key_len > 64) {
    sha256(key, key_len, k0);
  } else {
    memcpy(k0, key, key_len);
  }
  uint8_t ipad[64], opad[64];
  for (int i = 0; i < 64; ++i) {
    ipad[i] = k0[i] ^ 0x36;
    opad[i] = k0[i] ^ 0x5c;
  }
  uint8_t inner[32];
  Sha256 s;
  s.update(ipad, 64);
  s.update(msg, msg_len);
  s.finish(inner);
  s.update(opad, 64);
  s.update(inner, 32);
  s.finish(out);
  memset(k0, 0, sizeof(k0));
  memset(ipad, 0, sizeof(ipad));
  memset(opad, 0, sizeof(opad));
}

std::string to_hex(const uint8_t* p, size_t n) {
  static const char* hx = "0123456789abcdef";
  std::string s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; ++i) {
    s += hx[p[i] >> 4];
    s += hx[p[i] & 15];
  }
  return s;
}

bool from_hex(const std::string& hex, uint8_t* out, size_t out_cap, size_t* out_len) {
  if (hex.size() % 2) return false;
  size_t n = hex.size() / 2;
  if (n > out_cap) return false;
  auto hv = [](char c) -> int {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
  };
  for (size_t i = 0; i < n; ++i) {
    int a = hv(hex[2 * i]), b = hv(hex[2 * i + 1]);
    if (a < 0 || b < 0) return false;
    out[i] = uint8_t((a << 4) | b);
  }
  if (out_len) *out_len = n;
  return true;
}

bool ct_equal(const uint8_t* a, const uint8_t* b, size_t n) {
  uint8_t d = 0;
  for (size_t i = 0; i < n; ++i) d |= a[i] ^ b[i];
  return d == 0;
}

}  // namespace crypto
