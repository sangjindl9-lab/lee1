// Hikvision 장비 기능 (ISAPI 기반): 정보·채널·스냅샷·PTZ·녹화검색·저장장치·재부팅
import crypto from 'node:crypto';
import { IsapiClient, IsapiError, xml } from './isapi.js';
import { devices } from './db.js';

export const DEMO_HOST = 'demo';
const PORT = Number(process.env.PORT || 8080);

const clients = new Map(); // deviceId -> IsapiClient (인증 정보 재사용)

export function clientFor(dev, password) {
  const base = dev.host === DEMO_HOST
    ? `http://127.0.0.1:${PORT}/sim`
    : `${dev.https ? 'https' : 'http'}://${dev.host}:${dev.httpPort || 80}`;
  return new IsapiClient({ base, username: dev.username, password });
}

export function client(devId) {
  let c = clients.get(devId);
  if (!c) {
    const dev = devices.get(devId);
    if (!dev) throw new IsapiError('장비를 찾을 수 없습니다', 404);
    c = clientFor(dev, devices.password(devId));
    clients.set(devId, c);
  }
  return c;
}
export const forgetClient = (devId) => clients.delete(devId);

const isRecorder = (kind) => /NVR|DVR|HVR/i.test(kind || '');

// 장비 등록/새로고침 시: 장비 정보 + 채널 목록 조회
export async function probe(c) {
  const info = (await c.get('/ISAPI/System/deviceInfo')).DeviceInfo || {};
  const kind = String(info.deviceType || '');
  let channels = [];

  // NVR/DVR: 연결된 IP 카메라 채널(InputProxy)
  try {
    const list = (await c.get('/ISAPI/ContentMgmt/InputProxy/channels')).InputProxyChannelList?.InputProxyChannel || [];
    let status = [];
    try {
      status = (await c.get('/ISAPI/ContentMgmt/InputProxy/channels/status')).InputProxyChannelStatusList?.InputProxyChannelStatus || [];
    } catch {}
    channels = list.map((ch) => {
      const st = status.find((s) => s.id === ch.id);
      return {
        no: Number(ch.id),
        name: String(ch.name || `채널 ${ch.id}`),
        ip: ch.sourceInputPortDescriptor?.ipAddress || '',
        online: st ? String(st.online) === 'true' : true,
      };
    });
  } catch {}

  // 카메라(또는 아날로그 채널): 스트리밍 채널에서 채널 번호 추출
  if (!channels.length) {
    try {
      const list = (await c.get('/ISAPI/Streaming/channels')).StreamingChannelList?.StreamingChannel || [];
      const nos = [...new Set(list.map((s) => Math.floor(Number(s.id) / 100)).filter((n) => n > 0))];
      channels = nos.map((no) => {
        const s = list.find((x) => Math.floor(Number(x.id) / 100) === no);
        return { no, name: String(s?.channelName || `채널 ${no}`), ip: '', online: true };
      });
    } catch {}
  }
  if (!channels.length) channels = [{ no: 1, name: String(info.deviceName || '채널 1'), ip: '', online: true }];

  return {
    kind: kind || (channels.length > 1 ? 'NVR' : 'IPCamera'),
    model: String(info.model || ''),
    serial: String(info.serialNumber || ''),
    firmware: [info.firmwareVersion, info.firmwareReleasedDate].filter(Boolean).join(' '),
    mac: String(info.macAddress || ''),
    deviceName: String(info.deviceName || ''),
    channels,
  };
}

export async function deviceStatus(devId) {
  const c = client(devId);
  const [info, time, storage] = await Promise.allSettled([
    c.get('/ISAPI/System/deviceInfo'),
    c.get('/ISAPI/System/time'),
    c.get('/ISAPI/ContentMgmt/Storage'),
  ]);
  const hdds = storage.status === 'fulfilled' ? (storage.value.storage?.hddList?.hdd || []) : [];
  return {
    info: info.status === 'fulfilled' ? info.value.DeviceInfo : null,
    time: time.status === 'fulfilled' ? time.value.Time : null,
    hdds: hdds.map((h) => ({
      id: h.id, name: h.hddName || `HDD ${h.id}`, status: h.status,
      capacityMB: Number(h.capacity) || 0, freeMB: Number(h.freeSpace) || 0,
    })),
  };
}

export async function snapshot(devId, ch, sub = false) {
  const c = client(devId);
  const sid = `${ch}0${sub ? 2 : 1}`;
  try {
    return await c.binary(`/ISAPI/Streaming/channels/${sid}/picture`);
  } catch (e) {
    if (e.status === 401) throw e;
    return await c.binary(`/ISAPI/ContentMgmt/StreamingProxy/channels/${sid}/picture`);
  }
}

function ptzBase(devId, ch) {
  const dev = devices.get(devId);
  return isRecorder(dev.kind)
    ? `/ISAPI/ContentMgmt/PTZCtrlProxy/channels/${ch}`
    : `/ISAPI/PTZCtrl/channels/${ch}`;
}

const clamp = (v) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));

export async function ptzMove(devId, ch, { pan = 0, tilt = 0, zoom = 0 }) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><PTZData><pan>${clamp(pan)}</pan><tilt>${clamp(tilt)}</tilt><zoom>${clamp(zoom)}</zoom></PTZData>`;
  await client(devId).request('PUT', `${ptzBase(devId, ch)}/continuous`, { body });
}

export async function ptzPresets(devId, ch) {
  const r = await client(devId).get(`${ptzBase(devId, ch)}/presets`);
  return (r.PTZPresetList?.PTZPreset || [])
    .filter((p) => String(p.enabled) !== 'false')
    .map((p) => ({ id: Number(p.id), name: String(p.presetName || `프리셋 ${p.id}`) }));
}

export async function ptzGoto(devId, ch, presetId) {
  await client(devId).request('PUT', `${ptzBase(devId, ch)}/presets/${presetId}/goto`, { body: '' });
}

// 녹화 검색: 하루치 녹화 구간
export async function searchRecords(devId, ch, date) {
  const c = client(devId);
  const items = [];
  const searchID = crypto.randomUUID().toUpperCase();
  for (let pos = 0, page = 0; page < 10; page++) {
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription>
<searchID>${searchID}</searchID>
<trackList><trackID>${ch}01</trackID></trackList>
<timeSpanList><timeSpan><startTime>${date}T00:00:00Z</startTime><endTime>${date}T23:59:59Z</endTime></timeSpan></timeSpanList>
<maxResults>100</maxResults>
<searchResultPostion>${pos}</searchResultPostion>
<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList>
</CMSearchDescription>`;
    const r = (await c.post('/ISAPI/ContentMgmt/search', body, { timeout: 15000 })).CMSearchResult || {};
    const list = r.matchList?.searchMatchItem || [];
    for (const it of list) {
      const meta = String(it.metadataMatches?.metadataDescriptor || '');
      items.push({
        start: String(it.timeSpan?.startTime || '').replace('Z', '').slice(0, 19),
        end: String(it.timeSpan?.endTime || '').replace('Z', '').slice(0, 19),
        type: /motion|vmd/i.test(meta) ? 'motion' : /alarm|event|smart|line|field|intrusion/i.test(meta) ? 'event' : 'normal',
      });
    }
    pos += list.length;
    if (String(r.responseStatusStrg) !== 'MORE' || !list.length) break;
  }
  return items.sort((a, b) => a.start.localeCompare(b.start));
}

export async function reboot(devId) {
  await client(devId).request('PUT', '/ISAPI/System/reboot', { body: '' });
}

// RTSP 주소 (실시간 / 재생)
const ts = (s) => s.replace(/[-:]/g, '').slice(0, 15) + 'Z'; // 2026-11-03T10:15:00 -> 20261103T101500Z

export function rtspUrl(dev, password, ch, { sub = false, playbackStart = null } = {}) {
  const auth = `${encodeURIComponent(dev.username)}:${encodeURIComponent(password)}@`;
  const hostPort = `${dev.host}:${dev.rtspPort || 554}`;
  if (playbackStart) {
    return `rtsp://${auth}${hostPort}/Streaming/tracks/${ch}01?starttime=${ts(playbackStart)}`;
  }
  return `rtsp://${auth}${hostPort}/Streaming/channels/${ch}0${sub ? 2 : 1}`;
}

export { xml, isRecorder };
