#include "event_queue.h"

#include <utility>

namespace evq {

bool EventQueue::push(std::string payload) {
  bool dropped = false;
  if (q_.size() >= kCapacity) {
    q_.pop_front();
    ++dropped_;
    dropped = true;
  }
  q_.push_back({next_seq_++, std::move(payload), -1, 0});
  return dropped;
}

std::vector<size_t> EventQueue::pending() const {
  std::vector<size_t> v;
  for (size_t i = 0; i < q_.size(); ++i)
    if (q_[i].msg_id < 0) v.push_back(i);
  return v;
}

bool EventQueue::ack(int msg_id) {
  if (msg_id < 0) return false;
  for (auto it = q_.begin(); it != q_.end(); ++it) {
    if (it->msg_id == msg_id) {
      q_.erase(it);
      return true;
    }
  }
  return false;
}

std::vector<std::pair<uint32_t, std::string>> EventQueue::take_pending(size_t max) const {
  std::vector<std::pair<uint32_t, std::string>> v;
  for (const auto& it : q_) {
    if (v.size() >= max) break;
    if (it.msg_id < 0) v.emplace_back(it.seq, it.payload);
  }
  return v;
}

bool EventQueue::set_inflight_seq(uint32_t seq, int msg_id, uint32_t now_ms) {
  for (auto& it : q_) {
    if (it.seq == seq) {
      it.msg_id = msg_id;
      it.sent_ms = now_ms;
      return true;
    }
  }
  return false;
}

size_t EventQueue::inflight() const {
  size_t n = 0;
  for (const auto& it : q_) n += it.msg_id >= 0;
  return n;
}

void EventQueue::expire_inflight(uint32_t now_ms, uint32_t timeout_ms) {
  for (auto& it : q_)
    if (it.msg_id >= 0 && now_ms - it.sent_ms > timeout_ms) it.msg_id = -1;
}

void EventQueue::reset_inflight() {
  for (auto& it : q_) it.msg_id = -1;
}

}  // namespace evq
