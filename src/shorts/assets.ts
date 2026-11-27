/** 스토어 아이콘·스크린샷 내려받기 + 원형 마스크 처리 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDetailsUrl, fetchPlayText } from '../playstore/http.ts';
import { parseScriptData, pick, pickString } from '../playstore/scriptData.ts';
import { run, ffmpegEnv, type ShortsMedia } from './ffmpeg.ts';
import { renderFallbackIcon, type Theme } from './png.ts';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface StoreAssets {
  icon: string | null;
  shots: string[];
  source: 'play' | 'fallback' | 'partial';
  warning: string | null;
}

async function download(url: string, target: string, timeoutMs = 20_000): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return false;
    fs.writeFileSync(target, buf);
    return true;
  } catch {
    return false;
  }
}

/** Play 상세 페이지에서 아이콘·스크린샷 URL 을 뽑습니다. */
export async function readStoreAssets(packageId: string, hl = 'ko', gl = 'KR'): Promise<{ icon: string | null; shots: string[] }> {
  const url = buildDetailsUrl(packageId, hl, gl);
  const { status, text } = await fetchPlayText(url, { hl, gl });
  if (status !== 200) throw new Error(`Play 상세 페이지 응답 ${status}`);
  const data = parseScriptData(text);
  const node = pick(['ds:5', 1, 2], data);
  const icon = pickString([95, 0, 3, 2], node) ?? pickString([95, 2], node);
  const raw = pick([78, 0], node);
  const shots: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      if (/^https:\/\/play-lh\.googleusercontent\.com\//.test(value) && !shots.includes(value)) shots.push(value);
      return;
    }
    if (Array.isArray(value)) for (const item of value) walk(item);
  };
  walk(raw);
  return { icon, shots: shots.slice(0, 3) };
}

async function roundMask(media: ShortsMedia, input: string, output: string): Promise<boolean> {
  if (!media.ffmpeg) return false;
  const result = await run(
    media.ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      input,
      '-vf',
      "scale=420:420:force_original_aspect_ratio=decrease,pad=420:420:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba," +
        "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(hypot(X-210,Y-210),203),255,0)'",
      '-frames:v',
      '1',
      '-y',
      output,
    ],
    { timeoutMs: 60_000, env: ffmpegEnv(media) },
  );
  return result.code === 0 && fs.existsSync(output);
}

async function toPng(media: ShortsMedia, input: string, output: string, height: number): Promise<boolean> {
  if (!media.ffmpeg) return false;
  const result = await run(
    media.ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-i', input, '-vf', `scale=-2:${height}`, '-frames:v', '1', '-y', output],
    { timeoutMs: 60_000, env: ffmpegEnv(media) },
  );
  return result.code === 0 && fs.existsSync(output);
}

export async function prepareAssets(options: {
  packageId: string;
  hl: string;
  gl: string;
  theme: Theme;
  seed: number;
  assetDir: string;
  iconHint: string | null;
  media: ShortsMedia;
}): Promise<StoreAssets> {
  const { packageId, hl, gl, theme, seed, assetDir, iconHint, media } = options;
  fs.mkdirSync(assetDir, { recursive: true });
  const safe = packageId.replace(/[^a-zA-Z0-9._-]/g, '_');

  let iconUrl = iconHint;
  let shotUrls: string[] = [];
  let warning: string | null = null;
  try {
    const store = await readStoreAssets(packageId, hl, gl);
    if (!iconUrl) iconUrl = store.icon;
    shotUrls = store.shots;
  } catch (err) {
    warning = `Play 스토어 자산을 읽지 못했습니다(${err instanceof Error ? err.message : String(err)}). 폴백 카드로 만듭니다.`;
  }

  let iconPath: string | null = null;
  if (iconUrl) {
    const rawPath = path.join(assetDir, `${safe}-icon-raw`);
    if (await download(iconUrl, rawPath)) {
      const rounded = path.join(assetDir, `${safe}-icon.png`);
      iconPath = (await roundMask(media, rawPath, rounded)) ? rounded : rawPath;
    }
  }
  if (!iconPath) {
    const fallback = path.join(assetDir, `${safe}-icon-fallback.png`);
    if (!fs.existsSync(fallback)) fs.writeFileSync(fallback, renderFallbackIcon(theme, seed));
    iconPath = fallback;
    if (!warning) warning = '스토어 아이콘을 내려받지 못해 폴백 아이콘 카드로 만들었습니다.';
  }

  const shots: string[] = [];
  for (let i = 0; i < shotUrls.length && shots.length < 2; i += 1) {
    const raw = path.join(assetDir, `${safe}-shot-${i + 1}-raw`);
    if (!(await download(shotUrls[i], raw))) continue;
    const png = path.join(assetDir, `${safe}-shot-${i + 1}.png`);
    if (await toPng(media, raw, png, 1400)) shots.push(png);
    else shots.push(raw);
  }

  return {
    icon: iconPath,
    shots,
    source: shots.length > 0 ? (iconPath.includes('fallback') ? 'partial' : 'play') : 'fallback',
    warning,
  };
}
