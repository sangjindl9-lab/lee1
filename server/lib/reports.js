// PDF 문서 HTML 생성 (실제 데이터)
const fs = require('fs');
const QRCode = require('qrcode');
const { db } = require('../db');
const { CATEGORIES, DETAIL_FIELDS, TEST_TYPES, CONN_KINDS, FILE_CATEGORIES } = require('./defs');
const { assetCard, epPeer } = require('./card');
const { absPath } = require('./files');
const { escapeHtml: e } = require('./pdf');
const config = require('../config');

const CSS = `
* { box-sizing: border-box; }
html, body { width: 100%; }
body { font-family: 'Noto Sans CJK KR','Noto Sans KR','NanumGothic','Malgun Gothic',sans-serif; font-size: 9pt; color: #111; margin: 0; padding: 0 1.5mm; }
h1 { font-size: 15pt; margin: 0 0 2mm; font-weight: 700; }
h2 { font-size: 10.5pt; margin: 5mm 0 1.5mm; padding-bottom: 1mm; border-bottom: 1.5px solid #111; break-after: avoid; }
.meta { color: #444; font-size: 8.5pt; margin-bottom: 3mm; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 0.6px solid #777; padding: 1.2mm 1.5mm; vertical-align: top; text-align: left; word-break: keep-all; overflow-wrap: anywhere; }
th { background: #eee; font-weight: 600; white-space: nowrap; }
table.kv th { width: 16%; }
table.kv td { width: 34%; }
.small { font-size: 7.6pt; }
table.small th, table.small td { padding: 1mm 1.2mm; }
.muted { color: #666; }
.bad { color: #b00000; font-weight: 600; }
.ok { color: #0a5c1a; font-weight: 600; }
.head { display: flex; justify-content: space-between; align-items: flex-start; }
.qr { width: 24mm; height: 24mm; }
.demo { border: 1px solid #b00000; color: #b00000; display: inline-block; padding: 0 2mm; font-size: 8pt; margin-left: 2mm; }
.photos { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.photo { border: 0.6px solid #777; break-inside: avoid; height: 118mm; display: flex; flex-direction: column; }
.photo .img { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #fafafa; }
.photo img { max-width: 100%; max-height: 100%; object-fit: contain; }
.photo .cap { border-top: 0.6px solid #777; padding: 1.5mm; font-size: 8pt; }
.photo-page { break-after: page; }
.photo-page:last-child { break-after: auto; }
.tree { margin: 0; padding-left: 4mm; }
.tree li { margin: 0.5mm 0; }
.empty { color: #666; padding: 2mm 0; }
`;

const page = (title, body) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${e(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
const fmtDate = s => (s || '').replace('T', ' ').slice(0, 16);
const v = x => (x === null || x === undefined || x === '' ? '-' : e(x));
const resCls = r => (r === '부적합' ? 'bad' : r === '적합' ? 'ok' : 'muted');

function siteHeader(siteId) {
  return db.prepare('SELECT * FROM sites WHERE id=?').get(siteId);
}

function imgData(fileRow) {
  try {
    const p = absPath({ stored_name: fileRow.stored_name.replace(/#c\d+$/, '') });
    return `data:${fileRow.mime};base64,${fs.readFileSync(p).toString('base64')}`;
  } catch { return ''; }
}

function treeHtml(node) {
  if (!node) return '';
  const label = `${e(node.text)}${node.conn ? ` <span class="muted">[${e(CONN_KINDS[node.conn.kind] || node.conn.kind)}${node.conn.closure ? ' @' + e(node.conn.closure) : ''}]</span>` : ''}${node.end ? ` <b>${e(node.end)}</b>` : ''}`;
  return `<li>${label}${node.children?.length ? `<ul class="tree">${node.children.map(treeHtml).join('')}</ul>` : ''}</li>`;
}

async function cardHtml(assetId) {
  const c = assetCard(assetId);
  const a = c.asset;
  const qrUrl = `${config.publicBaseUrl || config.runtimeBase || ''}/q/${a.qr_token}`;
  const qr = await QRCode.toDataURL(qrUrl, { margin: 0, width: 200 });
  const fields = DETAIL_FIELDS[a.category] || [];
  const kv = (pairs) => {
    let html = '<table class="kv">';
    for (let i = 0; i < pairs.length; i += 2) {
      const [l1, v1] = pairs[i]; const [l2, v2] = pairs[i + 1] || ['', ''];
      html += `<tr><th>${e(l1)}</th><td>${v1}</td><th>${e(l2)}</th><td>${v2}</td></tr>`;
    }
    return html + '</table>';
  };
  const drawings = [...new Set(c.marks.map(m => `${m.drawing_no} Rev.${m.rev_no}`))].join(', ');
  let body = `<div class="head"><div><h1>${e(c.category_label)} 이력 카드${a.is_demo ? '<span class="demo">시연용 데이터</span>' : ''}</h1>
    <div class="meta">${e(a.site_name)} (${e(a.site_code)}) · 관리번호 <b>${e(a.mgmt_no)}</b> · 출력일 ${new Date().toLocaleString('ko-KR')}</div></div>
    <img class="qr" src="${qr}"></div>`;
  body += '<h2>기본 정보</h2>' + kv([
    ['관리번호', v(a.mgmt_no)], ['설비 종류', v(c.category_label)], ['명칭', v(a.name)], ['상태', v(a.status)],
    ['건물·층', v([a.building, a.floor].filter(Boolean).join(' '))], ['실·구역', v([a.room, a.zone].filter(Boolean).join(' '))],
    ['설치 위치', v(a.location_desc)], ['상위 설비', v(c.parent?.mgmt_no)],
    ['제조사·모델', v([a.manufacturer, a.model].filter(Boolean).join(' / '))], ['시리얼번호', v(a.serial_no)],
    ['설치일', v(a.install_date)], ['시공업체·담당', v([a.contractor, a.manager].filter(Boolean).join(' / '))],
    ['관련 도면', v(drawings)], ['교체 관계', v(c.replaces ? `기존 ${c.replaces.mgmt_no} (S/N ${c.replaces.serial_no || '-'}) 대체` : c.replacedBy ? `신규 장비(S/N ${c.replacedBy.serial_no || '-'})로 교체됨` : '')],
    ['등록', v(`${fmtDate(a.created_at)} ${a.created_by_name || ''}`)], ['최종 변경', v(`${fmtDate(a.updated_at)} ${a.updated_by_name || ''}`)],
    ['비고', v(a.notes)], ['', ''],
  ]);
  if (fields.length) body += '<h2>상세 정보</h2>' + kv(fields.map(([k, l]) => [l, v(c.details[k])]));

  body += '<h2>연결 관계</h2>';
  if (c.ends) body += kv([['A단(시작) 연결', v(c.ends.A?.text || '미등록')], ['B단(종점) 연결', v(c.ends.B?.text || '미등록')]]);
  if (c.paths?.cable) body += `<div class="small" style="margin-top:2mm"><b>경로 추적</b><ul class="tree">${treeHtml(c.paths.cable)}</ul></div>`;
  if (c.paths?.comm || c.paths?.power) {
    body += `<div class="small" style="margin-top:2mm"><b>통신 경로</b><ul class="tree">${c.paths.comm ? treeHtml(c.paths.comm) : '<li>미등록</li>'}</ul>
      <b>전원 경로</b>${c.details.power_method === 'PoE' ? ' <span class="muted">(PoE: 통신 경로 종단 스위치 포트에서 급전)</span>' : ''}<ul class="tree">${c.paths.power ? treeHtml(c.paths.power) : '<li>미등록</li>'}</ul>
      <div class="muted">※ 등록된 연결 정보 기준이며 실시간 작동 상태가 아닙니다.</div></div>`;
  }
  if (c.cores.length) {
    body += `<table class="small" style="margin-top:2mm"><thead><tr><th>코어</th><th>색상</th><th>용도</th><th>상태</th><th>A단 연결</th><th>B단 연결</th></tr></thead><tbody>`
      + c.cores.map(x => `<tr><td>#${x.core_no}</td><td>${v(x.color)}</td><td>${v(x.purpose)}</td><td>${v(x.status)}</td><td>${v(x.a?.text)}</td><td>${v(x.b?.text)}</td></tr>`).join('') + '</tbody></table>';
  }
  if (c.ports.length) {
    const pass = CATEGORIES[a.category]?.ports === 'passthrough';
    body += `<table class="small" style="margin-top:2mm"><thead><tr><th>포트</th><th>상태</th>${pass ? '<th>뒤(고정 배선)</th><th>앞(패치코드)</th>' : '<th>연결</th>'}<th>비고</th></tr></thead><tbody>`
      + c.ports.map(p => `<tr><td>${e(p.name)}</td><td>${v(p.status)}</td>${pass ? `<td>${v(p.rear?.text)}</td><td>${v(p.front?.text)}</td>` : `<td>${v(p.peer?.text)}</td>`}<td>${v(p.data.breaker ? '차단기 ' + p.data.breaker : p.data.note)}</td></tr>`).join('') + '</tbody></table>';
  }
  const ended = c.connections.filter(x => !x.active);
  if (ended.length) {
    body += `<div class="small" style="margin-top:2mm"><b>해제·변경된 연결 이력</b></div><table class="small"><thead><tr><th>연결</th><th>종류</th><th>등록</th><th>해제</th><th>사유</th></tr></thead><tbody>`
      + ended.map(x => `<tr><td>${e(x.a.text)} ↔ ${e(x.b.text)}</td><td>${e(CONN_KINDS[x.kind])}</td><td>${fmtDate(x.created_at)}</td><td>${fmtDate(x.ended_at)}</td><td>${v(x.end_reason)}</td></tr>`).join('') + '</tbody></table>';
  }

  body += '<h2>측정 기록</h2>';
  body += c.measurements.length ? `<table class="small"><thead><tr><th>측정일시</th><th>시험</th><th>구간·조합</th><th>조건</th><th>측정값</th><th>측정기기·측정자</th><th>적용 기준</th><th>자동 판정</th><th>검토</th><th>성적서</th></tr></thead><tbody>`
    + c.measurements.map(m => `<tr${m.superseded_by ? ' class="muted"' : ''}><td>${fmtDate(m.measured_at)}${m.superseded_by ? '<br>(정정됨)' : ''}${m.corrects_id ? '<br>정정: ' + v(m.correction_reason) : ''}</td>
      <td>${e(TEST_TYPES[m.test_type]?.label)}</td><td>${v([m.section, m.combination, m.core_no ? '#' + m.core_no : ''].filter(Boolean).join(' / '))}</td>
      <td>${v([m.test_voltage ? m.test_voltage + 'V' : '', m.wavelength ? m.wavelength + 'nm' : '', m.direction].filter(Boolean).join(' '))}</td>
      <td>${m.value !== null ? e(m.value) + ' ' + v(m.unit) : v(m.overall)}${m.items ? '<br>' + m.items.map(i => `${e(i.name)}: ${e(i.result || i.value || '')}`).join(', ') : ''}</td>
      <td>${v(m.instrument)}<br>${v(m.measurer)}</td>
      <td>${m.criteria_snapshot ? `${e(m.criteria_snapshot.name)} v${m.criteria_snapshot.version}<br>${e(m.criteria_snapshot.comparator)} ${e(m.criteria_snapshot.value)} ${e(m.criteria_snapshot.unit)}` : '미설정'}</td>
      <td class="${resCls(m.auto_result)}">${e(m.auto_result)}</td><td>${e(m.review_status)}${m.reviewer_name ? '<br>' + e(m.reviewer_name) : ''}</td><td>${m.file_count ? m.file_count + '건' : '<span class="bad">없음</span>'}</td></tr>`).join('') + '</tbody></table>'
    : '<div class="empty">등록된 측정 기록이 없습니다.</div>';

  body += '<h2>작업·보수 이력</h2>';
  body += c.worklogs.length ? `<table class="small"><thead><tr><th>작업일시</th><th>종류</th><th>내용</th><th>작업자·업체</th><th>변경 전</th><th>변경 후</th><th>상태</th></tr></thead><tbody>`
    + c.worklogs.map(w => `<tr${w.superseded_by ? ' class="muted"' : ''}><td>${fmtDate(w.work_at)}</td><td>${e(w.work_type)}</td><td>${v(w.content)}${w.corrects_id ? '<br>정정 사유: ' + v(w.correction_reason) : ''}</td><td>${v([w.worker, w.company].filter(Boolean).join(' / '))}</td><td>${v(w.before_value)}</td><td>${v(w.after_value)}</td><td>${e(w.superseded_by ? '정정됨' : w.status)}${w.reviewer_name ? '<br>' + e(w.reviewer_name) : ''}</td></tr>`).join('') + '</tbody></table>'
    : '<div class="empty">등록된 작업 이력이 없습니다.</div>';

  const docs = c.files.filter(f => !f.mime.startsWith('image/'));
  if (docs.length) body += '<h2>첨부 문서</h2><table class="small"><thead><tr><th>분류</th><th>파일명</th><th>등록</th></tr></thead><tbody>' + docs.map(f => `<tr><td>${e(FILE_CATEGORIES[f.category] || f.category)}</td><td>${e(f.orig_name)}</td><td>${fmtDate(f.created_at)} ${v(f.created_by_name)}</td></tr>`).join('') + '</tbody></table>';

  const photos = db.prepare(`SELECT * FROM files WHERE archived=0 AND mime LIKE 'image/%' AND id IN (${c.files.filter(f => f.mime.startsWith('image/')).map(f => f.id).join(',') || 0}) ORDER BY id`).all();
  if (photos.length) {
    body += '<h2 style="break-before:page">사진</h2>' + photoPages(photos.map(p => ({ file: p, caption: `${FILE_CATEGORIES[p.category] || ''} · ${fmtDate(p.created_at)}${p.caption ? ' · ' + p.caption : ''}` })));
  }
  return { html: page(`${a.mgmt_no} 이력 카드`, body), title: `${a.site_name} · ${a.mgmt_no} ${c.category_label} 이력 카드` };
}

function photoPages(items) {
  let html = '';
  for (let i = 0; i < items.length; i += 4) {
    html += '<div class="photo-page"><div class="photos">' + items.slice(i, i + 4).map(it => `<div class="photo"><div class="img"><img src="${imgData(it.file)}"></div><div class="cap">${e(it.caption)}</div></div>`).join('') + '</div></div>';
  }
  return html;
}

function listHead(title, site, extra = '') {
  return `<h1>${e(title)}${site.is_demo ? '<span class="demo">시연용 데이터</span>' : ''}</h1><div class="meta">${e(site.name)} (${e(site.code)}) · 출력일 ${new Date().toLocaleString('ko-KR')} ${extra}</div>`;
}

const detailsOf = id => JSON.parse(db.prepare('SELECT data FROM asset_details WHERE asset_id=?').get(id)?.data || '{}');

function powerList(siteId) {
  const site = siteHeader(siteId);
  const rows = db.prepare(`SELECT * FROM assets WHERE site_id=? AND category='power_cable' AND retired=0 ORDER BY mgmt_no`).all(siteId);
  const last = db.prepare(`SELECT MIN(value) AS v, unit, GROUP_CONCAT(DISTINCT auto_result) AS r, MAX(measured_at) AS at FROM measurements WHERE asset_id=? AND test_type='insulation' AND superseded_by IS NULL
     AND measured_at = (SELECT MAX(measured_at) FROM measurements WHERE asset_id=? AND test_type='insulation' AND superseded_by IS NULL)`);
  let body = listHead('전력케이블 목록', site, `· ${rows.length}건`);
  body += `<table class="small"><thead><tr><th>관리번호</th><th>분전반</th><th>회로</th><th>종류·규격</th><th>심수×병렬</th><th>전압·상·선식</th><th>차단기</th><th>연결 부하</th><th>시작점 → 종점</th><th>설계/실제(m)</th><th>포설일</th><th>최근 절연저항</th><th>상태</th></tr></thead><tbody>`;
  for (const a of rows) {
    const d = detailsOf(a.id); const m = last.get(a.id, a.id);
    const A = epPeer('cable', a.id, 'A'); const B = epPeer('cable', a.id, 'B');
    body += `<tr><td>${e(a.mgmt_no)}</td><td>${v(d.panel_name)}</td><td>${v(d.circuit_no)}</td><td>${v([d.cable_type, d.size].filter(Boolean).join(' '))}</td><td>${v(d.cores)}${d.parallel ? '×' + e(d.parallel) : ''}</td>
      <td>${v([d.voltage, d.phase, d.wiring].filter(Boolean).join(' '))}</td><td>${v(d.breaker_rating)}</td><td>${v(d.load_desc)}</td>
      <td>${v(A?.text || d.from_desc)} → ${v(B?.text || d.to_desc)}</td><td>${v(d.design_length)} / ${v(d.actual_length)}</td><td>${v(d.laid_date)}</td>
      <td>${m?.at ? `${e(m.v)} ${v(m.unit)} <span class="${resCls(m.r)}">${e(m.r)}</span><br><span class="muted">${fmtDate(m.at)}</span>` : '<span class="muted">미측정</span>'}</td><td>${e(a.status)}</td></tr>`;
  }
  body += '</tbody></table>';
  return { html: page('전력케이블 목록', body), landscape: true, title: `${site.name} 전력케이블 목록` };
}

function fiberSplice(siteId) {
  const site = siteHeader(siteId);
  const cables = db.prepare(`SELECT * FROM assets WHERE site_id=? AND category='fiber_cable' AND retired=0 ORDER BY mgmt_no`).all(siteId);
  let body = listHead('광코어 접속표', site);
  const conn = db.prepare(`SELECT c.*, a.mgmt_no AS closure FROM connection_endpoints ce JOIN connections c ON c.id=ce.connection_id AND c.active=1 LEFT JOIN assets a ON a.id=c.closure_asset_id WHERE ce.ep_type='core' AND ce.ep_id=? AND ce.ep_end=? AND ce.active=1`);
  for (const cb of cables) {
    const d = detailsOf(cb.id);
    const cores = db.prepare('SELECT * FROM cable_cores WHERE cable_id=? ORDER BY core_no').all(cb.id);
    body += `<h2>${e(cb.mgmt_no)} ${v(d.section_name)} <span class="muted small">${v(d.cable_type)} ${v(d.spec)} ${cores.length}C · ${v(d.from_desc)} → ${v(d.to_desc)}</span></h2>`;
    body += `<table class="small"><thead><tr><th>코어</th><th>색상</th><th>용도</th><th>상태</th><th>A단 연결</th><th>A단 접속함·트레이·슬리브</th><th>B단 연결</th><th>B단 접속함·트레이·슬리브</th></tr></thead><tbody>`;
    for (const c of cores) {
      const pa = epPeer('core', c.id, 'A'); const pb = epPeer('core', c.id, 'B');
      const ca = conn.get(c.id, 'A'); const cbb = conn.get(c.id, 'B');
      const loc = x => x ? v([x.closure, x.tray && 'T' + x.tray, x.sleeve && 'S' + x.sleeve].filter(Boolean).join(' / ')) : '-';
      body += `<tr><td>#${c.core_no}</td><td>${v(c.color)}</td><td>${v(c.purpose)}</td><td>${v(c.status)}</td><td>${v(pa?.text)}</td><td>${loc(ca)}</td><td>${v(pb?.text)}</td><td>${loc(cbb)}</td></tr>`;
    }
    body += '</tbody></table>';
  }
  if (!cables.length) body += '<div class="empty">등록된 광케이블이 없습니다.</div>';
  return { html: page('광코어 접속표', body), landscape: true, title: `${site.name} 광코어 접속표` };
}

function lanPorts(siteId) {
  const site = siteHeader(siteId);
  const pps = db.prepare(`SELECT a.*, p.mgmt_no AS rack FROM assets a LEFT JOIN assets p ON p.id=a.parent_id WHERE a.site_id=? AND a.category IN ('patch_panel') AND a.retired=0 ORDER BY rack, a.mgmt_no`).all(siteId);
  let body = listHead('LAN 포트 배선표', site);
  for (const pp of pps) {
    const ports = db.prepare('SELECT * FROM ports WHERE asset_id=? ORDER BY port_no').all(pp.id);
    body += `<h2>${e(pp.mgmt_no)} ${v(pp.name)} <span class="muted small">랙 ${v(pp.rack)} · ${ports.length}포트</span></h2>`;
    body += `<table class="small"><thead><tr><th>포트</th><th>상태</th><th>뒤 · 고정 배선</th><th>고정 배선 종점</th><th>앞 · 패치코드 연결</th><th>PoE</th></tr></thead><tbody>`;
    for (const p of ports) {
      const rear = epPeer('port', p.id, 'rear'); const front = epPeer('port', p.id, 'front');
      let far = null, poe = '';
      if (rear?.type === 'cable') {
        far = epPeer('cable', rear.id, rear.end === 'A' ? 'B' : 'A');
        poe = detailsOf(rear.id).poe || '';
      }
      body += `<tr><td>${e(p.name)}</td><td>${e(p.status)}</td><td>${v(rear?.text)}</td><td>${v(far?.text)}</td><td>${v(front?.text)}</td><td>${v(poe)}</td></tr>`;
    }
    body += '</tbody></table>';
  }
  if (!pps.length) body += '<div class="empty">등록된 패치패널이 없습니다.</div>';
  return { html: page('LAN 포트 배선표', body), landscape: true, title: `${site.name} LAN 포트 배선표` };
}

function lastLeaf(node) {
  if (!node) return null;
  const leaves = [];
  (function walk(n) { if (!n.children?.length) leaves.push(n); else n.children.forEach(walk); })(node);
  return leaves.map(l => `${l.text} (${l.end})`).join(', ');
}

function cctvLedger(siteId) {
  const site = siteHeader(siteId);
  const cams = db.prepare(`SELECT id FROM assets WHERE site_id=? AND category='cctv' AND retired=0 ORDER BY mgmt_no`).all(siteId);
  let body = listHead('CCTV 장비대장', site, `· ${cams.length}대 · 장비 비밀번호는 포함하지 않음`);
  body += `<table class="small"><thead><tr><th>장비번호</th><th>명칭</th><th>제조사·모델</th><th>시리얼</th><th>설치 위치</th><th>높이·방향</th><th>IP / MAC</th><th>NVR·채널</th><th>전원</th><th>통신 경로 종단</th><th>설치일·업체</th><th>보증기간</th><th>상태</th></tr></thead><tbody>`;
  for (const { id } of cams) {
    const c = assetCard(id); const a = c.asset; const d = c.details;
    const lan = c.ports.find(p => p.name === 'LAN'); const pwr = c.ports.find(p => p.name === 'PWR');
    const nvrCh = db.prepare(`SELECT a.mgmt_no, p.name FROM connection_endpoints e1 JOIN connection_endpoints e2 ON e2.connection_id=e1.connection_id AND e2.seq<>e1.seq
       JOIN connections c ON c.id=e1.connection_id AND c.active=1 JOIN ports p ON p.id=e2.ep_id AND e2.ep_type='port' JOIN assets a ON a.id=p.asset_id
       WHERE e1.ep_type='asset' AND e1.ep_id=? AND a.category='nvr'`).get(id);
    body += `<tr><td>${e(a.mgmt_no)}</td><td>${v(a.name)}</td><td>${v([a.manufacturer, a.model].filter(Boolean).join(' '))}</td><td>${v(a.serial_no)}</td>
      <td>${v([a.building, a.floor, a.room].filter(Boolean).join(' '))}<br>${v(a.location_desc)}</td><td>${v(d.install_height)}m / ${v(d.direction)}</td>
      <td>${v(d.ip)}<br>${v(d.mac)}</td><td>${v(nvrCh ? nvrCh.mgmt_no + ' ' + nvrCh.name : d.nvr_channel)}</td>
      <td>${v(d.power_method)}<br>${v(d.power_method === 'PoE' ? '' : (pwr?.peer?.text || '미등록'))}</td><td>${v(lastLeaf(c.paths?.comm))}</td>
      <td>${v(a.install_date)}<br>${v(a.contractor)}</td><td>${v(d.warranty_start)} ~ ${v(d.warranty_end)}</td><td>${e(a.status)}</td></tr>`;
  }
  body += '</tbody></table>';
  return { html: page('CCTV 장비대장', body), landscape: true, title: `${site.name} CCTV 장비대장` };
}

function measurementList(siteId) {
  const site = siteHeader(siteId);
  const rows = db.prepare(`SELECT m.*, a.mgmt_no, a.category, c.core_no, u.name AS reviewer, (SELECT COUNT(*) FROM files f WHERE f.owner_type='measurement' AND f.owner_id=m.id AND f.archived=0) AS fc
     FROM measurements m JOIN assets a ON a.id=m.asset_id LEFT JOIN cable_cores c ON c.id=m.core_id LEFT JOIN users u ON u.id=m.reviewed_by
     WHERE m.site_id=? AND m.superseded_by IS NULL ORDER BY a.mgmt_no, m.measured_at`).all(siteId);
  let body = listHead('시험·측정 결과 목록', site, `· ${rows.length}건 (정정 전 기록 제외)`);
  body += `<table class="small"><thead><tr><th>관리번호</th><th>시험</th><th>측정일시</th><th>구간·조합</th><th>조건</th><th>측정값</th><th>측정기기</th><th>측정자</th><th>적용 기준</th><th>자동 판정</th><th>검토</th><th>성적서</th></tr></thead><tbody>`;
  for (const m of rows) {
    const cs = m.criteria_snapshot ? JSON.parse(m.criteria_snapshot) : null;
    body += `<tr><td>${e(m.mgmt_no)}</td><td>${e(TEST_TYPES[m.test_type]?.label)}</td><td>${fmtDate(m.measured_at)}</td><td>${v([m.section, m.combination, m.core_no ? '#' + m.core_no : ''].filter(Boolean).join(' / '))}</td>
      <td>${v([m.test_voltage ? m.test_voltage + 'V' : '', m.wavelength ? m.wavelength + 'nm' : '', m.direction].filter(Boolean).join(' '))}</td>
      <td>${m.value !== null ? e(m.value) + ' ' + v(m.unit) : v(m.overall)}</td><td>${v(m.instrument)}</td><td>${v(m.measurer)}</td>
      <td>${cs ? `${e(cs.name)} v${cs.version} (${e(cs.comparator)} ${e(cs.value)} ${e(cs.unit)})` : '미설정'}</td><td class="${resCls(m.auto_result)}">${e(m.auto_result)}</td>
      <td>${e(m.review_status)} ${v(m.reviewer)}</td><td>${m.fc ? m.fc + '건' : '<span class="bad">없음</span>'}</td></tr>`;
  }
  body += '</tbody></table>';
  return { html: page('시험·측정 결과 목록', body), landscape: true, title: `${site.name} 시험·측정 결과 목록` };
}

function worklogList(siteId, q = {}) {
  const site = siteHeader(siteId);
  const params = [siteId]; let extra = '';
  if (q.from) { extra += ' AND w.work_at>=?'; params.push(q.from); }
  if (q.to) { extra += ' AND w.work_at<=?'; params.push(q.to + ' 23:59'); }
  if (q.work_type) { extra += ' AND w.work_type=?'; params.push(q.work_type); }
  const rows = db.prepare(`SELECT w.*, a.mgmt_no, a.category, u.name AS reviewer FROM work_logs w JOIN assets a ON a.id=w.asset_id LEFT JOIN users u ON u.id=w.reviewed_by
    WHERE w.site_id=? AND w.superseded_by IS NULL ${extra} ORDER BY w.work_at, w.id`).all(...params);
  let body = listHead('보수 이력대장', site, `· ${rows.length}건${q.from || q.to ? ` · 기간 ${q.from || ''} ~ ${q.to || ''}` : ''}`);
  body += `<table class="small"><thead><tr><th>작업일시</th><th>관리번호</th><th>설비</th><th>작업 종류</th><th>내용</th><th>작업자·업체</th><th>변경 전</th><th>변경 후</th><th>검토</th></tr></thead><tbody>`;
  for (const w of rows) body += `<tr><td>${fmtDate(w.work_at)}</td><td>${e(w.mgmt_no)}</td><td>${e(CATEGORIES[w.category]?.label)}</td><td>${e(w.work_type)}</td><td>${v(w.content)}${w.corrects_id ? '<br>정정 사유: ' + v(w.correction_reason) : ''}</td>
    <td>${v([w.worker, w.company].filter(Boolean).join(' / '))}</td><td>${v(w.before_value)}</td><td>${v(w.after_value)}</td><td>${e(w.status)} ${v(w.reviewer)}</td></tr>`;
  body += '</tbody></table>';
  return { html: page('보수 이력대장', body), landscape: true, title: `${site.name} 보수 이력대장` };
}

function photoLedger(siteId, q = {}) {
  const site = siteHeader(siteId);
  const params = [siteId]; let extra = '';
  if (q.asset_id) { extra += ` AND (a.id=?)`; params.push(Number(q.asset_id)); }
  if (q.from) { extra += ' AND f.created_at>=?'; params.push(q.from); }
  if (q.to) { extra += ' AND f.created_at<=?'; params.push(q.to + ' 23:59'); }
  const rows = db.prepare(`SELECT f.*, a.mgmt_no, a.name AS asset_name, w.work_type, w.work_at FROM files f
    LEFT JOIN work_logs w ON f.owner_type='worklog' AND w.id=f.owner_id
    LEFT JOIN measurements m ON f.owner_type='measurement' AND m.id=f.owner_id
    JOIN assets a ON a.id = CASE f.owner_type WHEN 'asset' THEN f.owner_id WHEN 'worklog' THEN w.asset_id WHEN 'measurement' THEN m.asset_id END
    WHERE f.site_id=? AND f.archived=0 AND f.mime LIKE 'image/%' ${extra}
    ORDER BY a.mgmt_no, COALESCE(w.work_at, f.created_at), CASE f.category WHEN 'photo_before' THEN 0 WHEN 'photo_after' THEN 2 ELSE 1 END, f.id`).all(...params);
  let body = listHead('작업 전후 사진대장', site, `· ${rows.length}매`);
  body += rows.length ? photoPages(rows.map(r => ({ file: r, caption: `${r.mgmt_no}${r.asset_name ? ' ' + r.asset_name : ''} · ${FILE_CATEGORIES[r.category] || ''}${r.work_type ? ' · ' + r.work_type : ''} · ${fmtDate(r.work_at || r.created_at)}${r.caption ? ' · ' + r.caption : ''}` })))
    : '<div class="empty">조건에 맞는 사진이 없습니다.</div>';
  return { html: page('작업 전후 사진대장', body), landscape: false, title: `${site.name} 작업 전후 사진대장` };
}

async function qrLabels(siteId, ids) {
  const site = siteHeader(siteId);
  const rows = ids?.length
    ? db.prepare(`SELECT * FROM assets WHERE site_id=? AND retired=0 AND id IN (${ids.map(() => '?').join(',')}) ORDER BY mgmt_no`).all(siteId, ...ids)
    : db.prepare('SELECT * FROM assets WHERE site_id=? AND retired=0 ORDER BY category, mgmt_no').all(siteId);
  let cells = '';
  for (const a of rows) {
    const qr = await QRCode.toDataURL(`${config.publicBaseUrl || config.runtimeBase || ''}/q/${a.qr_token}`, { margin: 0, width: 160 });
    cells += `<div style="border:0.6px solid #777;padding:2mm;display:flex;gap:2mm;align-items:center;break-inside:avoid;height:30mm">
      <img src="${qr}" style="width:24mm;height:24mm"><div><div style="font-size:11pt;font-weight:700">${e(a.mgmt_no)}</div>
      <div class="small">${e(CATEGORIES[a.category]?.label)}${a.name ? ' · ' + e(a.name) : ''}</div><div class="small muted">${e(site.name)}</div></div></div>`;
  }
  const body = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:3mm">${cells}</div>`;
  return { html: page('QR 라벨', body), title: `${site.name} QR 라벨` };
}

const REPORTS = {
  power_list: { label: '전력케이블 목록', fn: powerList },
  fiber_splice: { label: '광코어 접속표', fn: fiberSplice },
  lan_ports: { label: 'LAN 포트 배선표', fn: lanPorts },
  cctv_ledger: { label: 'CCTV 장비대장', fn: cctvLedger },
  measurements: { label: '시험·측정 결과 목록', fn: measurementList },
  worklogs: { label: '보수 이력대장', fn: worklogList },
  photos: { label: '작업 전후 사진대장', fn: photoLedger },
};

module.exports = { cardHtml, REPORTS, qrLabels };
