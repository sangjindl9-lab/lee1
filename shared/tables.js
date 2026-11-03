/* 산출표·장비표 생성 (화면 하단 표, Excel, PDF 출력 공통) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./catalog.js'), require('./calc.js'));
  else root.CCTVTables = factory(root.CCTVCatalog, root.CCTVCalc);
})(typeof self !== 'undefined' ? self : this, function (CAT, C) {
  'use strict';
  const T = n => (CAT.DEVICE_TYPES[n] || {}).name || n;
  function build(model) {
    const ix = C.index(model);
    const sheetName = id => (ix.sheet.get(id) || {}).name || '';
    const zone = id => { const s = ix.sheet.get(id); return s ? [s.building, s.floor, s.zone].filter(Boolean).join(' ') : ''; };
    const dtag = id => (ix.dev.get(id) || {}).tag || '';
    const prodName = id => { const p = ix.prod.get(id); return p ? p.name + (p.spec ? ' ' + p.spec : '') : '(미지정)'; };
    const q = C.quantities(model);
    const circ = C.circuits(model, ix);
    const devs = model.devices || [];
    const out = {};
    const COMMON = ['품명', '규격', '단위', '수량', '산출근거', '설치 구역', '신설·기존·철거', '비고'];
    const qrow = r => [r.name, r.spec, r.unit, r.qty == null ? '확인 필요' : r.qty, r.basis, r.zone, r.status, [r.check, r.manual ? `자동 ${r.auto} / 보정 ${r.manual}` : ''].filter(Boolean).join(' ')];
    out.summary = { title: '공종별 집계표', head: ['공종'].concat(COMMON.slice(0, 4)).concat(['신설·기존·철거', '비고']), rows: C.summaryByCat(q).map(r => [r.cat, r.name, r.spec, r.unit, r.unknown ? (r.qty ? r.qty + ' + 확인 필요' : '확인 필요') : r.qty, r.status, r.unknown ? '축척 미설정 등 미확정 항목 포함' : '']) };
    out.quantity = { title: '물량산출표', head: ['공종'].concat(COMMON), rows: q.map(r => [r.cat].concat(qrow(r))), refs: q.map(r => r.refs) };
    const cams = devs.filter(d => d.type === 'camera');
    out.cctv = { title: 'CCTV 설치 수량표', head: COMMON, rows: q.filter(r => r.cat === 'CCTV').map(qrow), refs: q.filter(r => r.cat === 'CCTV').map(r => r.refs) };
    out.equipment = { title: '장비 일람표', head: ['장비번호', '유형', '명칭', '시스템', '형식', '제조사', '모델', '도면', '설치 위치', '설치높이(m)', '구분', '현장 확인', '비고'], rows: devs.filter(d => d.type !== 'offpage').sort((a, b) => (a.tag || '').localeCompare(b.tag || '', 'ko', { numeric: true })).map(d => { const p = d.props || {}; return [d.tag, T(d.type), d.name || '', p.system || '', p.form || '', p.maker || '', p.model || '', sheetName(d.sheet_id), p.location || zone(d.sheet_id), p.height || '', d.status || '신설', (d.field && d.field.status) || '미확인', p.note || '']; }), refs: devs.filter(d => d.type !== 'offpage').sort((a, b) => (a.tag || '').localeCompare(b.tag || '', 'ko', { numeric: true })).map(d => [{ type: 'device', id: d.id }]) };
    // 채널 배정
    const recs = devs.filter(d => ['nvr', 'dvr', 'hvr'].includes(d.type));
    const chRows = [], chRefs = [];
    recs.forEach(r => {
      const n = +((r.props || {}).channels) || 0;
      const ipc = cams.filter(c => (c.props || {}).nvr_id === r.id);
      const vc = circ.filter(c => c.kind === 'video' && c.sink === r.id);
      for (let i = 1; i <= Math.max(n, ...ipc.map(c => +c.props.nvr_channel || 0), 0); i++) {
        const a = ipc.filter(c => +c.props.nvr_channel === i).map(c => c.tag);
        const b = vc.filter(c => c.sink_port === 'CH' + i).map(c => dtag(c.camera));
        const all = a.concat(b);
        chRows.push([r.tag, T(r.type), 'CH' + i, all.join(', ') || '(빈 채널)', a.length ? 'IP(논리 배정)' : b.length ? '동축(물리 입력)' : '', all.length > 1 ? '중복' : (i > n ? '채널 수 초과' : '')]);
        chRefs.push(ipc.filter(c => +c.props.nvr_channel === i).map(c => ({ type: 'device', id: c.id })).concat(vc.filter(c => c.sink_port === 'CH' + i).map(c => ({ type: 'device', id: c.camera }))));
      }
      ipc.filter(c => !c.props.nvr_channel).forEach(c => { chRows.push([r.tag, T(r.type), '(미지정)', c.tag, 'IP(논리 배정)', '채널 미지정']); chRefs.push([{ type: 'device', id: c.id }]); });
    });
    out.channels = { title: 'NVR·DVR 채널 배정표', head: ['녹화장비', '유형', '채널', '카메라', '연결 방식', '검토'], rows: chRows, refs: chRefs };
    // 스위치 포트
    const swRows = [], swRefs = [];
    devs.filter(d => ['switch', 'poe_switch', 'fiber_switch'].includes(d.type)).forEach(sw => {
      CAT.portsFor(sw).filter(p => p.kind !== 'power').forEach(pt => {
        const cs = (model.cables || []).filter(c => (c.from && c.from.dev === sw.id && c.from.port === pt.id) || (c.to && c.to.dev === sw.id && c.to.port === pt.id));
        const peer = cs.map(c => { const o = c.from.dev === sw.id ? c.to : c.from; return dtag(o.dev) + (o.port ? ':' + o.port : ''); });
        const cam = cs.map(c => { const o = c.from.dev === sw.id ? c.to : c.from; return ix.dev.get(o.dev); }).find(d => d && d.type === 'camera');
        swRows.push([sw.tag, pt.id, pt.kind === 'fiber' ? 'SFP' : 'RJ45', cs.map(c => c.tag).join(', '), peer.join(', ') || '(미사용)', cam && cam.props.poe ? (cam.props.poe_w ? cam.props.poe_w + 'W' : 'PoE(전력 미입력)') : '', cam ? (cam.props.vlan || '') : '', cs.length > 1 ? '중복' : '']);
        swRefs.push(cs.map(c => ({ type: 'cable', id: c.id })));
      });
    });
    out.ports = { title: '스위치 포트 배정표', head: ['스위치', '포트', '종류', '케이블', '연결 장비', 'PoE', 'VLAN', '검토'], rows: swRows, refs: swRefs };
    const ipDevs = devs.filter(d => d.props && (d.props.ip || d.type === 'camera' && d.props.system === 'IP' || ['nvr', 'switch', 'poe_switch', 'fiber_switch', 'hvr', 'server', 'encoder'].includes(d.type)));
    const ipCount = {}; ipDevs.forEach(d => { if (d.props.ip) ipCount[d.props.ip] = (ipCount[d.props.ip] || 0) + 1; });
    out.ip = { title: 'IP 주소표', head: ['장비번호', '유형', 'IP 주소', '서브넷', '게이트웨이', 'VLAN', '연결 스위치·포트', 'NVR·채널', '검토'], rows: ipDevs.map(d => { const p = d.props; const dc = circ.find(c => c.camera === d.id && c.kind === 'data'); return [d.tag, T(d.type), p.ip || '', p.subnet || '', p.gateway || '', p.vlan || '', dc && dc.sink ? dtag(dc.sink) + ':' + (dc.sink_port || '') : '', p.nvr_id ? dtag(p.nvr_id) + (p.nvr_channel ? ' CH' + p.nvr_channel : '') : '', !p.ip ? '미입력' : ipCount[p.ip] > 1 ? '중복' : '']; }), refs: ipDevs.map(d => [{ type: 'device', id: d.id }]) };
    // 케이블 구간
    const cabs = (model.cables || []).slice().sort((a, b) => (a.tag || '').localeCompare(b.tag || '', 'ko', { numeric: true }));
    out.cables = { title: '케이블 구간별 산출표', head: ['케이블번호', '종류', '규격', '시작 장비·포트', '종료 장비·포트', '도면', '포설 방식', '경유 관로', '측정(m)', '수직(m)', '인입·분리(m)', '여장(m)', '여장 기준', '설계 수량(m)', '구분', '검토'], rows: cabs.map(c => { const L = C.cableLength(c, ix); const pr = c.parent_id ? `연속(${(ix.cab.get(c.parent_id) || {}).tag || ''})` : ''; return [c.tag, CAT.CABLE_KINDS[c.kind].name, prodName(c.product_id), (c.from && c.from.dev ? dtag(c.from.dev) + ':' + (c.from.port || '?') : '미연결'), (c.to && c.to.dev ? dtag(c.to.dev) + ':' + (c.to.port || '?') : '미연결'), sheetName(c.sheet_id), c.method || '', (c.conduit_ids || []).map(id => (ix.cond.get(id) || {}).tag).filter(Boolean).join(', '), C.round2(L.measured_m) ?? '확인 필요', L.vertical_m, C.round2(L.entry_m + L.tail_m), C.round2(L.slack_m) ?? '', L.slack_desc || '', L.final_m ?? '확인 필요', c.status || '신설', [L.notes.join(', '), pr].filter(Boolean).join(' ')]; }), refs: cabs.map(c => [{ type: 'cable', id: c.id }]) };
    const cx = C.coaxCircuitTable(model);
    out.coax = { title: '동축 영상 회선표', head: ['카메라 번호', '영상 신호', '시작 장비', '종료 장비', 'DVR 채널', '동축 규격', '구간별 길이', '총길이(m)', '접속점', '커넥터', '전원 방식', '검토 상태'], rows: cx.map(r => [r.cam, r.signal, r.start, r.end, r.channel, r.spec, r.segs.map(s => `${s.tag} ${s.len == null ? '?' : s.len}m`).join(' / '), r.total ?? '확인 필요', r.joints, r.connectors, r.power, r.status]), refs: cx.map(r => [{ type: 'device', id: r.cam_id }]) };
    const fib = cabs.filter(c => c.kind === 'fiber');
    const fr = [], frefs = [];
    fib.forEach(c => {
      const p = ix.prod.get(c.product_id); const cores = p && p.props.cores; const used = C.coresUsed(c); const a = (c.props || {}).core_assign || [];
      const head = [c.tag, prodName(c.product_id), p ? p.props.mode || '' : '', cores ?? '미입력', used ?? '미입력', cores != null && used != null ? cores - used : ''];
      const ends = [dtag(c.from && c.from.dev), dtag(c.to && c.to.dev)];
      if (!a.length) { fr.push(head.concat(ends, ['', '', (c.props || {}).core_map || '', cores != null && used != null && used > cores ? '코어 부족' : ''])); frefs.push([{ type: 'cable', id: c.id }]); }
      a.slice().sort((x, y) => (+x.core) - (+y.core)).forEach(x => { fr.push(head.concat(ends, [x.core, x.use || '사용', [x.target, x.note].filter(Boolean).join(' '), cores != null && +x.core > cores ? '코어 번호 초과' : ''])); frefs.push([{ type: 'cable', id: c.id }]); });
    });
    out.fiber = { title: '광코어 배정표', head: ['케이블번호', '규격', '모드', '코어 수', '사용 코어', '예비 코어', '시작', '종료', '코어', '구분', '연결 대상·비고', '검토'], rows: fr, refs: frefs };
    const spl = [], srefs = [];
    devs.filter(d => ((d.props || {}).splices || []).length).forEach(d => d.props.splices.forEach((x, i) => { spl.push([d.tag, i + 1, (ix.cab.get(x.in_cable) || {}).tag || '?', x.in_core, (ix.cab.get(x.out_cable) || {}).tag || '?', x.out_core, x.type || '융착', x.note || '']); srefs.push([{ type: 'device', id: d.id }]); }));
    out.splices = { title: '광 접속표', head: ['접속 위치', '번호', '입력 케이블', '입력 코어', '출력 케이블', '출력 코어', '접속 방식', '비고'], rows: spl, refs: srefs };
    const pcs = circ.filter(c => c.kind === 'power');
    out.power = { title: '전원 회로표', head: ['부하(카메라)', '전원 방식', '공급 장치·출력', '경로 케이블', '경로 길이(m)', '공급전압(V)', '소비전력(W)', '전압강하', '검토'], rows: pcs.map(c => { const cam = ix.dev.get(c.camera); const vd = C.voltageDrop(c, model, ix); return [cam.tag, c.path.some(s => s.cable.kind === 'composite') ? '복합케이블 전원부' : '별도 전원선', c.sink ? dtag(c.sink) + ':' + (c.sink_port || '') : '(미연결)', c.path.map(s => s.cable.tag + (s.part === 'power' && s.cable.kind === 'composite' ? '(전원부)' : '')).join(' → '), vd && vd.ok ? vd.L_m : '', vd && vd.ok ? vd.V : ((ix.dev.get(c.sink) || { props: {} }).props.voltage || ''), cam.props.power_w || '', vd && vd.ok ? `${vd.vd}V (${vd.pct}%) 계산값` : (vd ? '입력 부족: ' + vd.missing.join(', ') : ''), c.sink ? '' : '전원 누락']; }), refs: pcs.map(c => [{ type: 'device', id: c.camera }]) };
    const cr = C.conduitReport(model, ix);
    out.conduit = { title: '배관·트레이 산출표', head: ['관로번호', '품목', '시공 구분', '측정(m)', '추가(m)', '설계 수량(m)', '수용 케이블', '점유율', '산정식', '기준', '부속 제안', '구분'], rows: cr.map(r => [r.tag, r.product, r.method || '', C.round2(r.len.measured_m) ?? '확인 필요', C.round2(r.len.extra_m) ?? '', r.len.final_m ?? '확인 필요', r.cables.join(', '), r.fill_pct == null ? '확인 필요' : r.fill_pct + '%', r.fill_note, r.fill_limit == null ? '기준 미설정' : r.fill_limit + '% (' + r.fill_state + ')', r.suggestions.map(s => `${s.item} ${s.qty}`).join(', '), r.status || '신설']), refs: cr.map(r => [{ type: 'conduit', id: r.id }]) };
    const boxRows = q.filter(r => r.cat === '함체·폴·브래킷' || (r.cat === '장비' && r.refs.some(x => { const d = ix.dev.get(x.id); return d && ['cabinet', 'rack', 'pole', 'bracket', 'junction_box', 'pull_box', 'manhole', 'handhole'].includes(d.type); })));
    out.boxes = { title: '함체·폴·브래킷 수량표', head: COMMON, rows: boxRows.map(qrow), refs: boxRows.map(r => r.refs) };
    const acc = q.filter(r => r.cat === '커넥터·부속' || r.cat === '관로 부속');
    out.accessories = { title: '커넥터·부속자재 수량표', head: ['품명', '규격', '단위', '자동 산출', '보정', '수량', '산출근거'], rows: acc.map(r => [r.name, r.spec, r.unit, r.auto ?? r.qty, r.manual || 0, r.qty, r.basis]), refs: acc.map(r => r.refs) };
    const rv = C.review(model);
    out.review = { title: '설계 검토', head: ['구분', '코드', '내용'], rows: rv.map(r => [r.level, r.code, r.msg]), refs: rv.map(r => r.refs) };
    const sto = C.storage(model, ix); const bw = C.bandwidth(model, ix);
    out.storage = { title: '저장용량·대역폭 계산', head: ['녹화장비', '카메라 수', '합계 비트레이트(Mbps)', '녹화일수', '녹화시간/일', '녹화 방식', '필요 용량(TB)', 'RAID', '물리 용량(TB)', '가용 용량(TB)', '판정', '계산식·가정'], rows: sto.map(s => [s.tag, s.cams.length, s.total_mbps, s.days ?? '미입력', s.hours, s.mode + (s.mode === '이벤트' ? ` ${s.ratio ?? '?'}%` : ''), s.required_tb ?? ('확인 필요' + (s.missing.length ? ' (비트레이트 미입력: ' + s.missing.join(',') + ')' : '')), s.raid, s.raw_tb ?? '', s.usable_tb ?? '미입력', s.required_tb != null && s.usable_tb != null ? (s.required_tb > s.usable_tb ? '부족' : '충족(계산값)') : '확인 필요', s.formula + ' / ' + s.assume]).concat(bw.per_switch.map(x => [x.tag + ' (스위치)', x.cams.length, x.mbps, '', '', '', '', '', '', '', x.missing.length ? '비트레이트 미입력: ' + x.missing.join(',') : '', '카메라 비트레이트 합산 예상 대역폭'])).concat([['전체 IP 카메라', cams.filter(c => c.props.system === 'IP').length, bw.total_mbps, '', '', '', '', '', '', '', '', '예상 네트워크 대역폭 합계']]) };
    return out;
  }
  const ORDER = ['summary', 'quantity', 'cctv', 'equipment', 'channels', 'ports', 'ip', 'cables', 'coax', 'fiber', 'splices', 'power', 'conduit', 'boxes', 'accessories', 'storage', 'review'];
  return { build, ORDER };
});
