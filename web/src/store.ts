import { create } from 'zustand';
import { evalTimeline, stepCount, totalDuration } from '@shared/scene.js';

export interface Part { id: string; name: string; parentId: string | null; bbox: { min: number[]; max: number[] }; center: number[]; volume: number | null; triangles: number; extras?: any }
export interface Model { id: string; name: string; method: string; parts: Part[]; stats: any; provenance: any; source_name?: string; source_ext?: string; source_file_id: string; source_file_version: number }

interface WS {
  model: Model | null; scene: any | null; sceneVersion: number; dirty: boolean;
  selected: string | null; hover: string | null;
  xray: boolean; wireframe: boolean; isolate: string | null; ortho: boolean; autoRotate: boolean;
  section: { on: boolean; axis: 'x' | 'y' | 'z'; pos: number; flip: boolean };
  mode: 'manual' | 'timeline'; e: number; t: number; playing: boolean;
  viewCmd: { view: string; n: number };
  load(model: Model, scene: any, version: number): void;
  set(p: Partial<WS>): void;
  patchScene(fn: (s: any) => void): void;
  patchPart(id: string, p: Record<string, any>): void;
  view(v: string): void;
  current(): { e: number; azimuth: number };
}

export const useWS = create<WS>((set, get) => ({
  model: null, scene: null, sceneVersion: 0, dirty: false, selected: null, hover: null,
  xray: false, wireframe: false, isolate: null, ortho: false, autoRotate: false,
  section: { on: false, axis: 'x', pos: 0.5, flip: false },
  mode: 'manual', e: 0, t: 0, playing: false, viewCmd: { view: 'iso', n: 0 },
  load: (model, scene, version) => set({ model, scene: structuredClone(scene), sceneVersion: version, dirty: false, selected: null, e: 0, t: 0, playing: false, mode: 'manual', isolate: null }),
  set: (p) => set(p),
  patchScene: (fn) => { const s = structuredClone(get().scene); fn(s); set({ scene: s, dirty: true }); },
  patchPart: (id, p) => get().patchScene((s) => {
    s.parts[id] = { ...(s.parts[id] || {}) };
    for (const [k, v] of Object.entries(p)) {
      if (k === 'explode') s.parts[id].explode = { ...(s.parts[id].explode || { dir: [0, 0, 1], dist: 0, step: 1 }), ...(v as any) };
      else if (v === undefined) delete s.parts[id][k]; else s.parts[id][k] = v;
    }
  }),
  view: (v) => set((st) => ({ viewCmd: { view: v, n: st.viewCmd.n + 1 } })),
  current: () => {
    const s = get();
    if (!s.scene) return { e: 0, azimuth: 0 };
    return s.mode === 'timeline' ? evalTimeline(s.scene, s.t) : { e: s.e, azimuth: 0 };
  },
}));

export const steps = (scene: any) => (scene ? stepCount(scene) : 0);
export const duration = (scene: any) => (scene ? totalDuration(scene) : 0);
