// GLB 가져오기: 형상은 그대로 두고 메시 노드마다 partId 를 부여, 부품 트리·통계 추출
import { NodeIO } from '@gltf-transform/core';
import { summarize } from './gltf-writer.js';

export async function convertGlb(buf) {
  const io = new NodeIO();
  let doc;
  try { doc = await io.readBinary(new Uint8Array(buf)); } catch (e) { throw new Error('GLB 파일을 읽지 못했습니다: ' + e.message); }
  const parts = [];
  let seq = 0;
  const names = new Map();
  const walk = (node, parentId, M) => {
    const W = mul(M, node.getMatrix());
    let myId = parentId;
    const mesh = node.getMesh();
    if (mesh) {
      myId = `P${String(++seq).padStart(4, '0')}`;
      let nm = node.getName() || mesh.getName() || '부품';
      const k = names.get(nm) || 0; names.set(nm, k + 1); if (k) nm = `${nm} (${k + 1})`;
      node.setName(nm).setExtras({ ...(node.getExtras() || {}), partId: myId });
      const st = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0 };
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute('POSITION'); if (!a) continue;
        const v = [0, 0, 0];
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, v);
          const w = apply(W, v);
          for (let j = 0; j < 3; j++) { st.min[j] = Math.min(st.min[j], w[j]); st.max[j] = Math.max(st.max[j], w[j]); }
        }
        st.tris += (prim.getIndices()?.getCount() ?? a.getCount()) / 3;
      }
      parts.push({ id: myId, name: nm, parentId: parentId || null, bbox: { min: st.min, max: st.max },
        center: st.min.map((x, i) => (x + st.max[i]) / 2), volume: null, triangles: Math.round(st.tris) });
    }
    for (const ch of node.listChildren()) walk(ch, myId, W);
  };
  for (const scene of doc.getRoot().listScenes()) for (const n of scene.listChildren()) walk(n, null, I4);
  if (!parts.length) throw new Error('GLB 에 메시가 없습니다');
  const glb = await io.writeBinary(doc);
  return {
    glb, parts, method: 'glb-import',
    stats: { ...summarize(parts), upAxis: 'Y', unit: '원본 단위' },
    provenance: { geometry: 'source', note: 'GLB 원본 메시·재질 그대로 사용' },
    analysis: { format: 'GLB', is3D: true, unit: 'glTF 표준(m) 또는 원본 단위', partCount: parts.length, convertible: true },
  };
}

const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) { // 열 우선 4x4
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
