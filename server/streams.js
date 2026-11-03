// 영상 중계: go2rtc 프로세스를 띄우고 RTSP 원본을 브라우저(MSE/HLS/MJPEG)로 변환
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, devices } from './db.js';
import { DEMO_HOST, rtspUrl } from './hik.js';

export const GO2RTC_PORT = Number(process.env.GO2RTC_PORT || 1984);
const API = `http://127.0.0.1:${GO2RTC_PORT}`;
const BIN = process.env.GO2RTC_BIN || 'go2rtc';
const FONT = process.env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

let proc = null;

export function startGo2rtc() {
  const cfg = path.join(DATA_DIR, 'go2rtc.yaml');
  fs.writeFileSync(cfg, [
    'api:',
    `  listen: "127.0.0.1:${GO2RTC_PORT}"`,
    '  origin: "*"',
    'rtsp:',
    '  listen: "127.0.0.1:8554"',
    'webrtc:',
    '  listen: ""',
    'srtp:',
    '  listen: ""',
    'rtmp:',
    '  listen: ""',
    'log:',
    '  level: warn',
    ...demoStreamsYaml(),
    '',
  ].join('\n'));
  const run = () => {
    proc = spawn(BIN, ['-c', cfg], { stdio: ['ignore', 'inherit', 'inherit'] });
    proc.on('exit', (code) => {
      console.error(`[go2rtc] 종료됨 (code ${code}) - 3초 후 재시작`);
      setTimeout(run, 3000);
    });
  };
  run();
}

// 데모 장비: 실제 카메라 대신 ffmpeg 테스트 화면을 RTSP로 송출
const DEMO_PATTERNS = ['testsrc2', 'smptehdbars', 'rgbtestsrc', 'testsrc'];

// go2rtc는 보안상 exec 소스를 API로 추가할 수 없으므로 데모 실시간 스트림은 설정 파일에 미리 넣는다.
export const DEMO_CHANNELS = 4;
const demoName = (ch, sub) => `demo_c${ch}_${sub ? 's' : 'm'}`;

function demoExec(ch, sub) {
  const size = sub ? '480x270' : '960x540';
  const pattern = DEMO_PATTERNS[(ch - 1) % DEMO_PATTERNS.length];
  const vf = [
    `drawtext=fontfile=${FONT}:text='LIVE  %{localtime}':x=20:y=20:fontsize=${sub ? 16 : 28}:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8`,
    `drawtext=fontfile=${FONT}:text='CH${ch}':x=20:y=h-${sub ? 36 : 60}:fontsize=${sub ? 16 : 26}:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=8`,
  ].join(',');
  return `exec:ffmpeg -hide_banner -loglevel error -re -f lavfi -i ${pattern}=size=${size}:rate=15 -vf "${vf}" -c:v libx264 -preset ultrafast -tune zerolatency -g 30 -pix_fmt yuv420p -f rtsp {output}`;
}

function demoStreamsYaml() {
  if (process.env.DEMO !== '1') return [];
  const lines = ['streams:'];
  for (let ch = 1; ch <= DEMO_CHANNELS; ch++) {
    for (const sub of [false, true]) lines.push(`  ${demoName(ch, sub)}: ${JSON.stringify(demoExec(ch, sub))}`);
  }
  return lines;
}

// 데모 재생: 테스트 패턴 (재생 시각은 화면에서 표시)
function demoPlayback(ch) {
  return `ffmpeg:virtual?video=${DEMO_PATTERNS[(ch - 1) % DEMO_PATTERNS.length]}&size=960x540#video=h264`;
}

async function putStream(name, src) {
  const url = `${API}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`;
  const res = await fetch(url, { method: 'PUT' });
  if (!res.ok) throw new Error(`go2rtc 스트림 등록 실패 (${res.status})`);
}

export async function deleteStream(name) {
  await fetch(`${API}/api/streams?src=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {});
}

const known = new Map(); // name -> src (중복 등록 방지)

async function ensure(name, src) {
  if (known.get(name) === src) return;
  await putStream(name, src);
  known.set(name, src);
}

export async function liveStream(devId, ch, sub) {
  const dev = devices.get(devId);
  if (dev.host === DEMO_HOST) return demoName(Math.min(Math.max(ch, 1), DEMO_CHANNELS), sub);
  const src = rtspUrl(dev, devices.password(devId), ch, { sub });
  const name = `d${devId}_c${ch}_${sub ? 's' : 'm'}`;
  await ensure(name, src);
  return name;
}

// 재생 스트림은 시작 시각마다 새로 만들고, 오래된 것은 정리
const playbacks = new Map(); // name -> createdAt
export async function playbackStream(devId, ch, start) {
  const dev = devices.get(devId);
  const src = dev.host === DEMO_HOST
    ? demoPlayback(ch)
    : rtspUrl(dev, devices.password(devId), ch, { playbackStart: start });
  const name = `pb${devId}_c${ch}_${start.replace(/\D/g, '')}_${Date.now().toString(36)}`;
  await putStream(name, src);
  playbacks.set(name, Date.now());
  return name;
}

setInterval(() => {
  for (const [name, t] of playbacks) {
    if (Date.now() - t > 2 * 60 * 60 * 1000) { playbacks.delete(name); deleteStream(name); }
  }
}, 10 * 60 * 1000).unref();

export async function dropDeviceStreams(devId) {
  for (const name of [...known.keys()]) {
    if (name.startsWith(`d${devId}_`)) { known.delete(name); await deleteStream(name); }
  }
}
