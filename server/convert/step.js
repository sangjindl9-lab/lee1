// STEP/IGES → (Open CASCADE, occt-import-js WASM) → B-Rep 테셀레이션 → GLB
// 원본 B-Rep 는 원본 파일로 보존되고, 여기서는 조립 계층·부품명·색상을 그대로 옮긴다.
import occtInit from 'occt-import-js';
import { writeGlb, summarize } from './gltf-writer.js';

let occtP;
const occt = () => (occtP ||= occtInit());

// OCCT 가 UTF-8 이름을 Latin-1 로 넘기는 경우 복원
function fixName(s) {
  if (!s) return s;
  if (/[À-ÿ][\u0080-¿]/.test(s)) {
    const b = Buffer.from(s, 'latin1').toString('utf8');
    if (!b.includes('�')) return b;
  }
  return s;
}

export async function convertStep(buf, ext) {
  const o = await occt();
  const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0008, angularDeflection: 0.35 };
  const isIges = ext === 'iges' || ext === 'igs';
  const r = isIges ? o.ReadIgesFile(new Uint8Array(buf), params) : o.ReadStepFile(new Uint8Array(buf), params);
  if (!r.success) throw new Error(`${isIges ? 'IGES' : 'STEP'} 파일을 읽지 못했습니다 (손상되었거나 지원하지 않는 스키마)`);

  const toTree = (n) => ({
    name: fixName(n.name),
    meshes: n.meshes.map((i) => {
      const m = r.meshes[i];
      return {
        positions: new Float32Array(m.attributes.position.array),
        normals: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : undefined,
        indices: new Uint32Array(m.index.array),
        color: m.color || undefined, metallic: 0.55, roughness: 0.4,
        brepFaces: m.brep_faces?.length || 0,
      };
    }),
    extras: n.meshes.length ? { brepFaces: n.meshes.reduce((s, i) => s + (r.meshes[i].brep_faces?.length || 0), 0) } : undefined,
    children: n.children.map(toTree),
  });
  const tree = toTree(r.root);
  // 최상위가 이름 없는 래퍼 하나뿐이면 펼친다
  const root = (!tree.name && tree.children.length === 1 && !tree.meshes.length) ? tree.children[0] : tree;
  const { glb, parts } = await writeGlb({ name: root.name || '조립체', children: root.children, meshes: root.meshes }, { unit: 'mm' });
  const depth = (n) => 1 + Math.max(0, ...n.children.map(depth));
  return {
    glb, parts,
    method: 'step-brep-tessellation',
    stats: { ...summarize(parts), upAxis: 'Z', assemblyDepth: depth(root), unit: 'mm' },
    provenance: { geometry: 'source', note: '원본 3D CAD(B-Rep)를 테셀레이션한 형상입니다. AI 재생성 없음.' },
    analysis: {
      format: isIges ? 'IGES' : 'STEP', is3D: true, unit: 'mm (원본 단위에서 변환)', coordinateSystem: '원본 좌표계 유지',
      assemblyName: root.name, partCount: parts.length, hierarchyDepth: depth(root), convertible: true,
    },
  };
}
