import type { Alarm, Command, Smartbox, TelemetryEvent, DeviceStatusEvent } from '../api/types';
import { UNRESOLVED_STATES } from './labels';
import { toMs } from './format';

export function applyTelemetry(sb: Smartbox, ev: TelemetryEvent): Smartbox {
  if (sb.id !== ev.smartbox_id) return sb;
  const now = new Date().toISOString();
  return { ...sb, latest: { ...ev.data, received_at: now }, last_seen_at: now };
}

export function applyStatus(sb: Smartbox, ev: DeviceStatusEvent): Smartbox {
  if (sb.id !== ev.smartbox_id) return sb;
  return { ...sb, online: ev.online, last_seen_at: ev.ts ?? sb.last_seen_at };
}

export function isUnresolved(a: Alarm): boolean {
  return (UNRESOLVED_STATES as readonly string[]).includes(a.state);
}

/** id 기준 갱신/삽입 (최신순 유지: 새 항목은 앞에) */
export function upsertById<T extends { id: string | number }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [item, ...list];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}

export function sortCommands(list: Command[]): Command[] {
  return list.slice().sort((a, b) => (toMs(b.created_at) ?? 0) - (toMs(a.created_at) ?? 0));
}
