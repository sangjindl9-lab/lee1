// 제출용 예정공정표 PDF — 흑백 표 양식(공종·보할·기간 칸·비고, 상단 보할값+굵은 예정선, 하단 실적, 계·누계)
import { jsPDF } from 'jspdf';
import type { Project } from './types';
import { computeProject, dateToX, UNIT_LABEL, type Period } from './calc';
import { addDays, fmtDot, isValidDate } from './date';
import { buildForm, cellNum, periodHead } from './form';
import { fitText, font, line, PX, rect, setFamily, wrap } from './exportPdf';
import type { Paper } from './exportPdf';
import type { PhaseMark } from './phases';
const PHASE = '#1d4ed8';

const FAMILY_FORM = '"Nanum Gothic", "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const INK = '#111111';
const SOFT = '#bdbdbd';
const ACT = '#1b5e20';
const BASE = '#c62828';
type Ctx = CanvasRenderingContext2D;

function spaced(ctx: Ctx, text: string, cx: number, y: number, size: number, gap: number) {
  font(ctx, size, 700);
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width + (ch === ' ' ? 0 : gap));
  const total = widths.reduce((s, w) => s + w, 0) - gap;
  let x = cx - total / 2;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, y);
    x += widths[i];
  });
}

export async function exportFormPdf(p: Project, paper: Paper = 'A3', marks: PhaseMark[] = []): Promise<Blob> {
  const c = computeProject(p);
  const f = buildForm(p, c);
  setFamily(FAMILY_FORM);
  try {
    await Promise.all([document.fonts.load(`400 12px "Nanum Gothic"`, '가나다'), document.fonts.load(`700 12px "Nanum Gothic"`, '가나다')]);
    await document.fonts.ready;
  } catch {
    /* 시스템 글꼴 */
  }
  const a4 = paper === 'A4';
  const W = a4 ? 297 : 420;
  const H = a4 ? 210 : 297;
  const mx = a4 ? 12 : 16;
  const top = a4 ? 30 : 40;
  const bottom = H - (a4 ? 12 : 16);
  const nameW = a4 ? 42 : 52;
  const wW = a4 ? 13 : 15;
  const noteW = a4 ? 20 : 26;
  const tlW = W - 2 * mx - nameW - wW - noteW;
  const minCol = p.view === 'week' ? (a4 ? 8 : 9) : p.view === 'month' ? (a4 ? 14 : 15.5) : a4 ? 18 : 20;
  const perPage = Math.max(1, Math.floor(tlW / minCol));
  const n = f.periods.length;
  const pStarts: number[] = [];
  for (let i = 0; i < Math.max(1, n); i += perPage) pStarts.push(i);
  const colW = n <= perPage ? tlW / Math.max(1, n) : tlW / perPage;
  const headH = a4 ? 12 : 15;
  const showAct = p.form.showActual;
  const minHalf = a4 ? 3.4 : 4.4;
  const maxHalf = a4 ? 8 : 9.5;
  const sumRows = 2;
  const bandH = marks.length ? (a4 ? 4.6 : 5.4) : 0;
  const avail = bottom - top - headH - bandH;
  const rowsPer = Math.max(1, Math.floor(avail / (minHalf * 2)) - sumRows);
  const rStarts: number[] = [];
  for (let i = 0; i < Math.max(1, f.rows.length); i += rowsPer) rStarts.push(i);
  const pages = pStarts.length * rStarts.length;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper.toLowerCase() as 'a3' | 'a4', compress: true });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * PX);
  canvas.height = Math.round(H * PX);
  const ctx = canvas.getContext('2d')!;
  let pageNo = 0;
  const vS = a4 ? 2.35 : 2.7; // 칸 숫자 글자 크기

  for (const ps of pStarts) {
    const periods: Period[] = f.periods.slice(ps, ps + perPage);
    const idx = periods.map((_, k) => ps + k);
    for (const rs of rStarts) {
      const rows = f.rows.slice(rs, rs + rowsPer);
      const nRows = rows.length + sumRows;
      const half = Math.max(minHalf, Math.min(maxHalf, avail / nRows / 2));
      const rowH = half * 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(PX, 0, 0, PX, 0, 0);
      pageNo++;
      // 제목·개요
      spaced(ctx, p.form.title || '예 정 공 정 표', W / 2, a4 ? 13 : 18, a4 ? 7.5 : 9.5, a4 ? 1.6 : 2.2);
      const iy = top - (a4 ? 3.2 : 4);
      const isz = a4 ? 3.1 : 3.6;
      fitText(ctx, `공사명 : ${p.info.name}`, mx, iy, (W - 2 * mx) * 0.56, isz, { weight: 700, color: INK });
      fitText(ctx, `시공업체 : ${p.info.contractor} (인)`, W - mx, iy, (W - 2 * mx) * 0.4, isz, { weight: 700, color: INK, align: 'right' });
      if (p.form.showSign) {
        const sw = a4 ? 15 : 18;
        const sx = W - mx - sw * 3;
        const sy = a4 ? 5 : 7;
        (
          [
            ['작성', p.info.writer],
            ['검토', p.info.reviewer],
            ['승인', p.info.approver],
          ] as const
        ).forEach(([k, v], i) => {
          rect(ctx, sx + i * sw, sy, sw, 4.5, undefined, INK, 0.25);
          fitText(ctx, k, sx + i * sw + sw / 2, sy + 2.3, sw - 1, 2.6, { align: 'center', color: INK });
          rect(ctx, sx + i * sw, sy + 4.5, sw, a4 ? 10 : 12, undefined, INK, 0.25);
          fitText(ctx, v || '', sx + i * sw + sw / 2, sy + (a4 ? 12 : 14), sw - 1, 2.5, { align: 'center', color: INK });
        });
      }
      if (pages > 1) fitText(ctx, `${pageNo} / ${pages}`, W - mx, bottom + 5, 20, 2.6, { align: 'right', color: '#444' });

      const x0 = mx;
      const tx = mx + nameW + wW;
      const nx = tx + periods.length * colW;
      const tableW = nameW + wW + periods.length * colW + noteW;
      let y = top;
      const pS = periods.length ? periods[0].start : '';
      const pE = periods.length ? periods[periods.length - 1].end : '';
      if (bandH) {
        fitText(ctx, '차 수 구 분', x0 + (nameW + wW) / 2, y + bandH / 2, nameW + wW - 2, a4 ? 2.8 : 3.1, { align: 'center', color: INK });
        for (const m of marks) {
          if (!isValidDate(m.start) || !isValidDate(m.end) || m.end < pS || m.start > pE) continue;
          const a = tx + dateToX(m.start < pS ? pS : m.start, periods, colW);
          const b = tx + dateToX(addDays(m.end > pE ? pE : m.end, 1), periods, colW);
          rect(ctx, a, y, b - a, bandH, 'rgba(29,78,216,0.07)');
          line(ctx, a, y, a, y + bandH, PHASE, 0.45);
          line(ctx, b, y, b, y + bandH, PHASE, 0.45);
          fitText(ctx, b - a > 14 ? `${m.label} 공사` : m.label, (a + b) / 2, y + bandH / 2, Math.max(4, b - a - 1), a4 ? 2.8 : 3.1, { align: 'center', color: PHASE, weight: 700, min: 1.6 });
        }
        line(ctx, x0, y + bandH, x0 + tableW, y + bandH, INK, 0.25);
        y += bandH;
      }
      const hTop = y;
      // 머리글
      const hh = headH / 2;
      fitText(ctx, '공       종', x0 + nameW / 2, y + headH / 2, nameW - 2, a4 ? 3 : 3.4, { align: 'center', color: INK });
      fitText(ctx, '보할', x0 + nameW + wW / 2, y + headH / 2 - 1.8, wW - 1, a4 ? 2.8 : 3.2, { align: 'center', color: INK });
      fitText(ctx, '(%)', x0 + nameW + wW / 2, y + headH / 2 + 1.9, wW - 1, a4 ? 2.6 : 3, { align: 'center', color: INK });
      let gi = 0;
      while (gi < periods.length) {
        let gj = gi;
        const top0 = periodHead(periods[gi]).top;
        while (gj + 1 < periods.length && periodHead(periods[gj + 1]).top === top0) gj++;
        fitText(ctx, top0, tx + ((gi + gj + 1) * colW) / 2, y + hh / 2, (gj - gi + 1) * colW - 1, a4 ? 2.9 : 3.3, { align: 'center', color: INK });
        if (gi) line(ctx, tx + gi * colW, y, tx + gi * colW, y + hh, INK, 0.25);
        gi = gj + 1;
      }
      line(ctx, tx, y + hh, nx, y + hh, INK, 0.25);
      periods.forEach((pr, k) => {
        fitText(ctx, periodHead(pr).label, tx + k * colW + colW / 2, y + hh + hh / 2, colW - 1, a4 ? 2.7 : 3.1, { align: 'center', color: INK, min: 1.6 });
      });
      fitText(ctx, '비     고', nx + noteW / 2, y + headH / 2, noteW - 2, a4 ? 3 : 3.4, { align: 'center', color: INK });
      y += headH;
      line(ctx, x0, y, x0 + tableW, y, INK, 0.3);
      const bodyTop = y;

      const drawRow = (r: (typeof rows)[number]) => {
        // 공종명 (최대 2줄)
        const nsz = a4 ? 2.8 : 3.2;
        font(ctx, nsz);
        const pad = 1.6 + r.depth * 2.2;
        const lines = wrap(ctx, r.label, nameW - pad - 1.5);
        const shown = lines.length > 2 ? [lines[0], lines.slice(1).join('')] : lines;
        shown.forEach((l, li) => fitText(ctx, l, x0 + pad, y + rowH / 2 + (li - (shown.length - 1) / 2) * (nsz * 1.3), nameW - pad - 1.5, nsz, { color: INK, weight: r.depth === 0 && c.byId.get(r.id)?.node.isLeaf === false ? 700 : 400 }));
        fitText(ctx, r.weight.toFixed(2), x0 + nameW + wW - 1.2, y + rowH / 2, wW - 2, a4 ? 2.8 : 3.2, { align: 'right', color: INK });
        line(ctx, tx, y + half, nx, y + half, SOFT, 0.12);
        // 예정선
        if (isValidDate(r.start) && isValidDate(r.end) && periods.length) {
          const s = r.start < periods[0].start ? periods[0].start : r.start;
          const e = r.end > periods[periods.length - 1].end ? periods[periods.length - 1].end : r.end;
          if (s <= e) {
            const a = tx + dateToX(s, periods, colW);
            const b = tx + dateToX(addDays(e, 1), periods, colW);
            rect(ctx, a, y + half - (r.color ? 0.7 : 0.45), Math.max(0.5, b - a), r.color ? 1.4 : 0.9, r.color || INK);
          }
        }
        // 실적선(실제 착수일이 있을 때만, 점선)
        if (showAct && r.actStart && periods.length) {
          const ae = r.actEnd || p.info.baseDate;
          const s = r.actStart < periods[0].start ? periods[0].start : r.actStart;
          const e = ae > periods[periods.length - 1].end ? periods[periods.length - 1].end : ae;
          if (s <= e) {
            const a = tx + dateToX(s, periods, colW);
            const b = tx + dateToX(addDays(e, 1), periods, colW);
            line(ctx, a, y + rowH - 1.6, b, y + rowH - 1.6, INK, 0.75, [1.6, 0.8]);
          }
        }
        idx.forEach((gi2, k) => {
          const v = cellNum(r.plan[gi2]);
          if (v) fitText(ctx, v, tx + k * colW + colW / 2, y + half * 0.45, colW - 0.8, vS, { align: 'center', color: INK, min: 1.4 });
          if (showAct) {
            const a = cellNum(r.act[gi2]);
            if (a) fitText(ctx, a, tx + k * colW + colW / 2, y + half + half * 0.45, colW - 0.8, vS, { align: 'center', color: ACT, weight: 700, min: 1.4 });
          }
        });
        if (r.note) {
          font(ctx, 2.5);
          wrap(ctx, r.note, noteW - 2)
            .slice(0, 2)
            .forEach((l, li) => fitText(ctx, l, nx + 1, y + 2.4 + li * 3.2, noteW - 2, 2.5, { color: INK }));
        }
        line(ctx, x0, y + rowH, x0 + tableW, y + rowH, INK, 0.25);
        y += rowH;
      };
      rows.forEach(drawRow);
      const sumRow = (label: string, a: (number | null)[], b: (number | null)[], wt: string) => {
        fitText(ctx, label, x0 + nameW / 2, y + rowH / 2, nameW - 2, a4 ? 3 : 3.4, { align: 'center', color: INK, weight: 700 });
        if (wt) fitText(ctx, wt, x0 + nameW + wW - 1.2, y + rowH / 2, wW - 2, a4 ? 2.8 : 3.2, { align: 'right', color: INK, weight: 700 });
        if (showAct) line(ctx, tx, y + half, nx, y + half, SOFT, 0.12);
        idx.forEach((gi2, k) => {
          const va = a[gi2];
          if (va != null) fitText(ctx, va.toFixed(2), tx + k * colW + colW / 2, showAct ? y + half / 2 + 0.3 : y + rowH / 2, colW - 0.8, vS + 0.2, { align: 'center', color: INK, min: 1.4 });
          if (showAct) {
            const vb = b[gi2];
            if (vb != null) fitText(ctx, vb.toFixed(2), tx + k * colW + colW / 2, y + half + half / 2, colW - 0.8, vS + 0.2, { align: 'center', color: ACT, weight: 700, min: 1.4 });
          }
        });
        line(ctx, x0, y + rowH, x0 + tableW, y + rowH, INK, 0.25);
        y += rowH;
      };
      sumRow('계', f.planSum, f.actSum, f.weightTotal.toFixed(1));
      sumRow('누      계', f.planCum, f.actCum, '');
      // 세로선
      line(ctx, x0 + nameW, hTop, x0 + nameW, y, INK, 0.25);
      line(ctx, tx, top, tx, y, INK, 0.25);
      periods.forEach((_, k) => k && line(ctx, tx + k * colW, hTop + hh, tx + k * colW, y, INK, 0.2));
      // 차수 경계선
      for (const m of marks) {
        if (isValidDate(m.start) && m.start > pS && m.start <= pE) {
          const mx2 = tx + dateToX(m.start, periods, colW);
          line(ctx, mx2, hTop + headH, mx2, y, PHASE, 0.5);
        }
      }
      line(ctx, nx, top, nx, y, INK, 0.25);
      // 기준일 선
      if (periods.length && p.info.baseDate >= periods[0].start && p.info.baseDate <= periods[periods.length - 1].end) {
        const bx = tx + dateToX(addDays(p.info.baseDate, 1), periods, colW);
        line(ctx, bx, bodyTop, bx, y, BASE, 0.3, [1, 0.8]);
      }
      rect(ctx, x0, top, tableW, y - top, undefined, INK, 0.5);
      // 범례
      const ly = Math.min(bottom + 5, H - 4);
      ctx.setLineDash([]);
      fitText(
        ctx,
        `${UNIT_LABEL[p.view]} · 보할 배분 ${p.calendar.distribution === 'month' ? '월 균등' : '작업일 비례'} · 상단: 예정공정(굵은 선, 기간별 보할 %)${showAct ? ' · 하단: 실적(녹색 값, 점선은 실제 수행기간)' : ''} · 기준일 ${fmtDot(p.info.baseDate)}(붉은 점선)${rStarts.length > 1 ? ` · 공종 ${rs + 1}~${rs + rows.length}/${f.rows.length}` : ''}`,
        mx,
        ly,
        W - 2 * mx - 24,
        2.4,
        { color: '#555' },
      );
      if (pageNo > 1) pdf.addPage(paper.toLowerCase(), 'landscape');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, W, H, undefined, 'FAST');
    }
  }
  return pdf.output('blob');
}
