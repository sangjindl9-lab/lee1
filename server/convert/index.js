import { convertStep } from './step.js';
import { convertStl } from './stl.js';
import { convertGlb } from './glb.js';
import { analyzeDxf } from './dxf.js';
import { analyzeDwg } from './dwg.js';
import { analyzePdf } from './pdf.js';

export const EXTS = ['step', 'stp', 'iges', 'igs', 'stl', 'glb', 'dxf', 'dwg', 'pdf'];
export const DRAWING_EXTS = ['dxf', 'dwg', 'pdf'];

/** 확장자·내용 서명 검사 (악성/위장 파일 차단). 통과 못 하면 오류 메시지 반환 */
export function sniff(ext, head) {
  const s = head.toString('latin1');
  const ok = {
    step: () => /ISO-10303-21/.test(s), stp: () => /ISO-10303-21/.test(s),
    iges: () => /^.{72}S/m.test(s), igs: () => /^.{72}S/m.test(s),
    stl: () => /^\s*solid/.test(s) || head.length >= 84,
    glb: () => s.startsWith('glTF'),
    dwg: () => /^AC10\d\d/.test(s),
    pdf: () => s.startsWith('%PDF-'),
    dxf: () => /^\s*0\s*\r?\n\s*SECTION/.test(s) || /SECTION/.test(s.slice(0, 2048)),
  }[ext];
  if (!ok) return `지원하지 않는 형식입니다 (${ext}). MVP 지원: ${EXTS.join(', ').toUpperCase()}`;
  if (!ok()) return `파일 내용이 ${ext.toUpperCase()} 형식이 아닙니다 (확장자 위장 또는 손상)`;
  return null;
}

export async function convertFile({ ext, buf, name, path }) {
  switch (ext) {
    case 'step': case 'stp': case 'iges': case 'igs': return convertStep(buf, ext);
    case 'stl': return convertStl(buf, name);
    case 'glb': return convertGlb(buf);
    case 'dxf': return { analysisOnly: true, analysis: analyzeDxf(buf) };
    case 'dwg': return { analysisOnly: true, analysis: await analyzeDwg(path) };
    case 'pdf': { const r = await analyzePdf(path); return { analysisOnly: true, analysis: r.analysis, preview: r.preview }; }
    default: throw new Error('지원하지 않는 형식');
  }
}
