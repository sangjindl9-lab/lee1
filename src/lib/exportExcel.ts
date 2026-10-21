// Excel 출력 (ExcelJS) — 편집 가능한 보할공정표. 현재 선택한 공정표 단위(월/주/20일)를 반영한다.
import ExcelJS from 'exceljs';
import type { Project } from './types';
import { computeProject, entryPct, plannedPct, sortedHistory, STATUS_LABEL, UNIT_LABEL } from './calc';
import { addDays, fmtDot, isValidDate, toNum } from './date';
import { buildForm, periodHead } from './form';
import { groupMembers, phaseLabel, phaseMarks, summarizePhases, type PhaseMark } from './phases';
import type { ProjectCalc } from './calc';

const FONT = '맑은 고딕';
const C = {
  head: 'FF253446',
  headInk: 'FFFFFFFF',
  plan: 'FFCDDFF9',
  planInk: 'FF1F4FA0',
  act: 'FF2B9A57',
  done: 'FF15603A',
  late: 'FFCF3A31',
  sunk: 'FFF1F4F7',
  line: 'FFB8C1CC',
};
const thin = { style: 'thin' as const, color: { argb: C.line } };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

export async function exportExcel(p: Project, all: Project[] = []): Promise<Blob> {
  const c = computeProject(p);
  const wb = new ExcelJS.Workbook();
  wb.creator = p.info.writer || '예정공정표';
  wb.created = new Date();
  const costMode = p.weightMode === 'cost';
  addFormSheet(wb, p, c, phaseMarks(all, p));
  if (p.contract) addPhaseSheet(wb, p, all);

  // ───── 시트2: 관리용 상세 공정표 ─────
  const ws = wb.addWorksheet(`관리용(${UNIT_LABEL[p.view]})`, {
    pageSetup: { paperSize: 8 as any, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    views: [{ state: 'frozen', xSplit: costMode ? 10 : 9, ySplit: 8 }], // = 고정 열 수
  });
  const fixed = ['No', '공종명', '보할(%)', ...(costMode ? ['공사비(원)'] : []), '계획 시작', '계획 종료', '예정(%)', '실적(%)', '상태', '구분'];
  const nf = fixed.length;
  const periods = c.periods.map((x) => x.period);
  const widths = [6, 34, 9, ...(costMode ? [15] : []), 11, 11, 9, 9, 8, 6];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const pw = p.view === 'week' ? 6.5 : p.view === 'month' ? 8.5 : 11;
  periods.forEach((_, i) => (ws.getColumn(nf + i + 1).width = pw));
  const lastCol = Math.max(nf + periods.length, nf + 3);
  const colOf = (k: string) => fixed.indexOf(k) + 1;

  const style = (cell: ExcelJS.Cell, o: Partial<ExcelJS.Style> = {}) => {
    cell.font = { name: FONT, size: 9, ...(o.font || {}) };
    cell.border = border;
    cell.alignment = { vertical: 'middle', ...(o.alignment || {}) };
    if (o.fill) cell.fill = o.fill;
    if (o.numFmt) cell.numFmt = o.numFmt;
  };

  // 제목 + 개요 + 결재란
  ws.mergeCells(1, 1, 1, lastCol - 3);
  const title = ws.getCell(1, 1);
  title.value = `예정공정표 (보할공정표) — ${UNIT_LABEL[p.view]}`;
  title.font = { name: FONT, size: 16, bold: true };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 30;
  const info: [string, string][] = [
    ['공 사 명', p.info.name],
    ['발주처 / 시공사', `${p.info.client} / ${p.info.contractor}`],
    ['공사기간', `${fmtDot(p.info.start)} ~ ${fmtDot(p.info.end)} (${c.totalDays}일)   계약금액 ${p.info.amount.toLocaleString('ko-KR')}원`],
    ['기준일 / 공정률', `${fmtDot(p.info.baseDate)}   예정 ${c.planned.toFixed(1)}%  실적 ${c.actual.toFixed(1)}%  편차 ${(c.deviation >= 0 ? '+' : '') + c.deviation.toFixed(1)}%p   문서번호 ${p.info.docNo}`],
  ];
  info.forEach(([k, v], i) => {
    const r = 2 + i;
    ws.mergeCells(r, 1, r, 2);
    ws.getCell(r, 1).value = k;
    ws.getCell(r, 1).font = { name: FONT, size: 9.5, bold: true };
    ws.mergeCells(r, 3, r, lastCol - 3);
    ws.getCell(r, 3).value = v;
    ws.getCell(r, 3).font = { name: FONT, size: 9.5 };
  });
  const sign: [string, string][] = [
    ['작성', p.info.writer],
    ['검토', p.info.reviewer],
    ['승인', p.info.approver],
  ];
  sign.forEach(([k, v], i) => {
    const col = lastCol - 2 + i;
    const h = ws.getCell(1, col);
    h.value = k;
    style(h, { fill: fill(C.sunk), font: { bold: true } as any, alignment: { horizontal: 'center' } });
    ws.mergeCells(2, col, 5, col);
    const b = ws.getCell(2, col);
    b.value = v;
    style(b, { alignment: { horizontal: 'center', vertical: 'bottom' } });
  });

  // 머리글 (7~8행)
  const H1 = 7;
  const H2 = 8;
  fixed.forEach((label, i) => {
    ws.mergeCells(H1, i + 1, H2, i + 1);
    const cell = ws.getCell(H1, i + 1);
    cell.value = label;
    style(cell, { fill: fill(C.head), font: { bold: true, color: { argb: C.headInk } } as any, alignment: { horizontal: 'center', wrapText: true } });
  });
  let gi = 0;
  while (gi < periods.length) {
    let gj = gi;
    while (gj + 1 < periods.length && periods[gj + 1].group === periods[gi].group) gj++;
    if (gj > gi) ws.mergeCells(H1, nf + gi + 1, H1, nf + gj + 1);
    const cell = ws.getCell(H1, nf + gi + 1);
    cell.value = periods[gi].group;
    style(cell, { fill: fill(C.head), font: { bold: true, color: { argb: C.headInk } } as any, alignment: { horizontal: 'center' } });
    gi = gj + 1;
  }
  periods.forEach((pr, i) => {
    const cell = ws.getCell(H2, nf + i + 1);
    cell.value = pr.label;
    style(cell, { fill: fill(C.head), font: { size: 8, color: { argb: C.headInk } } as any, alignment: { horizontal: 'center', wrapText: true } });
  });
  ws.getRow(H2).height = p.view === 'd20' ? 26 : 18;

  // 본문: 공종마다 계획/실적 2행
  let r = H2 + 1;
  const leafPlanRows: number[] = [];
  const weightCol = colOf('보할(%)');
  const planCol = colOf('예정(%)');
  const actCol = colOf('실적(%)');
  for (const row of c.rows) {
    const t = row.node.task;
    const leaf = row.node.isLeaf;
    const r1 = r;
    const r2 = r + 1;
    const indent = '  '.repeat(row.node.depth);
    const base = leaf ? {} : { font: { bold: true } as any, fill: fill(C.sunk) };
    const put = (col: number, v: ExcelJS.CellValue, o: Partial<ExcelJS.Style> = {}, merge = true) => {
      if (merge) ws.mergeCells(r1, col, r2, col);
      const cell = ws.getCell(r1, col);
      cell.value = v;
      style(cell, { ...base, ...o, font: { ...((base as any).font || {}), ...((o.font as any) || {}) } });
    };
    put(1, row.node.num, { alignment: { horizontal: 'center' } });
    put(2, indent + t.name, { alignment: { wrapText: true } });
    put(weightCol, Math.round(row.node.weight * 10000) / 10000, { numFmt: '0.00', alignment: { horizontal: 'right' } });
    if (costMode) put(colOf('공사비(원)'), leaf ? t.cost : row.node.leaves.reduce((s, x) => s + (x.cost || 0), 0), { numFmt: '#,##0', alignment: { horizontal: 'right' } });
    put(colOf('계획 시작'), fmtDot(row.node.start), { alignment: { horizontal: 'center' } });
    put(colOf('계획 종료'), fmtDot(row.node.end), { alignment: { horizontal: 'center' } });
    put(planCol, Math.round(row.planned * 100) / 100, { numFmt: '0.0', alignment: { horizontal: 'right' } });
    put(actCol, Math.round(row.actual * 100) / 100, { numFmt: '0.0', alignment: { horizontal: 'right' } });
    put(colOf('상태'), STATUS_LABEL[row.status], {
      alignment: { horizontal: 'center' },
      font: { bold: true, color: { argb: row.status === 'late' ? C.late : row.status === 'done' ? C.done : row.status === 'idle' ? 'FF8A96A3' : C.act } } as any,
    });
    const g1 = ws.getCell(r1, nf);
    g1.value = '계획';
    style(g1, { ...base, alignment: { horizontal: 'center' }, font: { size: 8, color: { argb: C.planInk } } as any });
    const g2 = ws.getCell(r2, nf);
    g2.value = '실적';
    style(g2, { ...base, alignment: { horizontal: 'center' }, font: { size: 8, color: { argb: C.act } } as any });

    // 계획 막대 + 기간별 보할 반영 계획값
    const planIdx: number[] = [];
    periods.forEach((pr, i) => {
      const cp = ws.getCell(r1, nf + i + 1);
      const ca = ws.getCell(r2, nf + i + 1);
      style(cp, { alignment: { horizontal: 'center' }, font: { size: 7.5, color: { argb: C.planInk } } as any });
      style(ca, { alignment: { horizontal: 'center' }, font: { size: 7.5, color: { argb: 'FFFFFFFF' } } as any });
      const overlap = isValidDate(row.node.start) && row.node.start <= pr.end && row.node.end >= pr.start;
      if (overlap) {
        cp.fill = fill(t.color && leaf ? 'FF' + t.color.replace('#', '').toUpperCase() : C.plan);
        if (t.color && leaf) cp.font = { name: FONT, size: 7.5, color: { argb: 'FFFFFFFF' } };
        planIdx.push(i);
        if (leaf) {
          const prev = i ? plannedPct(t, addDays(pr.start, -1), c.cal) : 0;
          const now = plannedPct(t, pr.end, c.cal);
          const v = ((now - prev) * (t.weight || 0)) / 100;
          if (v > 0.0049) {
            cp.value = Math.round(v * 100) / 100;
            cp.numFmt = '0.00';
          }
        }
      }
    });
    // 실적 막대: 실제 착수일이 있으면 실제 기간, 없으면 계획 구간 중 달성률만큼
    const actColor = row.status === 'done' ? C.done : row.status === 'late' ? C.late : C.act;
    if (leaf && isValidDate(t.actualStart)) {
      const ae = isValidDate(t.actualEnd) ? t.actualEnd : p.info.baseDate;
      periods.forEach((pr, i) => {
        if (t.actualStart <= pr.end && ae >= pr.start) ws.getCell(r2, nf + i + 1).fill = fill(actColor);
      });
    } else if (row.actual > 0 && planIdx.length) {
      const k = Math.max(1, Math.round((row.actual / 100) * planIdx.length));
      planIdx.slice(0, k).forEach((i) => (ws.getCell(r2, nf + i + 1).fill = fill(actColor)));
      ws.getCell(r2, nf + planIdx[Math.min(k, planIdx.length) - 1] + 1).value = `${Math.round(row.actual)}%`;
    }
    if (leaf) leafPlanRows.push(r1);
    ws.getRow(r1).height = 15;
    ws.getRow(r2).height = 13;
    r += 2;
  }

  // 합계 행 (수식으로 편집 가능)
  const colL = (n: number) => ws.getColumn(n).letter;
  const wL = colL(weightCol);
  const pL = colL(planCol);
  const aL = colL(actCol);
  const sumW = leafPlanRows.length ? `SUM(${leafPlanRows.map((x) => `${wL}${x}`).join(',')})` : '0';
  const prodP = leafPlanRows.length ? leafPlanRows.map((x) => `${wL}${x}*${pL}${x}`).join('+') : '0';
  const prodA = leafPlanRows.length ? leafPlanRows.map((x) => `${wL}${x}*${aL}${x}`).join('+') : '0';
  ws.mergeCells(r, 1, r, 2);
  ws.getCell(r, 1).value = '합 계';
  for (let col = 1; col <= nf; col++) style(ws.getCell(r, col), { fill: fill(C.sunk), font: { bold: true } as any, alignment: { horizontal: col <= 2 ? 'center' : 'right' } });
  ws.getCell(r, weightCol).value = { formula: sumW, result: c.weightTotal };
  ws.getCell(r, weightCol).numFmt = '0.00';
  ws.getCell(r, planCol).value = { formula: `IF(${sumW}=0,0,(${prodP})/${sumW})`, result: c.planned };
  ws.getCell(r, planCol).numFmt = '0.0';
  ws.getCell(r, actCol).value = { formula: `IF(${sumW}=0,0,(${prodA})/${sumW})`, result: c.actual };
  ws.getCell(r, actCol).numFmt = '0.0';
  if (Math.abs(c.weightTotal - 100) > 0.005) ws.getCell(r, weightCol).font = { name: FONT, size: 9, bold: true, color: { argb: C.late } };
  periods.forEach((_, i) => style(ws.getCell(r, nf + i + 1), { fill: fill(C.sunk) }));
  r++;

  const foot: [string, (i: number) => number | null, string][] = [
    ['기간 예정공정률(%)', (i) => c.periods[i].planDelta, C.planInk],
    ['예정공정률 누계(%)', (i) => c.periods[i].planCum, C.planInk],
    ['기간 실제공정률(%)', (i) => c.periods[i].actDelta, C.act],
    ['실제공정률 누계(%)', (i) => c.periods[i].actCum, C.act],
  ];
  for (const [label, fn, color] of foot) {
    ws.mergeCells(r, 1, r, nf);
    const cell = ws.getCell(r, 1);
    cell.value = label;
    style(cell, { fill: fill(C.sunk), font: { bold: true, color: { argb: color } } as any, alignment: { horizontal: 'right' } });
    periods.forEach((_, i) => {
      const v = fn(i);
      const cc = ws.getCell(r, nf + i + 1);
      cc.value = v == null ? '-' : Math.round(v * 10) / 10;
      style(cc, { numFmt: '0.0', alignment: { horizontal: 'center' }, font: { size: 8, bold: label.includes('누계') } as any });
    });
    r++;
  }
  ws.getCell(r + 1, 1).value = `※ 계획 행 숫자: 기간별 보할 반영 예정공정률(보할×기간 진도). 실적 막대는 실제 착수일이 있으면 실제 수행기간, 없으면 계획기간 중 달성률만큼 표시. 기준일 ${fmtDot(p.info.baseDate)} · 작업일 기준: ${p.calendar.mode === 'weekday' ? '주말 제외' : '전체 달력일'}${p.calendar.holidays.length ? ` · 지정 휴무일 ${p.calendar.holidays.length}일` : ''}`;
  ws.getCell(r + 1, 1).font = { name: FONT, size: 8.5, color: { argb: 'FF5D6976' } };
  ws.pageSetup.printTitlesRow = `${H1}:${H2}`;

  // ───── 시트2: 보할표 ─────
  const wb2 = wb.addWorksheet('보할표');
  wb2.columns = [
    { header: 'No', width: 7 },
    { header: '공종명', width: 36 },
    { header: '공사비(원)', width: 16 },
    { header: '보할(%)', width: 10 },
    { header: '계획 시작', width: 12 },
    { header: '계획 종료', width: 12 },
    { header: '계획일수', width: 9 },
    { header: '예정(%)', width: 9 },
    { header: '실적(%)', width: 9 },
    { header: '편차(%p)', width: 9 },
    { header: '보할 반영 예정', width: 12 },
    { header: '보할 반영 실적', width: 12 },
    { header: '실제 착수', width: 12 },
    { header: '실제 완료', width: 12 },
    { header: '비고', width: 24 },
    { header: '메모', width: 30 },
  ];
  wb2.getRow(1).eachCell((cell) => style(cell, { fill: fill(C.head), font: { bold: true, color: { argb: C.headInk } } as any, alignment: { horizontal: 'center' } }));
  for (const row of c.rows) {
    const t = row.node.task;
    const leaf = row.node.isLeaf;
    const rr = wb2.addRow([
      row.node.num,
      '  '.repeat(row.node.depth) + t.name,
      leaf ? t.cost : row.node.leaves.reduce((s, x) => s + (x.cost || 0), 0),
      Math.round(row.node.weight * 10000) / 10000,
      fmtDot(row.node.start),
      fmtDot(row.node.end),
      isValidDate(row.node.start) ? toNum(row.node.end) - toNum(row.node.start) + 1 : '',
      Math.round(row.planned * 100) / 100,
      Math.round(row.actual * 100) / 100,
      Math.round((row.actual - row.planned) * 100) / 100,
      leaf ? Math.round(((t.weight || 0) * row.planned) / 100 * 100) / 100 : null,
      leaf ? Math.round(((t.weight || 0) * row.actual) / 100 * 100) / 100 : null,
      fmtDot(t.actualStart),
      fmtDot(t.actualEnd),
      t.note,
      t.memo,
    ]);
    rr.eachCell({ includeEmpty: true }, (cell, col) => style(cell, { fill: leaf ? undefined : fill(C.sunk), font: { bold: !leaf } as any, numFmt: col === 3 ? '#,##0' : col === 4 ? '0.00' : col >= 8 && col <= 12 ? '0.00' : undefined }));
  }
  const tot = wb2.addRow(['', '합계', c.costTotal, Math.round(c.weightTotal * 100) / 100, '', '', '', Math.round(c.planned * 100) / 100, Math.round(c.actual * 100) / 100, Math.round(c.deviation * 100) / 100]);
  tot.eachCell({ includeEmpty: true }, (cell, col) => style(cell, { fill: fill(C.sunk), font: { bold: true } as any, numFmt: col === 3 ? '#,##0' : '0.00' }));
  wb2.views = [{ state: 'frozen', ySplit: 1 }];

  // ───── 시트3: 누적공정률 ─────
  const w3 = wb.addWorksheet('누적공정률');
  w3.columns = [
    { header: '구간', width: 12 },
    { header: '시작', width: 12 },
    { header: '종료', width: 12 },
    { header: '기간 예정(%)', width: 12 },
    { header: '예정 누계(%)', width: 12 },
    { header: '기간 실적(%)', width: 12 },
    { header: '실적 누계(%)', width: 12 },
    { header: '편차(%p)', width: 10 },
    { header: '실적 입력일', width: 12 },
  ];
  w3.getRow(1).eachCell((cell) => style(cell, { fill: fill(C.head), font: { bold: true, color: { argb: C.headInk } } as any, alignment: { horizontal: 'center' } }));
  for (const x of c.periods) {
    const rr = w3.addRow([
      `${x.period.group} ${x.period.label}`,
      fmtDot(x.period.start),
      fmtDot(x.period.end),
      Math.round(x.planDelta * 100) / 100,
      Math.round(x.planCum * 100) / 100,
      x.actDelta == null ? '데이터 없음' : Math.round(x.actDelta * 100) / 100,
      x.actCum == null ? '데이터 없음' : Math.round(x.actCum * 100) / 100,
      x.actCum == null ? '' : Math.round((x.actCum - x.planCum) * 100) / 100,
      x.actDate ? fmtDot(x.actDate) : '',
    ]);
    rr.eachCell({ includeEmpty: true }, (cell) => style(cell, { numFmt: '0.00' }));
  }

  // ───── 시트4: 실적이력 ─────
  const hist = sortedHistory(p.history);
  const w4 = wb.addWorksheet('실적이력');
  const leaves = c.rows.filter((x) => x.node.isLeaf);
  w4.columns = [{ header: '입력일', width: 12 }, { header: '전체 실적(%)', width: 12 }, { header: '비고', width: 26 }, ...leaves.map((x) => ({ header: `${x.node.num} ${x.node.task.name}`, width: 14 }))];
  w4.getRow(1).height = 42;
  w4.getRow(1).eachCell((cell) => style(cell, { fill: fill(C.head), font: { bold: true, color: { argb: C.headInk } } as any, alignment: { horizontal: 'center', wrapText: true } }));
  for (const h of hist) {
    const rr = w4.addRow([fmtDot(h.date), Math.round(entryPct(h, c.tree.leaves) * 100) / 100, h.note, ...leaves.map((x) => h.values[x.node.task.id] ?? null)]);
    rr.eachCell({ includeEmpty: true }, (cell) => style(cell, { numFmt: '0.0' }));
  }
  if (!hist.length) w4.addRow(['저장된 실적 이력이 없습니다.']);

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** 제출용 양식 시트: 공종·보할·기간·비고, 공종마다 2행(상단 예정값+굵은 밑줄 = 예정선, 하단 실적), 계·누계는 수식 */
function addFormSheet(wb: ExcelJS.Workbook, p: Project, c: ProjectCalc, marks: PhaseMark[] = []) {
  const f = buildForm(p, c);
  const ws = wb.addWorksheet('예정공정표(제출용)', {
    pageSetup: { paperSize: 8 as any, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ state: 'frozen', xSplit: 2, ySplit: 5, showGridLines: false }],
  });
  const n = f.periods.length;
  const T0 = 3; // 첫 기간 열
  const noteCol = T0 + n;
  const black = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const all = { top: black, left: black, bottom: black, right: black };
  const F = (size = 10, bold = false, color = 'FF000000') => ({ name: FONT, size, bold, color: { argb: color } });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 8;
  for (let i = 0; i < n; i++) ws.getColumn(T0 + i).width = p.view === 'week' ? 6.5 : p.view === 'month' ? 8.2 : 11;
  ws.getColumn(noteCol).width = 14;

  ws.mergeCells(1, 1, 1, noteCol);
  const t = ws.getCell(1, 1);
  t.value = p.form.title || '예 정 공 정 표';
  t.font = F(20, true);
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 40;
  const half = Math.max(1, Math.ceil(noteCol * 0.6));
  ws.mergeCells(2, 1, 2, half);
  ws.getCell(2, 1).value = `공사명 : ${p.info.name}`;
  ws.getCell(2, 1).font = F(10.5, true);
  if (half + 1 <= noteCol) {
    if (noteCol > half + 1) ws.mergeCells(2, half + 1, 2, noteCol);
    const r = ws.getCell(2, half + 1);
    r.value = `시공업체 : ${p.info.contractor} (인)`;
    r.alignment = { horizontal: 'right' };
    r.font = F(10.5, true);
  }
  ws.getRow(2).height = 22;

  // 3행: 차수 구분(총차 공정표)
  if (marks.length) {
    const lc = ws.getCell(3, 1);
    ws.mergeCells(3, 1, 3, 2);
    lc.value = '차 수 구 분';
    lc.font = F(10);
    lc.alignment = { horizontal: 'center', vertical: 'middle' };
    for (const col of [1, 2, noteCol]) ws.getCell(3, col).border = all;
    const used = new Set<number>();
    for (const m of marks) {
      const cols = f.periods.map((pr, i) => (m.start <= pr.end && m.end >= pr.start ? i : -1)).filter((i) => i >= 0 && !used.has(i));
      if (!cols.length) continue;
      cols.forEach((i) => used.add(i));
      const a = T0 + cols[0];
      const b = T0 + cols[cols.length - 1];
      if (b > a) ws.mergeCells(3, a, 3, b);
      const cell = ws.getCell(3, a);
      cell.value = `${m.label} 공사 (${fmtDot(m.start)}~${fmtDot(m.end)})`;
      cell.font = F(9, true, 'FF1D4ED8');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FD' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', shrinkToFit: true };
      const med = { style: 'medium' as const, color: { argb: 'FF1D4ED8' } };
      for (let col = a; col <= b; col++) ws.getCell(3, col).border = { top: black, bottom: black, left: col === a ? med : undefined, right: col === b ? med : undefined };
    }
    ws.getRow(3).height = 20;
  }
  // 머리글 4~5행
  const H1 = 4;
  const H2 = 5;
  const head = (r1: number, c1: number, r2: number, c2: number, v: string) => {
    if (r1 !== r2 || c1 !== c2) ws.mergeCells(r1, c1, r2, c2);
    const cell = ws.getCell(r1, c1);
    cell.value = v;
    cell.font = F(10);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let r = r1; r <= r2; r++) for (let cc = c1; cc <= c2; cc++) ws.getCell(r, cc).border = all;
  };
  head(H1, 1, H2, 1, '공       종');
  head(H1, 2, H2, 2, '보할\n(%)');
  let gi = 0;
  while (gi < n) {
    let gj = gi;
    const top0 = periodHead(f.periods[gi]).top;
    while (gj + 1 < n && periodHead(f.periods[gj + 1]).top === top0) gj++;
    head(H1, T0 + gi, H1, T0 + gj, top0);
    gi = gj + 1;
  }
  f.periods.forEach((pr, i) => head(H2, T0 + i, H2, T0 + i, periodHead(pr).label));
  head(H1, noteCol, H2, noteCol, '비       고');
  ws.getRow(H1).height = 20;
  ws.getRow(H2).height = p.view === 'd20' ? 28 : 20;

  const showAct = p.form.showActual;
  const ACTC = 'FF1B5E20';
  let r = H2 + 1;
  const planRows: number[] = [];
  const actRows: number[] = [];
  for (const row of f.rows) {
    const r1 = r;
    const r2 = r + 1;
    const lineColor = { argb: row.color ? 'FF' + row.color.slice(1).toUpperCase() : 'FF000000' };
    ws.mergeCells(r1, 1, r2, 1);
    const nameC = ws.getCell(r1, 1);
    nameC.value = '   '.repeat(row.depth) + row.label;
    const isParent = c.byId.get(row.id)?.node.isLeaf === false && p.form.level === 'all';
    nameC.font = F(10, isParent);
    nameC.alignment = { vertical: 'middle', wrapText: true };
    ws.mergeCells(r1, 2, r2, 2);
    const wC = ws.getCell(r1, 2);
    wC.value = Math.round(row.weight * 100) / 100;
    wC.numFmt = '0.00';
    wC.font = F(10);
    wC.alignment = { horizontal: 'right', vertical: 'middle' };
    ws.mergeCells(r1, noteCol, r2, noteCol);
    const noteC = ws.getCell(r1, noteCol);
    noteC.value = row.note;
    noteC.font = F(9);
    noteC.alignment = { vertical: 'middle', wrapText: true };
    [1, 2, noteCol].forEach((col) => {
      ws.getCell(r1, col).border = all;
      ws.getCell(r2, col).border = all;
    });
    f.periods.forEach((pr, i) => {
      const up = ws.getCell(r1, T0 + i);
      const dn = ws.getCell(r2, T0 + i);
      const v = row.plan[i];
      if (Math.abs(v) >= 0.005) up.value = Math.round(v * 100) / 100;
      up.numFmt = '0.00';
      up.font = F(8);
      up.alignment = { horizontal: 'center', vertical: 'top' };
      const inPlan = isValidDate(row.start) && row.start <= pr.end && row.end >= pr.start;
      up.border = { left: black, right: black, top: black, bottom: inPlan ? { style: 'thick', color: lineColor } : { style: 'hair', color: { argb: 'FFBDBDBD' } } };
      const a = row.act[i];
      if (showAct && a != null && Math.abs(a) >= 0.005) {
        dn.value = Math.round(a * 100) / 100;
        dn.numFmt = '0.00';
      }
      dn.font = F(8, true, ACTC);
      dn.alignment = { horizontal: 'center', vertical: 'top' };
      const ae = row.actEnd || (row.actStart ? p.info.baseDate : '');
      const inAct = showAct && row.actStart && row.actStart <= pr.end && ae >= pr.start;
      dn.border = { left: black, right: black, bottom: black, top: inPlan ? { style: 'thick', color: lineColor } : { style: 'hair', color: { argb: 'FFBDBDBD' } } };
      if (inAct) dn.border = { ...dn.border, bottom: { style: 'mediumDashed', color: { argb: 'FF000000' } } };
    });
    ws.getRow(r1).height = 21;
    ws.getRow(r2).height = 19;
    const isLeafRow = p.form.level === 'top' || c.byId.get(row.id)?.node.isLeaf;
    if (isLeafRow) {
      planRows.push(r1);
      actRows.push(r2);
    }
    r += 2;
  }
  // 계·누계 (수식)
  const L = (col: number) => ws.getColumn(col).letter;
  const sumRow = (label: string, kind: 'sum' | 'cum') => {
    const r1 = r;
    const r2 = showAct ? r + 1 : r;
    if (r2 > r1) ws.mergeCells(r1, 1, r2, 1);
    const lc = ws.getCell(r1, 1);
    lc.value = label;
    lc.font = F(10.5, true);
    lc.alignment = { horizontal: 'center', vertical: 'middle' };
    if (r2 > r1) ws.mergeCells(r1, 2, r2, 2);
    const wc = ws.getCell(r1, 2);
    if (kind === 'sum') {
      wc.value = planRows.length ? { formula: `SUM(${planRows.map((x) => `B${x}`).join(',')})`, result: Math.round(f.weightTotal * 100) / 100 } : 0;
      wc.numFmt = '0.0';
    }
    wc.font = F(10, true);
    wc.alignment = { horizontal: 'right', vertical: 'middle' };
    if (r2 > r1) ws.mergeCells(r1, noteCol, r2, noteCol);
    [1, 2, noteCol].forEach((col) => {
      ws.getCell(r1, col).border = all;
      ws.getCell(r2, col).border = all;
    });
    f.periods.forEach((_, i) => {
      const col = T0 + i;
      const up = ws.getCell(r1, col);
      if (kind === 'sum') up.value = { formula: planRows.length ? `SUM(${planRows.map((x) => `${L(col)}${x}`).join(',')})` : '0', result: Math.round(f.planSum[i] * 100) / 100 };
      else up.value = { formula: i ? `${L(col - 1)}${r1}+${L(col)}${r1 - (showAct ? 2 : 1)}` : `${L(col)}${r1 - (showAct ? 2 : 1)}`, result: Math.round(f.planCum[i] * 100) / 100 };
      up.numFmt = '0.00';
      up.font = F(9);
      up.alignment = { horizontal: 'center', vertical: 'middle' };
      up.border = { left: black, right: black, top: black, bottom: showAct ? { style: 'hair', color: { argb: 'FFBDBDBD' } } : black };
      if (showAct) {
        const dn = ws.getCell(r2, col);
        const v = kind === 'sum' ? f.actSum[i] : f.actCum[i];
        if (v != null) dn.value = Math.round(v * 100) / 100;
        dn.numFmt = '0.00';
        dn.font = F(9, true, ACTC);
        dn.alignment = { horizontal: 'center', vertical: 'middle' };
        dn.border = { left: black, right: black, bottom: black, top: { style: 'hair', color: { argb: 'FFBDBDBD' } } };
      }
    });
    ws.getRow(r1).height = 20;
    if (r2 > r1) ws.getRow(r2).height = 18;
    r = r2 + 1;
  };
  sumRow('계', 'sum');
  sumRow('누       계', 'cum');
  ws.getCell(r + 1, 1).value = `※ 상단: 기간별 예정 보할(%) · 굵은 밑줄 = 예정공정 기간${showAct ? ' · 하단(녹색): 저장된 실적 이력 기준 기간별 실적(%) · 점선 = 실제 수행기간' : ''} · 보할 배분: ${p.calendar.distribution === 'month' ? '월 균등' : '작업일 비례'} · 기준일 ${fmtDot(p.info.baseDate)}`;
  ws.getCell(r + 1, 1).font = F(8.5, false, 'FF555555');
  ws.pageSetup.printTitlesRow = `${H1}:${H2}`;
}

/** 장기계속공사 차수 현황 시트 */
function addPhaseSheet(wb: ExcelJS.Workbook, p: Project, all: Project[]) {
  const members = groupMembers(all.some((x) => x.id === p.id) ? all : [...all, p], p);
  const total = members.find((x) => x.contract?.kind === 'total');
  if (!total) return;
  const sum = summarizePhases(total, members);
  const ws = wb.addWorksheet('차수 현황');
  ws.columns = [
    { header: '차수', width: 8 },
    { header: '착공일', width: 12 },
    { header: '준공일', width: 12 },
    { header: '일수', width: 7 },
    { header: '계약금액(원)', width: 16 },
    { header: '총차 대비 금액(%)', width: 14 },
    { header: '총차 예정 몫(%)', width: 13 },
    { header: '차수 준공 시 총차 누계(%)', width: 18 },
    { header: '차수 실적(%)', width: 11 },
    { header: '총차 환산 실적(%p)', width: 15 },
  ];
  const head = ws.getRow(1);
  head.height = 30;
  head.eachCell((cell) => {
    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill(C.head);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = border;
  });
  const put = (vals: (string | number | null)[], bold = false) => {
    const r = ws.addRow(vals);
    r.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: FONT, size: 9.5, bold };
      cell.border = border;
      cell.numFmt = col === 5 ? '#,##0' : col >= 6 ? '0.00' : '@';
      if (bold) cell.fill = fill(C.sunk);
    });
  };
  put([phaseLabel(total), fmtDot(total.info.start), fmtDot(total.info.end), toNum(total.info.end) - toNum(total.info.start) + 1, total.info.amount, 100, 100, 100, null, null], true);
  for (const r of sum.rows)
    put([r.label, fmtDot(r.start), fmtDot(r.end), r.days, r.amount, r.amountRatio == null ? null : Math.round(r.amountRatio * 100) / 100, r.share, Math.round(r.planCumAtEnd * 100) / 100, Math.round(r.actual * 100) / 100, Math.round(r.totalContribution * 100) / 100]);
  put(['차수 합계', '', '', null, sum.sumAmount, total.info.amount ? Math.round((sum.sumAmount / total.info.amount) * 10000) / 100 : null, Math.round(sum.sumShare * 100) / 100, null, null, Math.round(sum.sumContribution * 100) / 100], true);
  ws.addRow([]);
  ws.addRow(['※ 총차 예정 몫 = 총차 예정공정 중 해당 차수 기간에 들어가는 비율, 총차 환산 실적 = 몫 × 차수 실적']).getCell(1).font = { name: FONT, size: 8.5, color: { argb: 'FF555555' } };
}
