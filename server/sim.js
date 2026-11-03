// 데모용 가상 Hikvision NVR (ISAPI 응답 흉내). 실제 장비 없이 앱 전체 흐름을 확인하기 위한 것.
import express from 'express';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const SIM_USER = 'admin';
export const SIM_PASS = 'demo1234';
const REALM = 'DS-SIM';
const FONT = process.env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

export const SIM_CHANNELS = [
  { id: 1, name: 'Main Gate', ip: '192.168.1.64' },
  { id: 2, name: 'Parking', ip: '192.168.1.65' },
  { id: 3, name: 'Warehouse', ip: '192.168.1.66' },
  { id: 4, name: 'Tower Crane', ip: '192.168.1.67' },
];
const PATTERNS = ['testsrc2', 'smptehdbars', 'rgbtestsrc', 'testsrc'];

const X = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
const OK_BODY = ('<ResponseStatus version="2.0"><requestURL></requestURL><statusCode>1</statusCode><statusString>OK</statusString><subStatusCode>ok</subStatusCode></ResponseStatus>');
const pad = (n) => String(n).padStart(2, '0');
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

function digestAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Digest ')) {
    const p = {};
    for (const m of h.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) p[m[1]] = m[2] ?? m[3];
    const ha1 = md5(`${SIM_USER}:${REALM}:${SIM_PASS}`);
    const ha2 = md5(`${req.method}:${p.uri}`);
    const expect = p.qop
      ? md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`)
      : md5(`${ha1}:${p.nonce}:${ha2}`);
    if (p.username === SIM_USER && p.response === expect) return next();
  }
  res.set('WWW-Authenticate', `Digest qop="auth", realm="${REALM}", nonce="${crypto.randomBytes(16).toString('hex')}", stale="FALSE"`);
  res.status(401).type('application/xml').send(X('<userCheck><statusValue>401</statusValue><statusString>Unauthorized</statusString></userCheck>'));
}

export function simRouter() {
  const r = express.Router();
  r.use(express.text({ type: '*/*' }));
  r.use(digestAuth);
  const send = (res, body) => res.type('application/xml').send(X(body));

  r.get('/ISAPI/System/deviceInfo', (req, res) => send(res, `<DeviceInfo version="2.0">
<deviceName>Demo Site NVR</deviceName><deviceID>sim-0001</deviceID><model>DS-7608NXI-K2 (DEMO)</model>
<serialNumber>DS-7608NXI-K20820261103CCRRDEMO0001</serialNumber><macAddress>c0:56:e3:00:00:01</macAddress>
<firmwareVersion>V4.71.105</firmwareVersion><firmwareReleasedDate>build 260801</firmwareReleasedDate>
<deviceType>NVR</deviceType></DeviceInfo>`));

  r.get('/ISAPI/ContentMgmt/InputProxy/channels', (req, res) => send(res, `<InputProxyChannelList version="2.0">${SIM_CHANNELS.map((c) => `
<InputProxyChannel><id>${c.id}</id><name>${c.name}</name><sourceInputPortDescriptor><proxyProtocol>HIKVISION</proxyProtocol>
<addressingFormatType>ipaddress</addressingFormatType><ipAddress>${c.ip}</ipAddress><managePortNo>8000</managePortNo><srcInputPort>1</srcInputPort></sourceInputPortDescriptor></InputProxyChannel>`).join('')}
</InputProxyChannelList>`));

  r.get('/ISAPI/ContentMgmt/InputProxy/channels/status', (req, res) => send(res, `<InputProxyChannelStatusList version="2.0">${SIM_CHANNELS.map((c) => `
<InputProxyChannelStatus><id>${c.id}</id><online>true</online><chanDetectResult>connect</chanDetectResult></InputProxyChannelStatus>`).join('')}
</InputProxyChannelStatusList>`));

  r.get('/ISAPI/System/time', (req, res) => send(res, `<Time version="2.0"><timeMode>NTP</timeMode><localTime>${localIso(new Date())}+09:00</localTime><timeZone>CST-9:00:00</timeZone></Time>`));

  r.get('/ISAPI/ContentMgmt/Storage', (req, res) => send(res, `<storage version="2.0"><hddList>
<hdd><id>1</id><hddName>hdd1</hddName><hddPath></hddPath><hddType>SATA</hddType><status>ok</status><capacity>3815447</capacity><freeSpace>0</freeSpace><property>RW</property></hdd>
<hdd><id>2</id><hddName>hdd2</hddName><hddPath></hddPath><hddType>SATA</hddType><status>ok</status><capacity>3815447</capacity><freeSpace>1254400</freeSpace><property>RW</property></hdd>
</hddList></storage>`));

  r.get('/ISAPI/Streaming/channels/:sid/picture', (req, res) => {
    const ch = Math.floor(Number(req.params.sid) / 100) || 1;
    const chan = SIM_CHANNELS.find((c) => c.id === ch) || SIM_CHANNELS[0];
    const vf = `drawtext=fontfile=${FONT}:text='CH${ch} ${chan.name}  %{localtime}':x=20:y=h-50:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=6`;
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      `${PATTERNS[(ch - 1) % PATTERNS.length]}=size=960x540:rate=1`, '-vf', vf, '-frames:v', '1', '-f', 'mjpeg', '-q:v', '5', 'pipe:1']);
    const chunks = [];
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.on('close', () => res.type('image/jpeg').send(Buffer.concat(chunks)));
  });

  const presets = [
    { id: 1, name: '출입구' }, { id: 2, name: '자재 야적장' }, { id: 3, name: '현장 사무실' }, { id: 4, name: '전체 보기' },
  ];
  r.put('/ISAPI/ContentMgmt/PTZCtrlProxy/channels/:ch/continuous', (req, res) => send(res, OK_BODY));
  r.get('/ISAPI/ContentMgmt/PTZCtrlProxy/channels/:ch/presets', (req, res) => send(res, `<PTZPresetList version="2.0">${presets.map((p) => `
<PTZPreset><enabled>true</enabled><id>${p.id}</id><presetName>${p.name}</presetName></PTZPreset>`).join('')}</PTZPresetList>`));
  r.put('/ISAPI/ContentMgmt/PTZCtrlProxy/channels/:ch/presets/:id/goto', (req, res) => send(res, OK_BODY));
  r.put('/ISAPI/System/reboot', (req, res) => send(res, OK_BODY));

  // 녹화 검색: 오늘은 지금까지, 지난 날짜는 하루 종일 녹화가 있다고 응답 (중간중간 모션 녹화)
  r.post('/ISAPI/ContentMgmt/search', (req, res) => {
    const body = String(req.body || '');
    const track = Number((body.match(/<trackID>(\d+)<\/trackID>/) || [])[1] || 101);
    const day = (body.match(/<startTime>(\d{4}-\d{2}-\d{2})/) || [])[1];
    const pos = Number((body.match(/<searchResultPostion>(\d+)/) || [])[1] || 0);
    const dayStart = new Date(`${day}T00:00:00`);
    const now = new Date();
    const dayEnd = Math.min(dayStart.getTime() + 86400000 - 1000, now.getTime());
    const items = [];
    if (dayStart < now) {
      let t = dayStart.getTime();
      let i = 0;
      while (t < dayEnd) {
        const len = (i % 3 === 1 ? 7 : 50) * 60000;
        const end = Math.min(t + len, dayEnd);
        items.push({ s: new Date(t), e: new Date(end), type: i % 3 === 1 ? 'MOTION' : 'CMR' });
        t = end + (i % 5 === 4 ? 20 * 60000 : 0);
        i++;
      }
    }
    const page = items.slice(pos, pos + 100);
    send(res, `<CMSearchResult version="2.0"><searchID>sim</searchID>
<responseStatus>true</responseStatus><responseStatusStrg>${pos + 100 < items.length ? 'MORE' : 'OK'}</responseStatusStrg>
<numOfMatches>${page.length}</numOfMatches><matchList>${page.map((it) => `
<searchMatchItem><sourceID>sim</sourceID><trackID>${track}</trackID>
<timeSpan><startTime>${localIso(it.s)}Z</startTime><endTime>${localIso(it.e)}Z</endTime></timeSpan>
<mediaSegmentDescriptor><contentType>video</contentType><codecType>H.264-BP</codecType></mediaSegmentDescriptor>
<metadataMatches><metadataDescriptor>recordType.meta.std-cgi.com/${it.type}</metadataDescriptor></metadataMatches></searchMatchItem>`).join('')}
</matchList></CMSearchResult>`);
  });

  // 알람 스트림: 10초마다 하트비트, 45~90초마다 임의 이벤트
  const EVENT_TYPES = [
    ['VMD', 'Motion alarm'], ['linedetection', 'Line crossing alarm'],
    ['fielddetection', 'Intrusion detection alarm'], ['regionEntrance', 'Region entrance alarm'],
  ];
  r.get('/ISAPI/Event/notification/alertStream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'multipart/mixed; boundary=boundary', Connection: 'keep-alive' });
    const part = (xmlBody) => res.write(`--boundary\r\nContent-Type: application/xml; charset="UTF-8"\r\nContent-Length: ${Buffer.byteLength(xmlBody)}\r\n\r\n${xmlBody}\r\n`);
    const alert = (type, desc, ch, state) => X(`<EventNotificationAlert version="2.0">
<ipAddress>127.0.0.1</ipAddress><portNo>80</portNo><protocol>HTTP</protocol><macAddress>c0:56:e3:00:00:01</macAddress>
<channelID>${ch}</channelID><dateTime>${localIso(new Date())}+09:00</dateTime><activePostCount>1</activePostCount>
<eventType>${type}</eventType><eventState>${state}</eventState><eventDescription>${desc}</eventDescription></EventNotificationAlert>`);
    const hb = setInterval(() => part(alert('videoloss', 'videoloss alarm', 0, 'inactive')), 10000);
    let ev;
    const schedule = () => {
      ev = setTimeout(() => {
        const [type, desc] = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
        part(alert(type, desc, 1 + Math.floor(Math.random() * SIM_CHANNELS.length), 'active'));
        schedule();
      }, 45000 + Math.random() * 45000);
    };
    setTimeout(() => part(alert('VMD', 'Motion alarm', 1, 'active')), 5000);
    schedule();
    req.on('close', () => { clearInterval(hb); clearTimeout(ev); });
  });

  return r;
}
