/**
 * 표 형식 보고서 PDF — A4/A3, 세로/가로. 페이지가 넘어가면 머리글을 반복하고 마지막에 합계 행
 */
import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

const FONT_DIR = [path.join(__dirname, '../../assets/fonts'), path.join(__dirname, '../../../assets/fonts'), path.join(process.cwd(), 'assets/fonts')].find((p) => fs.existsSync(p))!;
const C = { ink: '#17202B', muted: '#5B6573', line: '#C9CED6', head: '#2B4C6F', soft: '#EEF1F4' };

export interface PdfColumn { header: string; weight?: number; align?: 'left' | 'right' | 'center'; money?: boolean }
export interface TablePdf {
  title: string; subtitle?: string; company: string; printedBy: string;
  size: 'A4' | 'A3'; landscape: boolean;
  columns: PdfColumn[]; rows: (string | number | null)[][]; totals?: (string | number | null)[];
  notes?: string[];
}

const fmt = (v: string | number | null, money?: boolean) => {
  if (v === null || v === undefined || v === '') return '';
  if (money) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n).toLocaleString('ko-KR') : String(v);
  }
  return String(v);
};

export function renderTablePdf(d: TablePdf): Promise<Buffer> {
  const doc = new PDFDocument({ size: d.size, layout: d.landscape ? 'landscape' : 'portrait', margins: { top: 36, bottom: 44, left: 32, right: 32 }, bufferPages: true, info: { Title: d.title, Author: d.company, Creator: 'SS-ERP' } });
  doc.registerFont('R', path.join(FONT_DIR, 'Pretendard-Regular.otf'));
  doc.registerFont('M', path.join(FONT_DIR, 'Pretendard-Medium.otf'));
  doc.registerFont('B', path.join(FONT_DIR, 'Pretendard-Bold.otf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const L = 32;
  const W = doc.page.width - 64;
  const fs8 = d.size === 'A3' ? 8.5 : 7.5;
  const totalWeight = d.columns.reduce((a, c) => a + (c.weight ?? 1), 0);
  const widths = d.columns.map((c) => (W * (c.weight ?? 1)) / totalWeight);
  let y = 36;
  doc.fillColor(C.ink).font('B').fontSize(16).text(d.title, L, y);
  doc.font('R').fontSize(8).fillColor(C.muted).text(`${d.company}${d.subtitle ? `  ·  ${d.subtitle}` : ''}`, L, y + 22);
  y += 42;
  const head = () => {
    let x = L;
    doc.rect(L, y, W, 18).fill(C.head);
    doc.fillColor('#FFFFFF').font('M').fontSize(fs8);
    d.columns.forEach((c, i) => {
      doc.text(c.header, x + 3, y + 5, { width: widths[i] - 6, align: 'center', lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    y += 18;
  };
  head();
  const bottom = doc.page.height - 56;
  const drawRow = (cells: (string | number | null)[], bold = false, fill?: string) => {
    doc.font(bold ? 'B' : 'R').fontSize(fs8);
    const hs = cells.map((v, i) => doc.heightOfString(fmt(v, d.columns[i].money) || ' ', { width: widths[i] - 6 }));
    const h = Math.max(15, Math.ceil(Math.max(...hs)) + 6);
    if (y + h > bottom) {
      doc.addPage();
      y = 36;
      head();
      doc.font(bold ? 'B' : 'R').fontSize(fs8);
    }
    if (fill) doc.rect(L, y, W, h).fill(fill);
    let x = L;
    doc.lineWidth(0.4).strokeColor(C.line);
    cells.forEach((v, i) => {
      doc.rect(x, y, widths[i], h).stroke();
      const c = d.columns[i];
      doc.fillColor(C.ink).text(fmt(v, c.money), x + 3, y + 3.5, { width: widths[i] - 6, align: c.align ?? (c.money ? 'right' : 'left') });
      x += widths[i];
    });
    y += h;
  };
  d.rows.forEach((r, i) => drawRow(r, false, i % 2 ? '#FAFBFC' : undefined));
  if (d.totals) drawRow(d.totals, true, C.soft);
  if (!d.rows.length) {
    doc.font('R').fontSize(9).fillColor(C.muted).text('자료가 없습니다', L, y + 10, { width: W, align: 'center' });
    y += 30;
  }
  if (d.notes?.length) {
    y += 8;
    doc.font('R').fontSize(7.5).fillColor(C.muted);
    for (const n of d.notes) {
      if (y > bottom) (doc.addPage(), (y = 36));
      doc.text(`· ${n}`, L, y, { width: W });
      y += doc.heightOfString(`· ${n}`, { width: W }) + 2;
    }
  }
  const range = doc.bufferedPageRange();
  const printed = new Date(Date.now() + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 16);
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fillColor(C.muted).font('R').fontSize(7);
    doc.text(`SS-ERP  ·  ${d.title}  ·  출력 ${printed} ${d.printedBy}`, L, doc.page.height - 30, { width: W / 1.5, lineBreak: false });
    doc.text(`${i - range.start + 1} / ${range.count}`, L, doc.page.height - 30, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}
