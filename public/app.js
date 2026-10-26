/* 관급자재 구매요청서 자동작성 — 화면 동작 */
(function () {
  'use strict';
  const E = window.GK_ENGINE, CARD = window.GK_CARD;
  const MAX_SLOTS = 7, MAX_ITEMS = E.LAYOUT.maxItems;
  const $ = (s) => document.querySelector(s);

  // ───────────── 상태 저장 (이 브라우저에만) ─────────────
  let state = load() || { project: {}, items: [] };
  let templateBytes = null;
  async function getTemplate() {
    if (!templateBytes) { const r = await fetch('gwangeup_template.xlsx', { cache: 'no-cache' }); if (!r.ok) throw new Error('내장 양식을 불러오지 못했습니다.'); templateBytes = new Uint8Array(await r.arrayBuffer()); }
    return templateBytes;
  }
  const free = { kw: '', sort: 'CTRT_UPRC_ASC', filter: '', page: 0, total: 0, list: [], facets: [], facet: '' };
  function load() { try { return JSON.parse(localStorage.getItem('gwj_state_v2')); } catch { return null; } }
  const save = debounce(() => { try { localStorage.setItem('gwj_state_v2', JSON.stringify(state)); } catch {} }, 300);

  // 양식 파일은 용량이 커서 IndexedDB에 보관
  const idb = {
    open() { return new Promise((ok, no) => { const r = indexedDB.open('gwj', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); },
    async get(k) { const d = await this.open(); return new Promise((ok) => { const r = d.transaction('f').objectStore('f').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }); },
    async set(k, v) { const d = await this.open(); return new Promise((ok, no) => { const t = d.transaction('f', 'readwrite'); t.objectStore('f').put(v, k); t.oncomplete = ok; t.onerror = () => no(t.error); }); },
  };

  // ───────────── 나라장터 검색 (서버 경유) ─────────────
  async function api(keyword, page = 1, sort = 'CTRT_UPRC_ASC') {
    const r = await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keyword, page, sort }) });
    const j = await r.json().catch(() => ({ error: '응답 해석 실패' }));
    if (!r.ok || j.error) throw new Error(j.error || ('검색 실패 ' + r.status));
    return j;
  }
  async function searchAllPages(keyword, maxPages = 5) {
    let out = [], total = 0, facets = [];
    for (let p = 1; p <= maxPages; p++) {
      const j = await api(keyword, p);
      total = j.total; if (p === 1) facets = j.facets;
      out.push(...j.list);
      if (j.list.length < 100 || out.length >= total) break;
    }
    const seen = new Set();
    return { list: out.filter((x) => (seen.has(x.no) ? false : seen.add(x.no))).sort((a, b) => a.price - b.price), total, facets };
  }
  const imgUrl = (src) => (src ? '/api/img?src=' + encodeURIComponent(src) : '');

  // ───────────── 검색어·필터 ─────────────
  const KO = [[/cable\s*tray/i, '케이블트레이'], [/joiner/i, '조이너'], [/ladder/i, '래더'], [/u[\s-]*channel/i, '유찬넬'], [/bracket/i, '브라켓'], [/shank\s*bolt/i, '생크볼트'],
    [/bonding|jumper/i, '본딩점퍼'], [/tunnel/i, '터널등'], [/street\s*light/i, '가로등'], [/panel\s*board|분전반/i, '분전반'], [/ups/i, 'UPS'], [/generator/i, '발전기'], [/cable(?!\s*tray)/i, '케이블']];
  function guessQuery(it) {
    const name = String(it.name || '').trim(), spec = String(it.spec || '');
    const ko = KO.filter(([re]) => re.test(name)).map(([, k]) => k);
    const dims = /(\d+(?:\.\d+)?)\s*W?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*H?/i.exec(spec);
    const dim = dims ? `${dims[1]}×${dims[2]}` : '';
    let base = ko.length ? (/joiner/i.test(name) ? '조이너' : ko[0]) : name;
    if (!dim && spec) { const w = /(\d+(?:\.\d+)?)\s*(W|kW|kVA|A|SQ|mm|M)\b/i.exec(spec); if (w) base += ' ' + w[0].replace(/\s+/g, ''); }
    const isTray = /tray|트레이/i.test(name) && !/joiner|조이너/i.test(name);
    return { kw: [base, dim].filter(Boolean).join(' '), filter: [dim, /joiner|조이너/i.test(name) ? '조이너' : isTray ? '스트레이트' : ''].filter(Boolean).join(', ') };
  }
  const nx = (s) => String(s).toLowerCase().replace(/\s+/g, '').replace(/(\d)[x*](\d)/g, '$1×$2');
  const passes = (r, filter) => { const t = String(filter || '').split(',').map(nx).filter(Boolean); return t.every((k) => nx(r.nm + ' ' + r.co + ' ' + r.cls).includes(k)); };
  const coKey = (s) => String(s).replace(/주식회사|\(주\)|㈜|\(유\)|유한회사|\s/g, '');

  // ───────────── 렌더 ─────────────
  const PF = [['name', '공사명'], ['type', '주요공종'], ['materials', '관급자재품목'], ['period', '공사기간'], ['location', '공사위치'], ['round', '차수 (예: 4차)'], ['group', '조사표 제목의 자재명 (예: 케이블트레이)']];
  function renderProject() {
    $('#project').innerHTML = PF.map(([k, l]) => `<label>${l}<input data-p="${k}" value="${esc(state.project[k] || '')}"></label>`).join('');
  }
  function renderItems() {
    const F = ['name', 'spec', 'unit', 'qtyTotal', 'qtyNow', 'designPrice', 'kw', 'filter'];
    $('#items').innerHTML = state.items.map((it, i) => `<tr data-i="${i}"><td>${i + 1}</td>${F.map((k) => `<td><input data-f="${k}" class="f-${k}" value="${esc(it[k] ?? '')}"></td>`).join('')}
      <td><button class="ghost sm" data-a="one" data-i="${i}">검색</button> <button class="ghost sm" data-a="del" data-i="${i}">삭제</button></td></tr>`).join('')
      || `<tr><td colspan="10" class="muted">[+ 품목 추가]로 직접 입력하거나, ③ 나라장터 검색 결과에서 [담기]를 누르면 품목이 생깁니다.</td></tr>`;
    document.querySelector('[data-a=add]').disabled = state.items.length >= MAX_ITEMS;
    renderTargets();
  }
  function renderTargets() {
    // 담을 품목 선택상자
    $('#freeTarget').innerHTML = (state.items.length < MAX_ITEMS || state.items.some(blankItem) ? '<option value="new">+ 새 품목으로 추가</option>' : '') +
      state.items.map((it, i) => blankItem(it) ? '' : `<option value="${i}">${i + 1}번 품목 (${esc(it.name)} ${esc(it.spec || '')})에 추가</option>`).join('');
    if (free.target == null) { // 새로고침 후: 업체가 3곳 미만인 마지막 품목을 이어서
      let li = -1; state.items.forEach((it, i) => { if (!blankItem(it)) li = i; });
      free.target = li >= 0 && Object.keys(state.items[li].slots || {}).length < 3 ? String(li) : 'new';
    }
    if (free.target != null && $('#freeTarget').querySelector(`option[value="${free.target}"]`)) $('#freeTarget').value = free.target;
    const ci = state.items[+free.target];
    $('#curTarget').innerHTML = free.target !== 'new' && ci
      ? `지금 등록 중: <b>${+free.target + 1}번 품목 (${esc(ci.name)} ${esc(ci.spec || '')})</b> · 업체 <b>${Object.keys(ci.slots || {}).length}곳</b> — 주소를 넣을 때마다 이 품목의 다음 업체로 들어갑니다.`
      : '다음에 등록하는 상품으로 <b>새 품목</b>을 만듭니다.';
  }
  function renderPicks() {
    $('#picks').innerHTML = state.items.map((it, i) => {
      const all = it.results || [];
      const list = it.showAll ? all : all.filter((r) => passes(r, it.filter) || (it.slots || {})[r.no]);
      const chosen = slotList(it).map((r, j) => r ? `<span class="chip">${j + 1}번 ${esc(short(r.co))} ${r.price.toLocaleString()}원</span>` : (j < 3 ? `<span class="chip warn">${j + 1}번 비어있음</span>` : '')).join('');
      return `<details class="it" data-i="${i}" ${it._open ? 'open' : ''}><summary><b>${i + 1}. ${esc(it.name || '(이름 없음)')} ${esc(it.spec || '')}</b>
        <span class="muted">${it.results ? `후보 ${all.length}건 · 필터 통과 ${all.filter((r) => passes(r, it.filter)).length}건` : '검색 전'}</span>${chosen}</summary>
        <div class="inner"><div class="row"><label><input type="checkbox" data-a="showAll" data-i="${i}" ${it.showAll ? 'checked' : ''}> 필터 무시하고 전체 보기</label><span class="grow"></span>
        <button class="ghost sm" data-a="one" data-i="${i}">이 품목 다시 검색</button><button class="ghost sm" data-a="clearSlots" data-i="${i}">선택 지우기</button></div>
        <div class="tblwrap tall"><table class="pick"><thead><tr><th>번호</th><th>사진</th><th>업체(제조사)</th><th>물품식별번호</th><th>품목명·규격</th><th>단가</th><th>단위</th><th>본사</th><th>인증</th></tr></thead><tbody>
        ${list.slice(0, 300).map((r) => rowHtml(r, `<select data-slot="${r.no}" data-i="${i}"><option value="">-</option>${Array.from({ length: MAX_SLOTS }, (_, k) => `<option ${(it.slots || {})[r.no] == k + 1 ? 'selected' : ''}>${k + 1}</option>`).join('')}</select>`, (it.slots || {})[r.no])).join('')
          || '<tr><td colspan="9" class="muted">결과 없음 — 검색어나 필터를 바꾸거나, ③ 나라장터 검색에서 직접 담으세요.</td></tr>'}
        </tbody></table></div></div></details>`;
    }).join('') || '<p class="muted">품목이 없습니다.</p>';
  }
  function rowHtml(r, first, on) {
    return `<tr class="${on ? 'on' : ''}"><td>${first}</td><td>${r.img ? `<img loading="lazy" src="${imgUrl(r.img)}" alt="">` : ''}</td><td>${esc(r.co)}</td><td>${r.no}</td>
      <td class="nm">${esc(r.nm)}<br><span class="muted">${esc(r.cls || '')}</span></td><td class="num">${r.price.toLocaleString()}</td><td>${esc(r.unit)}</td><td>${esc(r.loc)}</td>
      <td class="cert">${r.certs.map((c) => `<span>${esc(c)}</span>`).join('')}</td></tr>`;
  }
  function renderFree() {
    const list = free.list.filter((r) => (!free.facet || r.cls === free.facet) && passes(r, free.filter));
    $('#freeInfo').textContent = free.kw ? `"${free.kw}" 전체 ${free.total.toLocaleString()}건 중 ${free.list.length}건 불러옴 · 표시 ${list.length}건` : '';
    const cls = {}; for (const r of free.list) if (r.cls) cls[r.cls] = (cls[r.cls] || 0) + 1;
    $('#facets').innerHTML = Object.keys(cls).length > 1 ? `<span class="muted">세부품명:</span><button class="${free.facet ? '' : 'on'}" data-facet="">전체</button>` +
      Object.entries(cls).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<button class="${free.facet === k ? 'on' : ''}" data-facet="${esc(k)}">${esc(k)} (${n})</button>`).join('') : '';
    const tgt = $('#freeTarget').value;
    const it = tgt !== 'new' && state.items[+tgt];
    $('#freeRes').innerHTML = list.map((r) => {
      const s = it && (it.slots || {})[r.no];
      return rowHtml(r, s ? `<button class="sm" data-a="unput" data-no="${r.no}">${s}번 ✓</button>` : `<button class="ghost sm" data-a="put" data-no="${r.no}">담기</button>`, s);
    }).join('') || (free.kw ? '<tr><td colspan="9" class="muted">결과 없음 — 검색어를 짧게 하거나 규격을 "300×60"처럼 × 로 써 보세요.</td></tr>' : '');
    $('#freeMore').hidden = !(free.kw && free.list.length < free.total);
  }
  function renderAll() { renderProject(); renderItems(); renderPicks(); renderFree(); }

  function slotList(it) {
    const out = [];
    for (const r of it.results || []) { const s = (it.slots || {})[r.no]; if (s) out[s - 1] = r; }
    for (let j = 0; j < 3; j++) if (!out[j]) out[j] = null;
    return out;
  }

  // ───────────── 동작 ─────────────
  async function searchItems(idx) {
    try {
      for (const i of idx) {
        const it = state.items[i]; if (!it || !it.name) continue;
        if (!it.kw) Object.assign(it, guessQuery(it));
        busy(`${i + 1}번 품목 검색 중… "${it.kw}"`);
        const keep = (it.results || []).filter((r) => (it.slots || {})[r.no]);
        const { list } = await searchAllPages(it.kw);
        const have = new Set(list.map((r) => r.no));
        it.results = [...list, ...keep.filter((r) => !have.has(r.no))].sort((a, b) => a.price - b.price);
        it._open = idx.length === 1;
      }
      busy(''); save(); renderPicks();
      if (idx.length > 1) toast('검색 완료. [공통업체 3곳 자동선택]을 누르거나 ④에서 직접 고르세요.');
    } catch (e) { busy(''); toast('검색 실패: ' + e.message, 9000); }
  }
  async function freeSearch(more) {
    const kw = $('#freeKw').value.trim(); if (!kw) return;
    try {
      busy('나라장터 검색 중…');
      if (!more) { Object.assign(free, { kw, sort: $('#freeSort').value, page: 0, list: [], facet: '' }); }
      const j = await api(free.kw, free.page + 1, free.sort);
      free.page = j.page; free.total = j.total;
      const have = new Set(free.list.map((r) => r.no));
      free.list.push(...j.list.filter((r) => !have.has(r.no)));
      busy(''); renderFree();
    } catch (e) { busy(''); toast('검색 실패: ' + e.message, 9000); }
  }
  function putFree(no, quiet, obj) {
    const r = obj || free.list.find((x) => x.no === no); if (!r) return;
    let tgt = $('#freeTarget').value;
    if (tgt === 'new') {
      const nu = { name: r.cls || free.kw, spec: '', unit: r.unit, qtyTotal: '', qtyNow: '', qtyRound: '', designPrice: '', kw: free.kw, filter: free.filter, results: [], slots: {} };
      const bi = state.items.findIndex(blankItem);
      if (bi >= 0) state.items[bi] = nu;
      else if (state.items.length >= MAX_ITEMS) return toast(`품목은 ${MAX_ITEMS}개까지입니다.`);
      else state.items.push(nu);
      tgt = String(bi >= 0 ? bi : state.items.length - 1); free.target = tgt;
      if (!quiet) toast(`${+tgt + 1}번 품목을 새로 만들었습니다. ②에서 규격·수량을 채워 주세요.`);
    }
    const it = state.items[+tgt]; it.results = it.results || []; it.slots = it.slots || {};
    if (!it.results.some((x) => x.no === r.no)) it.results.push(r);
    const used = new Set(Object.values(it.slots));
    let s = 1; while (used.has(s) && s <= MAX_SLOTS) s++;
    if (s > MAX_SLOTS) return toast('업체 칸(1~7번)이 모두 찼습니다.');
    it.slots[r.no] = s; it.results.sort((a, b) => a.price - b.price);
    save(); renderItems(); renderPicks(); renderFree();
  }
  async function pasteRegister() {
    const text = $('#pasteBox').value.trim();
    if (!text) return toast('상품 주소를 붙여넣어 주세요.');
    try {
      busy('나라장터에서 상품 정보를 가져오는 중…');
      const r = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      const j = await r.json(); busy('');
      if (!r.ok || j.error) throw new Error(j.error || '실패');
      const ok = [], bad = [];
      for (const x of j.results) {
        if (!x.item) { bad.push(x.error); continue; }
        const it = x.item;
        putFree(it.no, true, it); // 검색 결과 목록에는 섞지 않음
        ok.push(`${short(it.co)} ${it.no} ${it.price.toLocaleString()}원` + (x.partial ? ' (본사·인증 확인 필요)' : ''));
      }
      if (ok.length) $('#pasteBox').value = '';
      const ti = +free.target, tgt = state.items[ti];
      const cnt = tgt ? Object.keys(tgt.slots || {}).length : 0;
      toast((ok.length ? `✔ ${ok.length}건 등록 → ${tgt ? (ti + 1) + '번 품목(' + tgt.name + ') · 지금 업체 ' + cnt + '곳' : ''}\n• ${ok.join('\n• ')}\n\n같은 품목의 다른 업체 주소를 계속 넣으세요. 다음 자재로 넘어갈 때는 [✚ 다음 품목 시작]을 누르세요.` : '') +
        (bad.length ? `${ok.length ? '\n\n' : ''}✖ ${bad.length}건 실패\n• ${bad.join('\n• ')}` : ''), 12000);
      renderFree();
    } catch (e) { busy(''); toast('주소 등록 실패: ' + e.message, 9000); }
  }
  function autoPick() {
    const items = state.items.filter((it) => (it.results || []).length);
    if (!items.length) return toast('먼저 검색을 해 주세요.');
    const per = items.map((it) => { const m = new Map(); for (const r of it.results.filter((x) => passes(x, it.filter))) { const k = coKey(r.co); if (!m.has(k) || m.get(k).price > r.price) m.set(k, r); } return m; });
    const all = new Map();
    per.forEach((m) => { const ps = [...m.values()].map((r) => r.price); const minP = Math.min(...ps); for (const [k, r] of m) { const a = all.get(k) || { k, n: 0, score: 0, name: r.co }; a.n++; a.score += r.price / minP; all.set(k, a); } });
    const ranked = [...all.values()].sort((a, b) => b.n - a.n || a.score / a.n - b.score / b.n).slice(0, 3);
    items.forEach((it, i) => { it.slots = {}; ranked.forEach((c, j) => { const r = per[i].get(c.k); if (r) it.slots[r.no] = j + 1; }); });
    save(); renderPicks(); renderFree();
    const miss = ranked.filter((c) => c.n < items.length);
    toast(`공통업체: ${ranked.map((c, j) => `${j + 1}번 ${short(c.name)}`).join(', ')}` + (miss.length ? `\n※ ${miss.map((c) => short(c.name)).join(', ')}: 일부 품목에 제품이 없습니다. ④에서 확인하세요.` : ''), 8000);
  }

  async function build() {
    const items = state.items.filter((it) => it.name);
    if (!items.length) return toast('품목을 입력해 주세요.');
    const summary = items.map((it, i) => `${i + 1}. ${it.name} ${it.spec || ''} — 업체 ${slotList(it).filter(Boolean).map((r) => short(r.co)).join(', ') || '없음'}`).join('\n');
    if (!confirm(`아래 품목으로 출력합니다. 맞습니까?\n\n${summary}\n\n(다른 품목이 섞여 있으면 [취소] 후 ②에서 삭제하거나 [새로 작성]을 누르세요)`)) return;
    const empty = items.findIndex((it) => !slotList(it).some(Boolean));
    if (empty >= 0) return toast(`${empty + 1}번 품목에 선택한 업체가 없습니다.`);
    const checkedAt = nowStr();
    try {
      const data = { project: state.project, items: [] };
      let n = 0;
      for (const it of items) {
        const slots = slotList(it), companies = [];
        for (let j = 0; j < Math.max(slots.length, 3); j++) {
          const r = slots[j]; if (!r) { companies.push(null); continue; }
          busy(`외형도 이미지 만드는 중… (${++n})`);
          let img = null; try { img = await loadImg(r.img); } catch {}
          const image = await CARD.cardBytes({ name: r.nm, no: r.no, co: r.co, loc: r.loc, price: r.price, unit: r.unit, certs: r.certs, term: r.term, ctrtEnd: r.ctrtEnd, contractType: r.type, checkedAt }, img);
          companies.push({ co: r.co, loc: r.loc, no: r.no, price: r.price, unit: r.unit, certs: r.certs, image });
        }
        while (companies.length && !companies[companies.length - 1]) companies.pop();
        data.items.push({ name: it.name, spec: it.spec, unit: it.unit, qtyTotal: it.qtyTotal, qtyRound: it.qtyRound ?? it.qtyNow, qtyNow: it.qtyNow, designPrice: it.designPrice, companies });
      }
      busy('원본 양식에 채우는 중…');
      const res = await E.fillWorkbook(JSZip, await getTemplate(), data);
      const fname = `관급자재 구매요청서_${(state.project.group || '자재').replace(/[\\/:*?"<>|]/g, '')}_${checkedAt.slice(0, 10).replace(/\./g, '')}.xlsx`;
      download(res.bytes, fname); busy('');
      toast(res.warnings.length ? `✔ ${fname} 저장됨\n확인할 점 ${res.warnings.length}건:\n• ${res.warnings.join('\n• ')}` : `✔ ${fname} 저장됨 (다운로드 폴더). 엑셀로 열면 금액이 자동 계산됩니다.`, res.warnings.length ? 16000 : 7000);
    } catch (e) { busy(''); console.error(e); toast('엑셀 출력 실패: ' + e.message, 10000); }
  }
  async function loadImg(src) {
    if (!src) return null;
    const r = await fetch(imgUrl(src)); if (!r.ok) return null;
    return await createImageBitmap(await r.blob());
  }
  function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ───────────── 이벤트 ─────────────
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.p) { state.project[t.dataset.p] = t.value; save(); }
    if (t.dataset.f) { const i = +t.closest('tr').dataset.i; state.items[i][t.dataset.f] = t.value; if (t.dataset.f === 'qtyNow') state.items[i].qtyRound = t.value; save(); }
  });
  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'freeTarget') { free.target = t.value; renderFree(); }
    if (t.id === 'freeFilter') { free.filter = t.value; renderFree(); }
    if (t.dataset.f && ['name', 'spec', 'filter'].includes(t.dataset.f)) { renderPicks(); renderTargets(); } // 표는 다시 그리지 않음(입력 중 포커스 유지)
    if (t.dataset.a === 'showAll') { const it = state.items[+t.dataset.i]; it.showAll = t.checked; it._open = true; save(); renderPicks(); }
    if (t.dataset.slot) {
      const it = state.items[+t.dataset.i]; it.slots = it.slots || {}; const v = +t.value || 0;
      if (v) for (const k of Object.keys(it.slots)) if (it.slots[k] === v) delete it.slots[k];
      if (v) it.slots[t.dataset.slot] = v; else delete it.slots[t.dataset.slot];
      it._open = true; save(); renderPicks(); renderFree();
    }
  });
  document.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-facet]'); if (f) { free.facet = f.dataset.facet; renderFree(); return; }
    const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'INPUT') return;
    const a = b.dataset.a, i = +b.dataset.i;
    if (a === 'build') build();
    if (a === 'add') { state.items.push({ name: '', spec: '', unit: '', qtyTotal: '', qtyNow: '', qtyRound: '', designPrice: '', kw: '', filter: '', results: null, slots: {} }); save(); renderItems(); renderPicks(); }
    if (a === 'del' && confirm(`${i + 1}번 품목을 삭제할까요?`)) { state.items.splice(i, 1); save(); renderAll(); }
    if (a === 'one') { const it = state.items[i]; if (!it.kw) Object.assign(it, guessQuery(it)); renderItems(); await searchItems([i]); document.querySelector(`details.it[data-i="${i}"]`)?.scrollIntoView({ behavior: 'smooth' }); }
    if (a === 'searchAll') { state.items.forEach((it) => { if (!it.kw) Object.assign(it, guessQuery(it)); }); renderItems(); await searchItems(state.items.map((_, k) => k)); }
    if (a === 'auto') autoPick();
    if (a === 'reset') resetAll();
    if (a === 'clearSlots') { state.items[i].slots = {}; save(); renderPicks(); renderFree(); }
    if (a === 'put') putFree(b.dataset.no);
    if (a === 'unput') { const it = state.items[+$('#freeTarget').value]; if (it) { delete it.slots[b.dataset.no]; save(); renderPicks(); renderFree(); } }
  });
  document.addEventListener('toggle', (e) => { const d = e.target; if (d.matches && d.matches('details.it')) state.items[+d.dataset.i]._open = d.open; }, true);
  $('#freeForm').addEventListener('submit', (e) => { e.preventDefault(); free.filter = $('#freeFilter').value; freeSearch(false); });
  $('#freeMore').addEventListener('click', () => freeSearch(true));
  $('#pasteBtn').addEventListener('click', pasteRegister);
  $('#nextItem').addEventListener('click', () => { free.target = 'new'; renderTargets(); renderFree(); toast('다음 품목을 시작합니다. 상품 주소를 넣거나 [담기]를 누르면 새 품목이 만들어집니다.'); });

  // ───────────── 기타 ─────────────
  function busy(msg) { const b = $('#busy'); b.hidden = !msg; b.querySelector('span').textContent = msg; }
  let tt; function toast(msg, ms = 4500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), ms); }
  $('#toast').addEventListener('click', () => ($('#toast').hidden = true));
  function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function short(s) { return String(s).replace(/주식회사\s*|\(주\)\s*|㈜\s*/g, ''); }
  function nowStr() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; }
  function blankItem(it) { return !String(it.name || '').trim() && !Object.keys(it.slots || {}).length; }
  function newItem() { return { name: '', spec: '', unit: '', qtyTotal: '', qtyNow: '', qtyRound: '', designPrice: '', kw: '', filter: '', results: null, slots: {} }; }
  function resetAll() {
    if (!confirm('공사개요와 품목·선택한 업체를 모두 지우고 새로 작성할까요?')) return;
    state = { project: {}, items: [newItem()] }; free.target = 'new'; save(); renderAll();
    toast('새로 작성합니다. ③에서 자재를 검색해 [담기]를 누르세요.');
  }
  function debounce(f, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; }

  (async function init() {
    renderAll();
    if (!state.items.length) { state.items.push({ name: '', spec: '', unit: '', qtyTotal: '', qtyNow: '', qtyRound: '', designPrice: '', kw: '', filter: '', results: null, slots: {} }); renderAll(); }
    getTemplate().catch(() => {});
  })();
  window.GWJ = { state: () => state, free, guessQuery, autoPick };
})();
