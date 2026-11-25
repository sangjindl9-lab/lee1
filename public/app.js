/* 이음 홍보센터 화면 */
(() => {
  const root = document.getElementById('root');
  let META = null;
  let BADGE = 0;

  // ---------- 도우미 ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', 'ic'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = (META && META.icons[name]) || '';
    return svg;
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && url !== '/api/login') { renderLogin(); throw new Error('로그인이 필요합니다'); }
    if (!r.ok) throw new Error(j.error || `요청 실패 (${r.status})`);
    return j;
  }
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
  }
  async function busy(btn, fn) {
    const old = btn.textContent; btn.disabled = true;
    try { return await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; if (!btn.isConnected) return; if (btn.textContent !== old && !btn.querySelector('svg')) btn.textContent = old; }
  }
  async function copyText(text, msg = '복사했습니다') {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    toast(msg);
  }
  async function copyRich(html, text) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } catch {
      const box = h('div', { html, contenteditable: 'true', style: 'position:fixed;left:-9999px;top:0' });
      document.body.append(box);
      const range = document.createRange(); range.selectNodeContents(box);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('copy'); sel.removeAllRanges(); box.remove();
    }
    toast('서식과 함께 복사했습니다. 글쓰기 화면에 붙여 넣으세요');
  }
  const fmtDate = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const STATUS = { draft: '초안', scheduled: '예약', ready: '올릴 차례', published: '발행', failed: '실패' };
  const stamp = (s) => h('span', { class: `stamp ${s}` }, STATUS[s] || s);
  const kindLabel = (k) => (META.kinds.find((x) => x.key === k) || {}).label || k;
  const field = (label, input, hint) => h(input.tagName === 'DIV' ? 'div' : 'label', { class: 'f' }, h('span', {}, label), input, hint && h('small', {}, hint));
  const query = () => new URLSearchParams((location.hash.split('?')[1]) || '');

  // ---------- 로그인 ----------
  function renderLogin() {
    const err = h('div', { class: 'err' });
    const id = h('input', { type: 'text', autocomplete: 'username', value: 'admin' });
    const pw = h('input', { type: 'password', autocomplete: 'current-password' });
    const form = h('form', { onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { await api('POST', '/api/login', { id: id.value.trim(), pw: pw.value }); await boot(); } catch (ex) { err.textContent = ex.message; }
    } },
      h('div', { class: 'brand', style: 'padding:0;margin:0' }, h('i', {}, '홍'), '이음 홍보센터'),
      h('h1', {}, '로그인'), h('p', {}, '앱 홍보 글을 만들고 올리는 작업대'),
      field('아이디', id), field('비밀번호', pw), err,
      h('button', { class: 'btn primary', type: 'submit' }, '들어가기'));
    root.replaceChildren(h('div', { class: 'login' }, form));
    pw.focus();
  }

  // ---------- 뼈대 ----------
  const NAV = [
    { path: '/', label: '오늘', icon: 'calendar-check' },
    { path: '/compose', label: '글 만들기', icon: 'pen-line' },
    { path: '/posts', label: '글 보관함', icon: 'archive' },
    { path: '/apps', label: '앱', icon: 'smartphone' },
    { sep: '자동화' },
    { path: '/autopilot', label: '자동 규칙', icon: 'repeat' },
    { path: '/channels', label: '채널 연결', icon: 'plug' },
    { sep: '점검' },
    { path: '/checklist', label: '홍보 체크리스트', icon: 'list-checks' },
    { path: '/stats', label: '클릭 통계', icon: 'chart-column' },
    { path: '/settings', label: '설정', icon: 'settings' },
  ];
  const TABS = [NAV[0], NAV[1], NAV[2], NAV[3], { path: '/more', label: '더보기', icon: 'menu' }];
  function shell(path, content) {
    const top = `/${path.split('/')[1] || ''}`;
    const link = (n, cls) => h('a', { href: `#${n.path}`, class: (top === n.path ? 'on' : '') + (cls ? ` ${cls}` : '') }, icon(n.icon), h('span', {}, n.label),
      n.path === '/' && BADGE ? h('span', { class: 'count' }, BADGE) : null);
    const side = h('aside', { class: 'side' },
      h('div', { class: 'brand' }, h('i', {}, '홍'), '이음 홍보센터'),
      h('nav', { class: 'nav' }, NAV.map((n) => (n.sep ? h('div', { class: 'label' }, n.sep) : link(n)))),
      h('div', { class: 'foot nav' }, h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('POST', '/api/logout'); renderLogin(); } }, icon('log-out'), '로그아웃')));
    const moreOn = !TABS.slice(0, 4).some((t) => t.path === top);
    const tabbar = h('nav', { class: 'tabbar' }, TABS.map((n) => h('a', { href: `#${n.path}`, class: (n.path === '/more' ? moreOn : top === n.path) ? 'on' : '' }, icon(n.icon), n.label, n.path === '/' && BADGE ? h('span', { class: 'count' }, BADGE) : null)));
    root.replaceChildren(h('div', { class: 'shell' }, side, h('main', { class: 'main fade' }, content)), tabbar);
    window.scrollTo(0, 0);
  }
  const head = (title, sub, action) => h('div', { class: 'head' }, h('div', {}, h('h1', {}, title), sub && h('p', {}, sub)), action);

  function postItem(p) {
    const when = p.status === 'scheduled' ? fmtDate(p.scheduled_at) : p.status === 'published' ? fmtDate(p.published_at) : fmtDate(p.created_at);
    return h('a', { class: 'item', href: `#/posts/${p.id}` }, stamp(p.status),
      h('div', { style: 'min-width:0' }, h('div', { class: 'ttl' }, p.title || p.body_text.split('\n')[0] || '(내용 없음)'),
        h('div', { class: 'sub' }, `${p.app_name} · ${p.target_label} · ${kindLabel(p.kind)}${p.error ? ` · ${p.error}` : ''}`)),
      h('div', { class: 'end num' }, when));
  }

  // 막대 차트 — 오늘만 주홍, 글을 올린 날에는 점
  function chart(series) {
    const narrow = window.innerWidth < 860;
    const W = narrow ? 340 : 720, H = narrow ? 200 : 240, L = 28, B = 24, T = 16;
    const max = Math.max(4, ...series.map((s) => s.clicks));
    const top = Math.ceil(max / 4) * 4;
    const bw = (W - L) / series.length;
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', narrow ? 'chart narrow' : 'chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `최근 ${series.length}일 링크 클릭 수`);
    let out = '';
    for (let i = 0; i <= 4; i++) { const v = (top / 4) * i; out += `<line class="grid" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`; }
    const step = Math.ceil(series.length / (narrow ? 5 : 7));
    series.forEach((s, i) => {
      const x = L + i * bw + bw * 0.2, w = Math.max(2, bw * 0.6);
      const hgt = Math.max(s.clicks ? 2 : 0, y(0) - y(s.clicks));
      out += `<rect class="bar${i === series.length - 1 ? ' today' : ''}" x="${x}" y="${y(0) - hgt}" width="${w}" height="${hgt}" rx="2"><title>${s.day} 클릭 ${s.clicks}회, 발행 ${s.posts}건</title></rect>`;
      if (s.posts) out += `<circle class="dot" cx="${x + w / 2}" cy="${y(0) - hgt - 7}" r="2.5"/>`;
      if ((i % step === 0 && i < series.length - step / 2) || i === series.length - 1) out += `<text x="${x + w / 2}" y="${H - B + 14}" text-anchor="middle">${Number(s.day.slice(5, 7))}/${Number(s.day.slice(8))}</text>`;
    });
    svg.innerHTML = out;
    return h('div', {}, svg, h('div', { class: 'legend' }, h('span', {}, h('i', {}), '클릭'), h('span', {}, h('i', { class: 'a' }), '오늘'), h('span', {}, h('i', { class: 'p' }), '글을 올린 날')));
  }
  function rank(rows, emptyMsg) {
    if (!rows.length) return h('p', { class: 'sub', style: 'color:var(--t3);font-size:14px' }, emptyMsg);
    const max = Math.max(...rows.map((r) => r.c));
    return h('div', { class: 'rank' }, rows.map((r) => h('div', {}, h('b', {}, r.name), h('span', {}, r.c), h('u', {}, h('s', { style: `width:${(r.c / max) * 100}%` })))));
  }

  // ---------- 오늘 ----------
  async function pageToday() {
    const [d, s] = await Promise.all([api('GET', '/api/dashboard'), api('GET', '/api/stats?days=14')]);
    BADGE = d.ready.length;
    const now = new Date();
    if (!d.apps) {
      return shell('/', [head(`${now.getMonth() + 1}월 ${now.getDate()}일`, '먼저 홍보할 앱을 등록합니다'),
        h('div', { class: 'card empty' }, h('p', {}, '앱 이름과 기능 몇 줄만 넣으면 소개글, SNS 글, 스토어 문구가 만들어집니다'), h('a', { class: 'btn primary', href: '#/apps/new' }, icon('plus'), '첫 앱 등록'))]);
    }
    const diff = d.publishedWeek - d.publishedPrevWeek;
    const cdiff = s.total - s.prev;
    const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
    shell('/', [
      head(`${now.getMonth() + 1}월 ${now.getDate()}일`, d.ready.length ? `직접 올릴 글 ${d.ready.length}건이 기다리고 있습니다` : '직접 올릴 글은 없습니다', h('a', { class: 'btn primary', href: '#/compose' }, icon('pen-line'), '글 만들기')),
      h('div', { class: 'stats' },
        h('div', { class: 'stat key' }, h('div', { class: 'k' }, '올릴 차례'), h('div', { class: 'v' }, d.ready.length), h('div', { class: 'd' }, '복사해서 붙여 넣을 글')),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '최근 7일 발행'), h('div', { class: 'v' }, d.publishedWeek), h('div', { class: 'd' }, `지난 7일보다 ${sign(diff)}건`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '최근 14일 클릭'), h('div', { class: 'v' }, s.total), h('div', { class: 'd' }, `앞선 14일보다 ${sign(cdiff)}회`)),
        h('div', { class: 'stat' }, h('div', { class: 'k' }, '예약된 글'), h('div', { class: 'v' }, d.scheduled.length), h('div', { class: 'd' }, `초안 ${d.drafts}건 보관 중`))),
      d.failed.length ? h('div', { class: 'sect' }, h('h2', {}, '발행에 실패한 글'), h('div', { class: 'list' }, d.failed.map(postItem))) : null,
      d.ready.length ? h('div', { class: 'sect', style: 'margin-top:16px' }, h('h2', {}, '올릴 차례'), h('div', { class: 'list' }, d.ready.map(postItem))) : null,
      h('div', { class: 'cols', style: 'margin-top:16px' },
        h('div', { class: 'card' }, h('h2', {}, '링크 클릭'), h('p', { class: 'sub' }, '글에 넣은 설치 링크가 눌린 횟수'), chart(s.series)),
        h('div', { class: 'card' }, h('h2', {}, '어디서 왔나'), rank(s.bySource, '아직 클릭이 없습니다'))),
      h('div', { class: 'sect' }, h('h2', {}, '예약'), d.scheduled.length ? h('div', { class: 'list' }, d.scheduled.map(postItem)) : h('div', { class: 'list' }, h('div', { class: 'empty' }, '예약된 글이 없습니다'))),
      d.recent.length ? h('div', { class: 'sect' }, h('h2', {}, '최근 발행'), h('div', { class: 'list' }, d.recent.map(postItem))) : null,
    ]);
  }

  // ---------- 앱 ----------
  async function pageApps() {
    const apps = await api('GET', '/api/apps');
    shell('/apps', [
      head('앱', `등록한 앱 ${apps.length}개`, h('a', { class: 'btn primary', href: '#/apps/new' }, icon('plus'), '앱 등록')),
      apps.length ? h('div', { class: 'list' }, apps.map((a) => h('a', { class: 'item app', href: `#/apps/${a.id}` },
        a.icon_url ? h('img', { class: 'appic', src: a.icon_url, alt: '' }) : h('div', { class: 'appic' }, [...a.name][0]),
        h('div', { style: 'min-width:0' }, h('div', { class: 'ttl' }, a.name), h('div', { class: 'sub' }, a.tagline || '한 줄 설명 없음')),
        h('div', { class: 'end num' }, `발행 ${a.published} · 30일 클릭 ${a.clicks30}`))))
        : h('div', { class: 'card empty' }, '등록한 앱이 없습니다'),
    ]);
  }
  async function pageAppEdit(id) {
    const isNew = id === 'new';
    const a = isNew ? { features: [], features_en: [], keywords: [], screenshots: [], price: '무료', is_public: 1 } : (await api('GET', '/api/apps')).find((x) => String(x.id) === id);
    if (!a) return go('/apps');
    const f = {};
    const inp = (k, ph) => (f[k] = h('input', { type: 'text', value: a[k] || '', placeholder: ph || '' }));
    const area = (k, v, ph) => (f[k] = h('textarea', { value: v || '', placeholder: ph || '' }));
    const imp = h('input', { type: 'text', placeholder: 'kr.eumsoft.app 또는 구글 플레이 주소', value: a.package || '' });
    const pub = h('input', { type: 'checkbox', checked: a.is_public !== 0 });
    const form = h('div', {},
      h('div', { class: 'card' }, h('h2', {}, '구글 플레이에서 가져오기'), h('p', { class: 'sub' }, '이미 공개된 앱이면 이름, 설명, 아이콘을 불러옵니다'),
        h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:200px' }, imp), h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => {
          const r = await api('POST', '/api/apps/import', { package: imp.value });
          for (const k of ['name', 'name_en', 'tagline', 'tagline_en', 'description', 'description_en', 'package', 'store_url', 'icon_url']) if (r[k] && f[k]) f[k].value = r[k];
          if (r.screenshots && r.screenshots.length) f.screenshots.value = r.screenshots.join('\n');
          toast('불러왔습니다. 기능 목록은 직접 채워 주세요');
        }) }, '가져오기'))),
      h('div', { class: 'card' }, h('h2', {}, '기본 정보'),
        h('div', { class: 'grid2' }, field('앱 이름', inp('name')), field('영문 이름', inp('name_en'), '해외용 글에 씁니다')),
        field('한 줄 설명', inp('tagline', '무엇을 해 주는 앱인지 한 문장'), '모든 글의 제목과 첫 줄에 들어갑니다'),
        field('영문 한 줄 설명', inp('tagline_en')),
        h('div', { class: 'grid2' }, field('분류', inp('category', '업무 도구, 교육, 게임…')), field('가격', inp('price'))),
        h('div', { class: 'grid2' }, field('패키지 이름', inp('package', 'kr.eumsoft.app')), field('스토어 주소', inp('store_url'), '비워 두면 패키지 이름으로 만듭니다'))),
      h('div', { class: 'card' }, h('h2', {}, '글 재료'), h('p', { class: 'sub' }, '여기 적은 내용만으로 글을 만듭니다. 자세할수록 글이 좋아집니다'),
        field('주요 기능 (한 줄에 하나)', area('features', (a.features || []).join('\n'), '기능 이름: 설명\n치수 재기: 화면에서 두 점을 찍어 길이를 잽니다'), '"이름: 설명" 꼴로 적으면 기능마다 글 한 편이 나옵니다'),
        field('영문 주요 기능', area('features_en', (a.features_en || []).join('\n'))),
        field('앱 설명', area('description', a.description)),
        field('영문 앱 설명', area('description_en', a.description_en)),
        field('누가 쓰나', inp('audience', '현장에서 도면을 확인해야 하는 기술자')),
        field('검색어 (쉼표로 구분)', (f.keywords = h('input', { type: 'text', value: (a.keywords || []).join(', ') })), '해시태그와 스토어 문구에 씁니다')),
      h('div', { class: 'card' }, h('h2', {}, '이미지와 소개 페이지'),
        field('아이콘 주소', inp('icon_url', 'https://')),
        field('스크린샷 주소 (한 줄에 하나)', area('screenshots', (a.screenshots || []).join('\n'))),
        h('label', { class: 'pick', style: 'margin-bottom:16px' }, pub, h('div', {}, h('b', {}, '소개 페이지 공개'), h('small', {}, '검색엔진에 잡히는 앱 소개 페이지와 다른 앱 목록에 올립니다'))),
        !isNew && h('div', {},
          h('div', { class: 'kv' }, h('div', {}, h('b', {}, '소개 페이지'), h('span', { class: 'code' }, `${META.baseUrl}/a/${a.slug}`)), h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => copyText(`${META.baseUrl}/a/${a.slug}`) }, '복사'), h('a', { class: 'btn sm', href: `/a/${a.slug}`, target: '_blank' }, '열기'))),
          h('div', { class: 'kv' }, h('div', {}, h('b', {}, '다른 앱 목록 (앱 안에서 불러 쓰는 주소)'), h('span', { class: 'code' }, `${META.baseUrl}/api/public/apps.json?exclude=${a.package}`)), h('button', { class: 'btn sm', onclick: () => copyText(`${META.baseUrl}/api/public/apps.json?exclude=${a.package}`) }, '복사')))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: (e) => busy(e.target, async () => {
          const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
          body.is_public = pub.checked;
          const saved = isNew ? await api('POST', '/api/apps', body) : await api('PUT', `/api/apps/${a.id}`, body);
          toast('저장했습니다'); go(isNew ? `/compose?app=${saved.id}` : '/apps');
        }) }, isNew ? '등록하고 글 만들기' : '저장'),
        !isNew && h('a', { class: 'btn', href: `#/compose?app=${a.id}` }, '이 앱으로 글 만들기'),
        !isNew && h('button', { class: 'btn quiet danger', onclick: async () => { if (confirm(`${a.name}과 이 앱의 글을 모두 지울까요`)) { await api('DELETE', `/api/apps/${a.id}`); go('/apps'); } } }, '삭제')));
    shell('/apps', [h('a', { class: 'back', href: '#/apps' }, icon('chevron-left'), '앱'), head(isNew ? '앱 등록' : a.name), form]);
  }

  // ---------- 글 만들기 ----------
  function targetsFor(group, channels) {
    if (group === 'etc') return [];
    const fmt = group === 'blog' ? 'blog' : 'short';
    const auto = channels.filter((c) => c.format === fmt && c.enabled).map((c) => ({ key: `ch:${c.id}`, label: c.name, sub: c.connected ? `${c.label} · 자동 발행` : `${c.label} · 연결 정보를 마저 넣어야 합니다`, auto: true }));
    const manual = Object.entries(META.manualTargets).filter(([k, m]) => m.format === fmt && !['community', 'youtube', 'etc'].includes(k)).map(([k, m]) => ({ key: k, label: m.label, sub: '복사해서 직접 붙여 넣기' }));
    return [...manual, ...auto];
  }
  const ETC_TARGET = { community: 'community', shorts_script: 'youtube', press: 'etc', store_listing: 'etc', review_reply: 'etc' };
  async function pageCompose() {
    const [apps, channels] = await Promise.all([api('GET', '/api/apps'), api('GET', '/api/channels')]);
    if (!apps.length) return go('/apps/new');
    const q = query();
    const st = { app: q.get('app') || String(apps[0].id), kind: q.get('kind') || 'blog_intro', lang: 'ko', targets: new Set(), note: '' };
    const groupOf = (k) => META.kinds.find((x) => x.key === k).group;
    const appSel = h('select', { onchange: (e) => { st.app = e.target.value; } }, apps.map((a) => h('option', { value: a.id, selected: String(a.id) === st.app }, a.name)));
    const langSel = h('select', { onchange: (e) => { st.lang = e.target.value; drawNote(); } }, META.langs.map((l) => h('option', { value: l.key }, l.label)));
    const note = h('textarea', { placeholder: '꼭 넣을 내용이 있으면 적습니다 (업데이트 소식이면 바뀐 점을 한 줄에 하나씩)', oninput: (e) => { st.note = e.target.value; } });
    const tgtBox = h('div', {});
    const noteBox = h('div', {});
    const aiBox = h('div', {});
    function drawTargets() {
      const group = groupOf(st.kind);
      const list = targetsFor(group, channels);
      st.targets = new Set(list.length ? [list[0].key] : [ETC_TARGET[st.kind] || 'etc']);
      tgtBox.replaceChildren(list.length
        ? h('div', { class: 'picks two' }, list.map((t, i) => h('label', { class: 'pick' }, h('input', { type: 'checkbox', checked: i === 0, onchange: (e) => { e.target.checked ? st.targets.add(t.key) : st.targets.delete(t.key); } }), h('div', {}, h('b', {}, t.label), h('small', {}, t.sub)))))
        : h('p', { class: 'note' }, '이 글은 복사해서 쓰는 용도라 올릴 곳을 고르지 않습니다'));
    }
    function drawNote() {
      const native = (META.langs.find((l) => l.key === st.lang) || {}).native;
      noteBox.replaceChildren(!native && !META.aiReady ? h('p', { class: 'note warn', style: 'margin-bottom:16px' }, '이 언어는 내장 문구가 없습니다. 아래 "AI 요청문 복사"로 구독 중인 AI에게 맡기거나, 설정에서 AI 키를 연결하세요') : '');
    }
    const kindBox = h('div', {}, ['blog', 'sns', 'etc'].map((g) => [h('div', { class: 'grp' }, { blog: '블로그 글', sns: 'SNS 글', etc: '그 밖의 문구' }[g]),
      h('div', { class: 'picks two' }, META.kinds.filter((k) => k.group === g).map((k) => h('label', { class: 'pick' }, h('input', { type: 'radio', name: 'kind', checked: k.key === st.kind, onchange: () => { st.kind = k.key; drawTargets(); } }), h('div', {}, h('b', {}, k.label), h('small', {}, k.desc)))))]));
    const body = () => ({ app_id: Number(st.app), kind: st.kind, lang: st.lang, targets: [...st.targets], note: st.note });
    const after = (posts) => { toast(`글 ${posts.length}편을 만들었습니다`); go(posts.length === 1 ? `/posts/${posts[0].id}` : '/posts?tab=draft'); };
    function openAi() {
      const first = [...st.targets][0];
      if (!first) return toast('올릴 곳을 하나 고르세요');
      const out = h('textarea', { readonly: true, style: 'min-height:160px;font-size:13px' });
      const paste = h('textarea', { placeholder: 'AI가 써 준 답을 통째로 붙여 넣습니다', style: 'min-height:160px' });
      api('POST', '/api/prompt', { ...body(), target: first }).then((r) => { out.value = r.prompt; }).catch((e) => toast(e.message));
      aiBox.replaceChildren(h('div', { class: 'card', style: 'margin-top:16px' }, h('h2', {}, '구독 중인 AI에게 맡기기'), h('p', { class: 'sub' }, 'Claude, ChatGPT, Gemini 어디든 됩니다. 요금이 따로 들지 않습니다'),
        field('1. 이 요청문을 복사해 AI 채팅에 붙여 넣습니다', out),
        h('button', { class: 'btn sm', style: 'margin-bottom:16px', onclick: () => copyText(out.value, '요청문을 복사했습니다') }, icon('copy'), '요청문 복사'),
        field('2. AI의 답을 여기에 붙여 넣습니다', paste),
        h('button', { class: 'btn dark', onclick: (e) => busy(e.target, async () => after([await api('POST', '/api/posts/from-ai', { ...body(), target: first, raw: paste.value })])) }, '글로 저장')));
      aiBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    drawTargets(); drawNote();
    shell('/compose', [
      head('글 만들기', '앱 정보를 바탕으로 개발자 시점의 글을 만듭니다'),
      h('div', { class: 'card' }, h('div', { class: 'grid2' }, field('앱', appSel), field('언어', langSel))),
      h('div', { class: 'card' }, h('h2', {}, '무슨 글'), kindBox),
      h('div', { class: 'card' }, h('h2', {}, '어디에'), h('p', { class: 'sub' }, '여러 곳을 고르면 곳마다 다른 글을 만듭니다. 같은 글을 여러 블로그에 올리면 검색에서 밀립니다'), tgtBox),
      h('div', { class: 'card' }, h('h2', {}, '메모'), noteBox, note),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onclick: (e) => busy(e.target, async () => after(await api('POST', '/api/generate', body()))) }, icon('pen-line'), META.aiReady ? 'AI로 글 만들기' : '글 만들기'),
        META.aiReady && h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => after(await api('POST', '/api/generate', { ...body(), engine: 'template' }))) }, '내장 문구로 만들기'),
        h('button', { class: 'btn', onclick: openAi }, 'AI 요청문 복사')),
      aiBox,
    ]);
  }

  // ---------- 글 보관함 ----------
  async function pagePosts() {
    const tab = query().get('tab') || 'ready';
    const all = await api('GET', '/api/posts');
    const count = (s) => all.filter((p) => p.status === s).length;
    const rows = all.filter((p) => p.status === tab);
    shell('/posts', [
      head('글 보관함', null, h('a', { class: 'btn primary', href: '#/compose' }, icon('pen-line'), '글 만들기')),
      h('div', { class: 'tabs' }, Object.entries(STATUS).sort((a, b) => ['ready', 'draft', 'scheduled', 'published', 'failed'].indexOf(a[0]) - ['ready', 'draft', 'scheduled', 'published', 'failed'].indexOf(b[0]))
        .map(([k, v]) => h('a', { href: `#/posts?tab=${k}`, class: k === tab ? 'on' : '' }, v, h('span', {}, count(k))))),
      rows.length ? h('div', { class: 'list' }, rows.map(postItem)) : h('div', { class: 'list' }, h('div', { class: 'empty' }, { ready: '직접 올릴 글이 없습니다', draft: '초안이 없습니다', scheduled: '예약된 글이 없습니다', published: '아직 발행한 글이 없습니다', failed: '실패한 글이 없습니다' }[tab])),
    ]);
  }
  async function pagePost(id) {
    const p = await api('GET', `/api/posts/${id}`);
    const isBlog = p.target_format === 'blog' && /^blog_/.test(p.kind);
    const title = h('textarea', { class: 'title-in', rows: '1', value: p.title, placeholder: '제목', 'aria-label': '제목', oninput: () => fitTitle() });
    const fitTitle = () => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; };
    requestAnimationFrame(fitTitle);
    const paper = isBlog ? h('div', { class: 'paper', contenteditable: 'true', html: p.body_html, role: 'textbox', 'aria-label': '본문', 'aria-multiline': 'true' })
      : h('textarea', { class: 'paper', value: p.body_text, 'aria-label': '본문', oninput: () => drawCount() });
    const tags = h('input', { type: 'text', value: p.tags.join(', ') });
    const counter = h('span', { class: 'num' });
    const drawCount = () => { counter.textContent = isBlog ? '' : `${[...paper.value].length}자`; };
    drawCount();
    const save = () => api('PUT', `/api/posts/${p.id}`, isBlog ? { title: title.value, body_html: paper.innerHTML, tags: tags.value } : { title: title.value, body_text: paper.value, tags: tags.value });
    const reload = () => pagePost(id);
    const tagText = () => tags.value.split(',').map((t) => t.trim()).filter(Boolean).map((t) => `#${t}`).join(' ');
    const when = h('input', { type: 'datetime-local', style: 'width:auto', value: p.scheduled_at ? new Date(new Date(p.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' });
    const doneUrl = h('input', { type: 'url', placeholder: '올린 글 주소 (선택)', style: 'flex:1;min-width:180px' });
    const live = p.status === 'published';
    const actions = [];
    if (p.manual) {
      actions.push(
        (p.title || isBlog) && h('button', { class: 'btn', onclick: () => copyText(title.value, '제목을 복사했습니다') }, icon('copy'), '제목 복사'),
        h('button', { class: 'btn primary', onclick: () => (isBlog ? copyRich(paper.innerHTML, paper.innerText) : copyText(paper.value, '본문을 복사했습니다')) }, icon('copy'), '본문 복사'),
        isBlog && h('button', { class: 'btn', onclick: () => copyText(tagText(), '태그를 복사했습니다') }, icon('copy'), '태그 복사'),
        p.write_url && h('a', { class: 'btn', href: p.write_url, target: '_blank', rel: 'noopener' }, icon('external-link'), `${p.target_label} 열기`));
    } else if (!live) {
      actions.push(h('button', { class: 'btn primary', onclick: (e) => busy(e.target, async () => { await save(); await api('POST', `/api/posts/${p.id}/publish`); toast('발행했습니다'); reload(); }) }, icon('send'), '지금 발행'));
    }
    actions.push(h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { await save(); toast('저장했습니다'); }) }, '저장'));
    if (!live) actions.push(h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { await api('POST', `/api/posts/${p.id}/regenerate`, {}); toast('다른 문장으로 다시 만들었습니다'); reload(); }) }, icon('refresh-cw'), '다시 만들기'));
    actions.push(h('button', { class: 'btn quiet danger', onclick: async () => { if (confirm('이 글을 지울까요')) { await api('DELETE', `/api/posts/${p.id}`); go('/posts'); } } }, icon('trash-2'), '삭제'));

    shell('/posts', [
      h('a', { class: 'back', href: `#/posts?tab=${p.status}` }, icon('chevron-left'), '글 보관함'),
      h('div', { class: 'meta' }, stamp(p.status), h('span', {}, `${p.app_name} · ${p.target_label} · ${kindLabel(p.kind)}`), counter,
        p.remote_url && h('a', { href: p.remote_url, target: '_blank', rel: 'noopener' }, '올라간 글 보기')),
      p.error && h('p', { class: 'note warn', style: 'margin-bottom:16px;max-width:720px' }, `발행 실패: ${p.error}`),
      (isBlog || p.title) && title, paper,
      h('div', { style: 'max-width:720px;margin-top:16px' }, field('태그 (쉼표로 구분)', tags)),
      h('div', { class: 'actions', style: 'position:static;background:none;margin:0 0 24px;padding:0' }, actions),
      !live && h('div', { class: 'card', style: 'max-width:720px' }, p.manual
        ? [h('h2', {}, '올린 뒤'), h('p', { class: 'sub' }, '붙여 넣어 올렸으면 표시해 둡니다. 날짜를 정해 두면 그날 "올릴 차례"에 나옵니다'),
          h('div', { class: 'row' }, doneUrl, h('button', { class: 'btn dark', onclick: (e) => busy(e.target, async () => { await save(); await api('POST', `/api/posts/${p.id}/done`, { url: doneUrl.value }); toast('올린 글로 표시했습니다'); go('/'); }) }, icon('check'), '올렸음')),
          h('div', { class: 'row', style: 'margin-top:12px' }, when, h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { if (!when.value) throw new Error('날짜를 고르세요'); await save(); await api('POST', `/api/posts/${p.id}/schedule`, { at: new Date(when.value).toISOString() }); toast('그날 올릴 차례에 나옵니다'); reload(); }) }, icon('clock'), '올릴 날 정하기'))]
        : [h('h2', {}, '예약 발행'), h('p', { class: 'sub' }, '정한 시각에 서버가 알아서 올립니다'),
          h('div', { class: 'row' }, when, h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { if (!when.value) throw new Error('시각을 고르세요'); await save(); await api('POST', `/api/posts/${p.id}/schedule`, { at: new Date(when.value).toISOString() }); toast('예약했습니다'); reload(); }) }, icon('clock'), '예약'),
            p.status === 'scheduled' && h('button', { class: 'btn quiet', onclick: async () => { await api('POST', `/api/posts/${p.id}/unschedule`); reload(); } }, '예약 취소'))]),
    ]);
  }

  // ---------- 자동 규칙 ----------
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  async function pageAutopilot() {
    const [rules, apps, channels] = await Promise.all([api('GET', '/api/autopilot'), api('GET', '/api/apps'), api('GET', '/api/channels')]);
    const st = { kinds: new Set(['blog_feature', 'blog_problem', 'blog_howto']), days: new Set([1, 3, 5]), apps: new Set() };
    const tgtSel = h('select', { onchange: () => drawKinds() }, [
      ...Object.entries(META.manualTargets).filter(([k]) => ['naver', 'tistory', 'instagram', 'threads', 'facebook'].includes(k)).map(([k, m]) => h('option', { value: k, 'data-fmt': m.format }, `${m.label} — 글을 만들어 두기만 함`)),
      ...channels.map((c) => h('option', { value: `ch:${c.id}`, 'data-fmt': c.format }, `${c.name} — 자동 발행`))]);
    const langSel = h('select', {}, META.langs.filter((l) => l.native || META.aiReady).map((l) => h('option', { value: l.key }, l.label)));
    const time = h('input', { type: 'time', value: '09:10', style: 'width:auto' });
    const kindBox = h('div', { class: 'chips' });
    function drawKinds() {
      const fmt = tgtSel.selectedOptions[0].dataset.fmt;
      const list = META.kinds.filter((k) => (fmt === 'blog' ? k.group === 'blog' && k.key !== 'blog_update' : k.group === 'sns'));
      st.kinds = new Set(list.slice(0, fmt === 'blog' ? 3 : 1).map((k) => k.key));
      kindBox.replaceChildren(...list.map((k) => h('label', {}, h('input', { type: 'checkbox', checked: st.kinds.has(k.key), onchange: (e) => (e.target.checked ? st.kinds.add(k.key) : st.kinds.delete(k.key)) }), k.label)));
    }
    drawKinds();
    const dayBox = h('div', { class: 'chips' }, DAYS.map((d, i) => h('label', {}, h('input', { type: 'checkbox', checked: st.days.has(i), onchange: (e) => (e.target.checked ? st.days.add(i) : st.days.delete(i)) }), d)));
    const appBox = h('div', { class: 'chips' }, apps.map((a) => h('label', {}, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? st.apps.add(a.id) : st.apps.delete(a.id)) }), a.name)));
    shell('/autopilot', [
      head('자동 규칙', '정한 요일과 시각에 앱을 돌아가며 글을 만들고, 자동 채널이면 바로 올립니다'),
      rules.length ? h('div', { class: 'list' }, rules.map((r) => h('div', { class: 'item', style: 'grid-template-columns:1fr auto' },
        h('div', { style: 'min-width:0' }, h('div', { class: 'ttl' }, `${r.target_label} · ${r.days.map((d) => DAYS[d]).join(' ')} ${r.time}`),
          h('div', { class: 'sub' }, `${r.app_ids.length ? `앱 ${r.app_ids.length}개` : '모든 앱'} · ${r.kinds.map(kindLabel).join(', ')} · ${r.manual ? '만들어서 올릴 차례에 넣음' : '자동 발행'} · 지금까지 ${r.cursor}회`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: (e) => busy(e.target, async () => { const p = await api('POST', `/api/autopilot/${r.id}/run`); toast(p.status === 'published' ? '만들어서 발행했습니다' : '글을 만들어 올릴 차례에 넣었습니다'); go(`/posts/${p.id}`); }) }, '지금 실행'),
          h('button', { class: 'btn sm quiet danger', 'aria-label': '규칙 삭제', onclick: async () => { if (confirm('이 규칙을 지울까요')) { await api('DELETE', `/api/autopilot/${r.id}`); pageAutopilot(); } } }, icon('trash-2'))))))
        : h('div', { class: 'list' }, h('div', { class: 'empty' }, '아직 규칙이 없습니다. 아래에서 하나 만들어 두면 매주 알아서 글이 준비됩니다')),
      h('div', { class: 'card sect' }, h('h2', {}, '규칙 추가'),
        apps.length ? null : h('p', { class: 'note warn', style: 'margin-bottom:16px' }, '먼저 앱을 등록해 주세요'),
        h('div', { class: 'grid2' }, field('어디에', tgtSel), field('언어', langSel)),
        field('글 종류 (돌아가며 씁니다)', kindBox),
        field('요일', dayBox), field('시각', time),
        field('앱 (고르지 않으면 모든 앱을 돌아가며)', appBox),
        h('p', { class: 'note', style: 'margin-bottom:16px' }, '규칙 하나는 하루에 글 한 편만 만듭니다. 같은 곳에 하루 여러 편을 올리면 광고성 계정으로 분류되기 쉬워서 막아 두었습니다'),
        h('button', { class: 'btn primary', onclick: (e) => busy(e.target, async () => {
          await api('POST', '/api/autopilot', { target: tgtSel.value, lang: langSel.value, kinds: [...st.kinds], days: [...st.days], time: time.value, app_ids: [...st.apps] });
          toast('규칙을 만들었습니다'); pageAutopilot();
        }) }, '규칙 만들기')),
    ]);
  }

  // ---------- 채널 ----------
  async function pageChannels() {
    const channels = await api('GET', '/api/channels');
    const typeSel = h('select', { onchange: () => drawForm() }, Object.entries(META.channelTypes).map(([k, t]) => h('option', { value: k }, `${t.label} — ${t.format === 'blog' ? '블로그 글' : '짧은 글'}`)));
    const formBox = h('div', {});
    let inputs = {};
    function drawForm() {
      const t = META.channelTypes[typeSel.value];
      inputs = { name: h('input', { type: 'text', value: t.label }) };
      formBox.replaceChildren(h('p', { class: 'note', style: 'margin-bottom:16px' }, t.help), field('표시 이름', inputs.name),
        ...t.fields.map((f) => field(f.label, (inputs[f.key] = h('input', { type: f.secret ? 'password' : 'text', placeholder: f.placeholder || '', autocomplete: 'off' })))));
    }
    drawForm();
    async function chRow(c) {
      const extra = h('div', {});
      if (c.type === 'blogger') {
        if (!c.connected) extra.append(h('a', { class: 'btn sm dark', href: `/api/oauth/google/start?channel=${c.id}` }, '구글 계정 연결'));
        else if (!c.config.blogId) {
          try {
            const blogs = await api('GET', `/api/channels/${c.id}/blogs`);
            const sel = h('select', { style: 'width:auto' }, blogs.map((b) => h('option', { value: b.id }, b.name)));
            extra.append(h('div', { class: 'row' }, sel, h('button', { class: 'btn sm', onclick: async () => { await api('PUT', `/api/channels/${c.id}`, { name: c.name, config: { blogId: sel.value, blogName: sel.selectedOptions[0].textContent } }); pageChannels(); } }, '이 블로그에 올리기')));
            if (!blogs.length) extra.replaceChildren(h('span', { class: 'sub' }, '이 구글 계정에 블로거 블로그가 없습니다. blogger.com에서 먼저 만드세요'));
          } catch (e) { extra.append(h('span', { class: 'sub' }, e.message)); }
        }
      }
      return h('div', { class: 'item', style: 'grid-template-columns:1fr auto' },
        h('div', { style: 'min-width:0' }, h('div', { class: 'ttl' }, c.name), h('div', { class: 'sub' }, `${c.label} · ${c.connected ? (c.config.blogName || '연결 정보 입력됨') : '연결 정보가 모자랍니다'}`), extra),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', onclick: (e) => busy(e.target, async () => { const r = await api('POST', `/api/channels/${c.id}/test`); toast(r.message); }) }, '연결 확인'),
          h('button', { class: 'btn sm quiet danger', 'aria-label': '채널 삭제', onclick: async () => { if (confirm(`${c.name} 연결을 지울까요`)) { await api('DELETE', `/api/channels/${c.id}`); pageChannels(); } } }, icon('trash-2'))));
    }
    const rows = await Promise.all(channels.map(chRow));
    shell('/channels', [
      head('채널 연결', '공식 글쓰기 기능이 있는 곳만 자동으로 올립니다'),
      h('div', { class: 'sect', style: 'margin-top:0' }, h('h2', {}, '자동 발행'), rows.length ? h('div', { class: 'list' }, rows) : h('div', { class: 'list' }, h('div', { class: 'empty' }, '연결한 채널이 없습니다'))),
      h('div', { class: 'card sect' }, h('h2', {}, '채널 추가'), field('종류', typeSel), formBox,
        h('button', { class: 'btn primary', onclick: (e) => busy(e.target, async () => {
          const config = Object.fromEntries(Object.entries(inputs).filter(([k]) => k !== 'name').map(([k, el]) => [k, el.value.trim()]));
          await api('POST', '/api/channels', { type: typeSel.value, name: inputs.name.value, config });
          toast('추가했습니다. 연결 확인을 눌러 보세요'); pageChannels();
        }) }, '추가')),
      h('div', { class: 'card' }, h('h2', {}, '직접 붙여 넣는 곳'), h('p', { class: 'sub' }, '네이버 블로그, 티스토리, 인스타그램, 스레드, 페이스북은 연결 없이 바로 쓸 수 있습니다'),
        h('p', { class: 'note' }, '이 서비스들은 외부 프로그램의 글쓰기를 막아 두었습니다. 로그인을 흉내 내는 방식은 계정이 정지될 수 있어 넣지 않았습니다. 대신 글을 미리 만들어 두고 복사 한 번, 붙여 넣기 한 번으로 끝나게 했습니다')),
    ]);
  }

  // ---------- 체크리스트 ----------
  async function pageChecklist() {
    const apps = await api('GET', '/api/apps');
    if (!apps.length) return shell('/checklist', [head('홍보 체크리스트'), h('div', { class: 'card empty' }, h('p', {}, '앱을 등록하면 앱마다 할 일을 챙길 수 있습니다'), h('a', { class: 'btn primary', href: '#/apps/new' }, '앱 등록'))]);
    const appId = query().get('app') || String(apps[0].id);
    const state = await api('GET', `/api/checklist/${appId}`);
    const total = META.checklist.reduce((n, g) => n + g.items.length, 0);
    const done = () => Object.values(state).filter((s) => s.done).length;
    const prog = h('s', { style: `width:${(done() / total) * 100}%` });
    const progText = h('span', { class: 'num' }, `${done()}/${total}`);
    shell('/checklist', [
      head('홍보 체크리스트', '돈 들이지 않고 혼자 할 수 있는 것부터 순서대로'),
      h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between' },
        h('select', { style: 'width:auto;min-width:200px', onchange: (e) => go(`/checklist?app=${e.target.value}`) }, apps.map((a) => h('option', { value: a.id, selected: String(a.id) === appId }, a.name))), progText),
        h('div', { class: 'progress' }, prog)),
      META.checklist.map((g) => h('div', { class: 'sect' }, h('h2', {}, g.group), g.note && h('p', { class: 'sub' }, g.note),
        h('div', { class: 'list' }, g.items.map((it) => {
          const row = h('div', { class: `chk${state[it.key]?.done ? ' done' : ''}` },
            h('input', { type: 'checkbox', checked: state[it.key]?.done, 'aria-label': it.title, onchange: async (e) => {
              state[it.key] = { done: e.target.checked }; row.classList.toggle('done', e.target.checked);
              prog.style.width = `${(done() / total) * 100}%`; progText.textContent = `${done()}/${total}`;
              await api('PUT', `/api/checklist/${appId}/${it.key}`, { done: e.target.checked }).catch((ex) => toast(ex.message));
            } }),
            h('div', {}, h('b', {}, it.title), h('small', {}, it.desc)),
            h('div', { class: 'row' }, it.kind && h('a', { class: 'btn sm', href: `#/compose?app=${appId}&kind=${it.kind}` }, '글 만들기'), it.url && h('a', { class: 'btn sm quiet', href: it.url, target: '_blank', rel: 'noopener', 'aria-label': `${it.title} 사이트 열기` }, icon('external-link'))));
          return row;
        })))),
    ]);
  }

  // ---------- 통계 ----------
  async function pageStats() {
    const days = Number(query().get('days')) || 30;
    const s = await api('GET', `/api/stats?days=${days}`);
    const diff = s.total - s.prev;
    shell('/stats', [
      head('클릭 통계', '글에 넣은 설치 링크가 눌린 횟수입니다. 실제 설치 수는 플레이 콘솔에서 확인하세요'),
      h('div', { class: 'tabs' }, [14, 30, 90].map((d) => h('a', { href: `#/stats?days=${d}`, class: d === days ? 'on' : '' }, `${d}일`))),
      h('div', { class: 'card' }, h('h2', {}, `최근 ${days}일 클릭 ${s.total}회`), h('p', { class: 'sub' }, `앞선 ${days}일보다 ${diff > 0 ? '+' : ''}${diff}회`), chart(s.series)),
      h('div', { class: 'grid2', style: 'gap:16px;margin-top:16px' },
        h('div', { class: 'card', style: 'margin:0' }, h('h2', {}, '앱별'), rank(s.byApp.map((r) => ({ name: r.name, c: r.c })), '아직 클릭이 없습니다')),
        h('div', { class: 'card', style: 'margin:0' }, h('h2', {}, '올린 곳별'), rank(s.bySource, '아직 클릭이 없습니다'))),
    ]);
  }

  // ---------- 설정 ----------
  async function pageSettings() {
    const s = await api('GET', '/api/settings');
    const brand = h('input', { type: 'text', value: s.site.brand });
    const base = h('input', { type: 'url', value: s.site.baseUrl, placeholder: s.effectiveBaseUrl });
    const prov = h('select', {}, [['anthropic', 'Claude (Anthropic)'], ['openai', 'ChatGPT (OpenAI)'], ['gemini', 'Gemini (Google)']].map(([k, l]) => h('option', { value: k, selected: s.ai.provider === k }, l)));
    const model = h('input', { type: 'text', value: s.ai.model, placeholder: '예: claude-haiku-5-5' });
    const key = h('input', { type: 'password', placeholder: s.ai.hasKey ? '저장된 키가 있습니다 (바꿀 때만 입력)' : 'API 키', autocomplete: 'off' });
    const gid = h('input', { type: 'text', value: s.google.clientId });
    const gsec = h('input', { type: 'password', placeholder: s.google.hasSecret ? '저장됨 (바꿀 때만 입력)' : '', autocomplete: 'off' });
    const cur = h('input', { type: 'password', autocomplete: 'current-password' });
    const next = h('input', { type: 'password', autocomplete: 'new-password' });
    shell('/settings', [
      head('설정'),
      h('div', { class: 'card' }, h('h2', {}, '사이트'),
        field('이름', brand, '앱 소개 페이지 맨 위에 나오는 이름'),
        field('기본 주소', base, '내 도메인을 연결했을 때만 넣습니다. 비워 두면 지금 주소를 씁니다'),
        h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { await api('PUT', '/api/settings', { site: { brand: brand.value, baseUrl: base.value } }); toast('저장했습니다'); META = await api('GET', '/api/meta'); }) }, '저장')),
      h('div', { class: 'card' }, h('h2', {}, 'AI 연결 (선택)'), h('p', { class: 'sub' }, '연결하지 않아도 한국어·영어 글은 내장 문구로 만들어집니다. 키를 넣으면 매번 다른 글과 다른 나라 말 글을 자동으로 씁니다'),
        h('p', { class: 'note', style: 'margin-bottom:16px' }, 'API 키는 채팅 구독과 별개로 쓴 만큼 요금이 나옵니다. 요금 없이 쓰려면 글 만들기의 "AI 요청문 복사"를 쓰세요'),
        h('div', { class: 'grid2' }, field('종류', prov), field('모델 이름', model, '각 회사 문서에 나온 모델 이름을 그대로 넣습니다')),
        field('API 키', key),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { await api('PUT', '/api/settings', { ai: { provider: prov.value, model: model.value, apiKey: key.value } }); toast('저장했습니다'); META = await api('GET', '/api/meta'); }) }, '저장'),
          h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { const r = await api('POST', '/api/ai-test'); toast(r.message); }) }, '연결 시험'),
          s.ai.hasKey && h('button', { class: 'btn quiet danger', onclick: async () => { await api('PUT', '/api/settings', { ai: { provider: prov.value, model: model.value, clearKey: true } }); META = await api('GET', '/api/meta'); pageSettings(); } }, '키 지우기'))),
      h('div', { class: 'card' }, h('h2', {}, '구글 연결 (블로거 자동 발행용)'), h('p', { class: 'sub' }, '구글 클라우드 콘솔에서 한 번만 만들면 됩니다'),
        h('p', { class: 'note', style: 'margin-bottom:16px' }, '1. console.cloud.google.com에서 프로젝트를 만들고 Blogger API를 켭니다', h('br'), '2. OAuth 동의 화면을 만들고 내 구글 계정을 테스트 사용자로 넣습니다', h('br'), '3. 사용자 인증 정보에서 "OAuth 클라이언트 ID"(웹 애플리케이션)를 만들고, 승인된 리디렉션 URI에 아래 주소를 넣습니다'),
        h('div', { class: 'kv', style: 'margin-bottom:16px' }, h('div', {}, h('b', {}, '리디렉션 URI'), h('span', { class: 'code' }, s.google.redirectUri)), h('button', { class: 'btn sm', onclick: () => copyText(s.google.redirectUri) }, '복사')),
        field('클라이언트 ID', gid), field('클라이언트 보안 비밀', gsec),
        h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { await api('PUT', '/api/settings', { google: { clientId: gid.value, clientSecret: gsec.value } }); toast('저장했습니다. 채널 연결에서 구글 블로거를 추가하세요'); }) }, '저장')),
      h('div', { class: 'card' }, h('h2', {}, '비밀번호 바꾸기'), h('p', { class: 'sub' }, `관리자 아이디 ${s.adminId}`),
        h('div', { class: 'grid2' }, field('현재 비밀번호', cur), field('새 비밀번호', next)),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => busy(e.target, async () => { await api('POST', '/api/password', { current: cur.value, next: next.value }); cur.value = next.value = ''; toast('바꿨습니다'); }) }, '바꾸기'),
          h('button', { class: 'btn quiet', onclick: async () => { await api('POST', '/api/logout'); renderLogin(); } }, icon('log-out'), '로그아웃'))),
    ]);
  }
  function pageMore() {
    shell('/more', [head('더보기'), h('div', { class: 'list' }, NAV.filter((n) => n.path && !TABS.some((t) => t.path === n.path)).map((n) =>
      h('a', { class: 'item', href: `#${n.path}`, style: 'grid-template-columns:24px 1fr 18px;min-height:56px' }, icon(n.icon), h('div', { class: 'ttl' }, n.label), icon('chevron-right'))))]);
  }

  // ---------- 길 찾기 ----------
  function go(path) { if (location.hash === `#${path}`) route(); else location.hash = `#${path}`; }
  async function route() {
    if (!META) return;
    const path = (location.hash.slice(1) || '/').split('?')[0];
    const seg = path.split('/').filter(Boolean);
    try {
      if (!seg.length) await pageToday();
      else if (seg[0] === 'apps') await (seg[1] ? pageAppEdit(seg[1]) : pageApps());
      else if (seg[0] === 'compose') await pageCompose();
      else if (seg[0] === 'posts') await (seg[1] ? pagePost(seg[1]) : pagePosts());
      else if (seg[0] === 'autopilot') await pageAutopilot();
      else if (seg[0] === 'channels') await pageChannels();
      else if (seg[0] === 'checklist') await pageChecklist();
      else if (seg[0] === 'stats') await pageStats();
      else if (seg[0] === 'settings') await pageSettings();
      else if (seg[0] === 'more') pageMore();
      else go('/');
    } catch (e) { if (META && root.querySelector('.shell')) toast(e.message); }
  }
  async function boot() {
    const me = await api('GET', '/api/me');
    if (!me.authed) return renderLogin();
    META = await api('GET', '/api/meta');
    try { BADGE = (await api('GET', '/api/dashboard')).ready.length; } catch {}
    route();
  }
  window.addEventListener('hashchange', route);
  boot();
})();
