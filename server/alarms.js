// 알람 수신(ISAPI alertStream) + 장비 온라인 상태 감시
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, devices, SNAP_DIR } from './db.js';
import { client, snapshot, xml } from './hik.js';

const listeners = new Set(); // SSE 응답 객체
export const online = new Map(); // deviceId -> { online, checkedAt, error }

export function subscribe(res) {
  listeners.add(res);
  res.on('close', () => listeners.delete(res));
}

function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(msg);
}

export const EVENT_NAMES = {
  VMD: '모션 감지', motion: '모션 감지', linedetection: '선 넘기 감지', fielddetection: '영역 침입 감지',
  regionEntrance: '영역 진입', regionExiting: '영역 이탈', tamperdetection: '영상 가림', shelteralarm: '영상 가림',
  videoloss: '영상 손실', IO: '알람 입력', facedetection: '얼굴 감지', scenechangedetection: '장면 변화',
  unattendedBaggage: '물품 방치', attendedBaggage: '물품 제거', loitering: '배회 감지', group: '군중 밀집',
  peopleGathering: '군중 밀집', parking: '주정차 감지', PIR: 'PIR 감지', diskfull: 'HDD 가득 참',
  diskerror: 'HDD 오류', nicbroken: '네트워크 끊김', ipconflict: 'IP 충돌', illaccess: '비정상 접속',
  AccessControllerEvent: '출입 이벤트', VMDHumanVehicle: '사람·차량 감지',
};

const recent = new Map(); // 같은 이벤트 연속 수신 방지 (key -> time)

async function saveEvent(devId, a) {
  const type = String(a.eventType || '');
  const state = String(a.eventState || 'active');
  if (state !== 'active') return; // inactive = 하트비트/해제
  const ch = Number(a.channelID || a.dynChannelID || 0);
  const key = `${devId}:${ch}:${type}`;
  if (Date.now() - (recent.get(key) || 0) < 15000) return;
  recent.set(key, Date.now());

  const time = String(a.dateTime || new Date().toISOString()).slice(0, 19);
  let snap = null;
  if (ch > 0) {
    try {
      const img = await snapshot(devId, ch, false);
      snap = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}.jpg`;
      fs.writeFileSync(path.join(SNAP_DIR, snap), img.data);
    } catch {}
  }
  const r = db.prepare('INSERT INTO events (device_id, channel, type, description, time, snap) VALUES (?,?,?,?,?,?)')
    .run(devId, ch, type, String(a.eventDescription || ''), time, snap);
  const ev = getEvent(Number(r.lastInsertRowid));
  broadcast('alarm', ev);
}

export function getEvent(id) {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  return e && decorate(e);
}

export function decorate(e) {
  const dev = devices.get(e.device_id);
  const chan = dev?.channels.find((c) => c.no === e.channel);
  return {
    id: e.id, deviceId: e.device_id, deviceName: dev?.name || '(삭제된 장비)', channel: e.channel,
    channelName: chan?.name || (e.channel ? `채널 ${e.channel}` : ''), type: e.type,
    typeName: EVENT_NAMES[e.type] || e.type, description: e.description, time: e.time,
    snap: e.snap ? `/api/snaps/${e.snap}` : null, read: !!e.is_read,
  };
}

// 장비별 alertStream 연결 유지
const streams = new Map(); // deviceId -> AbortController

async function runStream(devId, ctrl) {
  while (!ctrl.signal.aborted) {
    try {
      const res = await client(devId).raw('GET', '/ISAPI/Event/notification/alertStream', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`alertStream ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('</EventNotificationAlert>')) >= 0) {
          const start = buf.lastIndexOf('<EventNotificationAlert', i);
          const chunk = buf.slice(start, i + 25);
          buf = buf.slice(i + 25);
          try { await saveEvent(devId, xml.parse(chunk).EventNotificationAlert || {}); } catch {}
        }
        if (buf.length > 1_000_000) buf = buf.slice(-100_000); // 사진 첨부 등 큰 데이터는 버림
      }
    } catch (e) {
      if (ctrl.signal.aborted) return;
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
}

export function watchDevice(devId) {
  unwatchDevice(devId);
  const ctrl = new AbortController();
  streams.set(devId, ctrl);
  runStream(devId, ctrl);
}

export function unwatchDevice(devId) {
  streams.get(devId)?.abort();
  streams.delete(devId);
  online.delete(devId);
}

export async function checkOnline(devId) {
  try {
    await client(devId).get('/ISAPI/System/deviceInfo', { timeout: 5000 });
    online.set(devId, { online: true, checkedAt: Date.now() });
  } catch (e) {
    online.set(devId, { online: false, checkedAt: Date.now(), error: e.message });
  }
  broadcast('status', { deviceId: devId, ...online.get(devId) });
}

export function startMonitoring() {
  for (const d of devices.all()) { watchDevice(d.id); checkOnline(d.id); }
  setInterval(() => { for (const d of devices.all()) checkOnline(d.id); }, 60000).unref();
  // 30일 지난 이벤트·사진 정리
  setInterval(() => {
    const old = db.prepare("SELECT snap FROM events WHERE time < datetime('now','-30 days')").all();
    for (const o of old) if (o.snap) fs.rm(path.join(SNAP_DIR, o.snap), () => {});
    db.prepare("DELETE FROM events WHERE time < datetime('now','-30 days')").run();
  }, 6 * 3600 * 1000).unref();
  setInterval(() => { for (const res of listeners) res.write(': ping\n\n'); }, 25000).unref();
}
