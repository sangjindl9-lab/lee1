// Offline-capable event queue (protocol.md 3.4): keeps up to 64 events in RAM,
// in order, until the broker acknowledges them (QoS1 PUBACK). Oldest are dropped
// when full. Pure C++; locking is done by the caller.
#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <vector>

namespace evq {

class EventQueue {
 public:
  static constexpr size_t kCapacity = 64;

  struct Item {
    uint32_t seq;      // unique, increasing
    std::string payload;
    int msg_id;        // -1 = not in flight
    uint32_t sent_ms;  // when it was handed to the MQTT client
  };

  // Adds an event. Returns true if an older event had to be dropped.
  bool push(std::string payload);
  // Items not yet in flight, in order (index into the queue).
  std::vector<size_t> pending() const;
  Item& at(size_t i) { return q_[i]; }
  void set_inflight(size_t i, int msg_id, uint32_t now_ms) {
    q_[i].msg_id = msg_id;
    q_[i].sent_ms = now_ms;
  }
  size_t inflight() const;
  // Copies up to `max` not-in-flight items (seq, payload), oldest first, so the
  // caller can publish without holding its lock.
  std::vector<std::pair<uint32_t, std::string>> take_pending(size_t max) const;
  // Marks the item with `seq` as in flight (no-op if it was dropped meanwhile).
  bool set_inflight_seq(uint32_t seq, int msg_id, uint32_t now_ms);
  // In flight longer than timeout without PUBACK (client outbox expired) -> re-send.
  void expire_inflight(uint32_t now_ms, uint32_t timeout_ms);
  // PUBACK received: remove the item with that msg_id. Returns true if found.
  bool ack(int msg_id);
  // Connection lost: everything in flight must be re-sent.
  void reset_inflight();
  size_t size() const { return q_.size(); }
  uint32_t dropped() const { return dropped_; }

 private:
  std::deque<Item> q_;
  uint32_t dropped_ = 0;
  uint32_t next_seq_ = 1;
};

}  // namespace evq
