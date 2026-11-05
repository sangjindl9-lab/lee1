// STL(바이너리/ASCII) → 단일 메시 GLB. 부품 구조가 없으므로 1개 부품으로 처리.
import { writeGlb, summarize } from './gltf-writer.js';

export function parseStl(buf) {
  const isBinary = buf.length >= 84 && 84 + buf.readUInt32LE(80) * 50 === buf.length;
  let pos, nor;
  if (isBinary) {
    const n = buf.readUInt32LE(80);
    pos = new Float32Array(n * 9); nor = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50;
      for (let v = 0; v < 3; v++) {
        for (let k = 0; k < 3; k++) {
          pos[i * 9 + v * 3 + k] = buf.readFloatLE(o + 12 + v * 12 + k * 4);
          nor[i * 9 + v * 3 + k] = buf.readFloatLE(o + k * 4);
        }
      }
    }
  } else {
    const txt = buf.toString('utf8');
    if (!/^\s*solid/.test(txt)) throw new Error('STL 형식이 아닙니다');
    const vs = [...txt.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
    const ns = [...txt.matchAll(/facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [+m[1], +m[2], +m[3]]);
    if (!vs.length || vs.length % 3) throw new Error('STL 삼각형 데이터를 읽지 못했습니다');
    pos = Float32Array.from(vs.flat());
    nor = Float32Array.from(ns.flatMap((n) => [...n, ...n, ...n]));
  }
  // 법선이 비어 있으면 면 법선 계산
  for (let t = 0; t < pos.length; t += 9) {
    if (nor[t] || nor[t + 1] || nor[t + 2]) continue;
    const ux = pos[t + 3] - pos[t], uy = pos[t + 4] - pos[t + 1], uz = pos[t + 5] - pos[t + 2];
    const vx = pos[t + 6] - pos[t], vy = pos[t + 7] - pos[t + 1], vz = pos[t + 8] - pos[t + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let v = 0; v < 3; v++) { nor[t + v * 3] = nx; nor[t + v * 3 + 1] = ny; nor[t + v * 3 + 2] = nz; }
  }
  return { positions: pos, normals: nor };
}

export async function convertStl(buf, name) {
  const m = parseStl(buf);
  const { glb, parts } = await writeGlb({ name, children: [{ name, meshes: [{ ...m, color: [0.6, 0.62, 0.65] }], children: [] }] }, { unit: 'mm' });
  return {
    glb, parts, method: 'stl-mesh',
    stats: { ...summarize(parts), upAxis: 'Z', unit: 'mm(가정)' },
    provenance: { geometry: 'source', note: 'STL 은 단위·부품 구조 정보가 없습니다. 단위는 mm 로 가정했고 부품 자동 분리는 되지 않습니다.' },
    analysis: { format: 'STL', is3D: true, unit: '미지정 (mm 가정)', partCount: 1, hasAssembly: false, convertible: true,
      warnings: ['단일 메시 — 분해도를 위해서는 부품 분할이 필요합니다(수동/AI 보조 분할은 2단계 이후).'] },
  };
}
