import * as XLSX from 'xlsx';
import { costSheet, sectionTotals, unitCost, matPrice, hangulAmount } from './calc.js';

function sheet(aoa, widths) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

export function buildWorkbook(p, opt = {}) {
  const { factor = 1, profitAdd = 0, title = '설계내역서', estimate = null } = opt;
  const cs = costSheet(p, { factor, profitAdd });
  const wb = XLSX.utils.book_new();

  if (estimate) {
    const e = estimate;
    const aoa = [
      ['견  적  서'], [],
      ['수신', e.to, '', '견적일', e.date],
      ['공사명', p.name, '', '유효기간', `견적일로부터 ${e.validDays}일`],
      ['공사장소', p.location],
      [], ['공급자', p.company, '', '사업자등록번호', p.bizNo], [],
      ['견적금액', `일금 ${hangulAmount(e.amount)}원정 (￦${e.amount.toLocaleString()})`, '', '', '부가세 포함'], [],
      ['No', '공종', '재료비', '노무비', '경비', '합계'],
      ...cs.secs.map((s, i) => [i + 1, s.section.name, s.m, s.l, s.e, s.sum]),
      ['', '직접공사비 계', cs.DM, cs.DL, cs.ME, cs.DM + cs.DL + cs.ME],
      ['', '제경비·일반관리비·이윤', '', '', '', cs.total - (cs.DM + cs.DL + cs.ME)],
      ['', '부가가치세', '', '', '', cs.vat],
      ...(e.tail ? [['', '단수조정', '', '', '', e.amount - cs.raw]] : []),
      ['', '견적 합계', '', '', '', e.amount],
      [], ['비고'], ...String(e.note || '').split('\n').map((x) => ['', x]),
    ];
    XLSX.utils.book_append_sheet(wb, sheet(aoa, [8, 34, 16, 16, 16, 18]), '견적서');
  }

  // 원가계산서
  const ca = [[`${title} 원가계산서`], ['공사명', p.name], ['발주처', p.client], [], ['비목', '구분', '금액', '산출근거']];
  cs.rows.forEach((r) => ca.push([r.g, r.label, r.amt, r.note || '']));
  ca.push([], ['', '공사금액(한글)', `일금 ${hangulAmount(cs.grand)}원정`]);
  XLSX.utils.book_append_sheet(wb, sheet(ca, [12, 34, 18, 44]), '원가계산서');

  // 공종별 집계표
  const sa = [['공종별 집계표'], [], ['공종', '재료비', '노무비', '경비', '합계']];
  cs.secs.forEach((s) => sa.push([s.section.name, s.m, s.l, s.e, s.sum]));
  sa.push(['합계', cs.DM, cs.DL, cs.ME, cs.DM + cs.DL + cs.ME]);
  XLSX.utils.book_append_sheet(wb, sheet(sa, [34, 16, 16, 16, 18]), '공종별집계표');

  // 내역서
  const na = [[title], [], ['품명', '규격', '단위', '수량', '재료비 단가', '재료비 금액', '노무비 단가', '노무비 금액', '경비 단가', '경비 금액', '합계 단가', '합계 금액', '비고']];
  sectionTotals(p, factor).forEach((s) => {
    na.push([s.section.name]);
    s.rows.forEach((r, i) => {
      const it = s.section.items[i];
      na.push([r.name, r.spec, r.unit, r.qty, r.um, r.am, r.ul, r.al, r.ue, r.ae, r.up, r.amt, [r.link, it.note].filter(Boolean).join(' ')]);
    });
    na.push(['[소계]', '', '', '', '', s.m, '', s.l, '', s.e, '', s.sum, '']);
  });
  XLSX.utils.book_append_sheet(wb, sheet(na, [28, 22, 6, 10, 12, 14, 12, 14, 12, 14, 12, 15, 14]), '내역서');

  // 일위대가 목록 + 상세
  const ul = [['일위대가 목록'], [], ['호표', '명칭', '규격', '단위', '재료비', '노무비', '경비', '합계']];
  const ud = [['일위대가표'], []];
  p.units.forEach((u) => {
    const c = unitCost(p, u);
    ul.push([u.code, u.name, u.spec, u.unit, Math.floor(c.m * factor), Math.floor(c.l * factor), Math.floor(c.e * factor), Math.floor(c.m * factor) + Math.floor(c.l * factor) + Math.floor(c.e * factor)]);
    ud.push([`${u.code}  ${u.name}  ${u.spec}  (${u.unit}당)`]);
    ud.push(['구분', '품명', '규격', '단위', '수량', '단가', '금액']);
    c.lines.forEach((l) => ud.push([l.kind, l.name, l.spec, l.unit, Number(l.qty), l.price, l.amt]));
    if (c.tool) ud.push(['경비', '공구손료', `노무비의 ${u.toolRate}%`, '식', 1, c.tool, c.tool]);
    ud.push(['', '합계', '', '', '', '', c.total], []);
  });
  XLSX.utils.book_append_sheet(wb, sheet(ul, [10, 28, 22, 6, 12, 12, 12, 14]), '일위대가목록');
  XLSX.utils.book_append_sheet(wb, sheet(ud, [8, 28, 22, 6, 10, 12, 14]), '일위대가표');

  const ma = [['자재단가표'], [], ['코드', '품명', '규격', '단위', '조달청', '물가정보', '거래가격', '적용단가']];
  p.mats.forEach((m) => ma.push([m.code, m.name, m.spec, m.unit, m.p1 || '', m.p2 || '', m.p3 || '', matPrice(m)]));
  XLSX.utils.book_append_sheet(wb, sheet(ma, [8, 26, 22, 6, 12, 12, 12, 12]), '자재단가');

  const la = [['노임단가표'], [], ['직종', '일 노임(원/인)']];
  p.labors.forEach((l) => la.push([l.name, Number(l.wage) || 0]));
  XLSX.utils.book_append_sheet(wb, sheet(la, [20, 16]), '노임단가');

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
