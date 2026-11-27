/** ffmpeg / ffprobe 실행 도우미 (정적 바이너리 탐색 + 한글 폰트/fontconfig 준비) */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

function isExecutable(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

function scanRuntimes(name: string): string | null {
  const roots = [path.resolve(process.cwd(), '.runtimes'), path.resolve(process.cwd(), '..', '.runtimes')];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith('ffmpeg')) continue;
      const candidate = path.join(root, entry, name);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/** PATH → 표준 경로 → 로컬 정적 바이너리 순으로 탐색 */
export function findBinary(name: string, override?: string | null): string | null {
  const filename = process.platform === 'win32' ? `${name}.exe` : name;
  if (override) {
    if (isExecutable(override)) return override;
    const asDir = path.join(override, filename);
    if (isExecutable(asDir)) return asDir;
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, filename);
    if (isExecutable(candidate)) return candidate;
  }
  for (const dir of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', '/snap/bin']) {
    const candidate = path.join(dir, filename);
    if (isExecutable(candidate)) return candidate;
  }
  return scanRuntimes(filename);
}

/** ffmpeg 가 없으면 /etc/fonts 대신 최소 fontconfig 설정을 만들어 씁니다. */
export function ensureFontconfig(dir: string): string | null {
  if (fs.existsSync('/etc/fonts/fonts.conf')) return null;
  const confPath = path.join(dir, 'fonts.conf');
  const cacheDir = path.join(dir, 'fc-cache');
  const dirs = [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    path.join(process.env.HOME ?? '/root', '.fonts'),
  ].filter((d) => fs.existsSync(d));
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
${dirs.map((d) => `  <dir>${d}</dir>`).join('\n')}
  <cachedir>${cacheDir}</cachedir>
</fontconfig>
`;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(confPath, xml, 'utf8');
    return confPath;
  } catch {
    return null;
  }
}

export function fontDirs(): string[] {
  return [
    '/usr/share/fonts/opentype/noto',
    '/usr/share/fonts/truetype/noto',
    '/usr/share/fonts/pickle-hwp',
    '/usr/share/fonts/truetype/nanum',
    '/usr/share/fonts',
  ].filter((d) => fs.existsSync(d));
}

export function run(bin: string, args: string[], options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<RunResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(bin)} 시간 초과 (${options.timeoutMs}ms)`));
    }, options.timeoutMs ?? 180_000);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
  });
}

export interface ShortsMedia {
  ffmpeg: string | null;
  ffprobe: string | null;
  fontFamily: string;
  fontFile: string | null;
  fontconfig: string | null;
  available: boolean;
  version: string | null;
  detail: string;
}

const mediaCache = new Map<string, ShortsMedia>();

/** ffmpeg/ffprobe/한글 폰트 상태를 확인하고 캐시합니다. */
export async function resolveMedia(
  settings: { ffmpegPath?: string | null; ffprobePath?: string | null; font?: string | null },
  workDir: string,
): Promise<ShortsMedia> {
  const key = `${settings.ffmpegPath ?? ''}|${settings.ffprobePath ?? ''}|${settings.font ?? ''}`;
  const cached = mediaCache.get(key);
  if (cached) return cached;

  const ffmpeg = findBinary('ffmpeg', settings.ffmpegPath ?? null);
  const ffprobe = findBinary('ffprobe', settings.ffprobePath ?? null);
  const fontconfig = ensureFontconfig(workDir);
  const fontFile =
    [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf',
    ].find((file) => fs.existsSync(file)) ?? null;

  let version: string | null = null;
  let detail = 'ffmpeg를 찾지 못했습니다. Docker 이미지에는 기본 설치되어 있습니다.';
  let available = false;
  if (ffmpeg && ffprobe) {
    try {
      const result = await run(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 10_000 });
      const first = result.stdout.split('\n')[0] ?? '';
      version = /ffmpeg version (\S+)/.exec(first)?.[1] ?? null;
      available = result.code === 0;
      detail = available ? `ffmpeg ${version ?? ''}`.trim() : 'ffmpeg 실행에 실패했습니다.';
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    }
  }

  const media: ShortsMedia = {
    ffmpeg,
    ffprobe,
    fontFamily: settings.font?.trim() || 'Noto Sans CJK KR',
    fontFile,
    fontconfig,
    available,
    version,
    detail,
  };
  mediaCache.set(key, media);
  return media;
}

export function ffmpegEnv(media: ShortsMedia, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...extra };
  if (media.fontconfig) env.FONTCONFIG_FILE = media.fontconfig;
  return env;
}

export interface ProbeInfo {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
}

export async function probe(media: ShortsMedia, file: string): Promise<ProbeInfo> {
  if (!media.ffprobe) throw new Error('ffprobe를 찾지 못했습니다.');
  const result = await run(
    media.ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file],
    { timeoutMs: 30_000, env: ffmpegEnv(media) },
  );
  if (result.code !== 0) throw new Error(`ffprobe 실패: ${result.stderr.slice(-400)}`);
  const data = JSON.parse(result.stdout) as {
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[];
    format?: { duration?: string; bit_rate?: string };
  };
  const video = data.streams?.find((s) => s.codec_type === 'video');
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  let fps: number | null = null;
  if (video?.avg_frame_rate) {
    const [num, den] = video.avg_frame_rate.split('/').map(Number);
    if (num && den) fps = Math.round((num / den) * 100) / 100;
  }
  return {
    durationSec: data.format?.duration ? Math.round(Number(data.format.duration) * 100) / 100 : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
    fps,
    codec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    bitrate: data.format?.bit_rate ? Number(data.format.bit_rate) : null,
  };
}

/** 오디오 길이만 초 단위로 */
export async function audioDuration(media: ShortsMedia, file: string): Promise<number | null> {
  try {
    const info = await probe(media, file);
    return info.durationSec;
  } catch {
    return null;
  }
}
