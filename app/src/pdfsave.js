// 편집 내용을 pdf-lib 으로 PDF 에 써넣는다.
import { PDFDocument, rgb, degrees, LineCapStyle, BlendMode, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** state.pages 순서대로 편집을 적용한 PDF 바이트를 만든다. */
export async function exportPdf(state, measures, labelFor, fontBytes, pickIdx) {
  const out = await PDFDocument.load(state.docs[0].bytes, { ignoreEncryption: true });
  out.registerFontkit(fontkit);
  // 글꼴은 미리 KS X 1001 한글만 남겨 줄인 것을 통째로 넣는다(fontkit 의 부분 포함이 한글 글꼴에서 깨짐).
  const font = await out.embedFont(fontBytes, { subset: false });

  // 양식 값
  const names = Object.keys(state.formValues);
  if (names.length) {
    const form = out.getForm();
    for (const name of names) {
      const v = state.formValues[name];
      try {
        const f = form.getField(name);
        if (f instanceof PDFTextField) f.setText(String(v));
        else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck(); }
        else if (f instanceof PDFRadioGroup) f.select(String(v));
        else if (f instanceof PDFDropdown || f instanceof PDFOptionList) f.select(String(v));
      } catch (e) { console.warn('양식 칸', name, e.message); }
    }
    try { form.updateFieldAppearances(font); } catch (e) { console.warn(e); }
  }

  // 다른 PDF 에서 온 쪽은 끝에 복사해 둔다(쪽 번호 매핑)
  const srcDocs = [];
  const outIndex = new Map(); // state.page → out 의 쪽 번호
  const origCount = out.getPageCount();
  const pages = pickIdx ? pickIdx.map((i) => state.pages[i]) : state.pages;
  for (const pg of pages) {
    if (pg.doc === 0) { outIndex.set(pg, pg.idx); continue; }
    if (!srcDocs[pg.doc]) srcDocs[pg.doc] = await PDFDocument.load(state.docs[pg.doc].bytes, { ignoreEncryption: true });
    const [cp] = await out.copyPages(srcDocs[pg.doc], [pg.idx]);
    out.addPage(cp);
    outIndex.set(pg, out.getPageCount() - 1);
  }

  // 편집 그리기
  for (const pg of pages) {
    const p = out.getPage(outIndex.get(pg));
    const vp = pg.page.getViewport({ scale: 1, rotation: (pg.baseRot + pg.rot) % 360 });
    const P = (x, y) => { const [X, Y] = vp.convertToPdfPoint(x, y); return { x: X, y: Y }; };
    const rot = degrees(vp.rotation);
    for (const ed of pg.edits) { try { await drawEdit(p, ed, P, rot, font, out); } catch (e) { console.warn("편집 쓰기 실패", ed.type, e.message); } }
    for (const m of measures) {
      if (m.key !== pg || m.pts.length < 2) continue;
      const pts = m.pts.map((q) => P(q.x, q.y));
      const path = pts.map((q, i) => `${i ? 'L' : 'M'}${q.x} ${-q.y}`).join(' ') + (m.kind === 'area' ? ' Z' : '');
      p.drawSvgPath(path, { x: 0, y: 0, borderColor: rgb(0.9, 0.1, 0.1), borderWidth: 0.8 });
      const a = pts[pts.length - 1];
      p.drawText(labelFor(m), { x: a.x + 2, y: a.y + 2, size: 8, font, color: rgb(0.9, 0.1, 0.1), rotate: rot });
    }
  }

  // 회전
  for (const pg of pages) {
    const p = out.getPage(outIndex.get(pg));
    p.setRotation(degrees((pg.baseRot + pg.rot) % 360));
  }

  // 쪽 순서·삭제가 없으면 그대로(양식 유지)
  const unchanged = !pickIdx && pages.length === origCount && pages.every((pg, i) => pg.doc === 0 && pg.idx === i);
  if (unchanged) return out.save();
  // 순서가 바뀌었으면 새 문서에 순서대로 복사한다(양식은 글자로 굳힌다)
  if (names.length) { try { out.getForm().flatten(); } catch (e) { console.warn(e); } }
  const final = await PDFDocument.create();
  const copied = await final.copyPages(out, pages.map((pg) => outIndex.get(pg)));
  for (const c of copied) final.addPage(c);
  return final.save();
}

/** 고른 쪽(state.pages 의 인덱스 목록)만 담은 PDF */
export function extractPages(state, idx, fontBytes) {
  return exportPdf(state, [], () => '', fontBytes, idx);
}

function drawEdit(p, ed, P, rot, font, doc) {
  const color = ed.color ? hex(ed.color) : rgb(0, 0, 0);
  switch (ed.type) {
    case 'ink': case 'highlight': {
      const path = ed.pts.map((q, i) => { const r = P(q.x, q.y); return `${i ? 'L' : 'M'}${r.x} ${-r.y}`; }).join(' ');
      p.drawSvgPath(path, { x: 0, y: 0, borderColor: color, borderWidth: ed.width, borderLineCap: LineCapStyle.Round,
        borderOpacity: ed.type === 'highlight' ? 0.45 : 1, blendMode: ed.type === 'highlight' ? BlendMode.Multiply : undefined });
      return;
    }
    case 'text': {
      const lines = ed.text.split('\n');
      lines.forEach((line, i) => {
        const r = P(ed.x, ed.y + ed.size * 0.88 + i * ed.size * 1.2);
        p.drawText(line, { x: r.x, y: r.y, size: ed.size, font, color, rotate: rot });
      });
      return;
    }
    case 'rect': case 'ellipse': {
      const a = P(ed.x1, ed.y1), b = P(ed.x2, ed.y2);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      if (ed.type === 'rect') p.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: ed.width });
      else p.drawEllipse({ x: x + w / 2, y: y + h / 2, xScale: w / 2, yScale: h / 2, borderColor: color, borderWidth: ed.width });
      return;
    }
    case 'line': case 'arrow': {
      const a = P(ed.x1, ed.y1), b = P(ed.x2, ed.y2);
      p.drawLine({ start: a, end: b, thickness: ed.width, color, lineCap: LineCapStyle.Round });
      if (ed.type === 'arrow') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 4 + ed.width * 3;
        const h1 = { x: b.x - L * Math.cos(ang - 0.45), y: b.y - L * Math.sin(ang - 0.45) };
        const h2 = { x: b.x - L * Math.cos(ang + 0.45), y: b.y - L * Math.sin(ang + 0.45) };
        p.drawSvgPath(`M${b.x} ${-b.y} L${h1.x} ${-h1.y} L${h2.x} ${-h2.y} Z`, { x: 0, y: 0, color, borderColor: color, borderWidth: 1 });
      }
      return;
    }
    case 'image': {
      return (ed.mime === 'image/png' ? doc.embedPng(ed.bytes) : doc.embedJpg(ed.bytes)).then((img) => {
        const o = P(ed.x, ed.y + ed.h);
        p.drawImage(img, { x: o.x, y: o.y, width: ed.w, height: ed.h, rotate: rot });
      });
    }
    case 'textfix': {
      const a = P(ed.x - 1, ed.y - 1), b = P(ed.x + ed.w + 1, ed.y + ed.h + 1);
      p.drawRectangle({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), color: rgb(1, 1, 1) });
      const r = P(ed.x, ed.y + ed.h * 0.82);
      p.drawText(ed.text, { x: r.x, y: r.y, size: ed.h * 0.95, font, color, rotate: rot });
      return;
    }
  }
}
