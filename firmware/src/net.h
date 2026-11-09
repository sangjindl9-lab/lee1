// Ethernet (LAN8720A RMII) bring-up and link state; ICMP ping via esp_ping.
#pragma once

#include <cstdint>
#include <string>

namespace net {

void begin();          // enables the 50 MHz oscillator (GPIO16) then ETH.begin()
bool link_up();
bool has_ip();
std::string ip();
std::string mac();
uint32_t ip_epoch();   // increments whenever a new IP is obtained

// Blocking ICMP echo: `count` requests, `timeout_ms` each. true if any reply.
bool ping(const std::string& ipv4, int count = 2, uint32_t timeout_ms = 1000);

}  // namespace net
