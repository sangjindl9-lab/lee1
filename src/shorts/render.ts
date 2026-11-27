/** 쇼츠 풀오토 파이프라인: 대본 → 이미지 → 음악/내레이션 → 1080×1920 MP4 */
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.ts';
import type { AppRow, AppSnapshotRow, Store } from '../db.ts';
import { sleep } from '../util.ts';
import { prepareAssets } from './assets.ts';
import { buildAss, sceneOverlay } from './ass.ts';
import { generateBgmWav } from './bgm.ts';
import { ffmpegEnv, probe, resolveMedia, run, type ShortsMedia } from './ffmpeg.ts';
import { generateExternalClip, heroPrompt, providerLabel } from './externalVideo.ts';
import { renderBackground, THEMES } from './png.ts';
import { buildShortScript, refineScriptWithAi } from './script.ts';
import { synthesizeNarration } from './tts.ts';
import type { Mood, ProviderSettings, Scene } from './types.ts';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const XFADE = 0.45;

export interface BuildContext {
  shortId: number;
  app: AppRow;
  snapshot: AppSnapshotRow | null;
  keywords: string[];
  mood: Mood;
  narration: boolean;
  providers: ProviderSettings;
  aiKey: string | null;
  aiModel: string;
}

export type StageCallback = (stage: string, progress: number, note?: string) => void;

export interface BuildResult {
  file: string;
  bytes: number;
  duration: number;
  warnings: string[];
  engine: string;
  script: ReturnType<typeof buildShortScript>;
}

function sceneMinDuration(scene: Scene): number {
  if (scene.role === 'hook') return 4.2;
  if (scene.role === 'cta') return 4.8;
  if (scene.role === 'proof') return 5.0;
  return 4.4;
}

function computeDurations(scenes: Scene[], narrationSeconds: (number | null)[]): number[] {
  const durations = scenes.map((scene, i) => {
    const spoken = narrationSeconds[i] ?? 0;
    const base = sceneMinDuration(scene);
    return Math.min(9.5, Math.max(base, spoken + 1.1));
  });
  let total = durations.reduce((a, b) => a + b, 0) - XFADE * (scenes.length - 1);
  if (total < 15.5) {
    const need = 15.5 - total;
    for (let i = 0; i < durations.length; i += 1) {
      durations[i] = Math.min(9.5, durations[i] + need / durations.length);
    }
  }
  total = durations.reduce((a, b) => a + b, 0) - XFADE * (scenes.length - 1);
  if (total > 24.5) {
    const excess = total - 24.5;
    const perScene = excess / durations.length;
    for (let i = 0; i < durations.length; i += 1) {
      const floor = Math.max(3.2, (narrationSeconds[i] ?? 0) + 0.4);
      durations[i] = Math.max(floor, durations[i] - perScene);
    }
  }
  return durations.map((d) => Math.round(d * 100) / 100);
}

function ffArgs(media: ShortsMedia): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y'];
}

async function renderSceneClip(options: {
  media: ShortsMedia;
  workDir: string;
  index: number;
  duration: number;
  background: string | null; // null → 외부 영상 사용
  externalVideo: string | null;
  icon: string | null;
  shot: string | null;
  overlay: { icon: { size: number; x: number; y: number } | null; shot: { height: number; x: number; y: number } | null };
}): Promise<string> {
  const { media, workDir, index, duration, background, externalVideo, icon, shot, overlay } = options;
  const out = path.join(workDir, `scene-${String(index + 1).padStart(2, '0')}.mp4`);
  const frames = Math.max(1, Math.round(duration * FPS));
  const inputs: string[] = [];
  const filters: string[] = [];

  if (externalVideo && index === 0) {
    inputs.push('-i', externalVideo);
    filters.push(
      `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,fps=${FPS},trim=duration=${duration},setpts=PTS-STARTPTS[bg]`,
    );
  } else {
    inputs.push('-loop', '1', '-i', background ?? '');
    filters.push(
      `[0:v]scale=540:960,zoompan=z='min(1+${(0.11 / Math.max(1, frames)).toFixed(6)}*on,1.11)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=540x960:fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=bicubic,setsar=1[bg]`,
    );
  }

  let last = 'bg';
  let inputIndex = 1;
  if (icon && overlay.icon) {
    inputs.push('-loop', '1', '-i', icon);
    filters.push(`[${inputIndex}:v]scale=${overlay.icon.size}:${overlay.icon.size}[ic]`);
    filters.push(`[${last}][ic]overlay=x=${overlay.icon.x}:y=${overlay.icon.y}:shortest=1[v${inputIndex}]`);
    last = `v${inputIndex}`;
    inputIndex += 1;
  }
  if (shot && overlay.shot) {
    inputs.push('-loop', '1', '-i', shot);
    filters.push(`[${inputIndex}:v]scale=-2:${overlay.shot.height}[sh${inputIndex}]`);
    filters.push(`[${last}][sh${inputIndex}]overlay=x=(W-w)/2:y=${overlay.shot.y}:shortest=1[v${inputIndex}]`);
    last = `v${inputIndex}`;
    inputIndex += 1;
  }

  const result = await run(
    media.ffmpeg!,
    [
      ...ffArgs(media),
      ...inputs,
      '-t',
      String(duration),
      '-filter_complex',
      filters.join(';'),
      '-map',
      `[${last}]`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      '-an',
      out,
    ],
    { timeoutMs: 240_000, env: ffmpegEnv(media) },
  );
  if (result.code !== 0) throw new Error(`씬 ${index + 1} 렌더 실패: ${result.stderr.slice(-500)}`);
  return out;
}

export async function buildShort(
  store: Store,
  config: AppConfig,
  ctx: BuildContext,
  onStage: StageCallback,
): Promise<BuildResult> {
  const warnings: string[] = [];
  const shortsDir = config.shortsDir;
  const workDir = path.join(shortsDir, 'work', String(ctx.shortId));
  const assetDir = path.join(shortsDir, 'assets');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(assetDir, { recursive: true });
  fs.mkdirSync(path.join(shortsDir, 'videos'), { recursive: true });

  const media = await resolveMedia(
    { ffmpegPath: config.ffmpegPath, ffprobePath: config.ffprobePath, font: config.shortsFont },
    workDir,
  );
  if (!media.available) throw new Error(`영상 엔진을 사용할 수 없습니다: ${media.detail}`);

  const theme = THEMES[ctx.mood] ?? THEMES.bright;

  // 1) 대본
  onStage('script', 6, '대본을 쓰는 중');
  let script = buildShortScript({
    app: ctx.app,
    snapshot: ctx.snapshot,
    keywords: ctx.keywords,
    mood: ctx.mood,
    seed: `${ctx.app.package_id}-${ctx.shortId}`,
  });
  warnings.push(...script.warnings);
  if (ctx.aiKey) {
    const refined = await refineScriptWithAi(script, ctx.aiKey, ctx.aiModel);
    if (refined.ok) script = refined.script;
    else if (refined.error) warnings.push(`AI 대본 보강 건너뜀: ${refined.error}`);
  }
  onStage('script', 16, `${script.scenes.length}개 씬 대본 완료`);

  // 2) 이미지 · 스토어 자산
  onStage('visuals', 20, '스토어 아이콘·화면을 준비하는 중');
  const assets = await prepareAssets({
    packageId: ctx.app.package_id,
    hl: config.locale.hl,
    gl: config.locale.gl,
    theme,
    seed: ctx.shortId,
    assetDir,
    iconHint: ctx.snapshot?.icon ?? null,
    media,
  });
  if (assets.warning) warnings.push(assets.warning);

  const backgrounds: string[] = [];
  for (let i = 0; i < script.scenes.length; i += 1) {
    const png = renderBackground(theme, i, ctx.shortId * 31 + i * 7, script.scenes[i].role === 'cta' ? 0.5 : 0);
    const file = path.join(workDir, `bg-${i + 1}.png`);
    fs.writeFileSync(file, png);
    backgrounds.push(file);
  }
  onStage('visuals', 32, '씬 배경·카드 생성 완료');

  // 3) 외부 AI 영상 (설정된 경우에만, 실패하면 내장 엔진으로 폴백)
  let externalVideo: string | null = null;
  let engine = '내장 풀오토';
  if (ctx.providers.videoProvider !== 'builtin') {
    const label = providerLabel(ctx.providers.videoProvider);
    onStage('visuals', 36, `${label}로 훅 장면 영상을 만드는 중`);
    const clipPath = path.join(workDir, 'hero.mp4');
    const clip = await generateExternalClip({
      provider: ctx.providers.videoProvider,
      apiKey: ctx.providers.videoApiKey,
      endpoint: ctx.providers.videoEndpoint,
      model: ctx.providers.videoModel,
      prompt: heroPrompt(script.appName, script.keywords[0] ?? ctx.app.notes ?? 'mobile app', ctx.mood),
      outFile: clipPath,
      pollTimeoutMs: 210_000,
    });
    if (clip.ok && clip.file) {
      externalVideo = clip.file;
      engine = `${label} 연결됨`;
      onStage('visuals', 44, `${label} 영상 도착`);
    } else {
      warnings.push(`${label} 사용 실패 → 내장 엔진으로 대체: ${clip.warning ?? '알 수 없는 오류'}`);
      onStage('visuals', 40, `${label} 실패 — 내장 엔진으로 계속`);
    }
  } else {
    onStage('visuals', 40, '내장 그래픽 엔진 사용');
  }

  // 4) 내레이션
  const narrationFiles: (string | null)[] = [];
  const narrationSeconds: (number | null)[] = [];
  let narrationEngine = '내레이션 없음';
  if (ctx.narration) {
    onStage('audio', 48, '한국어 내레이션을 만드는 중');
    for (let i = 0; i < script.scenes.length; i += 1) {
      const scene = script.scenes[i];
      const out = path.join(workDir, `voice-${i + 1}.mp3`);
      const result = await synthesizeNarration({
        text: scene.narration,
        provider: ctx.providers.ttsProvider,
        apiKey: ctx.providers.ttsApiKey,
        voice: ctx.providers.ttsVoice,
        outFile: out,
        media,
      });
      if (result.ok) {
        narrationFiles.push(result.file);
        narrationSeconds.push(result.seconds);
        narrationEngine = result.engine;
      } else {
        narrationFiles.push(null);
        narrationSeconds.push(null);
        if (result.warning) warnings.push(`씬 ${i + 1} 내레이션: ${result.warning}`);
      }
      if (i === 0 && !result.ok) break; // 엔진이 죽었으면 나머지도 시도하지 않음
    }
    if (narrationFiles.every((f) => !f)) {
      warnings.push('내레이션 없이 자막+BGM으로 생성했습니다.');
      narrationEngine = '내레이션 없음 (자막+BGM)';
    }
  }

  const durations = computeDurations(script.scenes, narrationSeconds);
  const total = Math.round((durations.reduce((a, b) => a + b, 0) - XFADE * (durations.length - 1)) * 100) / 100;

  // 5) BGM (영상 길이에 정확히 맞춰 합성)
  onStage('audio', 56, `BGM 생성 (${ctx.mood})`);
  const bgm = generateBgmWav(ctx.mood, total + 0.5, `${script.packageId}-${ctx.shortId}`);
  const bgmFile = path.join(workDir, 'bgm.wav');
  fs.writeFileSync(bgmFile, bgm.buffer);
  if (bgm.rms < 0.02) warnings.push('BGM 신호가 약합니다. 볼륨을 확인하세요.');

  // 6) 씬 렌더 + 크로스페이드 결합 + 자막 + 오디오
  onStage('render', 62, '씬별 모션을 렌더링하는 중');
  const timeline = durations.map((duration, i) => ({
    index: i + 1,
    start: durations.slice(0, i).reduce((a, b) => a + b, 0) - XFADE * i,
    duration,
  }));

  const { content: assContent, overlays } = buildAss({
    script,
    theme,
    timeline,
    hasIcon: Boolean(assets.icon),
    hasShot: assets.shots.length > 0,
    fontFamily: media.fontFamily,
  });
  const assFile = path.join(workDir, 'short.ass');
  fs.writeFileSync(assFile, assContent, 'utf8');

  const sceneFiles: string[] = [];
  for (let i = 0; i < script.scenes.length; i += 1) {
    const overlay = overlays[i] ?? sceneOverlay(script.scenes[i].role, Boolean(assets.icon), assets.shots.length > 0);
    const file = await renderSceneClip({
      media,
      workDir,
      index: i,
      duration: durations[i],
      background: backgrounds[i] ?? backgrounds[0],
      externalVideo,
      icon: assets.icon,
      shot: script.scenes[i].role === 'hook' ? (assets.shots[1] ?? assets.shots[0] ?? null) : (assets.shots[0] ?? null),
      overlay,
    });
    sceneFiles.push(file);
    onStage('render', 62 + Math.round((i + 1) * (18 / script.scenes.length)), `씬 ${i + 1}/${script.scenes.length} 완료`);
  }

  onStage('render', 84, '크로스페이드 · 자막 · 오디오 믹싱');
  const inputs: string[] = [];
  for (const file of sceneFiles) inputs.push('-i', file);
  inputs.push('-i', bgmFile);
  const voiceInputs: { file: string; start: number }[] = [];
  timeline.forEach((slot, i) => {
    const file = narrationFiles[i];
    if (file) voiceInputs.push({ file, start: slot.start + 0.35 });
  });
  for (const voice of voiceInputs) inputs.push('-i', voice.file);

  const filters: string[] = [];
  let lastVideo = '0:v';
  let offset = durations[0] - XFADE;
  for (let i = 1; i < sceneFiles.length; i += 1) {
    const outLabel = `x${i}`;
    filters.push(
      `[${lastVideo}][${i}:v]xfade=transition=fade:duration=${XFADE}:offset=${Math.max(0, offset).toFixed(3)}[${outLabel}]`,
    );
    lastVideo = outLabel;
    offset += durations[i] - XFADE;
  }
  filters.push(`[${lastVideo}]ass=filename='${assFile}'[vtxt]`);
  filters.push(
    `[vtxt]fade=t=in:st=0:d=0.3,fade=t=out:st=${Math.max(0, total - 0.45).toFixed(2)}:d=0.45[vout]`,
  );

  const bgmIndex = sceneFiles.length;
  filters.push(
    `[${bgmIndex}:a]volume=${voiceInputs.length ? 0.42 : 0.7},atrim=0:${total.toFixed(2)},asetpts=N/SR/TB[bgm]`,
  );
  const mixLabels = ['[bgm]'];
  voiceInputs.forEach((voice, idx) => {
    const inputIdx = bgmIndex + 1 + idx;
    const ms = Math.round(voice.start * 1000);
    filters.push(`[${inputIdx}:a]adelay=${ms}|${ms},volume=1.0[vc${idx}]`);
    mixLabels.push(`[vc${idx}]`);
  });
  if (voiceInputs.length > 0) {
    filters.push(
      `${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:duration=first,alimiter=limit=0.92,afade=t=out:st=${Math.max(0, total - 1.3).toFixed(2)}:d=1.3[aout]`,
    );
  } else {
    filters.push(`[bgm]alimiter=limit=0.92,afade=t=out:st=${Math.max(0, total - 1.3).toFixed(2)}:d=1.3[aout]`);
  }

  const slug = script.appName.replace(/[^0-9A-Za-z가-힣]+/g, '') || 'short';
  const finalFile = path.join(shortsDir, 'videos', `${ctx.shortId}-${slug}.mp4`);
  const encode = await run(
    media.ffmpeg!,
    [
      ...ffArgs(media),
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-t',
      total.toFixed(2),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '19',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ar',
      '44100',
      '-movflags',
      '+faststart',
      finalFile,
    ],
    { timeoutMs: 300_000, env: ffmpegEnv(media) },
  );
  if (encode.code !== 0) throw new Error(`최종 인코딩 실패: ${encode.stderr.slice(-600)}`);

  const info = await probe(media, finalFile);
  if (!info.durationSec || info.durationSec < 8) throw new Error('생성된 영상 길이가 비정상입니다.');
  if (info.width !== WIDTH || info.height !== HEIGHT) {
    warnings.push(`해상도가 ${info.width}×${info.height}로 확인되었습니다.`);
  }
  if (info.codec !== 'h264') warnings.push(`비디오 코덱이 ${info.codec}입니다.`);
  const bytes = fs.statSync(finalFile).size;

  onStage('render', 96, '영상 검증');
  fs.writeFileSync(
    path.join(workDir, 'result.json'),
    JSON.stringify({ script, warnings, durations, narrationEngine, engine, info, bytes }, null, 2),
    'utf8',
  );
  await sleep(50);
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    // 정리는 실패해도 무시
  }

  return {
    file: finalFile,
    bytes,
    duration: info.durationSec,
    warnings,
    engine,
    script: { ...script, warnings },
  };
}
