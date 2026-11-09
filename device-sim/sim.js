/**
 * SB-MB01 스마트박스 시뮬레이터 — 시험 전용.
 * 실제 장치와 같은 프로토콜(docs/protocol.md)로 브로커에 접속한다. 서버에 '가짜 연결'을 만드는 것이 아니라
 * 실제 인증서·서명·ACK 흐름을 그대로 거치므로 서버 기능 검증에 사용한다. 운영 데이터와 섞지 않도록 별도 함체에 등록할 것.
 *
 * 사용: node sim.js provisioning.json [--interval 10] [--broker mqtts://host:8883]
 */
const mqtt = require('mqtt');
const crypto = require('crypto');
const fs = require('fs');

function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

const DEFAULT_CHANNELS = [
  { ch: 1, contact: 'NC', role: 'poe_switch' }, { ch: 2, contact: 'NC', role: 'optic_converter' },
  { ch: 3, contact: 'NO', role: 'fan' }, { ch: 4, contact: 'NO', role: 'heater' },
  { ch: 5, contact: 'NC', role: 'spare' }, { ch: 6, contact: 'NC', role: 'spare' },
];

class SimDevice {
  constructor(prov, opts = {}) {
    this.prov = prov;
    this.id = prov.device_id;
    this.url = opts.broker || `mqtts://${prov.mqtt_host}:${prov.mqtt_port}`;
    this.interval = opts.interval || 10;
    this.fixedInterval = !!opts.fixedInterval;   // 부하 시험용: 서버 설정의 계측 주기를 따르지 않음
    this.fw = opts.fw || '1.0.0-sim';
    this.configVersion = 0;
    this.channels = DEFAULT_CHANNELS.map(c => ({ ...c }));
    this.coil = [false, false, false, false, false, false];
    this.alarmOut = { siren: false, strobe: false };
    this.inputs = { door: false, tamper: false, ups_ac_fail: false, ups_batt_low: false, elb_trip: false, spd_fault: false, di7: false, di8: false };
    this.env = { t: 24.5, rh: 55.0 };
    this.ac = { v: 221.3, a: 0.74, w: 152.0, kwh: 1200.0, hz: 60.0, pf: 0.92 };
    this.dc = { in_v: 13.6, in_a: 1.1, batt_v: 13.4 };
    this.seq = 0; this.evSeq = 0; this.boot = Math.floor(Math.random() * 1e6);
    this.ackCache = new Map();   // cmd_id → 마지막 ack (최근 32개)
    this.pendingEvents = [];
    this.reconnects = 0;
    this.started = Date.now();
    this.log = opts.log || (() => {});
    this.rejectAll = false;      // 시험용: 장치가 응답하지 않는 상황
    this.executed = [];          // 실제로 실행된 명령 기록(중복 실행 검증용)
    this.dropCmds = 0;
  }

  topic(k) { return `eum/v1/${this.id}/${k}`; }
  loads() { return this.coil.map((on, i) => (this.channels[i].contact === 'NC' ? !on : on)); }

  connect() {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.url, {
        clientId: this.id, ca: this.prov.ca_cert_pem, cert: this.prov.client_cert_pem, key: this.prov.client_key_pem,
        rejectUnauthorized: true, servername: this.prov.mqtt_host, protocolVersion: 4, clean: false, keepalive: 15, reconnectPeriod: 2000,
        will: { topic: this.topic('status'), payload: JSON.stringify({ online: false }), qos: 1, retain: true },
      });
      let first = true;
      this.client.on('connect', () => {
        if (!first) this.reconnects++;
        this.client.subscribe(this.topic('cmd'), { qos: 1 });
        this.client.publish(this.topic('status'), JSON.stringify({ online: true, ts: Date.now() }), { qos: 1, retain: true });
        this.client.publish(this.topic('hello'), JSON.stringify({
          ts: Date.now(), uptime_ms: Date.now() - this.started, hw: 'SB-MB01', hw_rev: '0.1', fw: this.fw, mac: '02:00:00:00:00:01', ip: '127.0.0.1',
          boot_reason: first ? 'power_on' : 'other', config_version: this.configVersion, channels: this.channels,
        }), { qos: 1 });
        while (this.pendingEvents.length) this.client.publish(this.topic('event'), JSON.stringify(this.pendingEvents.shift()), { qos: 1 });
        this.sendTelemetry();
        if (first) { first = false; resolve(); }
      });
      this.client.on('error', e => { this.log('error', e.message); if (first) reject(e); });
      this.client.on('message', (t, p) => this.onCmd(p));
      this.timer = setInterval(() => this.sendTelemetry(), this.interval * 1000);
    });
  }

  /** 네트워크 단절 흉내 (LWT 발생) */
  dropNetwork() { this.client.stream.destroy(); }
  async stop(graceful = true) {
    clearInterval(this.timer);
    if (graceful) await new Promise(r => this.client.publish(this.topic('status'), JSON.stringify({ online: false, ts: Date.now() }), { qos: 1, retain: true }, r));
    await this.client.endAsync(!graceful);
  }

  sendTelemetry() {
    if (!this.client?.connected) return;
    this.seq++;
    this.client.publish(this.topic('telemetry'), JSON.stringify({
      ts: Date.now(), uptime_ms: Date.now() - this.started, seq: this.seq,
      ac: this.inputs.ups_ac_fail ? { ...this.ac, v: 0, a: 0, w: 0 } : this.ac, dc: this.dc, env: this.env,
      relays: this.coil, loads: this.loads(), alarm_out: this.alarmOut, inputs: this.inputs,
      accel: { shock: false, tilt_deg: 0.3 }, net: { eth_link: true, mqtt_reconnects: this.reconnects, offline_buffered: this.pendingEvents.length },
      auto: { fan: true, heater: true },
    }), { qos: 0 });
  }

  event(type, severity, data) {
    const ev = { id: `e-${this.boot}-${++this.evSeq}`, ts: Date.now(), type, severity, data };
    if (this.client?.connected) this.client.publish(this.topic('event'), JSON.stringify(ev), { qos: 1 });
    else { this.pendingEvents.push(ev); if (this.pendingEvents.length > 64) this.pendingEvents.shift(); }
    return ev;
  }

  setInput(key, value) {
    this.inputs[key] = value;
    const sev = { ups_ac_fail: 'critical', elb_trip: 'critical', ups_batt_low: 'major', spd_fault: 'major', door: 'warning', tamper: 'warning' }[key] || 'info';
    this.event('input_change', value ? sev : 'info', { input: key, value });
    this.sendTelemetry();
  }

  ack(cmdId, stage, extra = {}) {
    const a = { cmd_id: cmdId, stage, ts: Date.now(), ...extra };
    this.ackCache.set(cmdId, a);
    if (this.ackCache.size > 32) this.ackCache.delete(this.ackCache.keys().next().value);
    this.client.publish(this.topic('ack'), JSON.stringify(a), { qos: 1 });
  }

  onCmd(buf) {
    if (this.rejectAll) return;
    if (this.dropCmds > 0) { this.dropCmds--; return; }   // 시험용: 수신 유실
    let c; try { c = JSON.parse(buf.toString()); } catch { return; }
    if (this.ackCache.has(c.cmd_id)) { this.client.publish(this.topic('ack'), JSON.stringify(this.ackCache.get(c.cmd_id)), { qos: 1 }); return; }
    const canonical = `${c.cmd_id}\n${c.ts}\n${c.exp}\n${c.type}\n${canonicalJson(c.params || {})}`;
    const sig = crypto.createHmac('sha256', Buffer.from(this.prov.cmd_secret, 'hex')).update(canonical).digest('hex');
    if (!c.sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(String(c.sig).padEnd(64, '0').slice(0, 64)))) return this.ack(c.cmd_id, 'rejected', { error: 'bad_signature' });
    if (c.exp && Date.now() > c.exp) return this.ack(c.cmd_id, 'rejected', { error: 'expired' });
    this.ack(c.cmd_id, 'received');
    this.executed.push(c.cmd_id);
    const p = c.params || {};
    const setLoad = (ch, on) => { const i = ch - 1; this.coil[i] = this.channels[i].contact === 'NC' ? !on : on; };
    switch (c.type) {
      case 'power_off': setLoad(p.ch, false); this.sendTelemetry(); return this.ack(c.cmd_id, 'done', { result: { ch: p.ch, load: false } });
      case 'power_on': setLoad(p.ch, true); this.sendTelemetry(); return this.ack(c.cmd_id, 'done', { result: { ch: p.ch, load: true } });
      case 'power_cycle':
        setLoad(p.ch, false); this.sendTelemetry();
        setTimeout(() => { setLoad(p.ch, true); this.sendTelemetry(); this.ack(c.cmd_id, 'done', { result: { ch: p.ch, load: true, off_sec: p.off_sec } }); }, p.off_sec * 1000);
        return;
      case 'alarm_out': this.alarmOut[p.output] = !!p.on; this.sendTelemetry(); return this.ack(c.cmd_id, 'done', { result: { output: p.output, on: !!p.on } });
      case 'telemetry_now': this.sendTelemetry(); return this.ack(c.cmd_id, 'done', { result: {} });
      case 'config_set':
        this.configVersion = p.config_version ?? this.configVersion;
        if (Array.isArray(p.channels)) this.channels = p.channels.map(x => ({ ...x }));
        if (p.telemetry_interval_s && !this.fixedInterval) { this.interval = p.telemetry_interval_s; clearInterval(this.timer); this.timer = setInterval(() => this.sendTelemetry(), this.interval * 1000); }
        return this.ack(c.cmd_id, 'done', { result: { config_version: this.configVersion } });
      case 'reboot_device': this.ack(c.cmd_id, 'done', { result: {} }); this.coil = this.coil.map(() => false); return;
      default: return this.ack(c.cmd_id, 'rejected', { error: 'unknown_type' });
    }
  }
}

module.exports = { SimDevice, canonicalJson };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('사용법: node sim.js provisioning.json [--interval 10] [--broker mqtts://host:8883]'); process.exit(1); }
  const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const dev = new SimDevice(JSON.parse(fs.readFileSync(file, 'utf8')), { interval: Number(arg('--interval') || 10), broker: arg('--broker'), log: (...a) => console.log('[sim]', ...a) });
  dev.connect().then(() => console.log(`[sim] ${dev.id} 접속됨`));
  // 콘솔 입력으로 상황 재현: door on / door off / temp 60 / quit
  process.stdin.on('data', d => {
    const [k, v] = d.toString().trim().split(/\s+/);
    if (k === 'temp') { dev.env.t = Number(v); dev.sendTelemetry(); }
    else if (k in dev.inputs) dev.setInput(k, v === 'on');
    else if (k === 'quit') dev.stop().then(() => process.exit(0));
  });
}
