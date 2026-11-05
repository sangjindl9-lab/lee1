// 쇼룸 템플릿: 배경·조명·바닥(그림자·반사) 구성. 뷰어·공유 쇼룸·MP4 렌더가 같은 함수를 사용한다.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export type Background = 'gallery' | 'machine' | 'mold' | 'electronics' | 'building' | 'dark' | 'white' | 'studio' | 'factory' | 'transparent';

interface Tpl {
  label: string;
  /** 배경: 위 → 아래 그라데이션 (같으면 단색) */
  sky: [string, string];
  floor: string;
  /** 0~1 바닥 반사 세기 (0 = 반사 없음) */
  reflect: number;
  shadow: number;
  grid?: { major: string; minor: string; opacity: number };
  key: number; fill: number; rim: number; hemi: [string, string, number];
  exposure: number;
  spot?: boolean;
  dark: boolean;
  legacy?: boolean;
}
export const BACKGROUNDS: Record<Background, Tpl> = {
  gallery: { label: '고급 제품 전시관', sky: ['#3a342e', '#0d0c0b'], floor: '#2e2924', reflect: 0.08, shadow: 0.6, key: 2.4, fill: 0.9, rim: 1.2, hemi: ['#fff4e6', '#6a5a48', 0.6], exposure: 1.1, spot: true, dark: true },
  machine: { label: '산업용 기계 쇼룸', sky: ['#4b5563', '#1f2429'], floor: '#2b3036', reflect: 0.08, shadow: 0.5, grid: { major: '#f59e0b', minor: '#3b4249', opacity: 0.35 }, key: 2.4, fill: 0.7, rim: 1.0, hemi: ['#e8eef5', '#2a2f35', 0.55], exposure: 1.05, dark: true },
  mold: { label: '금형 기술설명 쇼룸', sky: ['#1e3a5f', '#0b1626'], floor: '#0f2136', reflect: 0.06, shadow: 0.45, grid: { major: '#5fa8ff', minor: '#1d3a5c', opacity: 0.5 }, key: 1.9, fill: 0.9, rim: 0.9, hemi: ['#dbeafe', '#0b1626', 0.8], exposure: 1.0, dark: true },
  electronics: { label: '전자제품 쇼룸', sky: ['#ffffff', '#e6e9ee'], floor: '#f3f4f6', reflect: 0.1, shadow: 0.2, key: 1.8, fill: 0.9, rim: 0.6, hemi: ['#ffffff', '#c8ccd2', 0.8], exposure: 1.05, dark: false },
  building: { label: '건축물 쇼룸', sky: ['#9ccaf0', '#eef5fb'], floor: '#c9cfc3', reflect: 0, shadow: 0.35, key: 2.8, fill: 0.5, rim: 0.4, hemi: ['#cfe6ff', '#8a8f7c', 0.9], exposure: 1.0, dark: false },
  dark: { label: '다크 스튜디오', sky: ['#1b1d21', '#0a0b0d'], floor: '#18191c', reflect: 0.12, shadow: 0.6, key: 2.2, fill: 0.45, rim: 1.1, hemi: ['#ffffff', '#202226', 0.4], exposure: 1.05, dark: true },
  white: { label: '화이트 스튜디오', sky: ['#ffffff', '#ffffff'], floor: '#ffffff', reflect: 0, shadow: 0.18, key: 1.9, fill: 0.9, rim: 0.5, hemi: ['#ffffff', '#d4d7dc', 0.9], exposure: 1.05, dark: false },
  transparent: { label: '투명 배경 (이미지용)', sky: ['', ''], floor: '', reflect: 0, shadow: 0.22, key: 2.0, fill: 0.8, rim: 0.6, hemi: ['#ffffff', '#666666', 0.7], exposure: 1.05, dark: false },
  studio: { label: '스튜디오 (기본)', sky: ['#e8eaed', '#cfd3d8'], floor: '#c9cdd2', reflect: 0, shadow: 0.22, key: 2.2, fill: 0.6, rim: 0.8, hemi: ['#ffffff', '#444444', 0.6], exposure: 1.05, dark: false, legacy: true },
  factory: { label: '공장(그리드)', sky: ['#2a2e33', '#2a2e33'], floor: '#33383e', reflect: 0, shadow: 0.4, grid: { major: '#6b7280', minor: '#3b4047', opacity: 0.6 }, key: 2.2, fill: 0.6, rim: 0.8, hemi: ['#ffffff', '#444444', 0.6], exposure: 1.05, dark: true, legacy: true },
};
/** 화면 선택 목록 (지시서의 7종 + 투명 + 이전 호환) */
export const TEMPLATE_ORDER: Background[] = ['gallery', 'machine', 'mold', 'electronics', 'building', 'dark', 'white', 'studio', 'factory', 'transparent'];
/** 프로젝트 업종 → 기본 쇼룸 */
export const INDUSTRY_TEMPLATE: Record<string, Background> = { mold: 'mold', machine: 'machine', electric: 'electronics', building: 'building', product: 'gallery' };

export interface Stage { group: THREE.Group; key: THREE.DirectionalLight; floor: THREE.Object3D; grid: THREE.GridHelper | null; dark: boolean; dispose(): void }

function gradient(top: string, bottom: string) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const g = c.getContext('2d')!;
  const lg = g.createLinearGradient(0, 0, 0, 256); lg.addColorStop(0, top); lg.addColorStop(1, bottom);
  g.fillStyle = lg; g.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 소프트웨어 렌더(SwiftShader·llvmpipe — 서버 MP4 렌더, GPU 없는 PC)에서는 반사를 꺼 속도를 지킨다 */
function softwareGL(r: THREE.WebGLRenderer) {
  try {
    const gl = r.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch { return false; }
}

export function setupStage(scene: THREE.Scene, renderer: THREE.WebGLRenderer, bg: Background, size: number, technical = false, opts: { reflections?: boolean } = {}): Stage {
  const b = BACKGROUNDS[bg] || BACKGROUNDS.studio;
  const disposables: { dispose(): void }[] = [];
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  if (bg === 'transparent') { scene.background = null; renderer.setClearColor(0x000000, 0); }
  else if (b.sky[0] === b.sky[1]) scene.background = new THREE.Color(b.sky[0]);
  else { const t = gradient(b.sky[0], b.sky[1]); scene.background = t; disposables.push(t); }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = technical ? 0.9 : b.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const group = new THREE.Group();
  group.name = '__stage';
  const hemi = new THREE.HemisphereLight(b.hemi[0], b.hemi[1], technical ? 1.2 : b.hemi[2]);
  const key = new THREE.DirectionalLight(0xffffff, technical ? 1.0 : b.key);
  // 거의 머리 위(살짝 왼쪽 앞)에서 비춰 그림자가 모델 발밑에 보이게 (등각 카메라는 오른쪽 앞에서 본다)
  key.position.set(-size * 0.5, size * 2.2, size * 0.6);
  key.castShadow = !technical;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -size * 1.5; sc.right = sc.top = size * 1.5; sc.near = 0.1; sc.far = size * 6;
  sc.updateProjectionMatrix(); // 범위를 바꾼 뒤 갱신해야 그림자가 실제 모델 크기(mm)를 덮는다
  key.shadow.bias = -0.0005;
  const fill = new THREE.DirectionalLight(0xffffff, technical ? 0.5 : b.fill);
  fill.position.set(-size * 1.2, size * 0.5, size * 0.8);
  const rim = new THREE.DirectionalLight(0xbcd4ff, technical ? 0.3 : b.rim);
  rim.position.set(-size, size * 0.6, -size);
  group.add(hemi, key, key.target, fill, rim);
  if (b.spot && !technical) {
    // 전시관 조명: 위에서 모델을 비추는 스포트라이트
    const sp = new THREE.SpotLight(0xfff1dc, 60, size * 8, Math.PI / 7, 0.6, 1.2);
    sp.position.set(0, size * 2.6, size * 0.4);
    sp.target.position.set(0, 0, 0);
    sp.intensity = 4 * b.key;
    sp.decay = 0;
    group.add(sp, sp.target);
  }

  // 바닥: [반사면] + [바닥색 반투명막] + [그림자] 를 한 묶음으로
  const floor = new THREE.Group();
  floor.name = '__floor';
  const S = size * 14;
  const reflect = !technical && b.reflect > 0 && opts.reflections !== false && !softwareGL(renderer);
  if (reflect) {
    const px = Math.min(1024, Math.round((renderer.domElement.width || 1024) / 2));
    const mirror = new Reflector(new THREE.CircleGeometry(S / 2, 64), { textureWidth: px, textureHeight: px, color: 0x7f7f7f });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -size * 0.0006;
    floor.add(mirror);
    disposables.push({ dispose: () => mirror.dispose() });
  }
  if (!technical && bg !== 'transparent') {
    // 가장자리로 갈수록 배경에 녹아드는 원형 바닥
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const col = new THREE.Color(b.floor);
    const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
    const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    const a0 = reflect ? 1 - b.reflect : 1;
    rg.addColorStop(0, `rgba(${rgb},${a0})`); rg.addColorStop(0.55, `rgba(${rgb},${Math.min(1, a0 + 0.1)})`); rg.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const deck = new THREE.Mesh(new THREE.CircleGeometry(S / 2, 64), mat);
    deck.rotation.x = -Math.PI / 2;
    deck.renderOrder = -1;
    floor.add(deck);
    disposables.push(tex, mat, deck.geometry);
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(S, S),
    technical ? new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0 }) : new THREE.ShadowMaterial({ opacity: b.shadow }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = size * 0.0004;
  shadow.receiveShadow = true;
  floor.add(shadow);
  group.add(floor);
  let grid: THREE.GridHelper | null = null;
  if (b.grid || technical) {
    const gc = b.grid || { major: '#6b7280', minor: b.dark ? '#3b4047' : '#b8bcc2', opacity: 0.6 };
    grid = new THREE.GridHelper(size * 8, 40, gc.major, gc.minor);
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = gc.opacity;
    grid.position.y = size * 0.0008;
    floor.add(grid);
  }
  scene.add(group);
  return {
    group, key, floor, grid, dark: b.dark,
    dispose() { scene.remove(group); env.dispose(); pmrem.dispose(); for (const d of disposables) d.dispose(); if (bg === 'transparent') renderer.setClearColor(0x000000, 0); },
  };
}

/** 바닥을 모델 아래(최저점)로, 조명·그림자·바닥 중심을 모델 중심으로 맞춤 (CAD 좌표는 원점에서 멀리 있을 수 있다) */
export function placeFloor(stage: Stage, minY: number, center?: THREE.Vector3) {
  if (center) { stage.group.position.set(center.x, 0, center.z); stage.group.updateMatrixWorld(true); }
  stage.floor.position.y = minY - 0.001;
}
