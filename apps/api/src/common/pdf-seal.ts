/**
 * PDF 도장 찍기 — 결재란 개인 도장, 문서 끝 회사 직인·대표자 도장
 * 등록된 이미지가 없으면 지금처럼 이름으로 만든 붉은 원 도장을 그린다.
 */
type Doc = PDFKit.PDFDocument;
const SEAL = '#C42B1C';
const INK = '#17202B';

export interface PdfSeals {
  company: Buffer | null;
  ceo: Buffer | null;
  stamps: Map<string, Buffer>;
}
export const NO_SEALS: PdfSeals = { company: null, ceo: null, stamps: new Map() };

function safeImage(doc: Doc, img: Buffer, x: number, y: number, w: number, h: number) {
  try {
    doc.image(img, x, y, { fit: [w, h], align: 'center', valign: 'center' });
    return true;
  } catch {
    return false; // 깨진 이미지면 이름 도장으로 대신
  }
}

/** 결재란 한 칸의 도장 (cx, cy = 칸 안 도장 중심) */
export function drawStepStamp(doc: Doc, cx: number, cy: number, name: string, date: string, opts: { rejected?: boolean; image?: Buffer | null; r?: number }) {
  const r = opts.r ?? 21;
  if (opts.image) {
    doc.save();
    const ok = safeImage(doc, opts.image, cx - r, cy - r - 3, r * 2, r * 2 - 4);
    doc.restore();
    if (ok) {
      doc.fillColor(SEAL).font('M').fontSize(6.5).text(date, cx - r, cy + r - 6, { width: r * 2, align: 'center', lineBreak: false });
      if (opts.rejected) doc.save().lineWidth(1.4).strokeColor(SEAL).moveTo(cx - r + 4, cy + r - 8).lineTo(cx + r - 4, cy - r + 4).stroke().restore();
      return;
    }
  }
  doc.save();
  doc.translate(cx, cy).rotate(-8);
  doc.lineWidth(1.6).strokeColor(SEAL).circle(0, 0, r).stroke();
  doc.lineWidth(0.6).circle(0, 0, r - 3).stroke();
  doc.fillColor(SEAL).font('B').fontSize(name.length > 3 ? 8 : r >= 21 ? 10 : 9.5).text(name, -(r - 3), -8, { width: (r - 3) * 2, align: 'center', lineBreak: false });
  doc.font('M').fontSize(6.5).text(date, -(r - 3), 4, { width: (r - 3) * 2, align: 'center', lineBreak: false });
  if (opts.rejected) doc.lineWidth(1.4).moveTo(-(r - 4), r - 8).lineTo(r - 4, -(r - 8)).stroke();
  doc.restore();
}

/**
 * 문서 끝 "회사명 / 대표이사 ○○○ (인)" — 결재가 끝난 문서에만 직인·대표자 도장을 찍는다.
 * 돌려주는 값은 다음 줄 y.
 */
export function drawSignature(doc: Doc, L: number, W: number, y: number, co: { name: string; ceoName: string | null }, seals: PdfSeals, stamp: boolean) {
  doc.fillColor(INK).font('B').fontSize(11);
  const nameW = doc.widthOfString(co.name);
  doc.text(co.name, L, y, { width: W, align: 'center' });
  const line = `대표이사  ${co.ceoName ?? ''}   (인)`;
  doc.font('R').fontSize(9.5);
  const lineW = doc.widthOfString(line);
  const inW = doc.widthOfString('(인)');
  doc.text(line, L, y + 16, { width: W, align: 'center' });
  if (stamp) {
    if (seals.ceo) {
      const cx = L + W / 2 + lineW / 2 - inW / 2;
      safeImage(doc, seals.ceo, cx - 17, y + 16 + 6 - 17, 34, 34);
    }
    if (seals.company) {
      // 회사명·대표이사 두 줄 오른쪽에 직인
      const x = L + W / 2 + Math.max(nameW, lineW) / 2 + 8;
      safeImage(doc, seals.company, x, y - 8, 46, 46);
    }
  }
  return y + 34;
}
