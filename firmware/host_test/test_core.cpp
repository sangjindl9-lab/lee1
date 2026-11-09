// Host-side unit tests for the pure-logic firmware modules (src/core).
// Build & run: host_test/run.sh
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

#include "command_core.h"
#include "control_logic.h"
#include "crypto.h"
#include "device_config.h"
#include "event_queue.h"
#include "hw_codec.h"
#include "json_canon.h"

static int g_fail = 0, g_pass = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (cond) {                                                        \
      ++g_pass;                                                        \
    } else {                                                           \
      ++g_fail;                                                        \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                  \
  } while (0)
#define CHECK_EQ(a, b)                                                                  \
  do {                                                                                  \
    auto _a = (a);                                                                      \
    auto _b = (b);                                                                      \
    if (_a == _b) {                                                                     \
      ++g_pass;                                                                         \
    } else {                                                                            \
      ++g_fail;                                                                         \
      fprintf(stderr, "FAIL %s:%d: %s == %s\n  got: [%s]\n  exp: [%s]\n", __FILE__,      \
              __LINE__, #a, #b, std::string(_a).c_str(), std::string(_b).c_str());     \
    }                                                                                   \
  } while (0)

static const char* kSecretHex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

static void test_crypto() {
  uint8_t d[32];
  crypto::sha256("abc", 3, d);
  CHECK_EQ(crypto::to_hex(d, 32),
           std::string("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
  std::string longmsg(1000, 'a');
  crypto::sha256(longmsg.data(), longmsg.size(), d);
  CHECK_EQ(crypto::to_hex(d, 32),
           std::string("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"));
  // RFC 4231 test case 1 and 2
  uint8_t k1[20];
  memset(k1, 0x0b, 20);
  crypto::hmac_sha256(k1, 20, "Hi There", 8, d);
  CHECK_EQ(crypto::to_hex(d, 32),
           std::string("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"));
  const char* m2 = "what do ya want for nothing?";
  crypto::hmac_sha256((const uint8_t*)"Jefe", 4, m2, strlen(m2), d);
  CHECK_EQ(crypto::to_hex(d, 32),
           std::string("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"));
  // RFC 4231 test case 6: key longer than block size (131 x 0xaa)
  uint8_t k6[131];
  memset(k6, 0xaa, sizeof(k6));
  const char* m6 = "Test Using Larger Than Block-Size Key - Hash Key First";
  crypto::hmac_sha256(k6, sizeof(k6), m6, strlen(m6), d);
  CHECK_EQ(crypto::to_hex(d, 32),
           std::string("60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"));
  uint8_t m[16];
  crypto::md5("", 0, m);
  CHECK_EQ(crypto::to_hex(m, 16), std::string("d41d8cd98f00b204e9800998ecf8427e"));
  crypto::md5("abc", 3, m);
  CHECK_EQ(crypto::to_hex(m, 16), std::string("900150983cd24fb0d6963f7d28e17f72"));
  const char* q = "The quick brown fox jumps over the lazy dog";
  crypto::md5(q, strlen(q), m);
  CHECK_EQ(crypto::to_hex(m, 16), std::string("9e107d9d372bb6826bd81d3542a419d6"));
  uint8_t buf[4];
  size_t n;
  CHECK(!crypto::from_hex("abc", buf, 4, &n));
  CHECK(!crypto::from_hex("zz", buf, 4, &n));
  CHECK(crypto::from_hex("A0ff", buf, 4, &n) && n == 2 && buf[0] == 0xA0 && buf[1] == 0xFF);
}

static void test_json_canon() {
  jc::Value v;
  std::string err;
  CHECK(jc::parse(" { \"b\" : [1, 2.50, {\"z\":true,\"a\":null}], \"a\":\"x\" } ", v, &err));
  CHECK_EQ(jc::canonical(v), std::string("{\"a\":\"x\",\"b\":[1,2.50,{\"a\":null,\"z\":true}]}"));
  // rejects
  CHECK(!jc::parse("{\"a\":1,\"a\":2}", v));            // duplicate key
  CHECK(!jc::parse("{\"a\":01}", v));                   // leading zero
  CHECK(!jc::parse("{\"a\":1} x", v));                  // trailing garbage
  CHECK(!jc::parse("{\"a\":\"\\ud800\"}", v));          // lone surrogate
  CHECK(!jc::parse("{\"a\":\"\x01\"}", v));             // raw control char
  CHECK(!jc::parse("[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]", v));  // too deep
  CHECK(!jc::parse("{\"a\":\"\xc3\"}", v));             // truncated UTF-8
  // escapes + normalized mode
  CHECK(jc::parse("{\"k\":\"p\\u00e4ss\\\"x\\/\"}", v));
  CHECK_EQ(v.get("k")->str, std::string("p\xc3\xa4ss\"x/"));
  CHECK_EQ(jc::canonical(v, jc::StrMode::Verbatim), std::string("{\"k\":\"p\\u00e4ss\\\"x\\/\"}"));
  CHECK_EQ(jc::canonical(v, jc::StrMode::Normalized), std::string("{\"k\":\"p\xc3\xa4ss\\\"x/\"}"));
  // surrogate pair -> 4-byte UTF-8
  CHECK(jc::parse("\"\\ud83d\\ude00\"", v));
  CHECK_EQ(v.str, std::string("\xf0\x9f\x98\x80"));
  int64_t i;
  CHECK(jc::parse("1762700000000", v) && jc::as_int64(v, i) && i == 1762700000000LL);
  CHECK(jc::parse("1.5", v) && !jc::as_int64(v, i));
  CHECK(jc::parse("-0", v) && jc::as_int64(v, i) && i == 0);
}

static std::string make_cmd(const char* cmd_id, const char* type, const char* params_wire,
                            const char* sig, const char* exp = "1762700060000") {
  std::string s = "{\"sig\": \"";
  s += sig;
  s += "\", \"params\": ";
  s += params_wire;
  s += ", \"type\": \"";
  s += type;
  s += "\", \"exp\": ";
  s += exp;
  s += ", \"ts\": 1762700000000, \"cmd_id\": \"";
  s += cmd_id;
  s += "\"}";
  return s;
}

static void test_command_verify() {
  uint8_t key[32];
  size_t n;
  CHECK(crypto::from_hex(kSecretHex, key, 32, &n) && n == 32);

  // Vector 1 (Python: hmac(bytes.fromhex(secret), canonical)). Wire params have
  // keys out of order and whitespace.
  cmdcore::Envelope e;
  auto r = cmdcore::parse_envelope(
      make_cmd("c-018f2a5e7d3b4c1a9e0f", "power_cycle", "{ \"off_sec\": 10, \"ch\": 1 }",
               "81fc469ddd788d26f0eb491e3df383cde26a595982771216f4b264248bd050b5"),
      e);
  CHECK(r == cmdcore::ParseError::None);
  CHECK(e.type == cmdcore::CmdType::PowerCycle);
  CHECK_EQ(e.params_canonical, std::string("{\"ch\":1,\"off_sec\":10}"));
  CHECK_EQ(cmdcore::canonical_string(e),
           std::string("c-018f2a5e7d3b4c1a9e0f\n1762700000000\n1762700060000\npower_cycle\n{\"ch\":1,\"off_sec\":10}"));
  CHECK(cmdcore::verify_signature(e, key, 32, kSecretHex));
  CHECK(cmdcore::verify_signature(e, key, 32, ""));  // raw-key form, no fallback needed

  // Same command signed with the hex-text key (Node createHmac(hexString)) -> fallback.
  cmdcore::parse_envelope(
      make_cmd("c-018f2a5e7d3b4c1a9e0f", "power_cycle", "{\"ch\":1,\"off_sec\":10}",
               "33c79769b79726d81df6ccb924a769f6c83240f0ca1efaeff73bc467843ba920"),
      e);
  CHECK(cmdcore::verify_signature(e, key, 32, kSecretHex));
  CHECK(!cmdcore::verify_signature(e, key, 32, ""));

  // Tampered params -> bad signature
  cmdcore::parse_envelope(
      make_cmd("c-018f2a5e7d3b4c1a9e0f", "power_cycle", "{\"ch\":2,\"off_sec\":10}",
               "81fc469ddd788d26f0eb491e3df383cde26a595982771216f4b264248bd050b5"),
      e);
  CHECK(!cmdcore::verify_signature(e, key, 32, kSecretHex));
  // Wrong cmd_id (replay under another id) -> bad signature
  cmdcore::parse_envelope(
      make_cmd("c-other", "power_cycle", "{\"ch\":1,\"off_sec\":10}",
               "81fc469ddd788d26f0eb491e3df383cde26a595982771216f4b264248bd050b5"),
      e);
  CHECK(!cmdcore::verify_signature(e, key, 32, kSecretHex));
  // Malformed sig
  cmdcore::parse_envelope(make_cmd("c-x", "power_cycle", "{\"ch\":1}", "zz"), e);
  CHECK(!cmdcore::verify_signature(e, key, 32, kSecretHex));

  // Vector 2: nested config_set with null, float, unicode escape on the wire.
  // Python canonical uses raw UTF-8 (ensure_ascii=False) -> normalized fallback.
  const char* cfg_wire =
      "{\"local_recovery\":{\"enabled\":true,\"targets\":[{\"user\":\"admin\",\"pass_enc\":"
      "\"p\\u00e4ss\\\"x\",\"kind\":\"hanwha_sunapi\",\"ip\":\"10.1.2.31\",\"ch\":null}]},"
      "\"fan\":{\"on_c\":40,\"off_c\":35.5},\"config_version\":4,"
      "\"channels\":[{\"role\":\"poe_switch\",\"contact\":\"NC\",\"ch\":1}]}";
  r = cmdcore::parse_envelope(
      make_cmd("c-cfg1", "config_set", cfg_wire,
               "bb313a0e686d0fe5b0839b188f6cfb690d7e335a345dbbe8d651861dd9c1ff5c"),
      e);
  CHECK(r == cmdcore::ParseError::None);
  CHECK(cmdcore::verify_signature(e, key, 32, kSecretHex));
  CHECK_EQ(e.params_canonical_norm,
           std::string("{\"channels\":[{\"ch\":1,\"contact\":\"NC\",\"role\":\"poe_switch\"}],"
                       "\"config_version\":4,\"fan\":{\"off_c\":35.5,\"on_c\":40},"
                       "\"local_recovery\":{\"enabled\":true,\"targets\":[{\"ch\":null,\"ip\":"
                       "\"10.1.2.31\",\"kind\":\"hanwha_sunapi\",\"pass_enc\":\"p\xc3\xa4ss\\\"x\","
                       "\"user\":\"admin\"}]}}"));
  // Vector 3: empty params
  r = cmdcore::parse_envelope(
      make_cmd("c-tn", "telemetry_now", "{}",
               "86b541728e7cc6f310df1b09e4d9a6144918f5a84a4deb9b8babd2f2ca331366"),
      e);
  CHECK(r == cmdcore::ParseError::None && cmdcore::verify_signature(e, key, 32, ""));

  // Envelope errors
  CHECK(cmdcore::parse_envelope("not json", e) == cmdcore::ParseError::NotJson);
  CHECK(cmdcore::parse_envelope("{\"ts\":1}", e) == cmdcore::ParseError::NoCmdId);
  CHECK(cmdcore::parse_envelope("{\"cmd_id\":\"c-1\",\"ts\":1.5,\"type\":\"x\",\"sig\":\"\"}", e) ==
        cmdcore::ParseError::BadEnvelope);
  CHECK_EQ(e.cmd_id, std::string("c-1"));
  CHECK(cmdcore::parse_envelope("{\"cmd_id\":\"c-1\",\"ts\":1,\"type\":\"x\",\"params\":[],\"sig\":\"\"}", e) ==
        cmdcore::ParseError::BadEnvelope);
  // Unknown type parses fine (rejected later with unknown_type after sig check)
  CHECK(cmdcore::parse_envelope(make_cmd("c-u", "self_destruct", "{}", "00"), e) ==
        cmdcore::ParseError::None);
  CHECK(e.type == cmdcore::CmdType::Unknown);

  // Expiry
  cmdcore::parse_envelope(make_cmd("c-e", "power_on", "{\"ch\":1}", "00"), e);
  CHECK(!cmdcore::is_expired(e, 0, 0));                     // no clock, no watermark
  CHECK(!cmdcore::is_expired(e, 1762700059999LL, 0));
  CHECK(cmdcore::is_expired(e, 1762700060001LL, 0));        // clock synced, past exp
  CHECK(cmdcore::is_expired(e, 0, 1762700070000LL));        // watermark beyond exp
  CHECK(!cmdcore::is_expired(e, 0, 1762700000000LL));
  CHECK(!cmdcore::is_expired(e, 1762700001000LL, 1762700070000LL));  // synced clock wins
}

static void test_ack_cache() {
  cmdcore::AckCache c;
  for (int i = 0; i < 32; ++i) c.put("c-" + std::to_string(i), "ack" + std::to_string(i), true);
  CHECK(c.size() == 32);
  CHECK(c.find("c-0") && *c.find("c-0") == "ack0");
  c.put("c-5", "ack5-done", true);  // update keeps size, last ack wins
  CHECK(c.size() == 32 && *c.find("c-5") == "ack5-done");
  c.put("c-32", "ack32", false);  // evicts oldest (c-0)
  CHECK(c.size() == 32);
  CHECK(c.find("c-0") == nullptr);
  CHECK(c.find("c-1") != nullptr);
  auto u = c.undelivered();
  CHECK(u.size() == 1 && u[0].first == "c-32");
  c.mark_delivered("c-32");
  CHECK(c.undelivered().empty());
  std::string a = cmdcore::build_ack("c-1", "rejected", 0, 1234, "bad_signature", "");
  CHECK_EQ(a, std::string("{\"cmd_id\":\"c-1\",\"stage\":\"rejected\",\"ts\":0,\"uptime_ms\":1234,"
                          "\"error\":\"bad_signature\"}"));
  a = cmdcore::build_ack("c-2", "done", 1762700012000LL, 0, "", "{\"ch\":1,\"load\":true}");
  CHECK_EQ(a, std::string("{\"cmd_id\":\"c-2\",\"stage\":\"done\",\"ts\":1762700012000,"
                          "\"result\":{\"ch\":1,\"load\":true}}"));
  jc::Value v;
  CHECK(jc::parse(a, v));
}

static void test_climate() {
  logic::FanCfg fan;        // on 40 / off 35
  logic::HeaterCfg heater;  // on 0 / off 5, rh 85 / 75
  logic::ClimateState s;
  auto step = [&](bool valid, float t, float rh) {
    logic::ClimateInput in{valid, t, rh};
    s = logic::climate_step(s, in, fan, heater);
  };
  step(true, 20, 50);
  CHECK(!s.fan && !s.heater);
  step(true, 39.9f, 50);
  CHECK(!s.fan);
  step(true, 40, 50);
  CHECK(s.fan && !s.heater);
  step(true, 37, 50);
  CHECK(s.fan);  // hysteresis band keeps it on
  step(true, 35, 50);
  CHECK(!s.fan);
  step(true, 38, 50);
  CHECK(!s.fan);  // band, stays off
  // cold
  step(true, 0.5f, 50);
  CHECK(!s.heater);
  step(true, 0, 50);
  CHECK(s.heater);
  step(true, 4.9f, 50);
  CHECK(s.heater);
  step(true, 5, 50);
  CHECK(!s.heater);
  // humidity
  step(true, 20, 85);
  CHECK(s.heater);
  step(true, 20, 76);
  CHECK(s.heater);
  step(true, 20, 75);
  CHECK(!s.heater);
  // humid but hot -> fan wins, heater interlocked off
  step(true, 41, 90);
  CHECK(s.fan && !s.heater);
  // sensor lost -> safe state
  step(false, 0, 0);
  CHECK(s.fan && !s.heater);
}

static void test_env_alarm() {
  logic::EnvAlarmCfg c;  // 60 / -20 / 95, hyst 2 / 5
  logic::EnvAlarmState st;
  CHECK(logic::env_alarm_step(st, 30, 50, c).empty());
  auto r = logic::env_alarm_step(st, 61, 50, c);
  CHECK(r.size() == 1 && strcmp(r[0].kind, "overtemp") == 0 && r[0].threshold == 60);
  CHECK(logic::env_alarm_step(st, 62, 50, c).empty());  // no repeat
  CHECK(logic::env_alarm_step(st, 59, 50, c).empty());  // inside hysteresis
  CHECK(st.overtemp);
  logic::env_alarm_step(st, 58, 50, c);
  CHECK(!st.overtemp);
  CHECK(logic::env_alarm_step(st, 60, 50, c).size() == 1);  // re-armed
  r = logic::env_alarm_step(st, -25, 96, c);
  CHECK(r.size() == 2);
}

static void test_limiter() {
  logic::HourlyLimiter L;
  L.load({}, true, 1794231930, 100);
  CHECK(L.allowed(100, 3));
  L.record(100, 1794231930);
  L.record(200, 1794232030);
  L.record(300, 1794232130);
  CHECK(!L.allowed(301, 3));
  CHECK(L.allowed(100 + 3600, 3));  // first one expired (sliding window)
  CHECK(L.count(100 + 3600) == 2);
  CHECK(!L.allowed(0 + 300, 0));    // max_per_hour 0 = never
  // Persist & reload after reboot with valid clock: ages preserved
  logic::HourlyLimiter La;
  La.record(100, 1794231930);
  La.record(200, 1794232030);
  La.record(300, 1794232130);
  logic::HourlyLimiter L2;
  auto ep = La.persist(400);
  CHECK(ep.size() == 3);
  L2.load(ep, true, 1794232130 + 1000, 5);  // 1000 s later, device uptime 5 s
  CHECK(L2.count(5) == 3);
  CHECK(L2.count(2404) == 3);
  CHECK(L2.count(2505) == 1);  // first two have aged out (ages 1200 s / 1100 s at boot)
  // Reload without valid clock: conservative, all count as fresh
  logic::HourlyLimiter L3;
  L3.load(ep, false, 0, 5);
  CHECK(L3.count(5 + 3599) == 3);
  CHECK(L3.count(5 + 3600) == 0);
  // Entries recorded without clock (epoch 0)
  logic::HourlyLimiter L4;
  L4.load({0, 0}, true, 1794231930, 10);
  CHECK(L4.count(10) == 2);
  // Expired entries dropped on load
  logic::HourlyLimiter L5;
  L5.load({1794231930 - 4000}, true, 1794231930, 10);
  CHECK(L5.count(10) == 0);
}

static void test_channels_inputs() {
  using logic::Contact;
  CHECK(logic::coil_for_load(Contact::NC, true) == false);
  CHECK(logic::coil_for_load(Contact::NC, false) == true);
  CHECK(logic::coil_for_load(Contact::NO, true) == true);
  CHECK(logic::load_from_coil(Contact::NC, false) == true);
  CHECK(!logic::recovery_power_allowed("poe_switch", false));
  CHECK(!logic::recovery_power_allowed("optic_converter", false));
  CHECK(logic::recovery_power_allowed("poe_switch", true));
  CHECK(logic::recovery_power_allowed("camera", false));
  // pin LOW = contact closed
  CHECK(logic::input_active(false, false) == true);   // NO, closed -> active
  CHECK(logic::input_active(true, false) == false);   // NO, open
  CHECK(logic::input_active(true, true) == true);     // NC, open -> active
  CHECK(logic::input_active(false, true) == false);   // NC, closed

  logic::Debouncer8 d(3);
  uint8_t ch;
  CHECK(!d.sample(0xFF, ch));
  CHECK(!d.sample(0xFF, ch));
  CHECK(d.sample(0xFF, ch) && ch == 0 && d.state() == 0xFF);
  d.sample(0xFE, ch);
  CHECK(ch == 0);
  d.sample(0xFF, ch);  // glitch resets the counter
  d.sample(0xFE, ch);
  d.sample(0xFE, ch);
  CHECK(ch == 0);
  d.sample(0xFE, ch);
  CHECK(ch == 0x01 && d.state() == 0xFE);
}

static void test_hw_codec() {
  uint8_t req[8];
  hw::pzem_build_read(0x01, 0x0000, 10, req);
  const uint8_t known[8] = {0x01, 0x04, 0x00, 0x00, 0x00, 0x0A, 0x70, 0x0D};
  CHECK(memcmp(req, known, 8) == 0);
  // Build a response: 221.4 V, 0.820 A, 160.2 W, 1234500 Wh, 60.0 Hz, PF 0.88
  uint16_t regs[10] = {2214, 820, 0, 1602, 0, uint16_t(1234500 & 0xFFFF), uint16_t(1234500 >> 16),
                       600, 88, 0};
  uint8_t resp[25] = {0x01, 0x04, 20};
  for (int i = 0; i < 10; ++i) {
    resp[3 + 2 * i] = uint8_t(regs[i] >> 8);
    resp[4 + 2 * i] = uint8_t(regs[i]);
  }
  uint16_t crc = hw::crc16_modbus(resp, 23);
  resp[23] = uint8_t(crc);
  resp[24] = uint8_t(crc >> 8);
  hw::PzemReading r;
  CHECK(hw::pzem_parse(resp, 25, 0x01, r));
  CHECK(fabsf(r.v - 221.4f) < 1e-3f && fabsf(r.a - 0.82f) < 1e-4f && fabsf(r.w - 160.2f) < 1e-3f);
  CHECK(fabsf(r.kwh - 1234.5f) < 1e-2f && fabsf(r.hz - 60.0f) < 1e-3f && fabsf(r.pf - 0.88f) < 1e-4f);
  CHECK(hw::pzem_parse(resp, 25, 0xF8, r));  // general address accepts
  resp[10] ^= 1;
  CHECK(!hw::pzem_parse(resp, 25, 0x01, r));  // CRC error
  const uint8_t exc[5] = {0x01, 0x84, 0x02, 0xC2, 0xC1};
  CHECK(!hw::pzem_parse(exc, 5, 0x01, r));

  const uint8_t beef[2] = {0xBE, 0xEF};
  CHECK(hw::sht31_crc8(beef, 2) == 0x92);  // datasheet example
  uint8_t f[6] = {0x66, 0x66, 0, 0x80, 0x00, 0};
  f[2] = hw::sht31_crc8(f, 2);
  f[5] = hw::sht31_crc8(f + 3, 2);
  float t, rh;
  CHECK(hw::sht31_decode(f, t, rh));
  CHECK(fabsf(t - 25.0f) < 0.05f && fabsf(rh - 50.0f) < 0.01f);
  f[5] ^= 0xFF;
  CHECK(!hw::sht31_decode(f, t, rh));

  CHECK(fabsf(hw::ina226_bus_v(10896) - 13.62f) < 1e-3f);
  CHECK(fabsf(hw::ina226_shunt_a(4840, 0.010f) - 1.21f) < 1e-3f);
  CHECK(fabsf(hw::ina226_shunt_a(-400, 0.010f) + 0.1f) < 1e-4f);

  hw::CivilTime c{2026, 11, 9, 13, 45, 30, 0};
  CHECK(hw::civil_to_epoch(c) == 1794231930LL);
  hw::CivilTime c2 = hw::epoch_to_civil(1709251199LL);  // 2024-02-29 23:59:59 (Thursday)
  CHECK(c2.year == 2024 && c2.month == 2 && c2.day == 29 && c2.hour == 23 && c2.minute == 59 &&
        c2.second == 59 && c2.weekday == 4);
  CHECK(hw::epoch_to_civil(0).weekday == 4 && hw::epoch_to_civil(0).year == 1970);
  for (int64_t e = 1700000000; e < 1900000000; e += 86399 * 7 + 13) {
    if (hw::civil_to_epoch(hw::epoch_to_civil(e)) != e) {
      CHECK(false);
      break;
    }
  }
  CHECK(hw::bcd2bin(0x59) == 59 && hw::bin2bcd(59) == 0x59);
  CHECK(!hw::civil_valid(hw::CivilTime{2000, 1, 1, 0, 0, 0, 0}));
  CHECK(hw::lis3dh_ths(1.0f, 4) == 31 && hw::lis3dh_ths(100, 4) == 127 && hw::lis3dh_ths(0, 2) == 1);
  float a[3] = {0, 0, 1}, b[3] = {0, 1, 1};
  CHECK(fabsf(hw::vec_angle_deg(a, b) - 45.0f) < 0.01f);
}

static void test_digest() {
  // RFC 2617 section 3.5 example
  hw::DigestChallenge ch;
  CHECK(hw::digest_parse_challenge(
      "Digest realm=\"testrealm@host.com\", qop=\"auth,auth-int\", "
      "nonce=\"dcd98b7102dd2f0e8b11d0f600bfb0c093\", opaque=\"5ccc069c403ebaf9f0171e9517f40e41\"",
      ch));
  CHECK_EQ(ch.realm, std::string("testrealm@host.com"));
  std::string h = hw::digest_authorization(ch, "Mufasa", "Circle Of Life", "GET", "/dir/index.html",
                                           1, "0a4f113b");
  CHECK(h.find("response=\"6629fae49393a05397450978507c4ef1\"") != std::string::npos);
  CHECK(h.find("nc=00000001") != std::string::npos);
  CHECK(h.find("opaque=\"5ccc069c403ebaf9f0171e9517f40e41\"") != std::string::npos);
  // RFC 7616 3.9.1 SHA-256 example
  hw::DigestChallenge c2;
  CHECK(hw::digest_parse_challenge(
      "Digest realm=\"http-auth@example.org\", qop=\"auth, auth-int\", algorithm=SHA-256, "
      "nonce=\"7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v\", "
      "opaque=\"FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS\"",
      c2));
  h = hw::digest_authorization(c2, "Mufasa", "Circle of Life", "GET", "/dir/index.html", 1,
                               "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ");
  CHECK(h.find("response=\"753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1\"") !=
        std::string::npos);
  CHECK(!hw::digest_parse_challenge("Basic realm=\"x\"", c2));
}

static void test_config() {
  cfg::Config c;
  CHECK(c.channels[0].role == "poe_switch" && c.channels[0].contact == logic::Contact::NC);
  CHECK(c.channels[2].role == "fan" && c.channels[2].contact == logic::Contact::NO);
  CHECK(c.channel_by_role("heater") == 4);
  JsonDocument d;
  CHECK(!deserializeJson(d, R"({"config_version":4,"telemetry_interval_s":15,
      "fan":{"on_c":45,"off_c":38},
      "channels":[{"ch":5,"contact":"NO","role":"camera_2"}],
      "inputs_polarity":{"door":"NC"},
      "local_recovery":{"enabled":true,"interval_s":30,"fail_threshold":5,"off_sec":10,
        "boot_wait_s":180,"max_per_hour":3,
        "targets":[{"ip":"10.1.2.31","kind":"hanwha_sunapi","ch":null,"user":"admin","pass_enc":"x"},
                   {"ip":"10.1.2.32","kind":"ping","ch":5}]}})"));
  std::string err;
  CHECK(cfg::merge(d.as<JsonObjectConst>(), c, err));
  CHECK(c.config_version == 4 && c.telemetry_interval_s == 15 && c.fan.on_c == 45);
  CHECK(c.channels[4].role == "camera_2" && c.channels[4].contact == logic::Contact::NO);
  CHECK(c.channels[0].role == "poe_switch");  // untouched
  CHECK(c.input_nc[0] && !c.input_nc[1]);
  CHECK(c.recovery.targets.size() == 2 && c.recovery.targets[0].ch == 0 && c.recovery.targets[1].ch == 5);

  // round trip through NVS JSON
  JsonDocument out;
  cfg::to_json(c, out.to<JsonObject>());
  std::string s;
  serializeJson(out, s);
  cfg::Config c2;
  JsonDocument in;
  CHECK(!deserializeJson(in, s));
  CHECK(cfg::merge(in.as<JsonObjectConst>(), c2, err));
  CHECK(c2.config_version == 4 && c2.channels[4].role == "camera_2" && c2.input_nc[0] &&
        c2.recovery.targets.size() == 2 && c2.recovery.targets[1].ch == 5 && c2.fan.off_c == 38);

  // invalid params leave config untouched
  const char* bad[] = {
      R"({"fan":{"on_c":30,"off_c":35}})",                 // off >= on
      R"({"channels":[{"ch":7,"contact":"NC"}]})",
      R"({"channels":[{"ch":1,"contact":"XX"}]})",
      R"({"channels":[{"ch":1,"role":"fan"}]})",          // second fan role
      R"({"inputs_polarity":{"nope":"NO"}})",
      R"({"local_recovery":{"targets":[{"ip":"10.1.2.300"}]}})",
      R"({"local_recovery":{"targets":[{"ip":"10.1.2.3","ch":9}]}})",
      R"({"local_recovery":{"off_sec":0}})",
      R"({"telemetry_interval_s":"10"})",
      R"({"heater":{"rh_on":70,"rh_off":75}})",
  };
  for (const char* b : bad) {
    JsonDocument bd;
    deserializeJson(bd, b);
    cfg::Config before = c;
    bool ok = cfg::merge(bd.as<JsonObjectConst>(), c, err);
    CHECK(!ok);
    if (ok) fprintf(stderr, "  accepted: %s\n", b);
    CHECK(c.fan.on_c == before.fan.on_c && c.recovery.targets.size() == before.recovery.targets.size());
  }
}

static void test_event_queue() {
  evq::EventQueue q;
  for (int i = 0; i < 70; ++i) q.push("e" + std::to_string(i));
  CHECK(q.size() == 64 && q.dropped() == 6);
  CHECK(q.at(0).payload == "e6");
  auto p = q.pending();
  CHECK(p.size() == 64);
  q.set_inflight(0, 100, 1000);
  q.set_inflight(1, 101, 5000);
  CHECK(q.pending().size() == 62 && q.inflight() == 2);
  q.expire_inflight(32000, 30000);  // msg 100 timed out, 101 not yet
  CHECK(q.inflight() == 1 && q.at(0).msg_id == -1 && q.at(1).msg_id == 101);
  q.set_inflight(0, 100, 32000);
  CHECK(q.ack(100) && q.size() == 63 && q.at(0).payload == "e7");
  CHECK(!q.ack(100));
  q.reset_inflight();
  CHECK(q.pending().size() == 63);
  auto tp = q.take_pending(5);
  CHECK(tp.size() == 5 && tp[0].second == "e7");
  CHECK(q.set_inflight_seq(tp[0].first, 7, 0) && q.inflight() == 1);
  q.push("late0");
  q.push("late");  // 65th item: drops the oldest (e7) while the caller publishes
  CHECK(!q.set_inflight_seq(tp[0].first, 8, 0));  // e7 was dropped: no-op
  CHECK(q.take_pending(100).back().second == "late");
}

// --verify <secret_hex>: reads one command JSON from stdin, prints OK/BAD.
static int verify_cli(const char* secret_hex) {
  std::string payload, line;
  int ch;
  while ((ch = getchar()) != EOF) payload += char(ch);
  uint8_t key[32];
  size_t n = 0;
  if (!crypto::from_hex(secret_hex, key, 32, &n) || n != 32) return 2;
  cmdcore::Envelope e;
  if (cmdcore::parse_envelope(payload, e) != cmdcore::ParseError::None) {
    printf("PARSE_ERROR\n");
    return 1;
  }
  bool ok = cmdcore::verify_signature(e, key, 32, secret_hex);
  printf("%s %s\n", ok ? "OK" : "BAD", e.type_str.c_str());
  return ok ? 0 : 1;
}

int main(int argc, char** argv) {
  if (argc == 3 && strcmp(argv[1], "--verify") == 0) return verify_cli(argv[2]);
  test_crypto();
  test_json_canon();
  test_command_verify();
  test_ack_cache();
  test_climate();
  test_env_alarm();
  test_limiter();
  test_channels_inputs();
  test_hw_codec();
  test_digest();
  test_config();
  test_event_queue();
  printf("%d passed, %d failed\n", g_pass, g_fail);
  return g_fail ? 1 : 0;
}
