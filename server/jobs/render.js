// MP4 렌더링: 헤드리스 Chromium 에서 뷰어와 같은 엔진으로 프레임을 하나씩 그리고 FFmpeg(H.264)로 인코딩.
// GPU 서버를 쓸 때는 RUN_WORKER=true 인 별도 렌더 워커 인스턴스를 GPU 장비에 띄우면 된다(같은 DB 큐 공유).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { config } from '../config.js';
import { tenant, audit } from '../db/index.js';
import * as storage from '../storage.js';
import { signRenderToken } from '../auth.js';
import { progress } from './queue.js';

export const QUALITY = { hd: [1280, 720], fhd: [1920, 1080], qhd: [2560, 1440], '4k': [3840, 2160] };

let browserP;
async function browser() {
  if (browserP) { const b = await browserP.catch(() => null); if (b?.isConnected()) return b; }
  browserP = chromium.launch({
    executablePath: config.chromiumPath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
  });
  return browserP;
}
export async function closeBrowser() { const b = await browserP?.catch(() => null); await b?.close().catch(() => {}); browserP = null; }

export async function processRender(job) {
  const { modelId, quality = 'fhd', fps = 30 } = job.payload;
  const [w, h] = QUALITY[quality] || QUALITY.fhd;
  const token = signRenderToken(job);
  const b = await browser();
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  const tmp = path.join(config.tmpDir, `render-${job.id}-${crypto.randomUUID().slice(0, 8)}`);
  await fs.mkdir(tmp, { recursive: true });
  const out = path.join(tmp, 'out.mp4');
  try {
    await page.goto(`${config.internalUrl}/render?job=${job.id}&t=${encodeURIComponent(token)}&fps=${fps}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__render?.ready === true || window.__render?.error, null, { timeout: 120000 });
    const info = await page.evaluate(() => (window.__render.error ? { error: window.__render.error } : window.__render.info));
    if (info.error) throw new Error('렌더 페이지 오류: ' + info.error);
    const frames = Math.min(info.frames, Math.round(config.maxRenderSeconds * fps));
    if (frames < 1) throw new Error('애니메이션 길이가 0 입니다');

    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d; });
    const ffDone = new Promise((res, rej) => ff.on('close', (code) => (code === 0 ? res() : rej(new Error('FFmpeg 오류: ' + ffErr.slice(-500))))));
    let thumb = null;
    let lastReport = 0;
    for (let i = 0; i < frames; i++) {
      const b64 = await page.evaluate((n) => window.__render.frame(n), i);
      const buf = Buffer.from(b64, 'base64');
      if (i === Math.floor(frames * 0.45)) thumb = buf;
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      const p = (i + 1) / frames;
      if (p - lastReport >= 0.03) { lastReport = p; await progress(job, 0.95 * p, `프레임 ${i + 1}/${frames}`); }
    }
    ff.stdin.end();
    await ffDone;
    await progress(job, 0.97, '저장 중');
    const st = await fs.stat(out);
    const vid = crypto.randomUUID();
    const key = storage.keyFor(job.company_id, 'videos', `${vid}.mp4`);
    await storage.moveIn(job.company_id, key, out);
    const thumbKey = thumb ? await storage.put(job.company_id, storage.keyFor(job.company_id, 'videos', `${vid}.jpg`), thumb) : null;
    const duration = frames / fps;
    return await tenant(job.company_id, async (c) => {
      await c.query(`INSERT INTO videos (id,company_id,model_id,job_id,storage_key,thumb_key,format,width,height,fps,duration,size)
        VALUES ($1,$2,$3,$4,$5,$6,'mp4',$7,$8,$9,$10,$11)`, [vid, job.company_id, modelId, job.id, key, thumbKey, w, h, fps, duration, st.size]);
      await audit(c, { companyId: job.company_id, userId: job.created_by, action: 'video.render', target: vid, meta: { modelId, w, h, fps, frames } });
      return { videoId: vid, size: st.size, frames, duration, width: w, height: h };
    });
  } catch (e) {
    if (logs.length) e.message += ` | 콘솔: ${logs.slice(-5).join(' / ')}`;
    throw e;
  } finally {
    await ctx.close().catch(() => {});
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
