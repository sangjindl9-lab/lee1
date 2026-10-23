/**
 * 기성청구서 PDF (A4 세로)
 *  제목·결재란 / 수신(발주처)·발신(우리 회사) / 공사 개요 / 기성 집계표(계약·전회·금회·누적·잔여·기성률)
 *  / 공종별 기성 내역 / 청구 금액(공급가액·세액·선급금 공제·유보금·청구액) / 청구 문구·회사명
 *  승인 전 기성은 "내부 결재 전" 워터마크로 효력이 없음을 표시한다.
 */
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { D } from '../common/money';
import { koreanAmount } from '../purchase/po-pdf';
import { drawSignature, drawStepStamp, NO_SEALS, PdfSeals } from '../common/pdf-seal';

const FONT_DIR = [path.join(__dirname, '../../assets/fonts'), path.join(__dirname, '../../../assets/fonts'), path.join(process.cwd(), 'assets/fonts')].find((p) => fs.existsSync(p))!;
const C = { ink: '#17202B', muted: '#5B6573', line: '#9AA3AE', soft: '#EEF1F4', seal: '#C42B1C', steel: '#2B4C6F' };
const won = (v: string | null | undefined) => D(v ?? 0).toDecimalPlaces(0, 1).toNumber().toLocaleString('ko-KR');
const bz = (v: string | null) => (v && v.length === 10 ? `${v.slice(0, 3)}-${v.slice(3, 5)}-${v.slice(5)}` : v ?? '');
const md = (d: Date | null) => (d ? `${String(new Date(d.getTime() + 9 * 3600000).getUTCMonth() + 1).padStart(2, '0')}.${String(new Date(d.getTime() + 9 * 3600000).getUTCDate()).padStart(2, '0')}` : '');
const ymd = (s: string | null) => (s ? `${s.slice(0, 4)}. ${s.slice(5, 7)}. ${s.slice(8, 10)}.` : '');

export interface ClaimPdfData {
  code: string; claimNo: number; status: string; claimDate: string; periodFrom: string | null; periodTo: string | null; dueDate: string | null; isFinal: boolean;
  contractOriginal: string; contractSupply: string; prevCumulative: string; thisSupply: string; cumulative: string; progressRate: string;
  vatRate: string; vatAmount: string; advanceDeduction: string; retentionRate: string; retentionAmount: string; receivableAmount: string; memo: string | null;
  company: { name: string; bizRegNo: string; ceoName: string | null; address: string | null; phone: string | null };
  client: { name: string; bizRegNo: string | null; ceoName: string | null; address: string | null };
  project: { code: string; name: string; siteAddress: string | null; contractDate: string | null; startDate: string | null; plannedEndDate: string | null };
  lines: { lineNo: number; name: string; spec: string | null; contractAmount: string; prevAmount: string; thisAmount: string; cumulativeAmount: string }[];
  approval: { steps: { stepNo: number; title: string; state: string; actedByName: string | null; actedAt: Date | null; actedStampId?: string | null }[] } | null;
  printedBy: string;
  seals?: PdfSeals;
}

export function renderClaimPdf(d: ClaimPdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 48, left: 40, right: 40 }, bufferPages: true, info: { Title: `기성청구서 ${d.code}`, Author: d.company.name, Creator: 'SS-ERP' } });
  doc.registerFont('R', path.join(FONT_DIR, 'Pretendard-Regular.otf'));
  doc.registerFont('M', path.join(FONT_DIR, 'Pretendard-Medium.otf'));
  doc.registerFont('B', path.join(FONT_DIR, 'Pretendard-Bold.otf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const L = 40;
  const W = doc.page.width - 80;
  const approved = ['APPROVED', 'INVOICED', 'PARTIAL', 'COLLECTED'].includes(d.status);

  const seals = d.seals ?? NO_SEALS;
  /* 결재란 */
  const steps = d.approval?.steps ?? [{ stepNo: 0, title: '담당', state: 'WAITING', actedByName: null, actedAt: null }, { stepNo: 1, title: '승인', state: 'WAITING', actedByName: null, actedAt: null }];
  const colW = 58, labelW = 16, boxW = labelW + colW * steps.length, bx = L + W - boxW, by = 40;
  doc.lineWidth(0.7).strokeColor(C.ink).rect(bx, by, boxW, 66).stroke();
  doc.rect(bx, by, labelW, 66).fillAndStroke(C.soft, C.ink);
  doc.fillColor(C.ink).font('M').fontSize(8);
  ['결', '재'].forEach((ch, i) => doc.text(ch, bx, by + 20 + i * 14, { width: labelW, align: 'center' }));
  steps.forEach((s, i) => {
    const cx = bx + labelW + i * colW;
    doc.rect(cx, by, colW, 16).fillAndStroke(C.soft, C.ink);
    doc.rect(cx, by + 16, colW, 50).stroke();
    doc.fillColor(C.ink).font('M').fontSize(8).text(s.title, cx, by + 4.5, { width: colW, align: 'center' });
    if ((s.state === 'APPROVED' || s.state === 'REJECTED') && s.actedByName) {
      drawStepStamp(doc, cx + colW / 2, by + 41, s.actedByName, md(s.actedAt), { r: 20, rejected: s.state === 'REJECTED', image: s.actedStampId ? seals.stamps.get(s.actedStampId) : null });
    }
  });
  doc.fillColor(C.ink).font('B').fontSize(23).text(d.isFinal ? '준 공 기 성 청 구 서' : '기 성 청 구 서', L, 50, { width: W - boxW - 10 });
  doc.font('R').fontSize(8.5).fillColor(C.muted).text(`문서번호  ${d.code}   ·   제 ${d.claimNo} 회 기성`, L, 86).text(`청구일자  ${ymd(d.claimDate)}`, L, 98);

  /* 당사자 */
  let y = 120;
  const half = (W - 10) / 2;
  const party = (x: number, title: string, rows: [string, string][]) => {
    doc.lineWidth(0.6).strokeColor(C.line).rect(x, y, half, 18).fillAndStroke(C.steel, C.steel);
    doc.fillColor('#FFFFFF').font('M').fontSize(9).text(title, x + 8, y + 4.5);
    rows.forEach(([k, v], i) => {
      const ry = y + 18 + i * 17;
      doc.rect(x, ry, 62, 17).fillAndStroke(C.soft, C.line).rect(x + 62, ry, half - 62, 17).stroke();
      doc.fillColor(C.muted).font('R').fontSize(8).text(k, x + 6, ry + 4.5);
      doc.fillColor(C.ink).font(i === 0 ? 'M' : 'R').fontSize(8.5).text(v, x + 68, ry + 4, { width: half - 72, lineBreak: false, ellipsis: true });
    });
  };
  party(L, '수신 (발주처)', [['상호', d.client.name], ['사업자번호', bz(d.client.bizRegNo)], ['대표자', d.client.ceoName ?? ''], ['주소', d.client.address ?? '']]);
  party(L + half + 10, '청구인 (수급인)', [['상호', d.company.name], ['사업자번호', bz(d.company.bizRegNo)], ['대표자', d.company.ceoName ?? ''], ['주소', d.company.address ?? '']]);
  y += 18 + 4 * 17 + 12;

  /* 공사 개요 */
  const ov: [string, string][] = [
    ['공사명', `${d.project.name}  (${d.project.code})`],
    ['공사 장소', d.project.siteAddress ?? ''],
    ['계약일·공기', `${ymd(d.project.contractDate)}  /  ${ymd(d.project.startDate)} ~ ${ymd(d.project.plannedEndDate)}`],
    ['기성 기간', d.periodFrom || d.periodTo ? `${ymd(d.periodFrom)} ~ ${ymd(d.periodTo)}` : ''],
  ];
  ov.forEach(([k, v], i) => {
    const ry = y + i * 17;
    doc.lineWidth(0.6).strokeColor(C.line).rect(L, ry, 70, 17).fillAndStroke(C.soft, C.line).rect(L + 70, ry, W - 70, 17).stroke();
    doc.fillColor(C.muted).font('R').fontSize(8).text(k, L + 6, ry + 4.5);
    doc.fillColor(C.ink).font(i === 0 ? 'M' : 'R').fontSize(8.5).text(v, L + 76, ry + 4, { width: W - 82, lineBreak: false, ellipsis: true });
  });
  y += ov.length * 17 + 12;

  /* 기성 집계 */
  const remain = D(d.contractSupply).minus(d.cumulative);
  const heads = ['계약금액(공급가)', '전회 누적', '금회 기성', '누적 기성', '잔여 계약', '기성률'];
  const vals = [won(d.contractSupply), won(d.prevCumulative), won(d.thisSupply), won(d.cumulative), won(remain.toString()), `${D(d.progressRate).mul(100).toFixed(2)}%`];
  const cw = W / heads.length;
  heads.forEach((h, i) => {
    doc.lineWidth(0.6).strokeColor(C.ink).rect(L + i * cw, y, cw, 17).fillAndStroke(C.soft, C.ink).rect(L + i * cw, y + 17, cw, 22).stroke();
    doc.fillColor(C.ink).font('M').fontSize(8).text(h, L + i * cw, y + 4.5, { width: cw, align: 'center' });
    doc.font(i === 2 ? 'B' : 'R').fontSize(9.5).text(vals[i], L + i * cw + 4, y + 23, { width: cw - 8, align: 'right' });
  });
  y += 39;
  if (!D(d.contractOriginal).eq(d.contractSupply)) {
    doc.fillColor(C.muted).font('R').fontSize(7.5).text(`최초 계약금액 ${won(d.contractOriginal)}원 → 변경계약 반영 ${won(d.contractSupply)}원`, L, y + 3);
    y += 12;
  }
  y += 10;

  /* 공종별 내역 */
  if (d.lines.length) {
    const cols = [
      { t: 'No', w: 24, a: 'center' as const }, { t: '공종·내역', w: 150, a: 'left' as const }, { t: '규격', w: 60, a: 'left' as const },
      { t: '계약금액', w: 72, a: 'right' as const }, { t: '전회 누적', w: 68, a: 'right' as const }, { t: '금회', w: 72, a: 'right' as const },
    ];
    cols.push({ t: '누적', w: W - cols.reduce((a, c) => a + c.w, 0), a: 'right' as const });
    const head = () => {
      let x = L;
      doc.lineWidth(0.6).strokeColor(C.ink).rect(L, y, W, 17).fillAndStroke(C.soft, C.ink);
      doc.fillColor(C.ink).font('M').fontSize(8);
      cols.forEach((c) => (doc.text(c.t, x, y + 4.5, { width: c.w, align: 'center' }), (x += c.w)));
      y += 17;
    };
    head();
    for (const l of d.lines) {
      const cells = [String(l.lineNo), l.name, l.spec ?? '', won(l.contractAmount), won(l.prevAmount), won(l.thisAmount), won(l.cumulativeAmount)];
      const h = Math.max(16, Math.ceil(doc.font('R').fontSize(8).heightOfString(l.name, { width: cols[1].w - 8 })) + 7);
      if (y + h > doc.page.height - 200) {
        doc.addPage();
        y = 40;
        head();
      }
      let x = L;
      doc.lineWidth(0.5).strokeColor(C.line);
      cols.forEach((c, i) => {
        doc.rect(x, y, c.w, h).stroke();
        doc.fillColor(C.ink).font(i === 5 ? 'M' : 'R').fontSize(8).text(cells[i], x + 4, y + 4, { width: c.w - 8, align: c.a });
        x += c.w;
      });
      y += h;
    }
    y += 12;
  }

  /* 청구 금액 */
  if (y + 170 > doc.page.height - 60) {
    doc.addPage();
    y = 40;
  }
  const rows: [string, string, boolean?][] = [
    ['금회 기성 (공급가액)', d.thisSupply],
    [`부가가치세 (${D(d.vatRate).mul(100).toFixed(0)}%)`, d.vatAmount],
    ['선급금 공제', D(d.advanceDeduction).gt(0) ? `△ ${won(d.advanceDeduction)}` : '0'],
    [`유보금 (${D(d.retentionRate).mul(100).toFixed(1)}%)`, D(d.retentionAmount).gt(0) ? `△ ${won(d.retentionAmount)}` : '0'],
    ['청구금액', d.receivableAmount, true],
  ];
  const kx = L + W * 0.42, kw = W * 0.3, vw = W * 0.28;
  rows.forEach(([k, v, strong], i) => {
    const ry = y + i * 19;
    doc.lineWidth(strong ? 1.1 : 0.6).strokeColor(strong ? C.ink : C.line);
    doc.rect(kx, ry, kw, 19).fillAndStroke(C.soft, strong ? C.ink : C.line).rect(kx + kw, ry, vw, 19).stroke();
    doc.fillColor(C.ink).font(strong ? 'B' : 'R').fontSize(8.5).text(k, kx + 6, ry + 5);
    doc.font(strong ? 'B' : 'M').fontSize(strong ? 10 : 9).text(v.startsWith('△') ? `${v} 원` : `${won(v)} 원`, kx + kw, ry + (strong ? 4 : 5), { width: vw - 8, align: 'right' });
  });
  doc.fillColor(C.ink).font('B').fontSize(11).text(`금 ${koreanAmount(D(d.receivableAmount).toFixed(0))}원정`, L, y + 30, { width: W * 0.4 });
  doc.font('R').fontSize(8).fillColor(C.muted).text(`(₩${won(d.receivableAmount)}, 부가세 포함)`, L, y + 48, { width: W * 0.4 });
  if (d.dueDate) doc.text(`지급 요청일  ${ymd(d.dueDate)}`, L, y + 62, { width: W * 0.4 });
  y += rows.length * 19 + 18;
  if (d.memo) {
    doc.fillColor(C.ink).font('R').fontSize(8).text(`비고: ${d.memo}`, L, y, { width: W });
    y += doc.heightOfString(`비고: ${d.memo}`, { width: W }) + 8;
  }

  /* 청구 문구 */
  y += 10;
  doc.fillColor(C.ink).font('R').fontSize(10).text(`위와 같이 ${d.isFinal ? '준공' : `제 ${d.claimNo} 회`} 기성금을 청구합니다.`, L, y, { width: W, align: 'center' });
  y += 22;
  doc.font('R').fontSize(9.5).text(`${d.claimDate.slice(0, 4)}년  ${Number(d.claimDate.slice(5, 7))}월  ${Number(d.claimDate.slice(8, 10))}일`, L, y, { width: W, align: 'center' });
  y += 22;
  y = drawSignature(doc, L, W, y, d.company, seals, approved) + 6;
  doc.font('M').fontSize(10).text(`${d.client.name}  귀하`, L, y, { width: W, align: 'left' });

  const range = doc.bufferedPageRange();
  const printed = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    if (!approved) {
      const text = d.status === 'CANCELLED' ? '취소된 기성청구' : d.status === 'REJECTED' ? '반려된 기성청구 · 효력 없음' : '내부 결재 전 · 제출용 아님';
      doc.save().rotate(-30, { origin: [doc.page.width / 2, doc.page.height / 2] });
      doc.fillColor(C.seal).opacity(0.12).font('B').fontSize(32).text(text, 0, doc.page.height / 2 - 20, { width: doc.page.width, align: 'center', lineBreak: false });
      doc.restore().opacity(1);
    }
    doc.fillColor(C.muted).font('R').fontSize(7);
    doc.text(`SS-ERP  ·  ${d.code}  ·  출력 ${printed} ${d.printedBy}`, L, doc.page.height - 34, { width: W / 2, lineBreak: false });
    doc.text(`${i - range.start + 1} / ${range.count}`, L, doc.page.height - 34, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
