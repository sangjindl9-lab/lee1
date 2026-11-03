// 보고서 PDF·Excel. 저장된 스냅샷(당시 입력값·계산결과·규칙 버전)으로만 만든다 → 이전 보고서 재현 가능
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { get } from './db.js';

const FONTS = [
  ['/usr/share/fonts/truetype/nanum/NanumGothic.ttf', null, '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf', null],
  ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'NotoSansCJKkr-Regular', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 'NotoSansCJKkr-Bold'],
];
const fmt = (v, d = '-') => (v == null || v === '' ? d : typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v));
const ST = { ok: '여유', caution: '주의', over: '초과', hold: '보류', info: '참고' };
const PH = { '1': '단상', '3': '삼상' };
const SUPPLY = { kepco_direct: '한전 직접 계약', building_managed: '건물 관리비 납부(관리주체)', unknown: '모름' };

export async function reportPdf(rep, out) {
  const snap = rep.snapshot; const c = snap.calc; const r = c.result; const site = c.bundle.site;
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `${snap.service_name} 보고서` } });
  doc.pipe(out);
  const f = FONTS.find((x) => fs.existsSync(x[0]));
  if (f) { doc.registerFont('R', f[0], f[1] || undefined); doc.registerFont('B', fs.existsSync(f[2]) ? f[2] : f[0], (fs.existsSync(f[2]) ? f[3] : f[1]) || undefined); }
  const R = f ? 'R' : 'Helvetica'; const B = f ? 'B' : 'Helvetica-Bold';
  const W = doc.page.width - 80;
  const h1 = (t) => { doc.moveDown(0.6); doc.font(B).fontSize(13).fillColor('#111').text(t); doc.moveTo(40, doc.y + 2).lineTo(40 + W, doc.y + 2).strokeColor('#999').stroke(); doc.moveDown(0.4); };
  const p = (t, o = {}) => doc.font(o.b ? B : R).fontSize(o.s || 9.5).fillColor(o.c || '#222').text(t, { width: W });
  const table = (head, rows, widths) => {
    const ws = widths.map((x) => x * W);
    const line = (cells, bold, bg) => {
      const hgt = Math.max(...cells.map((t, i) => doc.font(bold ? B : R).fontSize(8.5).heightOfString(fmt(t), { width: ws[i] - 6 }))) + 6;
      if (doc.y + hgt > doc.page.height - 50) doc.addPage();
      const y = doc.y; let x = 40;
      if (bg) doc.rect(40, y, W, hgt).fill(bg);
      cells.forEach((t, i) => { doc.font(bold ? B : R).fontSize(8.5).fillColor('#111').text(fmt(t), x + 3, y + 3, { width: ws[i] - 6 }); x += ws[i]; });
      doc.rect(40, y, W, hgt).strokeColor('#bbb').lineWidth(0.5).stroke(); doc.y = y + hgt; doc.x = 40;
    };
    line(head, true, '#eeeeee'); rows.forEach((rw) => line(rw)); doc.moveDown(0.4);
  };

  // 표지 정보
  const co = snap.company;
  if (co?.logo_path && fs.existsSync(co.logo_path)) { try { doc.image(await sharp(co.logo_path).png().resize(240).toBuffer(), 40, 36, { height: 36 }); doc.moveDown(2.2); } catch {} }
  doc.font(B).fontSize(18).fillColor('#111').text(`${snap.service_name} 전력 검토 보고서`);
  p(`작성일 ${snap.created_at.slice(0, 10)} · 보고서 번호 ${rep.id} · 계산 규칙 ${c.versions.engine} / ${c.versions.cost}${c.versions.tariff ? ' / 요금 ' + c.versions.tariff : ''}`, { s: 8.5, c: '#555' });
  if (co) p(`작성: ${co.name}${co.phone ? ' · ' + co.phone : ''}${co.address ? ' · ' + co.address : ''}${co.quote_valid_days ? ` · 견적 유효기간 ${co.quote_valid_days}일` : ''}`, { s: 8.5, c: '#555' });
  doc.moveDown(0.5);
  doc.rect(40, doc.y, W, 44).fill('#f4f4f4'); const vy = doc.y + 8;
  doc.font(B).fontSize(14).fillColor('#111').text(`판정: ${r.verdict}`, 50, vy);
  if (r.flags.length) doc.font(R).fontSize(9).text(r.flags.join(' · '), 50, vy + 20);
  doc.x = 40; doc.y = vy + 44;
  p('※ 본 보고서는 입력값과 사진 추출값에 기초한 검토 자료이며, 안전 여부나 법적 적합성을 확인한 문서가 아닙니다. 사진만으로 실제 부하·전선 허용전류·누전·접지·단자 상태를 확정하지 않았습니다.', { s: 8, c: '#666' });

  h1('1. 주요 질문');
  table(['질문', '검토 결과'], snap.answers.map((a) => [a.q, a.a]), [0.35, 0.65]);

  h1('2. 장소 및 계약정보');
  table(['항목', '내용', '항목', '내용'], [
    ['장소명', site.name, '주소', snap.masked_address],
    ['건물 용도·업종', [site.building_use, site.industry].filter(Boolean).join(' / '), '면적', site.area_m2 ? site.area_m2 + '㎡' : '-'],
    ['전기요금 납부', SUPPLY[site.supply_type] || '모름', '계약종별', site.contract_kind],
    ['계약전력', site.contract_kw != null ? site.contract_kw + 'kW' : '모름', '공급방식', `${PH[site.phase] || '모름'} ${site.v_line ? site.v_line + '/' : ''}${site.v_phase || ''}V ${site.wire_system || ''}`],
    ['임대 공간', site.rented ? '예' : '아니오/모름', '관리주체 협의', site.needs_mgmt_consent ? '필요' : '-'],
  ], [0.17, 0.33, 0.17, 0.33]);
  p('계약전력: 한전 또는 건물 관리주체와 계약·배정된 전력 / 예상 사용전력: 기기와 동시 사용 조건으로 계산한 전력 / 설비 수용능력: 인입선·간선·분전반·차단기·분기회로가 감당할 수 있는 범위', { s: 8, c: '#555' });

  h1('3. 기기 목록');
  table(['기기', '상태', '수량', '1대 입력(W)', '근거', '운전계수(일반/최대/분산)', '회로·상', '주의'],
    r.devices.map((d) => { const src = c.bundle.devices.find((x) => x.id === d.id) || {};
      return [d.name, d.status === 'planned' ? '추가 예정' : '현재', d.qty, d.unitW, `${d.basis || '-'} (${src.source || '출처 미기재'})`,
        `${d.factors.normal}/${d.factors.peak}/${d.factors.shifted}${d.factors.defaulted ? ' *' : ''}`, d.conn || '미확인', d.warnings.join(' / ')]; }),
    [0.13, 0.08, 0.06, 0.1, 0.17, 0.13, 0.08, 0.25]);
  p('* 표시는 사용자가 운전계수를 따로 입력하지 않아 기본 가정(동시 사용=1, 미사용=0)을 적용한 기기', { s: 8, c: '#555' });

  h1('4. 현재 및 추가 후 비교');
  table(['시나리오', '예상 전력(kW)', 'L1', 'L2', 'L3', '상 미확인'], Object.values(r.scenarios).map((s) => [s.label, s.kw, s.phaseKw.L1, s.phaseKw.L2, s.phaseKw.L3, s.unassignedKw]), [0.34, 0.14, 0.12, 0.12, 0.12, 0.16]);
  table(['구분', '값'], [
    ['현재 계약전력', r.contract.contractKw != null ? r.contract.contractKw + ' kW' : '미확인'],
    ['기술적 필요용량 검토값', r.contract.technicalKw != null ? `${r.contract.technicalKw} kW (근거: ${r.contract.basis}, 여유율 ${r.assumptions.margin_pct}%)` : '보류'],
    ['약관 적용 계약전력 검토값', r.contract.officialNote],
    ['추가 증설 검토량', r.contract.addKw != null ? r.contract.addKw + ' kW (기술적 검토값 기준)' : '보류'],
    ['확인된 실측 최대값', r.contract.measured ? `${r.contract.measured.peak_kw} kW · 측정 ${fmt(r.contract.measured.period_days)}일 ${r.contract.measured.notes.join(' / ')}` : '실측값 없음'],
    ['고지서 최대수요전력', r.contract.billMaxKw != null ? r.contract.billMaxKw + ' kW' : '고지서 최대수요 정보 없음'],
  ], [0.3, 0.7]);

  h1('5. 분전반·회로별 부하표');
  table(['분전반', '주차단기 정격(A)', '예상 최대전류(A)', '판정', '내용'], r.main.map((m) => [m.panel, m.breakerA, m.loadA, ST[m.status], [m.msg, ...m.issues].filter(Boolean).join(' / ')]), [0.16, 0.14, 0.14, 0.08, 0.48]);
  table(['회로', '연결기기', 'kW', '전류(A)', '차단기(A)', '판정', '전선·전압강하'], r.circuits.map((x) => [x.name, x.devices.join(', '), x.kw, x.loadA, x.breakerA, ST[x.status],
    [x.wire?.msg, x.vdrop ? `전압강하 ${x.vdrop.pct}%${x.vdrop.limit != null ? ` (기준 ${x.vdrop.limit}%)` : ' (기준 미등록)'}` : null, x.mismatch ? '표기 불일치: ' + x.mismatch : null, ...x.issues].filter(Boolean).join(' / ')]),
  [0.12, 0.2, 0.07, 0.08, 0.09, 0.07, 0.37]);
  if (r.unassigned.length) p(`미확인 회로 기기: ${r.unassigned.join(', ')}`);
  if (r.phase) p(`상별 부하: L1 ${r.phase.phaseKw.L1}kW · L2 ${r.phase.phaseKw.L2}kW · L3 ${r.phase.phaseKw.L3}kW — ${r.phase.msg}`);
  for (const s of r.starts) p(`기동 검토 · ${s.name}: ${s.startA ? s.startA + 'A (' + s.source + ') ' : ''}${s.msg}`, { s: 8.5 });

  // 사진과 추출값
  const photos = snap.photos || [];
  if (photos.length) {
    h1('6. 분전반·명판 사진과 추출값');
    for (const ph of photos) {
      const fr = get('SELECT * FROM files WHERE id=?', ph.file_id);
      if (!fr || !fs.existsSync(fr.path) || fr.mime === 'application/pdf') continue;
      try {
        const img = await sharp(fr.path).rotate().resize(900, 900, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
        if (doc.y > doc.page.height - 260) doc.addPage();
        doc.image(img, 40, doc.y, { fit: [220, 200] }); const top = doc.y;
        doc.font(R).fontSize(8.5).text(ph.lines.join('\n'), 270, top, { width: W - 230 }); doc.x = 40; doc.y = Math.max(top + 205, doc.y + 5);
      } catch {}
    }
  }

  h1('7. 계산식·가정·적용 기준');
  p('기기 전력 합계 = Σ(입력 소비전력 × 수량) · 시나리오 전력 = Σ(기기 전력 × 시나리오 운전계수) · 단상 전류 = P ÷ (V × 역률) · 평형 삼상 전류 = P ÷ (√3 × 선간전압 × 역률)', { s: 8.5 });
  p(`가정: 역률 미입력 기기 ${r.assumptions.default_pf} · 주의 기준 차단기 정격의 ${Math.round(r.assumptions.caution_ratio * 100)}% · 여유율 ${r.assumptions.margin_pct}% (운전계수와 중복 적용하지 않음)`, { s: 8.5 });
  const stdList = [...new Set((c.standards.ampacity || []).map((a) => `${a.standard} ${a.version || ''}`))];
  p(`적용 기준: ${[...stdList, c.standards.vdrop_standard, c.standards.unbalance_standard].filter(Boolean).join(', ') || '등록된 기준 없음(해당 판정 보류)'}`, { s: 8.5 });
  if (r.notes.length) p(r.notes.join(' / '), { s: 8.5 });

  h1('8. 증설·설비 개선 및 대안');
  p(`경로: ${r.path.steps.join(' → ')}`);
  table(['대안', '예상 피크 감소', '초기 비용', '사용 불편', '추가 확인'], c.alternatives.list.map((a) => [a.name, a.peakCutKw == null ? '계산 불가' : a.peakCutKw + ' kW', a.cost, a.burden, a.check]), [0.22, 0.12, 0.2, 0.12, 0.34]);
  p(c.alternatives.note, { s: 8.5, c: '#a33' });

  h1('9. 공사비 내역');
  p(`견적 상태: ${c.quote.status}`, { b: true });
  table(['항목', '수량', '재료비', '노무비', '경비', '합계(최소~최대)', '단가 근거'], c.quote.lines.map((l) => l.status === 'priced'
    ? [l.name, `${l.qty_min}~${l.qty_max} ${l.unit || ''}`, `${fmt(l.min.material)}~${fmt(l.max.material)}`, `${fmt(l.min.labor)}~${fmt(l.max.labor)}`, `${fmt(l.min.expense)}~${fmt(l.max.expense)}`, `${fmt(l.min_total)}~${fmt(l.max_total)}`, l.price_basis.map((b) => `${b.source || ''} ${b.region || ''} ${b.base_date || ''}`).join('; ')]
    : [l.name, l.qty_min, '-', '-', '-', '단가 없음', l.reason]), [0.18, 0.1, 0.13, 0.13, 0.1, 0.16, 0.2]);
  if (c.quote.totals) p(`공급가 ${fmt(c.quote.totals.supply[0])}~${fmt(c.quote.totals.supply[1])}원 · 부가세 ${fmt(c.quote.totals.vat[0])}~${fmt(c.quote.totals.vat[1])}원 · 합계 ${fmt(c.quote.totals.total[0])}~${fmt(c.quote.totals.total[1])}원`, { b: true });
  p('사진만으로 케이블 길이·은폐 구간 상태를 확정하지 않았습니다. 수량은 입력값 범위입니다.', { s: 8, c: '#555' });

  h1('10. 한전 예상 납부금 (공사비와 별도)');
  if (!c.kepco) p('신청 조건 미입력 — 한전 확인 필요');
  else {
    p(c.kepco.state, { b: true });
    if (c.kepco.items.length) table(['항목', '상태', '수량', '단가', '금액(세포함)', '요율 버전·적용일·출처'], c.kepco.items.map((i) => i.status === 'estimated'
      ? [i.label, '예상', i.qty, fmt(i.unit_price), fmt(i.total), `${i.version || ''} ${i.valid_from || ''}~${i.valid_to || ''} ${i.source_url || ''}`] : [i.label, '한전 확인 필요', '-', '-', '-', i.reason]), [0.18, 0.12, 0.08, 0.12, 0.14, 0.36]);
    if (c.kepco.subtotal != null) p(`확정되지 않은 항목을 제외한 예상 합계 ${fmt(c.kepco.subtotal)}원 · 미확정 ${c.kepco.unresolved}건`);
  }

  h1('11. 전기요금 변화');
  if (c.tariff.status !== 'ok') p(c.tariff.msg);
  else p(`현재 월 ${fmt(c.tariff.now.subtotal)}원 → 변경 후 ${fmt(c.tariff.after.subtotal)}원 (차이 ${fmt(c.tariff.monthlyDiff)}원) ${c.tariff.paybackMonths ? `· 회수기간 약 ${c.tariff.paybackMonths}개월` : ''} · ${c.tariff.now.note}`);
  p(`월 사용량 추정(기기 입력 기준): 현재 ${fmt(c.tariff.kwhNow)}kWh → 추가 후 ${fmt(c.tariff.kwhAfter)}kWh ${c.tariff.appliedAssumed ? '· ' + c.tariff.appliedAssumed : ''}`, { s: 8.5 });
  if (c.seasonal.count) p(`고지서 ${c.seasonal.count}건: ` + Object.entries(c.seasonal.groups).map(([k, g]) => `${k} 평균 ${fmt(Math.round(g.kwh / g.months))}kWh`).join(' · ') + (c.seasonal.note ? ' — ' + c.seasonal.note : ''), { s: 8.5 });

  h1('12. 제외 항목과 미확인 항목');
  const miss = [...r.missing, ...c.quote.unresolved, ...(c.kepco?.items || []).filter((i) => i.status === 'unresolved').map((i) => `${i.label}: ${i.reason}`),
    ...r.circuits.filter((x) => x.status === 'hold').map((x) => `${x.name}: ${x.msg}`), ...r.main.filter((m) => m.status === 'hold').map((m) => `${m.panel}: ${m.msg}`)];
  p(miss.length ? miss.map((m) => '· ' + m).join('\n') : '없음');

  h1('13. 검토 담당자 의견');
  p(snap.reviews.length ? snap.reviews.map((v) => `${v.created_at.slice(0, 10)} ${v.name}: ${v.opinion}`).join('\n') : '검토 의견 없음');

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) { doc.switchToPage(i); doc.font(R).fontSize(7.5).fillColor('#888').text(`${snap.service_name} · 보고서 ${rep.id} · ${i + 1}/${range.count}`, 40, doc.page.height - 30, { width: W, align: 'center', lineBreak: false }); }
  doc.end();
}

export async function reportXlsx(rep) {
  const snap = rep.snapshot; const c = snap.calc; const r = c.result;
  const wb = new ExcelJS.Workbook(); wb.creator = snap.service_name;
  const sheet = (name, head, rows) => { const ws = wb.addWorksheet(name); ws.addRow(head).font = { bold: true }; rows.forEach((x) => ws.addRow(x)); ws.columns.forEach((col) => { col.width = 18; }); return ws; };
  sheet('요약', ['항목', '값'], [['판정', r.verdict], ['추가 표시', r.flags.join(', ')], ...snap.answers.map((a) => [a.q, a.a]), ['작성일', snap.created_at], ['계산 규칙', `${c.versions.engine} / ${c.versions.cost}`]]);
  sheet('기기', ['기기', '상태', '수량', '1대 입력W', '근거', '일반', '최대', '분산', '회로·상', '주의'], r.devices.map((d) => [d.name, d.status, d.qty, d.unitW, d.basis, d.factors.normal, d.factors.peak, d.factors.shifted, d.conn, d.warnings.join(' / ')]));
  sheet('시나리오', ['시나리오', 'kW', 'L1', 'L2', 'L3', '상 미확인 kW'], Object.values(r.scenarios).map((s) => [s.label, s.kw, s.phaseKw.L1, s.phaseKw.L2, s.phaseKw.L3, s.unassignedKw]));
  sheet('회로부하', ['회로', '연결기기', 'kW', 'A', '차단기A', '판정', '전선', '전압강하%'], r.circuits.map((x) => [x.name, x.devices.join(', '), x.kw, x.loadA, x.breakerA, ST[x.status], x.wire?.msg, x.vdrop?.pct]));
  sheet('공사비', ['항목', '수량최소', '수량최대', '재료최소', '재료최대', '노무최소', '노무최대', '경비최소', '경비최대', '합계최소', '합계최대', '비고'], c.quote.lines.map((l) => l.status === 'priced'
    ? [l.name, l.qty_min, l.qty_max, l.min.material, l.max.material, l.min.labor, l.max.labor, l.min.expense, l.max.expense, l.min_total, l.max_total, c.quote.status] : [l.name, l.qty_min, '', '', '', '', '', '', '', '', '', l.reason]));
  sheet('한전납부금', ['항목', '상태', '수량', '단가', '합계', '근거'], (c.kepco?.items || []).map((i) => [i.label, i.status === 'estimated' ? '예상' : '한전 확인 필요', i.qty, i.unit_price, i.total, i.source_url || i.reason]));
  sheet('검토의견', ['일자', '담당', '의견'], snap.reviews.map((v) => [v.created_at, v.name, v.opinion]));
  return wb.xlsx.writeBuffer();
}
