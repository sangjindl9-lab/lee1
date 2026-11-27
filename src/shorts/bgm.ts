/**
 * 저작권 걱정 없는 프로시저럴 BGM 생성기.
 * 외부 라이브러리 없이 44.1kHz 스테레오 16bit WAV 를 직접 합성합니다.
 */
import type { Mood } from './types.ts';

export interface BgmResult {
  buffer: Buffer;
  sampleRate: number;
  channels: number;
  seconds: number;
  peak: number;
  rms: number;
}

interface MoodSpec {
  bpm: number;
  /** 4마디 코드 진행 (MIDI 노트 번호) */
  progression: number[][];
  arpRate: number;
  kick: boolean[];
  snare: boolean[];
  hatLevel: number;
  padLevel: number;
  bassLevel: number;
  brightness: number;
}

const MOOD_SPECS: Record<Mood, MoodSpec> = {
  bright: {
    bpm: 118,
    progression: [
      [60, 64, 67, 72],
      [55, 59, 62, 67],
      [57, 60, 64, 69],
      [53, 57, 60, 65],
    ],
    arpRate: 2,
    kick: [true, false, true, false],
    snare: [],
    hatLevel: 1,
    padLevel: 1,
    bassLevel: 1,
    brightness: 1.25,
  },
  focus: {
    bpm: 84,
    progression: [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [60, 64, 67, 72],
      [55, 59, 62, 67],
    ],
    arpRate: 1,
    kick: [true, false, false, false],
    snare: [],
    hatLevel: 0.55,
    padLevel: 1.35,
    bassLevel: 0.9,
    brightness: 0.9,
  },
  impact: {
    bpm: 128,
    progression: [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [55, 58, 62, 67],
      [52, 55, 59, 64],
    ],
    arpRate: 4,
    kick: [true, false, true, true],
    snare: [false, true, false, true],
    hatLevel: 1.25,
    padLevel: 0.85,
    bassLevel: 1.25,
    brightness: 1.45,
  },
};

const freq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 단순 2차 로우패스 (패드를 부드럽게) */
function lowpass(samples: Float32Array, cutoff: number, sampleRate: number): void {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sampleRate;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < samples.length; i += 1) {
    prev += alpha * (samples[i] - prev);
    samples[i] = prev;
  }
}

export function generateBgmWav(mood: Mood, seconds: number, seed = 'eum'): BgmResult {
  const spec = MOOD_SPECS[mood] ?? MOOD_SPECS.bright;
  const sampleRate = 44_100;
  const total = Math.max(1, Math.round(seconds * sampleRate));
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const rnd = mulberry32(hashSeed(`${mood}-${Math.round(seconds)}-${seed}`));
  const beat = 60 / spec.bpm;
  const bar = beat * 4;

  const add = (index: number, value: number, pan: number): void => {
    if (index < 0 || index >= total) return;
    const p = Math.max(0, Math.min(1, pan));
    left[index] += value * Math.cos((p * Math.PI) / 2);
    right[index] += value * Math.sin((p * Math.PI) / 2);
  };

  // 1) 패드 — 마디마다 코드톤 3개를 길게
  const bars = Math.ceil(seconds / bar) + 1;
  for (let b = 0; b < bars; b += 1) {
    const chord = spec.progression[b % spec.progression.length];
    const start = Math.round(b * bar * sampleRate);
    const length = Math.round(bar * sampleRate * 1.05);
    for (let n = 0; n < chord.length; n += 1) {
      const note = chord[n] + (n === chord.length - 1 ? 12 : 0);
      const f = freq(note);
      const pan = 0.32 + (n / Math.max(1, chord.length - 1)) * 0.36;
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        const attack = Math.min(1, t / 0.45);
        const release = Math.min(1, Math.max(0, (length / sampleRate - t) / 0.5));
        const env = attack * release * 0.028 * spec.padLevel;
        const detune = 1 + (n % 2 === 0 ? 0.0009 : -0.0011);
        const v =
          Math.sin(2 * Math.PI * f * detune * t) +
          0.22 * Math.sin(2 * Math.PI * f * 2 * t) +
          0.08 * Math.sin(2 * Math.PI * f * 3 * t);
        add(start + i, v * env, pan);
      }
    }
  }

  // 2) 아르페지오 — 8분/16분 플럭
  const step = beat / spec.arpRate;
  const steps = Math.ceil(seconds / step);
  for (let s = 0; s < steps; s += 1) {
    const t0 = s * step;
    const chord = spec.progression[Math.floor(t0 / bar) % spec.progression.length];
    const tones = [...chord, chord[0] + 12, chord[3] + 12];
    const note = tones[(s * 3 + Math.floor(rnd() * 2)) % tones.length] + 12;
    const f = freq(note);
    const start = Math.round(t0 * sampleRate);
    const length = Math.round(Math.min(0.34, step * 2) * sampleRate);
    const pan = 0.2 + ((s % 4) / 3) * 0.6;
    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 7.5) * 0.055 * spec.brightness;
      add(
        start + i,
        (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t) + 0.12 * Math.sin(2 * Math.PI * f * 4 * t)) * env,
        pan,
      );
    }
  }

  // 3) 베이스
  const bassBeats = [0, 2.5, 3];
  for (let b = 0; b < bars; b += 1) {
    const chord = spec.progression[b % spec.progression.length];
    const root = chord[0] - 24;
    for (const offset of bassBeats) {
      const start = Math.round((b * bar + offset * beat) * sampleRate);
      const length = Math.round(Math.min(0.6, beat * 0.9) * sampleRate);
      const f = freq(root);
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 3.4) * 0.16 * spec.bassLevel;
        add(start + i, (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * f * 2 * t)) * env, 0.5);
      }
    }
  }

  // 4) 킥 · 스네어 · 하이햇
  const drumBeats = Math.ceil(seconds / beat);
  for (let b = 0; b < drumBeats; b += 1) {
    const inBar = b % 4;
    const t0 = b * beat;
    if (spec.kick[inBar]) {
      const start = Math.round(t0 * sampleRate);
      const length = Math.round(0.32 * sampleRate);
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        const f = 130 * Math.exp(-t * 28) + 44;
        const env = Math.exp(-t * 10) * 0.5;
        add(start + i, Math.sin(2 * Math.PI * f * t) * env, 0.5);
      }
    }
    if (spec.snare[inBar]) {
      const start = Math.round(t0 * sampleRate);
      const length = Math.round(0.22 * sampleRate);
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        const env = Math.exp(-t * 22) * 0.12;
        add(start + i, (rnd() * 2 - 1) * env + Math.sin(2 * Math.PI * 190 * t) * env * 0.4, 0.5);
      }
    }
    // 하이햇: 8분 오프비트
    if (spec.hatLevel > 0) {
      const start = Math.round((t0 + beat / 2) * sampleRate);
      const length = Math.round(0.07 * sampleRate);
      let prevNoise = 0;
      for (let i = 0; i < length; i += 1) {
        const t = i / sampleRate;
        const noise = rnd() * 2 - 1;
        const hp = noise - prevNoise;
        prevNoise = noise;
        const env = Math.exp(-t * 55) * 0.05 * spec.hatLevel;
        add(start + i, hp * env, 0.62);
      }
    }
  }

  // 5) 마스터링 — 소프트 클립 + 노멀라이즈 + 페이드
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / sampleRate;
    const fadeIn = Math.min(1, t / 0.08);
    const fadeOut = Math.min(1, Math.max(0, (seconds - t) / 1.1));
    const gain = fadeIn * fadeOut;
    left[i] = Math.tanh(left[i] * 1.35) * gain;
    right[i] = Math.tanh(right[i] * 1.35) * gain;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    energy += left[i] * left[i] + right[i] * right[i];
  }
  const norm = peak > 0 ? 0.89 / peak : 1;
  const data = Buffer.alloc(total * 4);
  for (let i = 0; i < total; i += 1) {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * norm * 32767))), i * 4);
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * norm * 32767))), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return {
    buffer: Buffer.concat([header, data]),
    sampleRate,
    channels: 2,
    seconds,
    peak: Math.min(1, peak * norm),
    rms: Math.sqrt(energy / (total * 2)) * norm,
  };
}
