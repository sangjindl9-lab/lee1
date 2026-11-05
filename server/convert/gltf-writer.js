// 메시 트리 → GLB. 메시를 가진 노드마다 고유 partId 를 extras 로 기록하고
// 부품별 경계상자·중심·체적(mm³)을 계산해 부품 트리로 반환한다.
import { Document, NodeIO } from '@gltf-transform/core';

/**
 * @param {{name:string, children:any[], meshes:{name?:string,positions:Float32Array,normals?:Float32Array,indices?:Uint32Array,color?:number[],metallic?:number,roughness?:number,opacity?:number}[], extras?:object}} root
 * @param {{ unit?: string, generator?: string }} opt
 */
export async function writeGlb(root, opt = {}) {
  const doc = new Document();
  doc.createBuffer();
  const scene = doc.createScene('scene');
  const parts = [];
  const usedNames = new Map();
  const mats = new Map();
  let seq = 0;

  const material = (m) => {
    const c = m.color || [0.7, 0.7, 0.72];
    const key = [...c, m.metallic ?? 0.5, m.roughness ?? 0.45, m.opacity ?? 1].map((v) => v.toFixed(3)).join(',');
    if (!mats.has(key)) {
      const mat = doc.createMaterial(`mat_${mats.size}`)
        .setBaseColorFactor([c[0], c[1], c[2], m.opacity ?? 1])
        .setMetallicFactor(m.metallic ?? 0.5).setRoughnessFactor(m.roughness ?? 0.45).setDoubleSided(true);
      if ((m.opacity ?? 1) < 1) mat.setAlphaMode('BLEND');
      mats.set(key, mat);
    }
    return mats.get(key);
  };

  const uniqueName = (n) => {
    const base = (n || '부품').trim() || '부품';
    const k = usedNames.get(base) || 0;
    usedNames.set(base, k + 1);
    return k === 0 ? base : `${base} (${k + 1})`;
  };

  const build = (src, parentNode, parentPartId) => {
    const isPart = src.meshes?.length > 0;
    const name = isPart ? uniqueName(src.name) : (src.name || '조립체');
    const node = doc.createNode(name);
    parentNode.addChild(node);
    let myId = parentPartId;
    if (isPart) {
      myId = `P${String(++seq).padStart(4, '0')}`;
      const mesh = doc.createMesh(name);
      const st = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], vol: 0, tris: 0 };
      for (const m of src.meshes) {
        const prim = doc.createPrimitive()
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(m.positions))
          .setMaterial(material(m));
        if (m.normals) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(m.normals));
        const idx = m.indices || Uint32Array.from({ length: m.positions.length / 3 }, (_, i) => i);
        prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx));
        mesh.addPrimitive(prim);
        accumulate(st, m.positions, idx);
      }
      node.setMesh(mesh).setExtras({ partId: myId, ...(src.extras || {}) });
      const center = st.min.map((v, i) => (v + st.max[i]) / 2);
      parts.push({
        id: myId, name, parentId: parentPartId || null,
        bbox: { min: round(st.min), max: round(st.max) }, center: round(center),
        volume: Math.round(Math.abs(st.vol)), triangles: st.tris, ...(src.extras ? { extras: src.extras } : {}),
      });
    } else {
      node.setExtras({ group: true, ...(src.extras || {}) });
    }
    for (const ch of src.children || []) build(ch, node, isPart ? myId : parentPartId);
    return node;
  };

  const top = doc.createNode(root.name || 'root').setExtras({ unit: opt.unit || 'mm' });
  scene.addChild(top);
  for (const ch of root.children || []) build(ch, top, null);
  if (root.meshes?.length) build({ ...root, children: [] }, top, null);
  doc.getRoot().getAsset().generator = opt.generator || 'EUM 3D STUDIO PRO';
  const glb = await new NodeIO().writeBinary(doc);
  return { glb, parts };
}

function accumulate(st, p, idx) {
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < st.min[k]) st.min[k] = v; if (v > st.max[k]) st.max[k] = v; }
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    st.vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1])
      - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c])
      + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  st.tris += idx.length / 3;
}
const round = (a) => a.map((v) => Math.round(v * 1000) / 1000);

export function summarize(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.bbox.min[k]); max[k] = Math.max(max[k], p.bbox.max[k]); }
  return {
    partCount: parts.length,
    triangles: parts.reduce((s, p) => s + p.triangles, 0),
    bbox: { min: round(min), max: round(max) },
    size: round(max.map((v, i) => v - min[i])),
  };
}
