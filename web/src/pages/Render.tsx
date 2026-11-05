// 서버 렌더 워커 전용 페이지: 헤드리스 브라우저가 frame(i) 를 호출해 JPEG 프레임을 받아간다.
import { useEffect } from 'react';
import * as THREE from 'three';
import { evalTimeline, totalDuration, stepCount } from '@shared/scene.js';
import { loadModel, applyScene, fitCamera, explodedBox, VIEWS } from '../engine/model';
import { setupStage, placeFloor } from '../engine/stage';

declare global { interface Window { __render: any } }

export default function RenderPage() {
  useEffect(() => {
    window.__render = { ready: false };
    run().catch((e) => { console.error(e); window.__render.error = String(e?.message || e); });
  }, []);
  return null;
}

async function run() {
  const q = new URLSearchParams(location.search);
  const job = q.get('job')!, tok = q.get('t')!, fps = Number(q.get('fps') || 30);
  const bundle = await fetch(`/api/render/${job}/bundle?t=${encodeURIComponent(tok)}`).then((r) => { if (!r.ok) throw new Error('bundle ' + r.status); return r.json(); });
  const scene = bundle.scene;
  const W = window.innerWidth, H = window.innerHeight;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);
  const zUp = bundle.model.stats?.upAxis !== 'Y';
  const model = await loadModel(`/api/render/${job}/model.glb?t=${encodeURIComponent(tok)}`, { zUp });
  const s3 = new THREE.Scene();
  s3.add(model.root);
  const technical = scene.viewMode === 'technical';
  const stage = setupStage(s3, renderer, scene.background === 'transparent' ? 'white' : scene.background || 'studio', model.size, technical);
  const ebox = explodedBox(model, scene, stepCount(scene));
  placeFloor(stage, model.box.min.y, model.box.getCenter(new THREE.Vector3()));
  const cam = new THREE.PerspectiveCamera(scene.camera?.fov || 35, W / H, 1, 1e6);
  let target: THREE.Vector3;
  if (scene.camera?.position) {
    cam.position.fromArray(scene.camera.position);
    target = new THREE.Vector3().fromArray(scene.camera.target);
    const d = cam.position.distanceTo(target);
    cam.near = d / 100; cam.far = d * 100; cam.lookAt(target); cam.updateProjectionMatrix();
  } else target = fitCamera(cam, ebox, VIEWS.iso, 1.1);
  const basePos = cam.position.clone();

  // 자막·워터마크 합성용 2D 캔버스
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const g = out.getContext('2d')!;
  const fontScale = H / 1080;
  const overlay = scene.overlay || {};
  const title = overlay.title !== false ? (scene.title || bundle.model.name) : '';
  const sub = overlay.subtitle || '';
  const mark = overlay.watermark ?? bundle.company?.name ?? '';
  const frames = Math.max(1, Math.ceil(totalDuration(scene) * fps));
  const up = new THREE.Vector3(0, 1, 0);

  window.__render.info = { frames, width: W, height: H };
  window.__render.frame = (i: number) => {
    const { e, azimuth } = evalTimeline(scene, i / fps);
    applyScene(model, scene, e, {});
    cam.position.copy(basePos).sub(target).applyAxisAngle(up, (azimuth * Math.PI) / 180).add(target);
    cam.lookAt(target);
    renderer.render(s3, cam);
    g.drawImage(renderer.domElement, 0, 0);
    const dark = stage.dark;
    if (title) {
      g.font = `700 ${Math.round(44 * fontScale)}px "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", sans-serif`;
      g.fillStyle = dark ? 'rgba(255,255,255,0.92)' : 'rgba(20,22,25,0.9)';
      g.fillText(title, 64 * fontScale, H - (sub ? 104 : 72) * fontScale);
      g.fillStyle = '#f59e0b';
      g.fillRect(64 * fontScale, H - (sub ? 92 : 60) * fontScale, 72 * fontScale, 4 * fontScale);
    }
    if (sub) {
      g.font = `400 ${Math.round(26 * fontScale)}px "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
      g.fillStyle = dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,22,25,0.7)';
      g.fillText(sub, 64 * fontScale, H - 52 * fontScale);
    }
    if (mark) {
      g.font = `600 ${Math.round(22 * fontScale)}px "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
      g.textAlign = 'right';
      g.fillStyle = dark ? 'rgba(255,255,255,0.55)' : 'rgba(20,22,25,0.45)';
      g.fillText(mark, W - 48 * fontScale, 60 * fontScale);
      g.textAlign = 'left';
    }
    return out.toDataURL('image/jpeg', 0.92).split(',')[1];
  };
  window.__render.ready = true;
}
