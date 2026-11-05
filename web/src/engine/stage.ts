// 조명·환경·바닥 구성 (뷰어와 MP4 렌더가 같은 함수를 사용)
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type Background = 'studio' | 'dark' | 'white' | 'factory';
export const BACKGROUNDS: Record<Background, { label: string; color: string; floor: string; grid: boolean }> = {
  studio: { label: '스튜디오', color: '#dfe2e6', floor: '#c9cdd2', grid: false },
  dark: { label: '다크 쇼룸', color: '#16181b', floor: '#22252a', grid: false },
  white: { label: '화이트', color: '#ffffff', floor: '#f0f1f3', grid: false },
  factory: { label: '공장(그리드)', color: '#2a2e33', floor: '#33383e', grid: true },
};

export interface Stage { group: THREE.Group; key: THREE.DirectionalLight; floor: THREE.Mesh; grid: THREE.GridHelper | null; dispose(): void }

export function setupStage(scene: THREE.Scene, renderer: THREE.WebGLRenderer, bg: Background, size: number, technical = false): Stage {
  const b = BACKGROUNDS[bg] || BACKGROUNDS.studio;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.background = new THREE.Color(b.color);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = technical ? 0.9 : 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const group = new THREE.Group();
  group.name = '__stage';
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, technical ? 1.2 : 0.6);
  const key = new THREE.DirectionalLight(0xffffff, technical ? 1.0 : 2.2);
  key.position.set(size * 0.8, size * 1.6, size * 1.1);
  key.castShadow = !technical;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -size * 1.5; sc.right = sc.top = size * 1.5; sc.near = 0.1; sc.far = size * 6;
  key.shadow.bias = -0.0005;
  const rim = new THREE.DirectionalLight(0xbcd4ff, technical ? 0.3 : 0.8);
  rim.position.set(-size, size * 0.6, -size);
  group.add(hemi, key, key.target, rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size * 12, size * 12),
    technical ? new THREE.MeshBasicMaterial({ color: b.floor, transparent: true, opacity: 0.0 }) : new THREE.ShadowMaterial({ opacity: bg === 'dark' ? 0.5 : 0.22 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = '__floor';
  group.add(floor);
  let grid: THREE.GridHelper | null = null;
  if (b.grid || technical) {
    grid = new THREE.GridHelper(size * 8, 40, 0x6b7280, bg === 'white' || bg === 'studio' ? 0xb8bcc2 : 0x3b4047);
    (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.6;
    group.add(grid);
  }
  scene.add(group);
  return {
    group, key, floor, grid,
    dispose() { scene.remove(group); env.dispose(); pmrem.dispose(); },
  };
}

/** 바닥을 모델 아래(최저점)로 맞춤 */
export function placeFloor(stage: Stage, minY: number) {
  stage.floor.position.y = minY - 0.001;
  if (stage.grid) stage.grid.position.y = minY;
}
