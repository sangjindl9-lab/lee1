// Portable SHA-256 / HMAC-SHA256 / MD5 (no external dependency).
// Used for command signatures (HMAC-SHA256) and HTTP digest auth (MD5 / SHA-256).
// The same code runs on the ESP32 and in the host unit test, so the exact bytes
// that are verified on the device are the ones covered by the tests.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace crypto {

class Sha256 {
 public:
  Sha256() { reset(); }
  void reset();
  void update(const void* data, size_t len);
  void finish(uint8_t out[32]);

 private:
  void block(const uint8_t* p);
  uint32_t h_[8];
  uint64_t len_;
  uint8_t buf_[64];
  size_t used_;
};

class Md5 {
 public:
  Md5() { reset(); }
  void reset();
  void update(const void* data, size_t len);
  void finish(uint8_t out[16]);

 private:
  void block(const uint8_t* p);
  uint32_t h_[4];
  uint64_t len_;
  uint8_t buf_[64];
  size_t used_;
};

void sha256(const void* data, size_t len, uint8_t out[32]);
void md5(const void* data, size_t len, uint8_t out[16]);
void hmac_sha256(const uint8_t* key, size_t key_len, const void* msg, size_t msg_len,
                 uint8_t out[32]);

std::string to_hex(const uint8_t* p, size_t n);
// Decodes hex (case-insensitive). Returns false on odd length / bad digit / overflow.
bool from_hex(const std::string& hex, uint8_t* out, size_t out_cap, size_t* out_len);
// Constant-time equality for equal-length buffers.
bool ct_equal(const uint8_t* a, const uint8_t* b, size_t n);

}  // namespace crypto
