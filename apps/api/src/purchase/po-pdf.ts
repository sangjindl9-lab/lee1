/**
 * 발주서 PDF (A4 세로)
 * ┌ 발 주 서 ───────────────────────── [결재 | 담당 | 승인] ┐
 * │ 문서번호·발주일                                        │
 * │ [수신: 공급자]            [발신: 발주자]                 │
 * │ 공사명 · 납품장소 · 납품기한 · 결제조건                   │
 * │ 합계금액 금 ○○원정 (₩…)                               │
 * │ 품목표 (페이지가 넘어가면 머리글 반복)                     │
 * │ 공급가액·세액·합계 / 특기사항 / 발주 문구·회사명           │
 * └ 바닥글: 문서번호 · 출력일시 · 쪽번호 ────────────────────┘
 * 결재가 끝나지 않은 발주서는 "결재 전" 워터마크를 넣어 효력이 없음을 표시한다.
 */
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { D } from '../common/money';
import { drawSignature, drawStepStamp, NO_SEALS, PdfSeals } from '../common/pdf-seal';

const FONT_DIR = [path.join(__dirname, '../../assets/fonts'), path.join(__dirname, '../../../assets/fonts'), path.join(process.cwd(), 'assets/fonts')].find((p) => fs.existsSync(p))!;
const C = { ink: '#17202B', muted: '#5B6573', line: '#9AA3AE', soft: '#EEF1F4', seal: '#C42B1C', steel: '#2B4C6F' };

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const BIG = ['', '만', '억', '조', '경'];
/** 123456789 → 일억이천삼백사십오만육천칠백팔십구 */
export function koreanAmount(n: string): string {
  const s = n.split('.')[0].replace(/^0+/, '');
  if (!s) return '영';
  const groups: string[] = [];
  for (let i = s.length; i > 0; i -= 4) groups.unshift(s.slice(Math.max(0, i - 4), i));
  let out = '';
  groups.forEach((g, gi) => {
    const big = BIG[groups.length - 1 - gi];
    let part = '';
    const p = g.padStart(4, '0');
    for (let k = 0; k < 4; k++) {
      const d = Number(p[k]);
      if (d) part += DIGITS[d] + SMALL[3 - k];
    }
    if (part) out += part + big;
  });
  return out;
}

const won = (v: string | number) => D(v).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const qtyStr = (v: string) => {
  const d = D(v);
  return d.isInteger() ? won(v) : d.toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace(/\B(?=(\d{3})+(?!\d))/, ',');
};
const md = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const k = new Date(new Date(d).getTime() + 9 * 3600000).toISOString();
  return `${k.slice(5, 7)}.${k.slice(8, 10)}`;
};

export interface PoPdfData {
  code: string;
  revision: number;
  status: string;
  title: string;
  orderDate: string;
  deliveryDate: string | null;
  deliveryPlace: string | null;
  paymentTerms: string | null;
  ourContact: string | null;
  ourPhone: string | null;
  vendorContact: string | null;
  memo: string | null;
  supplyAmount: string;
  vatAmount: string;
  totalAmount: string;
  vatRate: string;
  company: { name: string; bizRegNo: string; ceoName: string | null; address: string | null; phone: string | null };
  vendor: { name: string; bizRegNo: string | null; ceoName: string | null; address: string | null; contactName: string | null; contactPhone: string | null; phone: string | null; email: string | null };
  project: { code: string; name: string; siteAddress: string | null };
  lines: { lineNo: number; name: string; spec: string | null; unit: string; qty: string; unitPrice: string; supplyAmount: string; vatAmount: string; taxType: string; memo: string | null }[];
  approval: { steps: { stepNo: number; title: string; state: string; actedByName: string | null; actedAt: Date | null; approverNames: string | null; actedStampId?: string | null }[] } | null;
  printedBy: string;
  seals?: PdfSeals;
}

const bz = (v: string | null) => (v && v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : v ?? '');

export function renderPoPdf(d: PoPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 48, left: 40, right: 40 }, bufferPages: true, info: { Title: `발주서 ${d.code}`, Author: d.company.name, Creator: 'SS-ERP' } });
  doc.registerFont('R', path.join(FONT_DIR, 'Pretendard-Regular.otf'));
  doc.registerFont('M', path.join(FONT_DIR, 'Pretendard-Medium.otf'));
  doc.registerFont('B', path.join(FONT_DIR, 'Pretendard-Bold.otf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const L = 40;
  const W = doc.page.width - 80; // 515
  const approved = ['APPROVED', 'SENT', 'PARTIAL', 'RECEIVED', 'CLOSED'].includes(d.status);

  const seals = d.seals ?? NO_SEALS;
  const steps = d.approval?.steps ?? [
    { stepNo: 0, title: '담당', state: 'WAITING', actedByName: null, actedAt: null, approverNames: null, actedStampId: null },
    { stepNo: 1, title: '승인', state: 'WAITING', actedByName: null, actedAt: null, approverNames: '대표이사', actedStampId: null },
  ];
  const drawApprovalBox = () => {
    const colW = 58;
    const labelW = 16;
    const boxW = labelW + colW * steps.length;
    const x = L + W - boxW;
    const y = 40;
    doc.lineWidth(0.7).strokeColor(C.ink);
    doc.rect(x, y, boxW, 70).stroke();
    doc.rect(x, y, labelW, 70).fillAndStroke(C.soft, C.ink);
    doc.fillColor(C.ink).font('M').fontSize(8);
    ['결', '재'].forEach((ch, i) => doc.text(ch, x, y + 22 + i * 14, { width: labelW, align: 'center' }));
    steps.forEach((s, i) => {
      const cx = x + labelW + i * colW;
      doc.rect(cx, y, colW, 16).fillAndStroke(C.soft, C.ink);
      doc.rect(cx, y + 16, colW, 54).stroke();
      doc.fillColor(C.ink).font('M').fontSize(8).text(s.title, cx, y + 4.5, { width: colW, align: 'center' });
      if ((s.state === 'APPROVED' || s.state === 'REJECTED') && s.actedByName) {
        drawStepStamp(doc, cx + colW / 2, y + 43, s.actedByName, md(s.actedAt), { rejected: s.state === 'REJECTED', image: s.actedStampId ? seals.stamps.get(s.actedStampId) : null });
      } else {
        doc.fillColor(C.muted).font('R').fontSize(7).text(s.state === 'HOLD' ? '보류' : s.stepNo === 0 ? '' : '', cx, y + 40, { width: colW, align: 'center' });
      }
    });
    return boxW;
  };

  /* 머리 */
  const boxW = drawApprovalBox();
  doc.fillColor(C.ink).font('B').fontSize(24).text('발   주   서', L, 52, { width: W - boxW - 10, characterSpacing: 2 });
  doc.font('R').fontSize(8.5).fillColor(C.muted);
  doc.text(`문서번호  ${d.code}${d.revision ? `  (개정 ${d.revision})` : ''}`, L, 88);
  doc.text(`발주일자  ${d.orderDate.replace(/-/g, '. ')}.`, L, 100);

  /* 당사자 표 */
  let y = 124;
  const half = (W - 10) / 2;
  const partyTable = (x: number, title: string, rows: [string, string][]) => {
    const lw = 62;
    const rh = 17;
    doc.lineWidth(0.6).strokeColor(C.line);
    doc.rect(x, y, half, 18).fillAndStroke(C.steel, C.steel);
    doc.fillColor('#FFFFFF').font('M').fontSize(9).text(title, x + 8, y + 4.5);
    rows.forEach(([k, v], i) => {
      const ry = y + 18 + i * rh;
      doc.rect(x, ry, lw, rh).fillAndStroke(C.soft, C.line);
      doc.rect(x + lw, ry, half - lw, rh).stroke();
      doc.fillColor(C.muted).font('R').fontSize(8).text(k, x + 6, ry + 4.5, { width: lw - 8 });
      doc.fillColor(C.ink).font(i === 0 ? 'M' : 'R').fontSize(8.5).text(v || '', x + lw + 6, ry + 4, { width: half - lw - 10, height: rh - 4, ellipsis: true, lineBreak: false });
    });
    return 18 + rows.length * rh;
  };
  const h1 = partyTable(L, '수신 (공급자)', [
    ['상호', d.vendor.name], ['사업자번호', bz(d.vendor.bizRegNo)], ['대표자', d.vendor.ceoName ?? ''],
    ['담당자', d.vendorContact ?? d.vendor.contactName ?? ''], ['연락처', d.vendor.contactPhone ?? d.vendor.phone ?? ''],
  ]);
  partyTable(L + half + 10, '발신 (발주자)', [
    ['상호', d.company.name], ['사업자번호', bz(d.company.bizRegNo)], ['대표자', d.company.ceoName ?? ''],
    ['주소', d.company.address ?? ''], ['담당·연락처', [d.ourContact, d.ourPhone].filter(Boolean).join('  ')],
  ]);
  y += h1 + 12;

  /* 발주 조건 */
  const condRows: [string, string, string?, string?][] = [
    ['공사명', `${d.project.name}  (${d.project.code})`],
    ['발주내용', d.title],
    ['납품장소', d.deliveryPlace ?? d.project.siteAddress ?? '', '납품기한', d.deliveryDate ? d.deliveryDate.replace(/-/g, '. ') + '.' : '협의'],
    ['결제조건', d.paymentTerms ?? '', '부가세', `별도 (${(Number(d.vatRate) * 100).toFixed(0)}%)`],
  ];
  const lw = 62;
  const rh = 18;
  condRows.forEach(([k1, v1, k2, v2], i) => {
    const ry = y + i * rh;
    doc.lineWidth(0.6).strokeColor(C.line);
    if (k2) {
      const w1 = W * 0.6;
      doc.rect(L, ry, lw, rh).fillAndStroke(C.soft, C.line);
      doc.rect(L + lw, ry, w1 - lw, rh).stroke();
      doc.rect(L + w1, ry, lw, rh).fillAndStroke(C.soft, C.line);
      doc.rect(L + w1 + lw, ry, W - w1 - lw, rh).stroke();
      doc.fillColor(C.muted).font('R').fontSize(8).text(k1, L + 6, ry + 5).text(k2, L + w1 + 6, ry + 5);
      doc.fillColor(C.ink).font('R').fontSize(8.5).text(v1, L + lw + 6, ry + 4.5, { width: w1 - lw - 10, lineBreak: false, ellipsis: true }).text(v2 ?? '', L + w1 + lw + 6, ry + 4.5, { width: W - w1 - lw - 10, lineBreak: false });
    } else {
      doc.rect(L, ry, lw, rh).fillAndStroke(C.soft, C.line);
      doc.rect(L + lw, ry, W - lw, rh).stroke();
      doc.fillColor(C.muted).font('R').fontSize(8).text(k1, L + 6, ry + 5);
      doc.fillColor(C.ink).font(i === 0 ? 'M' : 'R').fontSize(8.5).text(v1, L + lw + 6, ry + 4.5, { width: W - lw - 12, lineBreak: false, ellipsis: true });
    }
  });
  y += condRows.length * rh + 10;

  /* 합계금액 */
  doc.lineWidth(1.2).strokeColor(C.ink).rect(L, y, W, 30).stroke();
  doc.rect(L, y, 112, 30).fillAndStroke(C.soft, C.ink);
  doc.fillColor(C.ink).font('M').fontSize(9).text('합계금액', L, y + 6, { width: 112, align: 'center' });
  doc.font('R').fontSize(7).fillColor(C.muted).text('(부가세 포함)', L, y + 18, { width: 112, align: 'center' });
  doc.fillColor(C.ink).font('B').fontSize(12).text(`금 ${koreanAmount(d.totalAmount)}원정`, L + 124, y + 9, { lineBreak: false });
  doc.font('B').fontSize(12).text(`₩${won(d.totalAmount)}`, L, y + 9, { width: W - 12, align: 'right' });
  y += 42;

  /* 품목표 */
  const cols = [
    { k: 'no', t: 'No', w: 24, a: 'center' as const },
    { k: 'name', t: '품명', w: 112, a: 'left' as const },
    { k: 'spec', t: '규격', w: 82, a: 'left' as const },
    { k: 'unit', t: '단위', w: 28, a: 'center' as const },
    { k: 'qty', t: '수량', w: 44, a: 'right' as const },
    { k: 'price', t: '단가', w: 56, a: 'right' as const },
    { k: 'supply', t: '공급가액', w: 66, a: 'right' as const },
    { k: 'vat', t: '세액', w: 52, a: 'right' as const },
  ];
  const remark = W - cols.reduce((a, c) => a + c.w, 0);
  cols.push({ k: 'memo', t: '비고', w: remark, a: 'left' as const });
  const pageBottom = doc.page.height - 60;
  const head = () => {
    let x = L;
    doc.lineWidth(0.6).strokeColor(C.ink);
    doc.rect(L, y, W, 18).fillAndStroke(C.soft, C.ink);
    doc.fillColor(C.ink).font('M').fontSize(8);
    cols.forEach((c) => {
      doc.text(c.t, x, y + 5, { width: c.w, align: 'center' });
      x += c.w;
    });
    y += 18;
  };
  head();
  doc.font('R').fontSize(8);
  d.lines.forEach((l) => {
    const cells: Record<string, string> = {
      no: String(l.lineNo), name: l.name, spec: l.spec ?? '', unit: l.unit, qty: qtyStr(l.qty), price: won(l.unitPrice),
      supply: won(l.supplyAmount), vat: l.taxType === 'TAXABLE' ? won(l.vatAmount) : l.taxType === 'EXEMPT' ? '면세' : '영세', memo: l.memo ?? '',
    };
    const hName = doc.heightOfString(cells.name, { width: cols[1].w - 8 });
    const hSpec = doc.heightOfString(cells.spec || ' ', { width: cols[2].w - 8 });
    const hMemo = doc.heightOfString(cells.memo || ' ', { width: remark - 8 });
    const h = Math.max(17, Math.ceil(Math.max(hName, hSpec, hMemo)) + 8);
    if (y + h > pageBottom) {
      doc.addPage();
      y = 40;
      head();
      doc.font('R').fontSize(8);
    }
    let x = L;
    doc.lineWidth(0.5).strokeColor(C.line);
    cols.forEach((c) => {
      doc.rect(x, y, c.w, h).stroke();
      doc.fillColor(C.ink).text(cells[c.k], x + 4, y + 4.5, { width: c.w - 8, align: c.a });
      x += c.w;
    });
    y += h;
  });

  /* 합계 행 */
  const totalRows: [string, string][] = [['공급가액 계', d.supplyAmount], ['세액 계', d.vatAmount], ['합계', d.totalAmount]];
  const labelX = L + cols.slice(0, 5).reduce((a, c) => a + c.w, 0);
  const labelW = cols[5].w;
  const valW = cols[6].w + cols[7].w + remark;
  if (y + 18 * 3 > pageBottom) {
    doc.addPage();
    y = 40;
  }
  totalRows.forEach(([k, v], i) => {
    const strong = i === 2;
    doc.lineWidth(strong ? 1 : 0.5).strokeColor(strong ? C.ink : C.line);
    doc.rect(labelX, y, labelW, 18).fillAndStroke(C.soft, strong ? C.ink : C.line);
    doc.rect(labelX + labelW, y, valW, 18).stroke();
    doc.fillColor(C.ink).font(strong ? 'B' : 'M').fontSize(8.5).text(k, labelX, y + 5, { width: labelW, align: 'center' });
    doc.text(`${won(v)} 원`, labelX + labelW, y + 5, { width: valW - 8, align: 'right' });
    y += 18;
  });
  doc.font('R').fontSize(7.5).fillColor(C.muted).text(`품목 ${d.lines.length}건`, L, y - 50);
  y += 14;

  /* 특기사항 */
  const terms = [
    '납품 시 거래명세표를 함께 제출해 주십시오. 검수 후 수량·규격이 다른 품목은 반품합니다.',
    '세금계산서는 검수 완료된 수량 기준으로 발행해 주십시오. (발주번호 기재)',
    '납품기한을 지키기 어려우면 미리 담당자에게 알려 주십시오.',
  ];
  const memoText = d.memo ? d.memo + '\n' : '';
  const body = memoText + terms.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const bh = doc.font('R').fontSize(8).heightOfString(body, { width: W - 90 }) + 14;
  if (y + bh + 70 > pageBottom) {
    doc.addPage();
    y = 40;
  }
  doc.lineWidth(0.6).strokeColor(C.line).rect(L, y, W, bh).stroke();
  doc.rect(L, y, 70, bh).fillAndStroke(C.soft, C.line);
  doc.fillColor(C.muted).font('M').fontSize(8).text('특기사항', L, y + bh / 2 - 4, { width: 70, align: 'center' });
  doc.fillColor(C.ink).font('R').fontSize(8).text(body, L + 80, y + 7, { width: W - 90, lineGap: 1.5 });
  y += bh + 22;

  /* 발주 문구 */
  doc.fillColor(C.ink).font('R').fontSize(10).text('위와 같이 발주합니다.', L, y, { width: W, align: 'center' });
  y += 22;
  doc.font('R').fontSize(9.5).text(`${d.orderDate.slice(0, 4)}년  ${Number(d.orderDate.slice(5, 7))}월  ${Number(d.orderDate.slice(8, 10))}일`, L, y, { width: W, align: 'center' });
  y += 22;
  drawSignature(doc, L, W, y, d.company, seals, approved);

  /* 워터마크·바닥글 (모든 쪽) */
  const range = doc.bufferedPageRange();
  const printed = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // 바닥글이 새 쪽을 만들지 않도록
    if (!approved) {
      const text = d.status === 'CANCELLED' ? '취소된 발주서' : d.status === 'REJECTED' ? '반려된 발주서 · 효력 없음' : '대표이사 결재 전 · 발주 효력 없음';
      doc.save();
      doc.rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fillColor(C.seal).opacity(0.12).font('B').fontSize(32).text(text, 0, doc.page.height / 2 - 20, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore();
      doc.opacity(1);
    }
    doc.fillColor(C.muted).font('R').fontSize(7);
    doc.text(`SS-ERP  ·  ${d.code}  ·  출력 ${printed} ${d.printedBy}`, L, doc.page.height - 34, { width: W / 2, lineBreak: false });
    doc.text(`${i - range.start + 1} / ${range.count}`, L, doc.page.height - 34, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
