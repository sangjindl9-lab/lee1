/* 관급자재 구매요청서 자동작성 — 화면 동작 (공사 여러 개 저장 · 품목별 작업창 · 결과 기반 필터) */
(function () {
  'use strict';
  const E = window.GK_ENGINE, CARD = window.GK_CARD;
  const MAX_PICKS = 7, MAX_ITEMS = E.LAYOUT.maxItems;
  const $ = (s) => document.querySelector(s);
  const KEY = 'gwj_v3';

  // ───────────── 저장 (이 브라우저) ─────────────
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const newItem = () => ({ id: uid(), name: '', spec: '', unit: '', qtyTotal: '', qtyNow: '', designPrice: '', kw: '', picks: [] });
  const newProject = (name = '') => ({ id: uid(), project: { name, type: '', materials: '', period: '', location: '', round: '', group: '' }, items: [newItem()], updated: Date.now() });
  let DB = loadDB();
  function loadDB() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.projects && Object.keys(d.projects).length) return d; } catch {}
    const p = newProject();
    try { // 이전 버전 자료 옮기기
      const old = JSON.parse(localStorage.getItem('gwj_state_v2'));
      if (old && old.items) {
        p.project = Object.assign(p.project, old.project || {});
        const its = old.items.filter((it) => it.name || Object.keys(it.slots || {}).length).map((it) => {
          const picks = [];
          for (const r of it.results || []) { const s = (it.slots || {})[r.no]; if (s) picks[s - 1] = r; }
          return { id: uid(), name: it.name || '', spec: it.spec || '', unit: it.unit || '', qtyTotal: it.qtyTotal || '', qtyNow: it.qtyNow || '', designPrice: it.designPrice || '', kw: it.kw || '', picks: picks.filter(Boolean) };
        });
        if (its.length) p.items = its;
      }
    } catch {}
    return { current: p.id, projects: { [p.id]: p } };
  }
  const save = debounce(() => { const P = cur(); if (P) P.updated = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { toast('브라우저 저장공간이 부족합니다. [백업 저장] 후 안 쓰는 공사를 지워 주세요.', 9000); } }, 300);
  const cur = () => DB.projects[DB.current];
  const items = () => cur().items;
  let selId = null;                 // 지금 작업 중인 품목
  const RES = {};                   // 품목별 검색 결과·필터 (저장 안 함)
  const R = (id) => (RES[id] = RES[id] || { kw: '', list: [], total: 0, f: emptyFilter() });
  function emptyFilter() { return { cls: new Set(), tok: new Set(), co: new Set(), cert: new Set(), min: '', max: '', text: '' }; }

  // ───────────── 나라장터 (서버 경유) ─────────────
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ error: '응답 해석 실패' }));
    if (!r.ok || j.error) throw new Error(j.error || ('요청 실패 ' + r.status));
    return j;
  }
  async function searchAll(keyword, maxPages = 5) {
    let out = [], total = 0;
    for (let p = 1; p <= maxPages; p++) {
      const j = await post('/api/search', { keyword, page: p });
      total = j.total; out.push(...j.list);
      if (j.list.length < 100 || out.length >= total) break;
    }
    const seen = new Set();
    return { list: out.filter((x) => (seen.has(x.no + '|' + x.price) ? false : seen.add(x.no + '|' + x.price))).sort((a, b) => a.price - b.price), total };
  }
  const imgUrl = (src) => (src ? '/api/img?src=' + encodeURIComponent(src) : '');
  // 나라장터 쇼핑몰 상품 원본 화면 링크 (상품 화면 [공유]→[URL복사]와 같은 주소)
  const shopLink = (r) => (r.mng ? `<a class="shop" href="https://shop.g2b.go.kr/link/GMSF001_01/?ctrtItemMngNo=${encodeURIComponent(r.mng)}" target="_blank" rel="noopener noreferrer" title="나라장터 쇼핑몰에서 원본 보기">${esc(r.nm)} ↗</a>` : esc(r.nm));
  const isAddr = (t) => /ctrtItemMngNo=|shop\.g2b\.go\.kr/i.test(t) || /^\s*\d{8}(\s+\d{8})*\s*$/.test(t);

  // ───────────── 검색어 추정 ─────────────
  const KO = [[/cable\s*tray/i, '케이블트레이'], [/joiner/i, '조이너'], [/ladder/i, '래더'], [/u[\s-]*channel/i, '유찬넬'], [/bracket/i, '브라켓'], [/shank\s*bolt/i, '생크볼트'],
    [/bonding|jumper/i, '본딩점퍼'], [/tunnel/i, '터널등'], [/street\s*light/i, '가로등'], [/panel\s*board/i, '분전반'], [/\bups\b/i, 'UPS'], [/generator/i, '발전기']];
  function guessKw(it) {
    const name = String(it.name || '').trim(), spec = String(it.spec || '');
    const ko = KO.filter(([re]) => re.test(name)).map(([, k]) => k);
    const dims = /(\d+(?:\.\d+)?)\s*W?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*H?/i.exec(spec);
    let base = ko.length ? (/joiner/i.test(name) ? '조이너' : ko[0]) : name;
    if (dims) return `${base} ${dims[1]}×${dims[2]}`;
    const w = /(\d+(?:\.\d+)?)\s*(kW|kVA|W|A|SQ|mm|M)\b/i.exec(spec);
    return w ? `${base} ${w[0].replace(/\s+/g, '')}` : base;
  }

  // ───────────── 결과에서 필터 항목 만들기 ─────────────
  function tokensOf(r) {
    if (r._tok) return r._tok;
    const parts = String(r.nm).split(',').map((s) => s.trim()).filter(Boolean);
    const t = new Set();
    for (const a of parts.slice(3)) {
      t.add(a);
      const d = /(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)/.exec(a); if (d) t.add(`${d[1]}×${d[2]}`);
      const th = /t\s?\d+(?:\.\d+)?\s?mm/i.exec(a); if (th) t.add(th[0].replace(/\s/g, ''));
      for (const p of a.split('/')) if (p && p !== a && p.length <= 20) t.add(p.trim());
    }
    Object.defineProperty(r, '_tok', { value: t, enumerable: false });
    return t;
  }
  function facets(list) {
    const cnt = (arr) => { const m = new Map(); for (const v of arr) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const n = list.length;
    return {
      cls: cnt(list.map((r) => r.cls).filter(Boolean)),
      tok: cnt(list.flatMap((r) => [...tokensOf(r)])).filter(([, c]) => c < n || n === 1).slice(0, 40),
      co: cnt(list.map((r) => short(r.co))).slice(0, 30),
      cert: cnt(list.flatMap((r) => r.certs)),
    };
  }
  function applyFilter(list, f) {
    const min = +String(f.min).replace(/,/g, '') || 0, max = +String(f.max).replace(/,/g, '') || Infinity;
    const words = String(f.text || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
    return list.filter((r) => (!f.cls.size || f.cls.has(r.cls)) &&
      [...f.tok].every((t) => tokensOf(r).has(t)) &&
      (!f.co.size || f.co.has(short(r.co))) &&
      [...f.cert].every((c) => r.certs.includes(c)) &&
      r.price >= min && r.price <= max &&
      words.every((w) => (r.nm + ' ' + r.co + ' ' + r.no).toLowerCase().replace(/\s/g, '').includes(w.replace(/x/g, '×'))));
  }

  // ───────────── 화면 그리기 ─────────────
  const PF = [['name', '공사명'], ['type', '주요공종'], ['materials', '관급자재품목'], ['period', '공사기간'], ['location', '공사위치'], ['round', '차수 (예: 4차)'], ['group', '조사표 제목 자재명']];
  function renderProjects() {
    const ps = Object.values(DB.projects).sort((a, b) => b.updated - a.updated);
    $('#projSel').innerHTML = ps.map((p) => `<option value="${esc(p.id)}" ${p.id === DB.current ? 'selected' : ''}>${esc(p.project.name || '(공사명 없음)')} · 품목 ${p.items.filter((i) => i.name || i.picks.length).length}</option>`).join('');
  }
  function renderOverview() {
    const P = cur().project;
    $('#project').innerHTML = PF.map(([k, l]) => `<label>${l}<input data-p="${k}" value="${esc(P[k] || '')}"></label>`).join('');
    $('#ovSummary').textContent = P.name ? '— ' + P.name : '— 공사명을 입력하세요';
  }
  function renderItems() {
    const its = items();
    if (!its.find((i) => i.id === selId)) selId = its[0] ? its[0].id : null;
    $('#itemCount').textContent = `${its.length}개 (최대 ${MAX_ITEMS})`;
    $('#itemList').innerHTML = its.map((it, i) => {
      const n = it.picks.length;
      return `<div class="it ${it.id === selId ? 'on' : ''}" data-sel="${esc(it.id)}">
        <span class="no">${i + 1}</span>
        <div class="nm"><b>${esc(it.name || '(자재명 미입력)')}</b><small>${esc(it.spec || '')}</small></div>
        <span class="badge ${n >= 3 ? 'ok' : n ? 'mid' : ''}">업체 ${n}</span>
      </div>`;
    }).join('');
    $('[data-a=addItem]').disabled = its.length >= MAX_ITEMS;
  }
  function renderEditor() {
    const it = items().find((x) => x.id === selId);
    if (!it) { $('#editor').innerHTML = '<p class="muted">왼쪽에서 [＋ 품목 추가]를 누르세요.</p>'; return; }
    const idx = items().indexOf(it) + 1;
    const F = [['name', '자재명', ''], ['spec', '규격', ''], ['unit', '단위', 'w-s'], ['qtyTotal', '설계수량', 'w-m num'], ['qtyNow', '금회수량', 'w-m num'], ['designPrice', '설계단가', 'w-m num']];
    $('#editor').innerHTML = `
      <div class="edhead"><h2>${idx}번 품목</h2><button class="ghost sm" data-a="delItem">품목 삭제</button></div>
      <div class="fields">${F.map(([k, l, c]) => `<label class="${c}">${l}<input data-f="${k}" value="${esc(it[k] ?? '')}"></label>`).join('')}</div>

      <div class="picks">
        <div class="ph"><b>선택한 업체</b> <span class="${it.picks.length >= 3 ? 'ok' : 'warn'}">${it.picks.length}곳${it.picks.length < 3 ? ' — 조사표에는 3곳이 필요합니다' : ''}</span></div>
        ${it.picks.length ? `<table class="ptbl"><tbody>${it.picks.map((r, i) => `<tr>
          <td class="slot">${i + 1}번</td><td>${r.img ? `<img src="${imgUrl(r.img)}" alt="">` : ''}</td>
          <td><b>${esc(r.co)}</b><br><span class="muted">${esc(r.loc || '')}</span></td><td>${esc(r.no)}</td>
          <td class="nm">${shopLink(r)}</td><td class="num">${r.price.toLocaleString()}<small> / ${esc(r.unit)}</small></td>
          <td class="cert">${r.certs.map((c) => `<span>${esc(c)}</span>`).join('')}</td>
          <td class="acts"><button class="ghost xs" data-a="up" data-i="${i}" ${i ? '' : 'disabled'}>▲</button><button class="ghost xs" data-a="down" data-i="${i}" ${i < it.picks.length - 1 ? '' : 'disabled'}>▼</button><button class="ghost xs" data-a="rm" data-i="${i}">✕</button></td>
        </tr>`).join('')}</tbody></table>` : '<p class="muted">아직 없습니다. 아래에서 검색하거나 상품 주소를 붙여넣고 [선택]을 누르세요.</p>'}
      </div>

      <form class="ubar" id="uform">
        <label for="ubox">🔗 상품 주소로 추가 <small>나라장터 쇼핑몰 상품 화면 → [공유] → [URL복사] 한 주소를 붙여넣으세요. 넣을 때마다 이 품목의 다음 업체로 들어갑니다.</small></label>
        <div class="row"><input id="ubox" autocomplete="off" placeholder="https://shop.g2b.go.kr/link/GMSF001_01/?ctrtItemMngNo=…  (여러 개는 띄어서 붙여넣기)">
        <button>주소로 추가</button></div>
      </form>

      <form class="sbar" id="sform">
        <input id="sbox" autocomplete="off" placeholder="🔍 나라장터 검색어 (예: 케이블트레이 150×60, LED 터널등, 디젤발전기)" value="${esc(R(it.id).kw || it.kw || guessKw(it))}">
        <button>검색</button>
        <button type="button" class="ghost" data-a="auto3" title="필터된 결과에서 싼 순서로 서로 다른 업체 3곳 자동 선택">싼 업체 3곳 자동</button>
      </form>
      <div id="resultArea"></div>`;
    renderResults();
  }
  function renderResults() {
    const it = items().find((x) => x.id === selId); if (!it) return;
    const st = R(it.id);
    const area = $('#resultArea'); if (!area) return;
    if (!st.list.length) { area.innerHTML = st.kw ? '<p class="muted">검색 결과가 없습니다. 검색어를 짧게 하거나 규격을 "300×60"처럼 써 보세요.</p>' : ''; return; }
    const fc = facets(st.list), f = st.f;
    const shown = applyFilter(st.list, f);
    const picked = new Map(it.picks.map((r, i) => [r.no + '|' + r.price, i + 1]));
    const chips = (key, arr) => arr.map(([v, c]) => `<button type="button" class="chip ${f[key].has(v) ? 'on' : ''}" data-fk="${key}" data-fv="${esc(v)}">${esc(v)} <i>${c}</i></button>`).join('');
    const active = f.cls.size + f.tok.size + f.co.size + f.cert.size + (f.min ? 1 : 0) + (f.max ? 1 : 0) + (f.text ? 1 : 0);
    area.innerHTML = `
      <div class="filters">
        <div class="fhead"><b>필터</b> <span class="muted">검색 결과 ${st.list.length}건 중 <b>${shown.length}건</b> 표시</span>${active ? '<button type="button" class="ghost xs" data-a="clearF">필터 모두 해제</button>' : ''}</div>
        ${fc.cls.length > 1 ? `<div class="frow"><span class="fl">세부품명</span>${chips('cls', fc.cls)}</div>` : ''}
        ${fc.tok.length ? `<div class="frow"><span class="fl">규격·사양</span>${chips('tok', fc.tok)}</div>` : ''}
        ${fc.co.length > 1 ? `<div class="frow"><span class="fl">업체</span>${chips('co', fc.co)}</div>` : ''}
        ${fc.cert.length ? `<div class="frow"><span class="fl">인증</span>${chips('cert', fc.cert)}</div>` : ''}
        <div class="frow"><span class="fl">가격·단어</span>
          <input class="w-m" data-ff="min" placeholder="최저가" value="${esc(f.min)}"> ~ <input class="w-m" data-ff="max" placeholder="최고가" value="${esc(f.max)}">
          <input data-ff="text" placeholder="포함 단어 (예: t1mm 분체)" value="${esc(f.text)}"></div>
      </div>
      <div class="tblwrap"><table class="res"><thead><tr><th></th><th>사진</th><th>업체(제조사)</th><th>물품식별번호</th><th>품목명·규격</th><th>단가</th><th>본사</th><th>인증</th></tr></thead><tbody>
      ${shown.slice(0, 300).map((r) => { const s = picked.get(r.no + '|' + r.price); return `<tr class="${s ? 'on' : ''}">
        <td>${s ? `<button class="sm" data-a="unpick" data-k="${esc(r.no + '|' + r.price)}">✓ ${s}번</button>` : `<button class="ghost sm" data-a="pick" data-k="${esc(r.no + '|' + r.price)}">선택</button>`}</td>
        <td>${r.img ? `<img loading="lazy" src="${imgUrl(r.img)}" alt="">` : ''}</td><td>${esc(r.co)}</td><td>${esc(r.no)}</td>
        <td class="nm">${shopLink(r)}<br><span class="muted">${esc(r.cls || '')}</span></td><td class="num">${r.price.toLocaleString()}<small> / ${esc(r.unit)}</small></td>
        <td>${esc(r.loc)}</td><td class="cert">${r.certs.map((c) => `<span>${esc(c)}</span>`).join('')}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">필터에 맞는 제품이 없습니다.</td></tr>'}
      </tbody></table></div>`;
  }
  function renderAll() { renderProjects(); renderOverview(); renderItems(); renderEditor(); }

  // ───────────── 품목 작업 ─────────────
  const curItem = () => items().find((x) => x.id === selId);
  function addPick(it, r) {
    if (it.picks.some((x) => x.no === r.no && x.price === r.price)) return false;
    if (it.picks.length >= MAX_PICKS) { toast(`업체는 ${MAX_PICKS}곳까지입니다.`); return false; }
    it.picks.push(r);
    // 첫 업체 선택 시 비어 있는 칸 채우기
    if (!it.name) it.name = r.cls || '';
    if (!it.unit) it.unit = r.unit || '';
    if (!it.spec) { const p = String(r.nm).split(',').map((s) => s.trim()); it.spec = p[3] || ''; }
    return true;
  }
  async function searchOrAdd(text) {
    const it = curItem(); if (!it) return;
    if (!text) return toast('검색어나 상품 주소를 넣어 주세요.');
    const st = R(it.id);
    try {
      if (isAddr(text)) {
        busy('나라장터에서 상품 정보를 가져오는 중…');
        const j = await post('/api/resolve', { text });
        busy('');
        const ok = [], bad = [];
        for (const x of j.results) {
          if (!x.item) { bad.push(x.error); continue; }
          if (addPick(it, x.item)) ok.push(`${short(x.item.co)} ${x.item.price.toLocaleString()}원` + (x.partial ? ' (본사·인증 확인 필요)' : ''));
          else bad.push(`${short(x.item.co)}: 이미 선택했거나 업체 칸이 찼습니다.`);
        }
        save(); renderItems(); renderEditor();
        if (!ok.length) $('#ubox').value = text; // 실패하면 입력한 주소를 남겨 둠
        toast((ok.length ? `✔ ${ok.length}곳 등록 (지금 ${it.picks.length}곳)\n• ${ok.join('\n• ')}` : '') + (bad.length ? `${ok.length ? '\n\n' : ''}✖ ${bad.join('\n✖ ')}` : ''), 9000);
        return;
      }
      busy(`나라장터 검색 중… "${text}"`);
      const { list, total } = await searchAll(text);
      busy('');
      Object.assign(st, { kw: text, list, total, f: emptyFilter() });
      it.kw = text; save(); renderResults();
      if (!list.length) toast('검색 결과가 없습니다.');
    } catch (e) { busy(''); toast('실패: ' + e.message, 9000); }
  }
  function auto3() {
    const it = curItem(); const st = R(it.id);
    if (!st.list.length) return toast('먼저 검색하세요.');
    const have = new Set(it.picks.map((r) => coKey(r.co)));
    let added = 0;
    for (const r of applyFilter(st.list, st.f)) {
      if (it.picks.length >= 3) break;
      if (have.has(coKey(r.co))) continue;
      addPick(it, r); have.add(coKey(r.co)); added++;
    }
    save(); renderItems(); renderEditor();
    toast(added ? `싼 순서로 ${added}곳을 골랐습니다. 필터를 먼저 맞추면 원하는 규격만 고릅니다.` : '더 고를 업체가 없습니다. 필터를 확인하세요.');
  }

  // ───────────── 엑셀 출력 ─────────────
  let TPL = null;
  async function getTemplate() {
    if (!TPL) { const r = await fetch('gwangeup_template.xlsx', { cache: 'no-cache' }); if (!r.ok) throw new Error('내장 양식을 불러오지 못했습니다.'); TPL = new Uint8Array(await r.arrayBuffer()); }
    return TPL;
  }
  async function build() {
    const its = items().filter((it) => it.name || it.picks.length);
    if (!its.length) return toast('품목을 추가하고 업체를 선택하세요.');
    const none = its.findIndex((it) => !it.picks.length);
    if (none >= 0) { selId = its[none].id; renderItems(); renderEditor(); return toast(`${items().indexOf(its[none]) + 1}번 품목에 선택한 업체가 없습니다.`); }
    const P = cur().project;
    const summary = its.map((it, i) => `${i + 1}. ${it.name} ${it.spec || ''} — ${it.picks.map((r) => short(r.co)).join(', ')}`).join('\n');
    const isNum = (v) => String(v ?? '').replace(/,/g, '').trim() !== '' && isFinite(+String(v).replace(/,/g, ''));
    const bad = its.map((it, i) => [i + 1, it, [['금회수량', it.qtyNow], ['설계수량', it.qtyTotal], ['설계단가', it.designPrice]].filter(([, v]) => !isNum(v)).map(([k]) => k)]).filter(([, , ks]) => ks.length);
    const warn = bad.length ? `\n\n※ 숫자가 비었거나 숫자가 아닌 칸 (0으로 계산됨):\n${bad.map(([n, it, ks]) => `${n}. ${it.name}: ${ks.join(', ')}`).join('\n')}` : '';
    if (!confirm(`[${P.name || '공사명 없음'}]\n아래 품목으로 출력합니다.\n\n${summary}${warn}`)) return;
    const checkedAt = nowStr();
    try {
      const data = { project: P, items: [] };
      let n = 0;
      for (const it of its) {
        const companies = [];
        for (const r of it.picks) {
          busy(`외형도 이미지 만드는 중… (${++n})`);
          let img = null; try { img = await loadImg(r.img); } catch {}
          const image = await CARD.cardBytes({ name: r.nm, no: r.no, co: r.co, loc: r.loc, price: r.price, unit: r.unit, certs: r.certs, term: r.term, ctrtEnd: r.ctrtEnd, contractType: r.type, checkedAt }, img);
          companies.push({ co: r.co, loc: r.loc, no: r.no, price: r.price, unit: r.unit, certs: r.certs, image });
        }
        data.items.push({ name: it.name, spec: it.spec, unit: it.unit, qtyTotal: it.qtyTotal, qtyRound: it.qtyNow, qtyNow: it.qtyNow, designPrice: it.designPrice, companies });
      }
      busy('원본 양식에 채우는 중…');
      const res = await E.fillWorkbook(JSZip, await getTemplate(), data);
      const fname = `관급자재 구매요청서_${(P.name || P.group || '공사').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}_${checkedAt.slice(0, 10).replace(/\./g, '')}.xlsx`;
      download(res.bytes, fname, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); busy('');
      toast(`✔ ${fname} 저장됨 (다운로드 폴더)` + (res.warnings.length ? `\n\n참고:\n• ${res.warnings.join('\n• ')}` : ''), res.warnings.length ? 12000 : 6000);
    } catch (e) { busy(''); console.error(e); toast('엑셀 출력 실패: ' + e.message, 10000); }
  }
  async function loadImg(src) { if (!src) return null; const r = await fetch(imgUrl(src)); if (!r.ok) return null; return createImageBitmap(await r.blob()); }
  function download(data, name, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ───────────── 공사 관리 ─────────────
  function switchProject(id) { DB.current = id; selId = null; save(); renderAll(); }
  function addProject() {
    const name = prompt('새 공사명을 입력하세요', ''); if (name === null) return;
    const c = cur(); // 아무것도 안 넣은 빈 공사는 정리
    if (c && !Object.values(c.project).some((v) => String(v || '').trim()) && !c.items.some((i) => i.name || i.spec || i.picks.length)) delete DB.projects[c.id];
    const p = newProject(name.trim()); DB.projects[p.id] = p; switchProject(p.id);
    toast('새 공사를 만들었습니다. 이전 공사는 위 [공사] 목록에서 언제든 다시 열 수 있습니다.');
  }
  function copyProject() {
    const src = cur(); const p = JSON.parse(JSON.stringify(src)); p.id = uid(); p.project.name = (src.project.name || '공사') + ' (복사)';
    p.items.forEach((it) => (it.id = uid())); p.updated = Date.now(); DB.projects[p.id] = p; switchProject(p.id);
  }
  function deleteProject() {
    const P = cur();
    if (!confirm(`"${P.project.name || '공사명 없음'}" 공사를 삭제할까요?\n(되돌릴 수 없습니다. 필요하면 먼저 [백업 저장]을 하세요)`)) return;
    delete DB.projects[P.id];
    if (!Object.keys(DB.projects).length) { const p = newProject(); DB.projects[p.id] = p; }
    switchProject(Object.values(DB.projects).sort((a, b) => b.updated - a.updated)[0].id);
  }
  function backup() {
    download(JSON.stringify({ app: 'gwangeup', ver: 3, savedAt: new Date().toISOString(), ...DB }, null, 1), `관급자재_공사백업_${nowStr().slice(0, 10).replace(/\./g, '')}.json`, 'application/json');
  }
  async function restore(file) {
    try {
      const d = JSON.parse(await file.text());
      if (!d.projects) throw new Error('백업 파일 형식이 아닙니다.');
      const okP = (p) => p && typeof p === 'object' && p.project && typeof p.project === 'object' && Array.isArray(p.items) &&
        p.items.every((it) => it && typeof it === 'object' && Array.isArray(it.picks) && it.picks.every((r) => r && typeof r.price === 'number' && Array.isArray(r.certs)));
      const list = Object.values(d.projects);
      if (!list.length || !list.every(okP)) throw new Error('백업 파일 내용이 올바르지 않습니다.');
      let n = 0; const idMap = {};
      for (const p of list) {
        const q = JSON.parse(JSON.stringify(p));
        if (!q.id || DB.projects[q.id]) { // 이미 있는 공사는 덮어쓰지 않고 따로 추가
          q.id = uid(); q.items.forEach((it) => (it.id = uid()));
          q.project.name = (q.project.name || '공사') + ' (불러옴)';
        }
        q.updated = Date.now(); idMap[p.id] = q.id; DB.projects[q.id] = q; n++;
      }
      DB.current = idMap[d.current] || Object.values(idMap)[0];
      selId = null; save(); renderAll(); toast(`공사 ${n}개를 불러왔습니다. 기존 공사는 그대로 있고, 같은 공사는 "(불러옴)"을 붙여 따로 추가했습니다.`, 7000);
    } catch (e) { toast('불러오기 실패: ' + e.message, 8000); }
  }

  // ───────────── 이벤트 ─────────────
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.p) { cur().project[t.dataset.p] = t.value; if (t.dataset.p === 'name') $('#ovSummary').textContent = '— ' + t.value; save(); }
    if (t.dataset.f) { const it = curItem(); if (it) { it[t.dataset.f] = t.value; save(); } }
    if (t.dataset.ff) { const st = R(selId); st.f[t.dataset.ff] = t.value; clearTimeout(t._t); t._t = setTimeout(() => { const pos = t.selectionStart, k = t.dataset.ff; renderResults(); const n = document.querySelector(`[data-ff="${k}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }, 350); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'projSel') switchProject(t.value);
    if (t.id === 'restoreInput' && t.files[0]) { restore(t.files[0]); t.value = ''; }
    if (t.dataset.p === 'name') renderProjects();
    if (t.dataset.f && ['name', 'spec'].includes(t.dataset.f)) renderItems();
  });
  document.addEventListener('click', (e) => {
    const sel = e.target.closest('[data-sel]'); if (sel) { selId = sel.dataset.sel; renderItems(); renderEditor(); if (innerWidth < 900) $('#editor').scrollIntoView({ behavior: 'smooth' }); return; }
    const chip = e.target.closest('[data-fk]');
    if (chip) { const s = R(selId).f[chip.dataset.fk]; const v = chip.dataset.fv; s.has(v) ? s.delete(v) : s.add(v); renderResults(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, it = curItem();
    if (a === 'build') build();
    if (a === 'newProj') addProject();
    if (a === 'copyProj') copyProject();
    if (a === 'delProj') deleteProject();
    if (a === 'backup') backup();
    if (a === 'addItem') { if (items().length >= MAX_ITEMS) return; const n = newItem(); items().push(n); selId = n.id; save(); renderItems(); renderEditor(); setTimeout(() => $('[data-f=name]') && $('[data-f=name]').focus(), 50); }
    if (a === 'delItem' && it && confirm(`${items().indexOf(it) + 1}번 품목을 삭제할까요?`)) { cur().items = items().filter((x) => x !== it); if (!items().length) items().push(newItem()); selId = null; save(); renderItems(); renderEditor(); }
    if (a === 'auto3') auto3();
    if (a === 'clearF') { R(selId).f = emptyFilter(); renderResults(); }
    if (it && (a === 'pick' || a === 'unpick')) {
      const [no, pr] = b.dataset.k.split('|'); const r = R(it.id).list.find((x) => x.no === no && String(x.price) === pr);
      if (a === 'pick' && r) addPick(it, r);
      if (a === 'unpick') it.picks = it.picks.filter((x) => !(x.no === no && String(x.price) === pr));
      save(); renderItems(); const y = scrollY; renderEditor(); scrollTo(0, y);
    }
    if (it && ['up', 'down', 'rm'].includes(a)) {
      const i = +b.dataset.i, p = it.picks;
      if (a === 'rm') p.splice(i, 1);
      if (a === 'up' && i > 0) [p[i - 1], p[i]] = [p[i], p[i - 1]];
      if (a === 'down' && i < p.length - 1) [p[i + 1], p[i]] = [p[i], p[i + 1]];
      save(); renderItems(); const y = scrollY; renderEditor(); scrollTo(0, y);
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'sform') { e.preventDefault(); searchOrAdd($('#sbox').value.trim()); }
    if (e.target.id === 'uform') {
      e.preventDefault(); const t = $('#ubox').value.trim();
      if (t && !isAddr(t)) return toast('나라장터 상품 주소가 아닙니다. 상품 화면에서 [공유] → [URL복사] 한 주소를 넣어 주세요. (검색어는 아래 검색칸에)', 7000);
      searchOrAdd(t);
    }
  });

  // ───────────── 기타 ─────────────
  function busy(msg) { const b = $('#busy'); b.hidden = !msg; b.querySelector('span').textContent = msg; }
  let tt; function toast(msg, ms = 4500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), ms); }
  $('#toast').addEventListener('click', () => ($('#toast').hidden = true));
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function short(s) { return String(s).replace(/주식회사\s*|\(주\)\s*|㈜\s*/g, '').trim(); }
  function coKey(s) { return String(s).replace(/주식회사|\(주\)|㈜|\s/g, ''); }
  function nowStr() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

  addEventListener('pagehide', () => { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch {} });
  renderAll();
  getTemplate().catch(() => {});
  window.GWJ = { db: () => DB, res: RES, sel: () => selId };
})();
