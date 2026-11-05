import { convertStep } from './step.js';
import { convertStl } from './stl.js';
import { convertGlb } from './glb.js';
import { analyzeDxf } from './dxf.js';
import { analyzeDwg } from './dwg.js';
import { analyzePdf } from './pdf.js';
import { analyzeRaster } from './raster.js';
import { autoDraft } from './autodraft.js';

export const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'tif', 'tiff'];
export const EXTS = ['step', 'stp', 'iges', 'igs', 'stl', 'glb', 'dxf', 'dwg', 'pdf', ...IMAGE_EXTS];
export const DRAWING_EXTS = ['dxf', 'dwg', 'pdf', ...IMAGE_EXTS];

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
    jpg: () => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff, jpeg: () => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
    png: () => s.startsWith('\x89PNG\r\n'),
    tif: () => s.startsWith('II*\0') || s.startsWith('MM\0*'), tiff: () => s.startsWith('II*\0') || s.startsWith('MM\0*'),
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
    case 'dxf': { const a = analyzeDxf(buf); return drawing({ analysis: a, preview: a._preview }, name); }
    case 'dwg': { const a = await analyzeDwg(path); return drawing({ analysis: a, preview: a._preview }, name); }
    case 'pdf': return drawing(await analyzePdf(path), name);
    case 'jpg': case 'jpeg': case 'png': case 'tif': case 'tiff': return drawing(await analyzeRaster(path, 'image'), name);
    default: throw new Error('지원하지 않는 형식');
  }
}

/** 2D 도면: 분석 결과 + 자동 3D 초안(가능하면). 초안 실패는 분석 결과를 막지 않는다 */
async function drawing({ analysis, preview }, name) {
  const out = { analysisOnly: true, analysis, preview };
  if (process.env.AUTO_DRAFT === 'false') return out;
  try {
    const d = await autoDraft(analysis, name);
    if (d.skipped) analysis.autoDraft = { status: 'skipped', reason: d.skipped };
    else {
      analysis.autoDraft = { status: 'created', ...d.draft };
      out.draft = d.result;
      out.glb = d.result.glb;
    }
  } catch (e) { analysis.autoDraft = { status: 'failed', reason: e.message }; }
  return out;
}
