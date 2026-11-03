// 같은 네트워크의 Hikvision 장비 검색 (SADP: UDP 멀티캐스트 239.255.255.250:37020)
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import { xml } from './isapi.js';

export function discover(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const uuid = crypto.randomUUID().toUpperCase();
    sock.on('message', (msg) => {
      try {
        const p = xml.parse(msg.toString('utf8')).ProbeMatch;
        if (!p?.IPv4Address) return;
        found.set(String(p.DeviceSN || p.IPv4Address), {
          ip: String(p.IPv4Address),
          httpPort: Number(p.HttpPort) || 80,
          model: String(p.DeviceDescription || p.DeviceType || ''),
          serial: String(p.DeviceSN || ''),
          mac: String(p.MAC || ''),
          firmware: String(p.SoftwareVersion || ''),
          activated: String(p.Activated) !== 'false',
        });
      } catch {}
    });
    sock.on('error', () => { try { sock.close(); } catch {} resolve([]); });
    sock.bind(37020, () => {
      try { sock.addMembership('239.255.255.250'); } catch {}
      const probe = `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${uuid}</Uuid><Types>inquiry</Types></Probe>`;
      sock.send(probe, 37020, '239.255.255.250');
      setTimeout(() => sock.send(probe, 37020, '239.255.255.250'), 800);
    });
    setTimeout(() => {
      try { sock.close(); } catch {}
      resolve([...found.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true })));
    }, timeoutMs);
  });
}
