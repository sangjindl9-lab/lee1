import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, OrthographicCamera, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { loadModel, applyScene, partIdOf, fitCamera, explodedBox, VIEWS, type LoadedModel } from '../engine/model';
import { setupStage, placeFloor, type Background } from '../engine/stage';
import { useWS, steps } from '../store';

/** 외부(UI)에서 카메라 상태를 읽기 위한 연결 */
export const viewerBridge: { camera?: THREE.Camera; target?: THREE.Vector3; gl?: THREE.WebGLRenderer; scene?: THREE.Scene } = {};

export default function Viewer({ url, zUp, headers, interactive = true, gizmo = true, onLoaded }:
  { url: string; zUp: boolean; headers?: Record<string, string>; interactive?: boolean; gizmo?: boolean; onLoaded?: (m: LoadedModel) => void }) {
  const [model, setModel] = useState<LoadedModel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ortho = useWS((s) => s.ortho);
  useEffect(() => {
    let dead = false;
    setModel(null); setErr(null);
    loadModel(url, { zUp, headers }).then((m) => { if (!dead) { setModel(m); onLoaded?.(m); } }).catch((e) => !dead && setErr(String(e.message || e)));
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, zUp]);
  return (
    <div className="relative h-full w-full" data-testid="viewer">
      <Canvas shadows gl={{ antialias: true, preserveDrawingBuffer: true, localClippingEnabled: true } as any} dpr={[1, 2]}
        onPointerMissed={() => interactive && useWS.getState().set({ selected: null })}>
        {ortho ? <OrthographicCamera makeDefault position={[1, 1, 1]} /> : <PerspectiveCamera makeDefault fov={35} position={[1, 1, 1]} />}
        {model && <Scene3D model={model} interactive={interactive} />}
        {gizmo && <GizmoHelper alignment="bottom-right" margin={[64, 64]}><GizmoViewport labelColor="white" axisHeadScale={0.9} /></GizmoHelper>}
      </Canvas>
      {!model && !err && <div className="absolute inset-0 grid place-items-center text-sm text-mute"><div className="flex items-center gap-2"><span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />3D 모델 불러오는 중…</div></div>}
      {err && <div className="absolute inset-0 grid place-items-center text-sm text-bad">모델을 불러오지 못했습니다: {err}</div>}
    </div>
  );
}

function Scene3D({ model, interactive }: { model: LoadedModel; interactive: boolean }) {
  const { gl, scene, camera, size } = useThree();
  const controls = useRef<any>(null);
  const scn = useWS((s) => s.scene);
  const bg = (scn?.background || 'studio') as Background;
  const technical = scn?.viewMode === 'technical';
  const autoRotate = useWS((s) => s.autoRotate);
  const viewCmd = useWS((s) => s.viewCmd);
  const section = useWS((s) => s.section);
  const ortho = useWS((s) => s.ortho);
  const lastAz = useRef(0);

  // 조명·바닥
  useEffect(() => {
    const st = setupStage(scene, gl, bg, model.size, technical);
    placeFloor(st, model.box.min.y);
    return () => st.dispose();
  }, [bg, technical, model, scene, gl]);

  const fullBox = useMemo(() => explodedBox(model, useWS.getState().scene, steps(useWS.getState().scene)), [model]);

  // 처음 로드·시점 명령·투영 전환 시 카메라 맞춤
  useEffect(() => {
    const s = useWS.getState().scene;
    const cam = camera as THREE.PerspectiveCamera;
    if (viewCmd.n === 0 && s?.camera?.position && !ortho) {
      cam.position.fromArray(s.camera.position);
      const t = new THREE.Vector3().fromArray(s.camera.target);
      cam.lookAt(t); controls.current?.target.copy(t);
      const d = cam.position.distanceTo(t); cam.near = d / 100; cam.far = d * 100; cam.updateProjectionMatrix();
    } else {
      const c = fitCamera(camera as any, viewCmd.view === 'iso' ? fullBox : model.box, VIEWS[viewCmd.view] || VIEWS.iso);
      controls.current?.target.copy(c);
    }
    controls.current?.update();
    lastAz.current = 0;
  }, [viewCmd, model, camera, fullBox, ortho, size.width, size.height]);

  // 단면
  useEffect(() => {
    if (!section.on) { gl.clippingPlanes = []; return; }
    const ax = { x: 0, y: 1, z: 2 }[section.axis];
    const b = model.box;
    const pos = THREE.MathUtils.lerp(b.min.getComponent(ax), b.max.getComponent(ax), section.pos);
    const n = new THREE.Vector3(); n.setComponent(ax, section.flip ? 1 : -1);
    gl.clippingPlanes = [new THREE.Plane(n, section.flip ? -pos : pos)];
  }, [section, gl, model]);

  useEffect(() => { viewerBridge.camera = camera; viewerBridge.gl = gl; viewerBridge.scene = scene; }, [camera, gl, scene]);

  useFrame((_, dt) => {
    const st = useWS.getState();
    if (st.playing && st.scene) {
      const T = st.scene.animation.clips.reduce((a: number, c: any) => a + (+c.duration || 0), 0);
      let t = st.t + dt;
      if (t >= T) { t = T; st.set({ playing: false }); }
      st.set({ t, mode: 'timeline' });
    }
    const cur = st.current();
    applyScene(model, st.scene, cur.e, { selected: st.selected, hover: st.hover, xray: st.xray, wireframe: st.wireframe, isolate: st.isolate });
    // 타임라인 회전(턴테이블)을 카메라에 반영
    const dAz = cur.azimuth - lastAz.current;
    if (Math.abs(dAz) > 1e-6 && controls.current) {
      const tgt = controls.current.target as THREE.Vector3;
      camera.position.sub(tgt).applyAxisAngle(new THREE.Vector3(0, 1, 0), (dAz * Math.PI) / 180).add(tgt);
      camera.lookAt(tgt);
    }
    lastAz.current = cur.azimuth;
    viewerBridge.target = controls.current?.target;
  });

  const pick = (e: any) => partIdOf(e.object);
  return (
    <>
      <primitive object={model.root}
        onClick={interactive ? (e: any) => { e.stopPropagation(); useWS.getState().set({ selected: pick(e) }); } : undefined}
        onPointerMove={interactive ? (e: any) => { e.stopPropagation(); const id = pick(e); if (useWS.getState().hover !== id) useWS.getState().set({ hover: id }); } : undefined}
        onPointerOut={interactive ? () => useWS.getState().set({ hover: null }) : undefined} />
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} autoRotate={autoRotate} autoRotateSpeed={1.2} />
    </>
  );
}
