// GLB 로드 → partId 별 노드 매핑 → 장면 설정(분해·색상·투명도·숨김)을 적용
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { partOffset } from '@shared/scene.js';

export interface PartRef {
  id: string; name: string; node: THREE.Object3D; base: THREE.Vector3;
  toLocal: THREE.Matrix3; meshes: THREE.Mesh[];
  materials: { mat: THREE.MeshStandardMaterial; color: THREE.Color; opacity: number; transparent: boolean }[];
}
export interface LoadedModel { root: THREE.Group; content: THREE.Object3D; parts: Map<string, PartRef>; box: THREE.Box3; size: number }

export async function loadModel(url: string, opts: { zUp: boolean; headers?: Record<string, string> }): Promise<LoadedModel> {
  const loader = new GLTFLoader();
  if (opts.headers) loader.setRequestHeader(opts.headers);
  const gltf = await loader.loadAsync(url);
  const content = gltf.scene;
  const root = new THREE.Group();
  root.name = '__model';
  if (opts.zUp) content.rotation.x = -Math.PI / 2; // CAD(Z-up) → 뷰어(Y-up)
  root.add(content);
  root.updateMatrixWorld(true);

  const parts = new Map<string, PartRef>();
  content.traverse((o) => {
    const pid = o.userData?.partId as string | undefined;
    if (!pid || parts.has(pid)) return;
    const meshes: THREE.Mesh[] = [];
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh && (c === o || !c.userData?.partId)) meshes.push(c as THREE.Mesh); });
    const materials: PartRef['materials'] = [];
    for (const m of meshes) {
      m.castShadow = true; m.receiveShadow = true;
      m.userData.partId = pid;
      const src = m.material as THREE.MeshStandardMaterial;
      const mat = src.clone(); // 부품별 재질 변경을 위해 복제
      mat.side = THREE.DoubleSide;
      m.material = mat;
      materials.push({ mat, color: mat.color.clone(), opacity: mat.opacity, transparent: mat.transparent });
    }
    // 모델 좌표(content 기준) 방향벡터를 부모 로컬 좌표로 바꾸는 행렬
    const parentToContent = new THREE.Matrix4().copy(content.matrixWorld).invert().multiply(o.parent!.matrixWorld);
    const toLocal = new THREE.Matrix3().setFromMatrix4(parentToContent.invert());
    parts.set(pid, { id: pid, name: o.name, node: o, base: o.position.clone(), toLocal, meshes, materials });
  });
  const box = new THREE.Box3().setFromObject(root);
  const size = Math.max(...box.getSize(new THREE.Vector3()).toArray()) || 1;
  return { root, content, parts, box, size };
}

export interface ViewState { selected?: string | null; hover?: string | null; xray?: boolean; wireframe?: boolean; isolate?: string | null }
const HILITE = new THREE.Color('#f59e0b');
const tmp = new THREE.Vector3();

/** 장면 데이터 + 분해 진행값 e 를 모델에 적용 */
export function applyScene(model: LoadedModel, scene: any, e: number, view: ViewState = {}) {
  const factor = scene?.explode?.factor ?? 1;
  for (const p of model.parts.values()) {
    const cfg = scene?.parts?.[p.id] || {};
    const off = partOffset(cfg, e, factor);
    tmp.set(off[0], off[1], off[2]).applyMatrix3(p.toLocal);
    p.node.position.copy(p.base).add(tmp);
    const hidden = !!cfg.hidden || (view.isolate ? view.isolate !== p.id : false);
    p.node.visible = !hidden;
    const sel = view.selected === p.id, hov = view.hover === p.id;
    for (const m of p.materials) {
      m.mat.color.copy(cfg.color ? new THREE.Color(cfg.color) : m.color);
      let op = cfg.opacity ?? m.opacity;
      if (view.xray && !sel) op = Math.min(op, 0.18);
      m.mat.opacity = op;
      m.mat.transparent = op < 1 || m.transparent;
      m.mat.depthWrite = op >= 0.99;
      m.mat.wireframe = !!view.wireframe;
      m.mat.emissive.copy(sel ? HILITE : hov ? HILITE : new THREE.Color(0));
      m.mat.emissiveIntensity = sel ? 0.45 : hov ? 0.18 : 0;
      if (cfg.metalness != null) m.mat.metalness = cfg.metalness;
      if (cfg.roughness != null) m.mat.roughness = cfg.roughness;
    }
  }
}

export function partIdOf(o: THREE.Object3D | null): string | null {
  while (o) { if (o.userData?.partId) return o.userData.partId; o = o.parent; }
  return null;
}

export const VIEWS: Record<string, [number, number, number]> = {
  iso: [1, 0.8, 1.2], front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001],
};

/** 카메라를 모델 전체가 보이도록 배치 */
export function fitCamera(cam: THREE.PerspectiveCamera | THREE.OrthographicCamera, box: THREE.Box3, dir: [number, number, number], margin = 1.25) {
  const c = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius * margin;
  const d = new THREE.Vector3(...dir).normalize();
  if ((cam as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const pc = cam as THREE.PerspectiveCamera;
    const fov = (pc.fov * Math.PI) / 180;
    const dist = r / Math.sin(Math.min(fov, fov * pc.aspect) / 2);
    pc.position.copy(c).addScaledVector(d, dist);
    pc.near = dist / 100; pc.far = dist * 100;
  } else {
    const oc = cam as THREE.OrthographicCamera;
    oc.position.copy(c).addScaledVector(d, r * 4);
    const aspect = (oc.right - oc.left) / (oc.top - oc.bottom) || 1;
    oc.zoom = 1;
    oc.top = r; oc.bottom = -r; oc.left = -r * aspect; oc.right = r * aspect;
    oc.near = 0.01; oc.far = r * 20;
  }
  cam.up.set(0, 1, 0);
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  return c;
}

/** 분해 상태까지 포함한 경계상자 (최대 분해 시) */
export function explodedBox(model: LoadedModel, scene: any, steps: number) {
  applyScene(model, scene, steps);
  model.root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(model.root);
  applyScene(model, scene, 0);
  return b;
}
