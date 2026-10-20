// PDF 출력: 각 페이지를 캔버스에 직접 그려(한글은 브라우저 글꼴로 렌더링) jsPDF에 담는다.
// 긴 공사기간은 기간 열 단위로, 공종이 많으면 행 단위로 자동 분할하며 글자는 칸 폭에 맞춰 축소/생략한다.
import { jsPDF } from 'jspdf';
import type { Project } from './types';
import { computeProject, dateToX, overallStatus, STATUS_LABEL, UNIT_LABEL, type ProjectCalc, type Period } from './calc';
import { addDays, fmtDot, isValidDate } from './date';

export type Paper = 'A3' | 'A4';
const PAPER = { A3: { w: 420, h: 297 }, A4: { w: 297, h: 210 } };
export const PX = 6; // mm → px
let FAMILY = ''; export const FAMILY_SANS = '"IBM Plex Sans KR", "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const COL = {
  ink: '#16202b',
  ink2: '#46525f',
  mute: '#7a8693',
  line: '#b9c2cc',
  line2: '#e1e6eb',
  head: '#253446',
  headInk: '#ffffff',
  sunk: '#f1f4f7',
  plan: '#2c6bd3',
  planSoft: '#cddff9',
  act: '#2b9a57',
  done: '#15603a',
  late: '#cf3a31',
  idle: '#97a2ae',
};

type Ctx = CanvasRenderingContext2D;

export function setFamily(f: string) {
  FAMILY = f;
}
export function font(ctx: Ctx, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FAMILY}`;
}
/** 폭에 맞게 글자 크기를 줄이고, 그래도 넘치면 말줄임 */
export function fitText(ctx: Ctx, text: string, x: number, y: number, maxW: number, size: number, opt: { weight?: number; align?: CanvasTextAlign; color?: string; min?: number } = {}) {
  const min = opt.min ?? size * 0.72;
  let s = size;
  font(ctx, s, opt.weight);
  while (ctx.measureText(text).width > maxW && s > min) {
    s -= 0.1;
    font(ctx, s, opt.weight);
  }
  let t = text;
  if (ctx.measureText(t).width > maxW) {
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  ctx.fillStyle = opt.color || COL.ink;
  ctx.textAlign = opt.align || 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
}
export function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill?: string, stroke?: string, lw = 0.15) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);
  }
}
export function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color = COL.line, lw = 0.15, dash?: number[]) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.setLineDash(dash || []);
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}
export function wrap(ctx: Ctx, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const ch of para) {
      if (ctx.measureText(cur + ch).width > maxW && cur) {
        out.push(cur);
        cur = ch;
      } else cur += ch;
    }
    out.push(cur);
  }
  return out;
}

function header(ctx: Ctx, p: Project, c: ProjectCalc, W: number, page: number, pages: number, sub: string, a4: boolean) {
  const m = 10;
  const st = overallStatus(c.deviation);
  fitText(ctx, '예정공정표', m, m + 5, 80, a4 ? 7 : 8, { weight: 700 });
  fitText(ctx, `보할공정표 · ${UNIT_LABEL[p.view]} · ${sub}`, m + (a4 ? 40 : 46), m + 5.4, 120, 3, { color: COL.ink2 });
  const lines: [string, string][] = [
    ['공 사 명', p.info.name],
    ['발주처 / 시공사', `${p.info.client || '-'}  /  ${p.info.contractor || '-'}`],
    ['공사기간', `${fmtDot(p.info.start)} ~ ${fmtDot(p.info.end)}  (${c.totalDays}일, 작업일 ${c.workDays}일)    계약금액 ${p.info.amount ? p.info.amount.toLocaleString('ko-KR') + '원' : '-'}`],
    ['기준일 공정률', `${fmtDot(p.info.baseDate)}   예정 ${c.planned.toFixed(1)}%   실적 ${c.actual.toFixed(1)}%   편차 ${(c.deviation >= 0 ? '+' : '') + c.deviation.toFixed(1)}%p (${st.label})`],
  ];
  const signW = a4 ? 17 : 20;
  const infoW = W - 2 * m - signW * 3 - 6;
  lines.forEach(([k, v], i) => {
    const y = m + 12 + i * 4.6;
    fitText(ctx, k, m, y, 26, 2.8, { weight: 600, color: COL.ink2 });
    fitText(ctx, v, m + 27, y, infoW - 27, 2.9, { weight: k === '공 사 명' ? 600 : 400 });
  });
  // 결재란
  const sx = W - m - signW * 3;
  const sy = m;
  const names: [string, string][] = [
    ['작성', p.info.writer],
    ['검토', p.info.reviewer],
    ['승인', p.info.approver],
  ];
  names.forEach(([k, v], i) => {
    const x = sx + i * signW;
    rect(ctx, x, sy, signW, 5, COL.sunk, COL.ink2, 0.2);
    fitText(ctx, k, x + signW / 2, sy + 2.6, signW - 2, 2.8, { weight: 600, align: 'center' });
    rect(ctx, x, sy + 5, signW, 15, undefined, COL.ink2, 0.2);
    fitText(ctx, v || '', x + signW / 2, sy + 17, signW - 2, 2.7, { align: 'center', color: COL.ink2 });
  });
  fitText(ctx, `문서번호 ${p.info.docNo || '-'}`, sx, sy + 23.5, signW * 3, 2.7, { color: COL.ink2 });
  fitText(ctx, `${page} / ${pages}`, W - m, sy + 23.5, 20, 2.7, { align: 'right', color: COL.ink2 });
  line(ctx, m, m + 31, W - m, m + 31, COL.ink, 0.35);
}

function footer(ctx: Ctx, W: number, H: number, p: Project) {
  const d = new Date();
  const s = `출력 ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}  ·  작업일 기준: ${p.calendar.mode === 'weekday' ? '주말 제외' : '전체 달력일'}${p.calendar.holidays.length ? `, 지정 휴무일 ${p.calendar.holidays.length}일 제외` : ''}  ·  범례: 예정(파랑) 실적(초록) 지연(빨강) 완료(진한 초록) 기준일(빨간 점선)`;
  fitText(ctx, s, 10, H - 5, W - 20, 2.4, { color: COL.mute });
}

interface LeftCol {
  key: string;
  label: string;
  w: number;
  align: CanvasTextAlign;
}

export async function exportPdf(p: Project, paper: Paper = 'A3'): Promise<Blob> {
  const c = computeProject(p);
  setFamily(FAMILY_SANS);
  try {
    await Promise.all([document.fonts.load(`400 12px "IBM Plex Sans KR"`, '가나다'), document.fonts.load(`700 12px "IBM Plex Sans KR"`, '가나다')]);
    await document.fonts.ready;
  } catch {
    /* 시스템 글꼴 사용 */
  }
  const { w: W, h: H } = PAPER[paper];
  const a4 = paper === 'A4';
  const m = 10;
  const top = m + 34;
  const bottom = H - 9;
  const left: LeftCol[] = [
    { key: 'no', label: 'No', w: 8, align: 'center' },
    { key: 'name', label: '공종명', w: a4 ? 46 : 60, align: 'left' },
    { key: 'w', label: '보할(%)', w: 12, align: 'right' },
    { key: 's', label: '계획 시작', w: a4 ? 15 : 17, align: 'center' },
    { key: 'e', label: '계획 종료', w: a4 ? 15 : 17, align: 'center' },
    { key: 'p', label: '예정(%)', w: 11, align: 'right' },
    { key: 'a', label: '실적(%)', w: 11, align: 'right' },
    { key: 'st', label: '상태', w: 9, align: 'center' },
  ];
  const leftW = left.reduce((s, x) => s + x.w, 0);
  const tlW = W - 2 * m - leftW;
  const minCol = p.view === 'week' ? 7.5 : p.view === 'month' ? 13 : 17;
  const allPeriods = c.periods;
  const perPage = Math.max(1, Math.floor(tlW / minCol));
  const pChunks: (typeof allPeriods)[] = [];
  for (let i = 0; i < allPeriods.length; i += perPage) pChunks.push(allPeriods.slice(i, i + perPage));
  if (!pChunks.length) pChunks.push([]);
  const colW = allPeriods.length <= perPage ? tlW / Math.max(1, allPeriods.length) : tlW / perPage;
  const headH = 9;
  const footRowH = a4 ? 3.8 : 4.2;
  const footH = footRowH * 4;
  const baseRowH = a4 ? 5.2 : 6;
  const avail = bottom - top - headH - footH - 4;
  const rowsPer = Math.max(1, Math.floor(avail / baseRowH));
  // 공종이 적으면 행 높이를 키워 지면을 채운다(최대 1.6배)
  const rowH = c.rows.length && c.rows.length <= rowsPer ? Math.min(baseRowH * 1.6, avail / c.rows.length) : baseRowH;
  const rChunks: (typeof c.rows)[] = [];
  for (let i = 0; i < c.rows.length; i += rowsPer) rChunks.push(c.rows.slice(i, i + rowsPer));
  if (!rChunks.length) rChunks.push([]);
  const pages = pChunks.length * rChunks.length + 1;

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper.toLowerCase() as 'a3' | 'a4', compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * PX);
  canvas.height = Math.round(H * PX);
  const ctx = canvas.getContext('2d')!;
  let pageNo = 0;

  const newPage = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(PX, 0, 0, PX, 0, 0);
    pageNo++;
  };
  const flush = () => {
    if (pageNo > 1) pdf.addPage(paper.toLowerCase(), 'landscape');
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, W, H, undefined, 'FAST');
  };

  for (let pi = 0; pi < pChunks.length; pi++) {
    const chunk = pChunks[pi];
    const periods: Period[] = chunk.map((x) => x.period);
    for (let ri = 0; ri < rChunks.length; ri++) {
      newPage();
      const sub = chunk.length ? `${fmtDot(periods[0].start)} ~ ${fmtDot(periods[periods.length - 1].end)}` : '';
      header(ctx, p, c, W, pageNo, pages, sub, a4);
      const x0 = m;
      const tx = m + leftW;
      let y = top;
      // 머리글
      rect(ctx, x0, y, leftW + tlW, headH, COL.head);
      let cx = x0;
      for (const col of left) {
        fitText(ctx, col.label, cx + col.w / 2, y + headH / 2, col.w - 1, 2.6, { weight: 600, align: 'center', color: COL.headInk });
        line(ctx, cx + col.w, y, cx + col.w, y + headH, '#5b6b7d', 0.15);
        cx += col.w;
      }
      // 기간 머리글 2단
      let gi = 0;
      while (gi < periods.length) {
        let gj = gi;
        while (gj + 1 < periods.length && periods[gj + 1].group === periods[gi].group) gj++;
        const gx = tx + gi * colW;
        fitText(ctx, periods[gi].group, gx + ((gj - gi + 1) * colW) / 2, y + 2.3, (gj - gi + 1) * colW - 1, 2.5, { weight: 600, align: 'center', color: COL.headInk });
        line(ctx, gx, y, gx, y + headH, '#5b6b7d', 0.15);
        gi = gj + 1;
      }
      line(ctx, tx, y + 4.6, tx + tlW, y + 4.6, '#5b6b7d', 0.12);
      periods.forEach((pr, i) => {
        fitText(ctx, pr.label, tx + i * colW + colW / 2, y + 6.8, colW - 0.8, 2.3, { align: 'center', color: COL.headInk, min: 1.4 });
        if (i) line(ctx, tx + i * colW, y + 4.6, tx + i * colW, y + headH, '#5b6b7d', 0.12);
      });
      y += headH;
      const bodyTop = y;
      // 행
      const rows = rChunks[ri];
      rows.forEach((row) => {
        const t = row.node.task;
        const leaf = row.node.isLeaf;
        if (!leaf) rect(ctx, x0, y, leftW + tlW, rowH, COL.sunk);
        let cx2 = x0;
        const vals: Record<string, string> = {
          no: row.node.num,
          name: `${'  '.repeat(row.node.depth)}${t.name}`,
          w: row.node.weight.toFixed(2),
          s: fmtDot(row.node.start).slice(2),
          e: fmtDot(row.node.end).slice(2),
          p: row.planned.toFixed(1),
          a: row.actual.toFixed(1),
          st: STATUS_LABEL[row.status],
        };
        for (const col of left) {
          const v = vals[col.key];
          const color = col.key === 'st' ? (row.status === 'late' ? COL.late : row.status === 'done' ? COL.done : row.status === 'idle' ? COL.idle : COL.act) : col.key === 'p' ? COL.plan : col.key === 'a' ? COL.act : COL.ink;
          const pad = 1;
          const ax = col.align === 'center' ? cx2 + col.w / 2 : col.align === 'right' ? cx2 + col.w - pad : cx2 + pad + (col.key === 'name' ? row.node.depth * 2.5 : 0);
          fitText(ctx, col.key === 'name' ? t.name : v, ax, y + rowH / 2, col.w - 2 * pad - (col.key === 'name' ? row.node.depth * 2.5 : 0), a4 ? 2.6 : 2.85, { align: col.align, color, weight: !leaf || col.key === 'st' ? 600 : 400 });
          line(ctx, cx2 + col.w, y, cx2 + col.w, y + rowH, COL.line2, 0.12);
          cx2 += col.w;
        }
        // 막대
        if (isValidDate(row.node.start) && periods.length) {
          const pS = periods[0].start;
          const pE = periods[periods.length - 1].end;
          const s = row.node.start < pS ? pS : row.node.start;
          const e = row.node.end > pE ? pE : row.node.end;
          if (s <= e) {
            const bx1 = tx + dateToX(s, periods, colW);
            const bx2 = tx + dateToX(addDays(e, 1), periods, colW);
            const hasAct = leaf && isValidDate(t.actualStart);
            const fillC = row.status === 'done' ? COL.done : row.status === 'late' ? COL.late : COL.act;
            if (leaf) {
              const by = y + (hasAct ? 0.9 : 1.3);
              const bh = hasAct ? rowH * 0.42 : rowH - 2.6;
              rect(ctx, bx1, by, Math.max(0.6, bx2 - bx1), bh, t.color ? t.color + '40' : COL.planSoft, t.color || COL.plan, 0.25);
              if (!hasAct && row.actual > 0) {
                // 계획 막대 안에 달성률만 (계획 전체 기간 기준)
                const fullX1 = tx + dateToX(row.node.start, periods, colW);
                const fullX2 = tx + dateToX(addDays(row.node.end, 1), periods, colW);
                const fx2 = fullX1 + (fullX2 - fullX1) * (row.actual / 100);
                const a = Math.max(bx1, fullX1);
                const b = Math.min(bx2, fx2);
                if (b > a) rect(ctx, a, by + 0.15, b - a, bh - 0.3, fillC);
              }
            } else {
              rect(ctx, bx1, y + rowH / 2 - 0.8, Math.max(0.6, bx2 - bx1), 1.6, COL.ink2);
              const fx2 = bx1 + (bx2 - bx1) * (row.actual / 100);
              if (row.actual > 0) rect(ctx, bx1, y + rowH / 2 - 0.8, fx2 - bx1, 1.6, fillC);
            }
            if (hasAct) {
              const ae = isValidDate(t.actualEnd) ? t.actualEnd : p.info.baseDate;
              const as = t.actualStart < pS ? pS : t.actualStart;
              const ae2 = ae > pE ? pE : ae;
              if (as <= ae2) {
                const ax1 = tx + dateToX(as, periods, colW);
                const ax2 = tx + dateToX(addDays(ae2, 1), periods, colW);
                rect(ctx, ax1, y + rowH * 0.55, Math.max(0.6, ax2 - ax1), rowH * 0.32, fillC);
              }
            }
          }
        }
        line(ctx, x0, y + rowH, x0 + leftW + tlW, y + rowH, COL.line2, 0.12);
        y += rowH;
      });
      const bodyBottom = Math.max(y, bodyTop + rowH);
      // 기간 세로선
      periods.forEach((_, i) => i && line(ctx, tx + i * colW, bodyTop, tx + i * colW, bodyBottom, COL.line2, 0.12));
      // 기준일 선
      if (periods.length && p.info.baseDate >= periods[0].start && p.info.baseDate <= periods[periods.length - 1].end) {
        const bx = tx + dateToX(addDays(p.info.baseDate, 1), periods, colW);
        line(ctx, bx, bodyTop, bx, bodyBottom + footH, COL.late, 0.35, [1.2, 0.8]);
        fitText(ctx, `기준일 ${fmtDot(p.info.baseDate)}`, bx, bodyBottom + footH + 2.2, 30, 2.3, { color: COL.late, weight: 600, align: 'center' });
      }
      // 하단 누계
      y = bodyBottom;
      const foot: [string, (k: number) => string, string][] = [
        ['기간 예정공정률(%)', (k) => chunk[k].planDelta.toFixed(1), COL.plan],
        ['예정공정률 누계(%)', (k) => chunk[k].planCum.toFixed(1), COL.plan],
        ['기간 실제공정률(%)', (k) => (chunk[k].actDelta == null ? '-' : chunk[k].actDelta!.toFixed(1)), COL.act],
        ['실제공정률 누계(%)', (k) => (chunk[k].actCum == null ? '-' : chunk[k].actCum!.toFixed(1)), COL.act],
      ];
      rect(ctx, x0, y, leftW + tlW, footH, COL.sunk);
      line(ctx, x0, y, x0 + leftW + tlW, y, COL.ink, 0.3);
      foot.forEach(([label, fn, color], fi) => {
        const fy = y + fi * footRowH;
        fitText(ctx, label, x0 + leftW - 2, fy + footRowH / 2, leftW - 4, 2.6, { align: 'right', color, weight: 600 });
        if (fi === 0) fitText(ctx, `보할 합계 ${c.weightTotal.toFixed(2)}%`, x0 + 2, fy + footRowH / 2, leftW / 2, 2.5, { color: Math.abs(c.weightTotal - 100) > 0.005 ? COL.late : COL.ink2 });
        chunk.forEach((_, k) => fitText(ctx, fn(k), tx + k * colW + colW / 2, fy + footRowH / 2, colW - 0.8, 2.4, { align: 'center', weight: fi % 2 ? 600 : 400, min: 1.4 }));
        if (fi) line(ctx, x0, fy, x0 + leftW + tlW, fy, COL.line2, 0.12);
      });
      periods.forEach((_, i) => i && line(ctx, tx + i * colW, y, tx + i * colW, y + footH, COL.line2, 0.12));
      // 외곽선
      rect(ctx, x0, top, leftW + tlW, y + footH - top, undefined, COL.ink, 0.3);
      line(ctx, tx, top, tx, y + footH, COL.ink2, 0.25);
      if (rChunks.length > 1) fitText(ctx, `공종 ${ri * rowsPer + 1}~${ri * rowsPer + rows.length} / ${c.rows.length}`, m, bottom + 1.3, 80, 2.4, { color: COL.ink2 });
      footer(ctx, W, H, p);
      flush();
    }
  }

  // 마지막 페이지: S-Curve + 특이사항
  newPage();
  header(ctx, p, c, W, pageNo, pages, '누적공정률(S-Curve)', a4);
  drawSCurve(ctx, c, m, top + 2, (W - 2 * m) * 0.64, bottom - top - 6);
  const nx = m + (W - 2 * m) * 0.64 + 8;
  const nw = W - m - nx;
  fitText(ctx, '공정현황 및 특이사항', nx, top + 5, nw, 3.4, { weight: 700 });
  font(ctx, 2.9);
  const lateRows = c.rows.filter((r) => r.node.isLeaf && r.status === 'late').sort((a, b) => a.actual - a.planned - (b.actual - b.planned));
  const summary = `기준일 ${fmtDot(p.info.baseDate)} 현재 예정공정률 ${c.planned.toFixed(1)}%, 실제공정률 ${c.actual.toFixed(1)}%로 ${(c.deviation >= 0 ? '+' : '') + c.deviation.toFixed(1)}%p (${overallStatus(c.deviation).label}).`;
  let ny = top + 11;
  for (const l of wrap(ctx, summary, nw)) {
    fitText(ctx, l, nx, ny, nw, 2.9, { color: COL.ink });
    ny += 4.4;
  }
  if (lateRows.length) {
    ny += 2;
    fitText(ctx, '지연 공종', nx, ny, nw, 2.9, { weight: 600, color: COL.late });
    ny += 4.4;
    for (const r of lateRows.slice(0, 10)) {
      fitText(ctx, `· ${r.node.task.name}`, nx, ny, nw - 30, 2.7);
      fitText(ctx, `${r.planned.toFixed(1)}→${r.actual.toFixed(1)} (${(r.actual - r.planned).toFixed(1)}%p)`, nx + nw, ny, 30, 2.6, { align: 'right', color: COL.late });
      ny += 4;
    }
  }
  if (p.statusNote.trim()) {
    ny += 3;
    fitText(ctx, '특이사항', nx, ny, nw, 2.9, { weight: 600 });
    ny += 4.4;
    font(ctx, 2.8);
    for (const l of wrap(ctx, p.statusNote, nw)) {
      if (ny > bottom - 4) break;
      fitText(ctx, l, nx, ny, nw, 2.8, { color: COL.ink2 });
      ny += 4.2;
    }
  }
  footer(ctx, W, H, p);
  flush();
  return pdf.output('blob');
}

function drawSCurve(ctx: Ctx, c: ProjectCalc, x: number, y: number, w: number, h: number) {
  fitText(ctx, '누적공정률 (S-Curve)', x, y + 3, w, 3.4, { weight: 700 });
  const lx = x + 14;
  const ty = y + 12;
  const pw = w - 18;
  const ph = h - 26;
  const n = c.periods.length;
  for (let v = 0; v <= 100; v += 25) {
    const yy = ty + ph - (v / 100) * ph;
    line(ctx, lx, yy, lx + pw, yy, COL.line2, 0.15);
    fitText(ctx, `${v}%`, lx - 2, yy, 10, 2.5, { align: 'right', color: COL.mute });
  }
  line(ctx, lx, ty + ph, lx + pw, ty + ph, COL.ink2, 0.25);
  const px = (i: number) => lx + (n <= 1 ? pw / 2 : (i / (n - 1)) * pw);
  const py = (v: number) => ty + ph - (Math.max(0, Math.min(100, v)) / 100) * ph;
  // 편차 영역
  const pts = c.periods.map((pc, i) => ({ i, plan: pc.planCum, act: pc.actCum }));
  const actPts = pts.filter((q) => q.act != null);
  if (actPts.length > 1) {
    ctx.beginPath();
    actPts.forEach((q, k) => (k ? ctx.lineTo(px(q.i), py(q.plan)) : ctx.moveTo(px(q.i), py(q.plan))));
    [...actPts].reverse().forEach((q) => ctx.lineTo(px(q.i), py(q.act!)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(207,58,49,0.13)';
    ctx.fill();
  }
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((q, k) => (k ? ctx.lineTo(px(q.i), py(q.plan)) : ctx.moveTo(px(q.i), py(q.plan))));
  ctx.strokeStyle = COL.plan;
  ctx.lineWidth = 0.5;
  ctx.stroke();
  if (actPts.length) {
    ctx.beginPath();
    actPts.forEach((q, k) => (k ? ctx.lineTo(px(q.i), py(q.act!)) : ctx.moveTo(px(q.i), py(q.act!))));
    ctx.strokeStyle = COL.act;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    actPts.forEach((q) => {
      ctx.beginPath();
      ctx.arc(px(q.i), py(q.act!), 0.8, 0, Math.PI * 2);
      ctx.fillStyle = COL.act;
      ctx.fill();
      fitText(ctx, q.act!.toFixed(1), px(q.i), py(q.act!) + 3, 12, 2.3, { align: 'center', color: COL.act, weight: 600 });
    });
  }
  // X축 라벨 (겹치지 않게 간격 조정)
  const step = Math.max(1, Math.ceil((n * 13) / pw));
  c.periods.forEach((pc, i) => {
    if (i % step && i !== n - 1) return;
    const label = pc.period.group.endsWith('년') ? `${pc.period.group.slice(2, 4)}.${pc.period.label.replace('월', '')}` : pc.period.label;
    fitText(ctx, label, px(i), ty + ph + 3.2, 13, 2.3, { align: 'center', color: COL.mute, min: 1.5 });
  });
  // 범례
  const ly = y + 7;
  line(ctx, lx + pw - 70, ly, lx + pw - 64, ly, COL.plan, 0.6);
  fitText(ctx, '누적 예정공정률', lx + pw - 63, ly, 26, 2.6, { color: COL.ink2 });
  line(ctx, lx + pw - 35, ly, lx + pw - 29, ly, COL.act, 0.6);
  fitText(ctx, '누적 실제공정률', lx + pw - 28, ly, 28, 2.6, { color: COL.ink2 });
  if (!actPts.length) fitText(ctx, '실적 이력 없음 — 기준일 실적을 저장하면 표시됩니다', lx + pw / 2, ty + ph / 2, pw, 3, { align: 'center', color: COL.mute });
}
