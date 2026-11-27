/* 이음 앱 홍보·ASO 자동화 센터 — 프런트엔드 */
const state = {
  apps: [],
  overview: null,
  settings: {},
  env: {},
  channels: [],
  appDetails: new Map(),
  aso: null,
  drafts: [],
  currentDraft: null,
  studioChannel: 'naver_blog',
  studioKeywordIds: new Set(),
  scheduleChannels: new Set(),
  shorts: [],
  shortProviders: null,
  shortPoll: null,
  view: 'dashboard',
};

const VIEW_META = {
  dashboard: { title: '대시보드', subtitle: 'Google Play 실시간 순위와 홍보 초안을 한 곳에서' },
  apps: { title: '앱 · 키워드', subtitle: '앱을 등록하고 키워드별 한국 스토어 순위를 추적합니다' },
  aso: { title: '경쟁 분석 · ASO', subtitle: '상위 경쟁 앱과 비교해 빠진 키워드를 찾고 문구를 다듬습니다' },
  studio: { title: '콘텐츠 스튜디오', subtitle: '블로그·커뮤니티·쇼츠용 홍보 글을 자동으로 만듭니다' },
  shorts: { title: '쇼츠 스튜디오', subtitle: '대본·이미지·음악·영상까지 버튼 한 번으로 1080×1920 MP4를 만듭니다' },
  library: { title: '보관함', subtitle: '생성한 홍보 초안을 다시 열고 내려받습니다' },
  settings: { title: '설정', subtitle: '자동 점검 주기, 웹훅, AI 키를 관리합니다' },
};

/* ---------------- 공통 ---------------- */
function $(id) {
  return document.getElementById(id);
}

function esc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(message, isError = false) {
  const node = $('toast');
  node.textContent = message;
  node.classList.toggle('error', Boolean(isError));
  node.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => node.classList.add('hidden'), 4200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('로그인이 필요합니다.');
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `요청 실패 (${res.status})`);
  }
  return data;
}

function kst(iso) {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function kstDate(iso) {
  if (!iso) return '–';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).format(date);
}

function rankBadge(rank, status) {
  if (status === 'pending') return '<span class="rank-badge rank-none">미점검</span>';
  if (status === 'error') return '<span class="rank-badge rank-error">오류</span>';
  if (!rank) return '<span class="rank-badge rank-none">권 밖</span>';
  const cls = rank <= 10 ? 'rank-top' : rank <= 30 ? 'rank-mid' : 'rank-none';
  return `<span class="rank-badge ${cls}">${rank}위</span>`;
}

function deltaBadge(delta) {
  if (delta === null || delta === undefined) return '<span class="delta-flat">–</span>';
  if (delta > 0) return `<span class="delta-up">▲ ${delta}</span>`;
  if (delta < 0) return `<span class="delta-down">▼ ${Math.abs(delta)}</span>`;
  return '<span class="delta-flat">유지</span>';
}

function showToastError(err) {
  toast(err instanceof Error ? err.message : String(err), true);
}

function showLogin() {
  $('app-shell').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
}

function showApp() {
  $('login-screen').classList.add('hidden');
  $('app-shell').classList.remove('hidden');
}

function openModal(title, html) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = html;
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
  $('modal-body').innerHTML = '';
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} 복사했습니다.`);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast(`${label} 복사했습니다.`);
  }
}

/* ---------------- 라우팅 ---------------- */
function setView(view) {
  if (!VIEW_META[view]) view = 'dashboard';
  state.view = view;
  document.querySelectorAll('.view').forEach((section) => section.classList.add('hidden'));
  const target = $(`view-${view}`);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  $('view-title').textContent = VIEW_META[view].title;
  $('view-subtitle').textContent = VIEW_META[view].subtitle;
  if (view === 'dashboard') loadDashboard();
  if (view === 'apps') loadAppsView();
  if (view === 'aso') loadAsoView();
  if (view === 'studio') loadStudioView();
  if (view === 'shorts') loadShortsView();
  if (view === 'library') loadLibrary();
  if (view === 'settings') loadSettingsView();
}

function route() {
  const view = (location.hash || '#dashboard').replace('#', '');
  setView(view);
}

/* ---------------- 데이터 로드 ---------------- */
async function loadApps() {
  const data = await api('/api/apps');
  state.apps = data.apps || [];
  fillAppSelects();
}

function fillAppSelects() {
  const options = state.apps
    .map((app) => `<option value="${app.id}">${esc(app.label || app.snapshot?.title || app.package_id)}</option>`)
    .join('');
  const targets = ['aso-app', 'studio-app', 'library-app', 'shorts-app'];
  for (const id of targets) {
    const select = $(id);
    if (!select) continue;
    const keep = select.value;
    select.innerHTML = id === 'library-app' ? `<option value="">모든 앱</option>${options}` : options;
    if (keep && [...select.options].some((o) => o.value === keep)) select.value = keep;
  }
  const asoApp = $('aso-app');
  if (asoApp && asoApp.value) loadAsoKeywords(Number(asoApp.value));
  const studioApp = $('studio-app');
  if (studioApp && studioApp.value) loadStudioKeywords(Number(studioApp.value));
}

async function loadOverview() {
  state.overview = await api('/api/overview');
  return state.overview;
}

async function loadDetail(appId) {
  if (state.appDetails.has(appId)) {
    const cached = state.appDetails.get(appId);
    if (Date.now() - cached.fetchedAt < 20_000) return cached.data;
  }
  const data = await api(`/api/apps/${appId}`);
  state.appDetails.set(appId, { data, fetchedAt: Date.now() });
  return data;
}

/* ---------------- 대시보드 ---------------- */
async function loadDashboard() {
  try {
    const overview = await loadOverview();
    $('stat-apps').textContent = overview.counts.apps;
    $('stat-keywords').textContent = overview.counts.keywords;
    $('stat-drafts').textContent = overview.counts.drafts;
    const checked = overview.rankToday.ranked + overview.rankToday.outside + overview.rankToday.error;
    $('stat-checks').textContent = checked;
    $('stat-checks-hint').textContent = `순위권 ${overview.rankToday.ranked} · 권 밖 ${overview.rankToday.outside} · 오류 ${overview.rankToday.error}`;

    $('dashboard-apps').innerHTML =
      overview.apps.length === 0
        ? '<div class="empty">등록된 앱이 없습니다. ‘앱 · 키워드’에서 추가하세요.</div>'
        : overview.apps
            .map(
              (app) => `
        <div class="app-row">
          ${
            app.icon
              ? `<img class="app-icon" src="${esc(app.icon)}" alt="" loading="lazy" />`
              : `<div class="app-icon">${esc((app.name || '?').slice(0, 1))}</div>`
          }
          <div class="app-meta">
            <strong>${esc(app.name)}</strong>
            <span>${esc(app.packageId)} · ${esc(app.genre || '카테고리 미확인')} · 평점 ${app.score ? app.score.toFixed(1) : '–'} · 설치 ${esc(app.installs || '–')}</span>
          </div>
          ${
            app.bestRank
              ? `<span class="app-badge">최고 ${app.bestRank.rank}위</span>`
              : app.checkedKeywords
                ? `<span class="rank-badge rank-none">${app.checkedKeywords}개 키워드 권 밖</span>`
                : '<span class="muted small">순위 기록 없음</span>'
          }
        </div>`,
            )
            .join('');

    $('dashboard-jobs').innerHTML =
      overview.jobs.length === 0
        ? '<div class="empty">아직 실행 기록이 없습니다.</div>'
        : overview.jobs
            .map(
              (job) => `
        <div class="job-row">
          <span>${job.kind === 'rank_check' ? '순위 점검' : '초안 생성'} <span class="muted">· ${esc(job.message || job.status)}</span></span>
          <span class="muted">${kst(job.started_at)}</span>
        </div>`,
            )
            .join('');

    const rows = [];
    for (const app of overview.apps) {
      try {
        const detail = await loadDetail(app.id);
        for (const item of detail.keywords || []) {
          rows.push({
            app: app.name,
            term: item.keyword.term,
            rank: item.latest ? item.latest.rank : null,
            status: item.latest ? item.latest.status : 'pending',
            delta: item.delta,
            checkedAt: item.latest ? item.latest.captured_at : null,
            competitor: item.latest && item.latest.competitors_json ? JSON.parse(item.latest.competitors_json)[0] : null,
          });
        }
      } catch (err) {
        /* 앱 하나 실패해도 나머지는 표시 */
      }
    }
    $('dashboard-ranks').innerHTML =
      rows.length === 0
        ? '<div class="empty">키워드를 등록하고 순위를 점검해 보세요.</div>'
        : `<table>
            <thead><tr><th>앱</th><th>키워드</th><th>현재 순위</th><th>전일 대비</th><th>1위 경쟁 앱</th><th>점검 시각</th></tr></thead>
            <tbody>
              ${rows
                .map(
                  (row) => `<tr>
                    <td>${esc(row.app)}</td>
                    <td><strong>${esc(row.term)}</strong></td>
                    <td>${rankBadge(row.rank, row.status)}</td>
                    <td>${deltaBadge(row.delta)}</td>
                    <td class="muted">${row.competitor ? esc(row.competitor.title || row.competitor.packageId) : '–'}</td>
                    <td class="muted">${kst(row.checkedAt)}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
          </table>`;
  } catch (err) {
    showToastError(err);
  }
}

/* ---------------- 앱 · 키워드 ---------------- */
async function loadAppsView() {
  try {
    await loadApps();
    $('apps-container').innerHTML = state.apps.length
      ? state.apps.map((app) => renderAppCard(app)).join('')
      : '<div class="panel empty">등록된 앱이 없습니다. 위에서 패키지명을 넣어 추가하세요.</div>';
    for (const app of state.apps) {
      loadAppCardDetail(app.id);
    }
  } catch (err) {
    showToastError(err);
  }
}

function renderAppCard(app) {
  const snapshot = app.snapshot || {};
  return `
  <article class="app-card" id="app-card-${app.id}">
    <div class="app-card-head">
      ${snapshot.icon ? `<img class="app-icon" src="${esc(snapshot.icon)}" alt="" loading="lazy" />` : `<div class="app-icon">${esc((app.label || '?').slice(0, 1))}</div>`}
      <div class="app-meta">
        <h3>${esc(app.label || snapshot.title || app.package_id)}</h3>
        <span class="muted small">${esc(snapshot.title || app.package_id)} · <a href="${esc(app.store_url)}" target="_blank" rel="noopener">스토어 열기</a></span>
      </div>
      <div class="app-card-actions">
        <button class="btn ghost small" data-action="refresh-app" data-app="${app.id}">정보 새로고침</button>
        <button class="btn primary small" data-action="check-app" data-app="${app.id}">지금 순위 점검</button>
        <button class="btn danger small" data-action="delete-app" data-app="${app.id}">삭제</button>
      </div>
    </div>
    <div class="app-card-body">
      <div class="app-facts">
        <span>평점 <b>${snapshot.score ? snapshot.score.toFixed(2) : '–'}</b></span>
        <span>리뷰 <b>${snapshot.ratings ? Number(snapshot.ratings).toLocaleString('ko-KR') : '–'}</b></span>
        <span>설치 <b>${esc(snapshot.installs || '–')}</b></span>
        <span>카테고리 <b>${esc(snapshot.genre || '–')}</b></span>
        <span>최근 업데이트 <b>${snapshot.updated_ts ? kstDate(new Date(snapshot.updated_ts).toISOString()) : '–'}</b></span>
        <span>정보 수집 <b>${kst(snapshot.captured_at)}</b></span>
      </div>
      <div class="keyword-form">
        <input placeholder="추적할 키워드 (예: DWG 뷰어)" data-role="keyword-input" data-app="${app.id}" />
        <button class="btn ghost" data-action="add-keyword" data-app="${app.id}">키워드 추가</button>
      </div>
      <div class="table-wrap" id="app-keywords-${app.id}"><span class="muted small">키워드 불러오는 중…</span></div>
    </div>
  </article>`;
}

async function loadAppCardDetail(appId) {
  const box = $(`app-keywords-${appId}`);
  if (!box) return;
  try {
    const detail = await api(`/api/apps/${appId}`);
    state.appDetails.set(appId, { data: detail, fetchedAt: Date.now() });
    const keywords = detail.keywords || [];
    if (keywords.length === 0) {
      box.innerHTML = '<div class="empty">키워드가 없습니다. 위에서 추가하면 순위를 추적합니다.</div>';
      return;
    }
    box.innerHTML = `<table>
      <thead><tr><th>키워드</th><th>현재 순위</th><th>전일 대비</th><th>탐색</th><th>상위 경쟁 앱 (1~3위)</th><th>최근 점검</th><th></th></tr></thead>
      <tbody>
        ${keywords
          .map((item) => {
            const competitors = item.latest && item.latest.competitors_json ? JSON.parse(item.latest.competitors_json).slice(0, 3) : [];
            return `<tr>
              <td><strong>${esc(item.keyword.term)}</strong></td>
              <td>${rankBadge(item.latest ? item.latest.rank : null, item.latest ? item.latest.status : 'pending')}</td>
              <td>${deltaBadge(item.delta)}</td>
              <td class="muted">${item.latest && item.latest.scanned ? `${item.latest.scanned}개 확인` : '–'}</td>
              <td class="muted small">${competitors.map((c) => `${c.rank}. ${esc(c.title || c.packageId)}`).join('<br />') || '–'}</td>
              <td class="muted">${kst(item.latest ? item.latest.captured_at : null)}</td>
              <td class="row">
                <button class="btn ghost small" data-action="keyword-chart" data-keyword="${item.keyword.id}" data-term="${esc(item.keyword.term)}">추이</button>
                <button class="btn ghost small" data-action="delete-keyword" data-keyword="${item.keyword.id}">삭제</button>
              </td>
            </tr>`;
          })
          .join('')}
      </tbody>
    </table>`;
  } catch (err) {
    box.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
  }
}

async function checkAppRanks(appId) {
  toast('순위를 점검하는 중입니다…');
  try {
    const result = await api(`/api/apps/${appId}/check-ranks`, { method: 'POST', body: {} });
    const outcomes = result.outcomes || [];
    const errors = outcomes.reduce((sum, o) => sum + (o.errors || []).length, 0);
    toast(errors ? `점검 완료 (오류 ${errors}건)` : '순위 점검을 마쳤습니다.', errors > 0);
    await loadAppsView();
  } catch (err) {
    showToastError(err);
  }
}

/* ---------------- 차트 ---------------- */
function renderChart(points, term) {
  const valid = points.filter((p) => typeof p.rank === 'number');
  if (valid.length < 2) {
    return `<div class="chart-empty">차트를 그리려면 2일 이상의 순위 기록이 필요합니다. (현재 ${valid.length}일)</div>`;
  }
  const width = 720;
  const height = 150;
  const padX = 28;
  const padY = 18;
  const ranks = valid.map((p) => p.rank);
  const maxRank = Math.max(...ranks);
  const minRank = Math.min(...ranks);
  const span = Math.max(1, maxRank - minRank);
  const x = (i) => padX + (i * (width - padX * 2)) / Math.max(1, valid.length - 1);
  const y = (rank) => padY + ((rank - minRank) / span) * (height - padY * 2);
  const path = valid.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' ');
  const dots = valid
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.rank).toFixed(1)}" r="3" fill="#3b5bdb" />`)
    .join('');
  const labels = valid
    .map((p, i) =>
      i === 0 || i === valid.length - 1 || i === Math.floor(valid.length / 2)
        ? `<text x="${x(i).toFixed(1)}" y="${height - 2}" font-size="10" fill="#667085" text-anchor="middle">${p.captured_date.slice(5)}</text>`
        : '',
    )
    .join('');
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(term)} 순위 추이">
    <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}" stroke="#eef1f6" />
    <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="#eef1f6" />
    <text x="4" y="${padY + 4}" font-size="10" fill="#667085">${minRank}위</text>
    <text x="4" y="${height - padY + 4}" font-size="10" fill="#667085">${maxRank}위</text>
    <path d="${path}" fill="none" stroke="#3b5bdb" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}
    ${labels}
  </svg>`;
}

async function showKeywordChart(keywordId, term) {
  try {
    const detail = [...state.appDetails.values()].find((entry) =>
      (entry.data.keywords || []).some((k) => k.keyword.id === keywordId),
    );
    const appId = detail ? detail.data.app.id : null;
    const points = detail
      ? (detail.data.keywords.find((k) => k.keyword.id === keywordId) || {}).history || []
      : [];
    openModal(
      `‘${term}’ 순위 추이`,
      `${renderChart(points, term)}
       <p class="muted small">${appId ? '일별 마지막 점검값입니다.' : ''} 위가 좋은 순위입니다.</p>`,
    );
  } catch (err) {
    showToastError(err);
  }
}

/* ---------------- 경쟁 분석 ---------------- */
async function loadAsoView() {
  try {
    if (state.apps.length === 0) {
      $('aso-result').innerHTML = '<div class="panel empty">먼저 앱을 등록하세요.</div>';
      return;
    }
    fillAppSelects();
    const appId = Number($('aso-app').value || state.apps[0].id);
    await loadAsoKeywords(appId);
    await loadAsoPlans(appId);
  } catch (err) {
    showToastError(err);
  }
}

async function loadAsoPlans(appId) {
  const box = $('aso-saved');
  if (!box || !appId) return;
  try {
    const data = await api(`/api/apps/${appId}/aso-plans`);
    const plan = (data.plans || [])[0];
    if (!plan) {
      box.innerHTML = '';
      return;
    }
    box.innerHTML = `
      <div class="panel">
        <div class="panel-head">
          <h2>저장된 ASO 개편안</h2>
          <span class="muted small">${esc(String(plan.created_at).slice(0, 10))} 저장 · 제목 ${plan.titleLength}자 · 간단 설명 ${plan.summaryLength}자</span>
        </div>
        <div class="candidate" data-copy="${esc(plan.title)}"><span>${esc(plan.title)}</span><span class="len-badge ${plan.titleLength <= 30 ? '' : 'over'}">${plan.titleLength}자</span></div>
        <div class="candidate" data-copy="${esc(plan.summary)}"><span>${esc(plan.summary)}</span><span class="len-badge ${plan.summaryLength <= 80 ? '' : 'over'}">${plan.summaryLength}자</span></div>
        <pre class="outline">${esc(plan.description_head)}</pre>
        ${plan.rationale ? `<p class="muted small">${esc(plan.rationale)}</p>` : ''}
      </div>`;
  } catch (err) {
    box.innerHTML = '';
  }
}

async function loadAsoKeywords(appId) {
  const select = $('aso-keyword');
  if (!select) return;
  try {
    const detail = await loadDetail(appId);
    const keywords = detail.keywords || [];
    select.innerHTML = keywords.length
      ? keywords.map((k) => `<option value="${k.keyword.id}">${esc(k.keyword.term)}${k.latest && k.latest.rank ? ` (${k.latest.rank}위)` : ''}</option>`).join('')
      : '<option value="">키워드 없음</option>';
  } catch (err) {
    select.innerHTML = '<option value="">오류</option>';
  }
}

async function runAso() {
  const appId = Number($('aso-app').value);
  const keywordId = $('aso-keyword').value;
  if (!appId) return;
  $('aso-result').innerHTML = '<div class="panel empty">경쟁 앱 정보를 불러오는 중입니다…</div>';
  try {
    const query = keywordId ? `?keywordId=${keywordId}` : '';
    const data = await api(`/api/apps/${appId}/aso${query}`);
    state.aso = data;
    await loadAsoPlans(appId);
    renderAso(data);
  } catch (err) {
    $('aso-result').innerHTML = `<div class="panel empty">${esc(err.message)}</div>`;
  }
}

function renderAso(data) {
  const missing = data.missingKeywords || [];
  const covered = data.coveredKeywords || [];
  const titles = data.titleCandidates || [];
  const summaries = data.shortDescriptionCandidates || [];
  const notes = data.notes || [];
  const competitors = data.competitors || [];

  if (competitors.length === 0) {
    $('aso-result').innerHTML = `<div class="panel empty">‘${esc(data.keyword ? data.keyword.term : '')}’ 키워드의 점검 기록이 없습니다. ‘앱 · 키워드’에서 지금 순위 점검을 먼저 실행하세요.</div>`;
    return;
  }

  $('aso-result').innerHTML = `
  <div class="panel">
    <div class="panel-head"><h2>요약</h2><span class="muted small">${esc(data.keyword ? data.keyword.term : '')} · 경쟁 앱 ${competitors.length}개 분석</span></div>
    <ul class="note-list">${notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>
  </div>
  <div class="aso-grid">
    <div class="panel">
      <div class="panel-head"><h2>내 앱에 빠진 키워드</h2><span class="muted small">제목×3 · 간단설명×2 · 상세설명×1 가중치</span></div>
      ${missing.length === 0 ? '<div class="empty">빠진 키워드가 없습니다.</div>' : `<div class="chip-select">${missing
        .map((item) => `<span class="chip-static">${esc(item.keyword)} <span class="w">가중 ${item.weight} · 경쟁 ${item.competitorCount}</span></span>`)
        .join('')}</div>`}
      <div class="panel-head" style="margin-top:18px"><h2>이미 반영된 키워드</h2></div>
      <div class="chip-select">${covered.map((item) => `<span class="chip">${esc(item.keyword)}</span>`).join('') || '<span class="muted small">없음</span>'}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>상위 경쟁 앱</h2><span class="muted small">한국 스토어 검색 기준</span></div>
      <table>
        <thead><tr><th>순위</th><th>앱</th><th>평점</th><th>설치</th></tr></thead>
        <tbody>${competitors
          .map(
            (c) => `<tr><td>${c.rank}</td><td>${esc(c.title || c.packageId)}<br /><span class="muted tiny">${esc(c.packageId)}</span></td><td>${c.score ? c.score.toFixed(1) : '–'}</td><td class="muted">${esc(c.installs || '–')}</td></tr>`,
          )
          .join('')}</tbody>
      </table>
    </div>
  </div>
  <div class="aso-grid">
    <div class="panel">
      <div class="panel-head"><h2>제목 후보 (30자 제한)</h2><span class="muted small">클릭하면 복사</span></div>
      <div class="candidate-list">${titles
        .map(
          (t) => `<div class="candidate" data-copy="${esc(t.text)}"><span>${esc(t.text)}</span><span class="len-badge ${t.ok ? '' : 'over'}">${t.length}자</span></div>`,
        )
        .join('')}</div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>간단한 설명 후보 (80자 제한)</h2><span class="muted small">클릭하면 복사</span></div>
      <div class="candidate-list">${summaries
        .map(
          (t) => `<div class="candidate" data-copy="${esc(t.text)}"><span>${esc(t.text)}</span><span class="len-badge ${t.ok ? '' : 'over'}">${t.length}자</span></div>`,
        )
        .join('')}</div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head"><h2>상세 설명 구성안</h2></div>
    <pre class="outline">${esc(data.descriptionOutline || '')}</pre>
  </div>`;
}

/* ---------------- 콘텐츠 스튜디오 ---------------- */
async function loadStudioView() {
  try {
    if (state.channels.length === 0) {
      const data = await api('/api/channels');
      state.channels = data.channels || [];
    }
    renderChannelCards();
    fillAppSelects();
    const appId = Number($('studio-app').value || (state.apps[0] && state.apps[0].id));
    if (appId) await loadStudioKeywords(appId);
  } catch (err) {
    showToastError(err);
  }
}

function renderChannelCards() {
  $('studio-channels').innerHTML = state.channels
    .map(
      (channel) => `<div class="channel-card ${state.studioChannel === channel.id ? 'on' : ''}" data-channel="${channel.id}">
        <strong>${esc(channel.name)}</strong><span>${esc(channel.description)}</span>
      </div>`,
    )
    .join('');
}

async function loadStudioKeywords(appId) {
  const box = $('studio-keywords');
  try {
    const detail = await loadDetail(appId);
    const keywords = detail.keywords || [];
    state.studioKeywordIds = new Set(keywords.map((k) => k.keyword.id));
    box.innerHTML = keywords.length
      ? keywords
          .map(
            (k) => `<span class="chip on" data-studio-keyword="${k.keyword.id}">${esc(k.keyword.term)}</span>`,
          )
          .join('')
      : '<span class="muted small">등록된 키워드가 없습니다. 앱 · 키워드에서 추가하세요.</span>';
  } catch (err) {
    box.innerHTML = `<span class="muted small">${esc(err.message)}</span>`;
  }
}

async function generateContent(event) {
  event.preventDefault();
  const appId = Number($('studio-app').value);
  if (!appId) return toast('앱을 선택하세요.', true);
  const button = event.submitter || document.querySelector('#studio-form button[type="submit"]');
  if (button) button.disabled = true;
  $('studio-preview').className = 'preview empty';
  $('studio-preview').textContent = state.studioChannel === 'naver_blog' ? '블로그 글을 쓰는 중입니다…' : '홍보 글을 만드는 중입니다…';
  try {
    const result = await api(`/api/apps/${appId}/content`, {
      method: 'POST',
      body: {
        channel: state.studioChannel,
        keywordIds: [...state.studioKeywordIds],
        useAi: $('studio-ai').checked,
        deliver: $('studio-deliver').checked,
      },
    });
    state.currentDraft = result.draft;
    renderDraftPreview(result.draft);
    if (result.warning) toast(result.warning, true);
    else toast('홍보 글을 생성했습니다.');
    if (result.webhook && result.webhook.attempted) {
      toast(result.webhook.ok ? '웹훅으로 발송했습니다.' : `웹훅 발송 실패: ${result.webhook.error || ''}`, !result.webhook.ok);
    }
  } catch (err) {
    $('studio-preview').className = 'preview empty';
    $('studio-preview').textContent = '생성에 실패했습니다.';
    showToastError(err);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderDraftPreview(draft) {
  const preview = $('studio-preview');
  preview.className = 'preview';
  preview.innerHTML = `
    <div class="draft-meta">${esc(channelName(draft.channel))} · ${draft.generator === 'openai' ? `OpenAI(${esc(draft.model || '')})` : '템플릿 엔진'} · ${kst(draft.created_at)}</div>
    <h1>${esc(draft.title)}</h1>
    ${draft.body_html}
    <p style="margin-top:18px"><strong>${esc(draft.hashtags)}</strong></p>
    <p class="muted small">${esc(draft.cta_url)}</p>`;
  $('copy-md').disabled = false;
  $('copy-html').disabled = false;
  const download = $('download-html');
  download.href = `/api/drafts/${draft.id}/download?format=html`;
  download.classList.remove('disabled');
  download.setAttribute('download', `${draft.title.slice(0, 40)}.html`);
}

/* ---------------- 보관함 ---------------- */
async function loadLibrary() {
  try {
    await loadApps();
    const appId = $('library-app').value;
    const data = await api(`/api/drafts?limit=60${appId ? `&appId=${appId}` : ''}`);
    state.drafts = data.drafts || [];
    $('library-list').innerHTML =
      state.drafts.length === 0
        ? '<div class="empty">아직 생성한 초안이 없습니다. 콘텐츠 스튜디오에서 만들어 보세요.</div>'
        : state.drafts
            .map(
              (draft) => `
          <div class="draft-row" data-draft="${draft.id}">
            <span class="pill ${draft.status}">${esc(draft.channelLabel || draft.channel)}</span>
            <div class="draft-main">
              <strong>${esc(draft.title)}</strong>
              <span>${draft.generator === 'openai' ? 'AI 생성' : '템플릿'} · ${kst(draft.created_at)} · ${esc(appNameFor(draft.app_id))}</span>
            </div>
            <span class="muted small">${draft.status === 'used' ? '사용 완료' : draft.status === 'archived' ? '보관' : '초안'}</span>
          </div>`,
            )
            .join('');
  } catch (err) {
    showToastError(err);
  }
}

function channelName(id) {
  const found = (state.channels || []).find((c) => c.id === id);
  return found ? found.name : id;
}

function appNameFor(appId) {
  const app = state.apps.find((a) => a.id === appId);
  return app ? app.label || app.snapshot?.title || app.package_id : '';
}

async function openDraft(id) {
  try {
    const data = await api(`/api/drafts/${id}`);
    const draft = data.draft;
    state.currentDraft = draft;
    openModal(
      draft.title,
      `<div class="draft-meta muted small">${esc(draft.channelLabel)} · ${draft.generator === 'openai' ? 'AI' : '템플릿'} · ${kst(draft.created_at)}</div>
       <div class="row" style="margin:12px 0">
         <button class="btn ghost small" data-copy="${esc(draft.body_md)}">본문 복사</button>
         <a class="btn ghost small" href="/api/drafts/${draft.id}/download?format=html" download>HTML 저장</a>
         <a class="btn ghost small" href="/api/drafts/${draft.id}/download?format=md" download>MD 저장</a>
         <button class="btn ghost small" data-action="deliver-draft" data-draft="${draft.id}">웹훅 발송</button>
         <button class="btn ghost small" data-action="use-draft" data-draft="${draft.id}">사용 완료 표시</button>
         <button class="btn danger small" data-action="delete-draft" data-draft="${draft.id}">삭제</button>
       </div>
       <h2>${esc(draft.title)}</h2>
       ${draft.body_html}
       <p style="margin-top:16px"><strong>${esc(draft.hashtags)}</strong></p>
       <p class="muted small">${esc(draft.cta_url)}</p>`,
    );
  } catch (err) {
    showToastError(err);
  }
}

/* ---------------- 쇼츠 스튜디오 ---------------- */
const SHORTS_STAGES = ['script', 'visuals', 'audio', 'render'];
const SHORTS_STAGE_LABEL = {
  script: '대본 쓰기',
  visuals: '이미지 · 스토어 자산',
  audio: '음악 · 내레이션',
  render: '영상 렌더링 · 자막',
  done: '완성',
  failed: '실패',
};

async function loadShortsView() {
  try {
    if (state.apps.length === 0) await loadApps();
    const providers = await api('/api/shorts/providers');
    state.shortProviders = providers;
    const moods = providers.moods || [];
    if (moods.length > 0) {
      const keep = $('shorts-mood').value;
      $('shorts-mood').innerHTML = moods
        .map((mood) => `<option value="${mood.id}">${esc(mood.label)} — ${esc(mood.hint)}</option>`)
        .join('');
      const preferred = keep || providers.providers?.shorts_mood || 'bright';
      if ([...$('shorts-mood').options].some((o) => o.value === preferred)) $('shorts-mood').value = preferred;
    }
    $('shorts-narration').checked = providers.providers?.shorts_narration !== 'false';
    renderEngineBadge();
    const media = providers.media || {};
    $('shorts-hint').textContent = media.available
      ? `영상 엔진 ${media.version ? 'ffmpeg ' + media.version : '준비됨'} · 한글 폰트 ${media.font || 'Noto Sans CJK KR'}`
      : `⚠️ 영상 엔진을 찾지 못했습니다: ${media.detail || ''}`;
    await loadShortsList();
  } catch (err) {
    showToastError(err);
  }
}

function renderEngineBadge() {
  const badge = $('shorts-engine-badge');
  if (!badge) return;
  const resolved = state.shortProviders?.providers?.resolved;
  if (!resolved) {
    badge.textContent = '엔진 확인 중…';
    return;
  }
  const external = resolved.video.id !== 'builtin' && resolved.video.ready;
  badge.textContent = external ? `${resolved.video.label} 연결됨` : '내장 풀오토 · 키 불필요';
  badge.classList.toggle('on', external);
  badge.title = `${resolved.video.detail}\n${resolved.tts.detail}`;
}

async function loadShortsList() {
  const data = await api('/api/shorts');
  state.shorts = data.shorts || [];
  renderShortsList();
}

function shortStatusLabel(status) {
  return { queued: '대기', running: '생성 중', done: '완료', failed: '실패' }[status] || status;
}

function renderShortsList() {
  const box = $('shorts-list');
  if (!box) return;
  if (!state.shorts.length) {
    box.innerHTML = '<div class="empty">아직 만든 쇼츠가 없습니다. 위에서 앱을 고르고 <strong>쇼츠 풀오토 만들기</strong>를 누르면 1분 안에 완성됩니다.</div>';
    return;
  }
  box.innerHTML = state.shorts.map((short) => renderShortCard(short)).join('');
}

function renderShortCard(short) {
  const done = short.status === 'done';
  const preview = done
    ? `<video class="short-video" controls preload="metadata" playsinline src="${short.videoUrl}"></video>`
    : `<div class="short-placeholder"><span>${esc(SHORTS_STAGE_LABEL[short.stage] || short.stage || '준비')} ${short.progress || 0}%</span></div>`;
  const warnings = (short.warnings || []).length
    ? `<ul class="short-warnings">${short.warnings.slice(0, 3).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '';
  const error = short.error ? `<p class="error-text small">${esc(short.error)}</p>` : '';
  const meta = [
    short.duration ? `${Number(short.duration).toFixed(1)}초` : null,
    short.width && short.height ? `${short.width}×${short.height}` : null,
    short.bytes ? `${(short.bytes / 1024 / 1024).toFixed(1)}MB` : null,
    short.engine,
    short.ttsProvider && short.ttsProvider !== 'builtin' ? short.ttsProvider : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <article class="short-card" data-short="${short.id}">
      ${preview}
      <div class="short-body">
        <div class="short-head">
          <strong>${esc(short.appName || short.title || '')}</strong>
          <span class="pill ${short.status}">${shortStatusLabel(short.status)}</span>
        </div>
        <p class="short-title">${esc(short.title || '제목 준비 중…')}</p>
        <p class="muted small">${esc(meta)} · ${esc(kst(short.createdAt))}</p>
        ${warnings}
        ${error}
        <div class="row short-actions">
          <a class="btn ghost small ${done ? '' : 'disabled'}" href="${done ? short.downloadUrl : '#'}" download>MP4 다운로드</a>
          <button class="btn ghost small" data-action="copy-short-script" data-short="${short.id}">대본 복사</button>
          <button class="btn ghost small" data-action="copy-short-title" data-short="${short.id}">제목·태그 복사</button>
          <button class="btn danger small" data-action="delete-short" data-short="${short.id}">삭제</button>
        </div>
      </div>
    </article>`;
}

function showShortProgress(short) {
  const panel = $('shorts-progress');
  if (!panel) return;
  panel.classList.remove('hidden');
  updateShortProgress(short);
}

function updateShortProgress(short) {
  $('shorts-progress-label').textContent = `${short.progress || 0}% · ${SHORTS_STAGE_LABEL[short.stage] || short.stage || ''}`;
  $('shorts-progress-bar').style.width = `${Math.max(2, short.progress || 0)}%`;
  const current = SHORTS_STAGES.indexOf(short.stage);
  document.querySelectorAll('#shorts-stages li').forEach((li) => {
    const index = SHORTS_STAGES.indexOf(li.dataset.stage);
    li.classList.toggle('active', short.status === 'running' && index === current);
    li.classList.toggle('done', short.status === 'done' || (current > -1 && index < current));
    li.classList.toggle('failed', short.status === 'failed' && index === current);
  });
  $('shorts-progress-note').textContent =
    short.status === 'failed'
      ? `오류: ${short.error || '알 수 없는 오류'}`
      : short.status === 'done'
        ? '완성했습니다. 아래 목록에서 미리보기·다운로드하세요.'
        : '창을 닫아도 서버에서 계속 생성됩니다.';
}

async function startShort(event) {
  event.preventDefault();
  const appId = Number($('shorts-app').value);
  if (!appId) return toast('앱을 먼저 선택하세요.', true);
  const button = $('shorts-submit');
  button.disabled = true;
  button.textContent = '생성 준비 중…';
  try {
    const result = await api('/api/shorts', {
      method: 'POST',
      body: {
        appId,
        mood: $('shorts-mood').value,
        narration: $('shorts-narration').checked,
      },
    });
    showShortProgress(result.short);
    toast(`${result.engine} 엔진으로 쇼츠를 만들기 시작했습니다.`);
    pollShort(result.short.id);
  } catch (err) {
    button.disabled = false;
    showToastError(err);
  } finally {
    button.textContent = '🎬 쇼츠 풀오토 만들기';
  }
}

async function pollShort(id) {
  clearTimeout(state.shortPoll);
  try {
    const data = await api(`/api/shorts/${id}`);
    const short = data.short;
    showShortProgress(short);
    await loadShortsList();
    if (short.status === 'done' || short.status === 'failed') {
      $('shorts-submit').disabled = false;
      toast(short.status === 'done' ? '쇼츠가 완성되었습니다 🎬' : `생성 실패: ${short.error || ''}`, short.status === 'failed');
      return;
    }
    state.shortPoll = setTimeout(() => pollShort(id), 2500);
  } catch (err) {
    $('shorts-submit').disabled = false;
    showToastError(err);
  }
}

function shortScriptText(short) {
  const script = short.script;
  if (!script || !Array.isArray(script.scenes)) return short.title || '';
  const lines = [`# ${script.title || short.title}`, ''];
  for (const scene of script.scenes) {
    lines.push(`[씬 ${scene.index} · ${String(scene.role || '').toUpperCase()}]`);
    lines.push(`화면: ${String(scene.headline || '').replace(/\n/g, ' / ')}`);
    if (scene.sub) lines.push(`보조: ${scene.sub}`);
    if (Array.isArray(scene.bullets) && scene.bullets.length) lines.push(`포인트: ${scene.bullets.join(' · ')}`);
    lines.push(`내레이션: ${scene.narration || ''}`);
    lines.push('');
  }
  lines.push('설명:', script.description || short.description || '');
  lines.push('');
  lines.push(script.hashtags ? script.hashtags.join(' ') : short.hashtags || '');
  return lines.join('\n');
}

function shortById(id) {
  return state.shorts.find((item) => item.id === Number(id));
}

/* ---------------- 설정 ---------------- */
async function loadSettingsView() {
  try {
    if (state.channels.length === 0) {
      const data = await api('/api/channels');
      state.channels = data.channels || [];
    }
    const data = await api('/api/settings');
    state.settings = data.settings || {};
    state.env = data.env || {};
    const s = state.settings;

    $('rank-enabled').checked = s.rank_schedule_enabled === 'true';
    $('rank-time').value = s.rank_schedule_time || '09:00';
    $('rank-depth').value = s.rank_depth || state.env.rankDepth || 30;
    $('content-enabled').checked = s.content_schedule_enabled === 'true';
    $('content-time').value = s.content_schedule_time || '10:00';
    $('content-frequency').value = s.content_schedule_frequency || 'daily';
    $('content-weekday').value = s.content_schedule_weekday || '1';
    state.scheduleChannels = new Set((s.content_schedule_channels || '').split(',').filter(Boolean));
    renderScheduleChannels();

    $('webhook-enabled').checked = s.webhook_enabled === 'true';
    $('webhook-url').value = s.webhook_url || '';
    $('openai-key').value = s.openai_api_key || '';
    $('openai-model').value = s.openai_model || 'gpt-4o-mini';
    $('utm-source').value = s.utm_source || '';
    $('utm-campaign').value = s.utm_campaign || '';
    await loadProviderSettings(s);

    $('env-info').textContent = `포트 ${state.env.port} · 데이터 경로 ${state.env.dataDir} · 관리자 비밀번호 ${state.env.adminPasswordSet ? '설정됨' : '없음(누구나 접속 가능)'} · OpenAI 환경변수 ${state.env.openaiEnvKeySet ? '설정됨' : '없음'}`;

    const scheduler = await api('/api/scheduler');
    $('schedule-status').textContent = `다음 순위 점검: ${scheduler.rank.nextRunKst || '꺼짐'} · 다음 초안 생성: ${scheduler.content.nextRunKst || '꺼짐'}`;

    const log = await api('/api/webhook/deliveries');
    const deliveries = log.deliveries || [];
    $('webhook-log').innerHTML =
      deliveries.length === 0
        ? '<div class="empty">발송 기록이 없습니다.</div>'
        : `<table><thead><tr><th>시각</th><th>이벤트</th><th>결과</th><th>응답</th></tr></thead><tbody>${deliveries
            .map(
              (d) => `<tr><td class="muted">${kst(d.created_at)}</td><td>${esc(d.event)}</td><td>${d.ok ? '<span class="delta-up">성공</span>' : `<span class="delta-down">실패</span>`}</td><td class="muted small">${esc(d.status_code || '')} ${esc((d.error || d.response_snippet || '').slice(0, 60))}</td></tr>`,
            )
            .join('')}</tbody></table>`;
  } catch (err) {
    showToastError(err);
  }
}

async function loadProviderSettings(s) {
  try {
    const response = await api('/api/shorts/providers');
    state.shortProviders = response;
    const videoProviders = response.videoProviders || [];
    const ttsProviders = response.ttsProviders || [];
    $('shorts-video-provider').innerHTML = videoProviders
      .map((p) => `<option value="${p.id}">${esc(p.label)}</option>`)
      .join('');
    $('shorts-tts-provider').innerHTML = ttsProviders
      .map((p) => `<option value="${p.id}">${esc(p.label)}</option>`)
      .join('');
    $('shorts-video-provider').value = s.shorts_video_provider || 'builtin';
    $('shorts-tts-provider').value = s.shorts_tts_provider || 'builtin';
    $('shorts-video-key').value = s.shorts_video_api_key || '';
    $('shorts-video-key').placeholder =
      s.shorts_video_key_set && s.shorts_video_key_source === 'env' ? '환경변수 키 사용 중' : '비워두면 내장 엔진으로 동작';
    $('shorts-video-endpoint').value = s.shorts_video_endpoint || '';
    $('shorts-video-model').value = s.shorts_video_model || '';
    $('shorts-tts-key').value = s.shorts_tts_api_key || '';
    $('shorts-tts-key').placeholder =
      s.shorts_tts_key_set && s.shorts_tts_key_source === 'env' ? '환경변수 키 사용 중' : 'OpenAI / ElevenLabs 키';
    $('shorts-tts-voice').value = s.shorts_tts_voice || '';
    const resolved = s.resolved || {};
    $('shorts-video-detail').textContent = resolved.video?.detail || '';
    $('shorts-tts-detail').textContent = resolved.tts?.detail || '';
    $('providers-status').textContent = resolved.video?.ready ? '키 설정됨' : '내장 엔진 사용';
    renderEngineBadge();
  } catch (err) {
    $('providers-status').textContent = err.message;
  }
}

async function saveProviders(event) {
  event.preventDefault();
  try {
    const body = {
      shorts_video_provider: $('shorts-video-provider').value,
      shorts_video_endpoint: $('shorts-video-endpoint').value.trim(),
      shorts_video_model: $('shorts-video-model').value.trim(),
      shorts_tts_provider: $('shorts-tts-provider').value,
      shorts_tts_voice: $('shorts-tts-voice').value.trim(),
    };
    const videoKey = $('shorts-video-key').value.trim();
    if (videoKey && !videoKey.includes('••••')) body.shorts_video_api_key = videoKey;
    const ttsKey = $('shorts-tts-key').value.trim();
    if (ttsKey && !ttsKey.includes('••••')) body.shorts_tts_api_key = ttsKey;
    await api('/api/settings', { method: 'PUT', body });
    toast('AI 프로바이더 설정을 저장했습니다.');
    await loadSettingsView();
  } catch (err) {
    showToastError(err);
  }
}

function renderScheduleChannels() {
  $('content-channels').innerHTML = state.channels
    .map(
      (channel) =>
        `<span class="chip ${state.scheduleChannels.has(channel.id) ? 'on' : ''}" data-schedule-channel="${channel.id}">${esc(channel.name)}</span>`,
    )
    .join('');
}

async function saveSchedule(event) {
  event.preventDefault();
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: {
        rank_schedule_enabled: $('rank-enabled').checked,
        rank_schedule_time: $('rank-time').value,
        rank_depth: Number($('rank-depth').value),
        content_schedule_enabled: $('content-enabled').checked,
        content_schedule_time: $('content-time').value,
        content_schedule_frequency: $('content-frequency').value,
        content_schedule_weekday: $('content-weekday').value,
        content_schedule_channels: [...state.scheduleChannels].join(','),
      },
    });
    toast('자동 점검 설정을 저장했습니다.');
    await loadSettingsView();
  } catch (err) {
    showToastError(err);
  }
}

async function saveIntegrations(event) {
  event.preventDefault();
  try {
    const body = {
      webhook_enabled: $('webhook-enabled').checked,
      webhook_url: $('webhook-url').value.trim(),
      openai_model: $('openai-model').value.trim(),
      utm_source: $('utm-source').value.trim(),
      utm_campaign: $('utm-campaign').value.trim(),
    };
    const key = $('openai-key').value.trim();
    if (key && !key.includes('••••')) body.openai_api_key = key;
    await api('/api/settings', { method: 'PUT', body });
    toast('연동 설정을 저장했습니다.');
    await loadSettingsView();
  } catch (err) {
    showToastError(err);
  }
}

/* ---------------- 이벤트 ---------------- */
function bindEvents() {
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/login', { method: 'POST', body: { password: $('login-password').value } });
      $('login-error').textContent = '';
      showApp();
      await boot();
    } catch (err) {
      $('login-error').textContent = err.message;
    }
  });

  window.addEventListener('hashchange', route);

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      location.hash = `#${item.dataset.view}`;
    });
  });

  document.addEventListener('click', async (event) => {
    const goto = event.target.closest('[data-goto]');
    if (goto) {
      location.hash = `#${goto.dataset.goto}`;
      return;
    }

    const copyNode = event.target.closest('[data-copy]');
    if (copyNode) {
      await copyText(copyNode.dataset.copy, '내용을');
      return;
    }

    const draftRow = event.target.closest('[data-draft]');
    if (draftRow && !event.target.closest('button')) {
      await openDraft(Number(draftRow.dataset.draft));
      return;
    }

    const channelCard = event.target.closest('[data-channel]');
    if (channelCard) {
      state.studioChannel = channelCard.dataset.channel;
      renderChannelCards();
      return;
    }

    const studioKeyword = event.target.closest('[data-studio-keyword]');
    if (studioKeyword) {
      const id = Number(studioKeyword.dataset.studioKeyword);
      if (state.studioKeywordIds.has(id)) state.studioKeywordIds.delete(id);
      else state.studioKeywordIds.add(id);
      studioKeyword.classList.toggle('on');
      return;
    }

    const scheduleChip = event.target.closest('[data-schedule-channel]');
    if (scheduleChip) {
      const id = scheduleChip.dataset.scheduleChannel;
      if (state.scheduleChannels.has(id)) state.scheduleChannels.delete(id);
      else state.scheduleChannels.add(id);
      renderScheduleChannels();
      return;
    }

    const actionNode = event.target.closest('[data-action]');
    if (!actionNode) return;
    const action = actionNode.dataset.action;
    try {
      if (action === 'refresh-app') {
        toast('앱 정보를 새로 가져오는 중입니다…');
        await api(`/api/apps/${actionNode.dataset.app}/refresh`, { method: 'POST', body: {} });
        state.appDetails.delete(Number(actionNode.dataset.app));
        toast('앱 정보를 갱신했습니다.');
        await loadAppsView();
      } else if (action === 'check-app') {
        await checkAppRanks(Number(actionNode.dataset.app));
      } else if (action === 'delete-app') {
        if (!confirm('이 앱과 순위 기록을 모두 삭제할까요?')) return;
        await api(`/api/apps/${actionNode.dataset.app}`, { method: 'DELETE' });
        state.appDetails.clear();
        toast('앱을 삭제했습니다.');
        await loadAppsView();
      } else if (action === 'add-keyword') {
        const input = document.querySelector(`[data-role="keyword-input"][data-app="${actionNode.dataset.app}"]`);
        const term = input ? input.value.trim() : '';
        if (!term) return toast('키워드를 입력하세요.', true);
        await api(`/api/apps/${actionNode.dataset.app}/keywords`, { method: 'POST', body: { terms: [term] } });
        if (input) input.value = '';
        state.appDetails.delete(Number(actionNode.dataset.app));
        toast(`‘${term}’ 키워드를 추가했습니다.`);
        await loadAppCardDetail(Number(actionNode.dataset.app));
        await loadApps();
      } else if (action === 'delete-keyword') {
        await api(`/api/keywords/${actionNode.dataset.keyword}`, { method: 'DELETE' });
        await loadAppsView();
      } else if (action === 'keyword-chart') {
        await showKeywordChart(Number(actionNode.dataset.keyword), actionNode.dataset.term);
      } else if (action === 'deliver-draft') {
        const result = await api(`/api/drafts/${actionNode.dataset.draft}/deliver`, { method: 'POST', body: {} });
        toast(result.ok ? '웹훅으로 발송했습니다.' : `발송 실패: ${result.error || ''}`, !result.ok);
      } else if (action === 'use-draft') {
        await api(`/api/drafts/${actionNode.dataset.draft}`, { method: 'PATCH', body: { status: 'used' } });
        toast('사용 완료로 표시했습니다.');
        closeModal();
        await loadLibrary();
      } else if (action === 'copy-short-script') {
        const short = shortById(actionNode.dataset.short);
        if (short) await copyText(shortScriptText(short), '쇼츠 대본을');
      } else if (action === 'copy-short-title') {
        const short = shortById(actionNode.dataset.short);
        if (short) await copyText(`${short.title || ''}\n\n${short.description || ''}\n\n${short.hashtags || ''}`.trim(), '제목·태그를');
      } else if (action === 'delete-short') {
        if (!confirm('이 쇼츠를 삭제할까요? MP4 파일도 함께 삭제됩니다.')) return;
        await api(`/api/shorts/${actionNode.dataset.short}`, { method: 'DELETE' });
        toast('쇼츠를 삭제했습니다.');
        await loadShortsList();
      } else if (action === 'delete-draft') {
        if (!confirm('이 초안을 삭제할까요?')) return;
        await api(`/api/drafts/${actionNode.dataset.draft}`, { method: 'DELETE' });
        toast('초안을 삭제했습니다.');
        closeModal();
        await loadLibrary();
      }
    } catch (err) {
      showToastError(err);
    }
  });

  $('add-app-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const packageId = $('add-package').value.trim();
    if (!packageId) return;
    const keywords = $('add-keywords').value.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      toast('Play 스토어에서 앱 정보를 가져오는 중입니다…');
      const result = await api('/api/apps', {
        method: 'POST',
        body: { packageId, label: $('add-label').value.trim() || null, keywords },
      });
      if (result.fetchError) toast(`앱은 등록했지만 정보 조회 실패: ${result.fetchError}`, true);
      else toast('앱을 등록했습니다.');
      $('add-package').value = '';
      $('add-label').value = '';
      $('add-keywords').value = '';
      state.appDetails.clear();
      await loadAppsView();
    } catch (err) {
      showToastError(err);
    }
  });

  $('btn-import-developer').addEventListener('click', async () => {
    const query = prompt('개발자 이름 또는 ID를 입력하세요.', '이음소프트웨어');
    if (!query) return;
    try {
      toast('개발자 앱 목록을 가져오는 중입니다…');
      const result = await api('/api/import-developer', { method: 'POST', body: { query } });
      toast(`앱 ${result.added.length}개 추가 (이미 등록 ${result.existing.length}개)`);
      await loadAppsView();
    } catch (err) {
      showToastError(err);
    }
  });

  $('btn-quick-check').addEventListener('click', async () => {
    if (state.apps.length === 0) {
      toast('먼저 앱을 등록하세요.', true);
      return;
    }
    toast('모든 앱의 순위를 점검합니다…');
    try {
      for (const app of state.apps) {
        await api(`/api/apps/${app.id}/check-ranks`, { method: 'POST', body: {} });
      }
      toast('전체 순위 점검을 마쳤습니다.');
      state.appDetails.clear();
      route();
    } catch (err) {
      showToastError(err);
    }
  });

  $('sidebar-run-rank').addEventListener('click', () => $('btn-quick-check').click());

  $('aso-run').addEventListener('click', runAso);
  $('aso-app').addEventListener('change', (event) => {
    const appId = Number(event.target.value);
    loadAsoKeywords(appId);
    loadAsoPlans(appId);
  });
  $('studio-form').addEventListener('submit', generateContent);
  $('studio-app').addEventListener('change', (event) => loadStudioKeywords(Number(event.target.value)));
  $('library-app').addEventListener('change', loadLibrary);
  $('library-refresh').addEventListener('click', loadLibrary);
  $('shorts-form').addEventListener('submit', startShort);
  $('shorts-refresh').addEventListener('click', () => loadShortsView());
  $('providers-form').addEventListener('submit', saveProviders);
  $('shorts-video-provider').addEventListener('change', () => {
    const list = state.shortProviders?.videoProviders || [];
    const found = list.find((p) => p.id === $('shorts-video-provider').value);
    $('shorts-video-detail').textContent = found ? `${found.hint}${found.needsKey ? ' · API 키 필요' : ''}` : '';
  });
  $('shorts-tts-provider').addEventListener('change', () => {
    const list = state.shortProviders?.ttsProviders || [];
    const found = list.find((p) => p.id === $('shorts-tts-provider').value);
    $('shorts-tts-detail').textContent = found ? `${found.hint}${found.needsKey ? ' · API 키 필요' : ''}` : '';
  });
  $('schedule-form').addEventListener('submit', saveSchedule);
  $('integration-form').addEventListener('submit', saveIntegrations);

  $('webhook-test').addEventListener('click', async () => {
    const url = $('webhook-url').value.trim();
    if (!url) return toast('웹훅 URL을 입력하세요.', true);
    $('webhook-result').textContent = '발송 중…';
    try {
      const result = await api('/api/webhook/test', { method: 'POST', body: { url } });
      $('webhook-result').textContent = result.ok ? `성공 (${result.statusCode})` : `실패: ${result.error || result.statusCode}`;
      toast(result.ok ? '테스트 발송에 성공했습니다.' : '테스트 발송에 실패했습니다.', !result.ok);
      await loadSettingsView();
    } catch (err) {
      $('webhook-result').textContent = err.message;
      showToastError(err);
    }
  });

  $('run-content-now').addEventListener('click', async () => {
    try {
      toast('초안을 생성하는 중입니다…');
      const result = await api('/api/scheduler/run', { method: 'POST', body: { kind: 'content' } });
      toast(result.message, !result.ok);
    } catch (err) {
      showToastError(err);
    }
  });

  $('copy-md').addEventListener('click', () => {
    if (state.currentDraft) copyText(state.currentDraft.body_md, '본문을');
  });
  $('copy-html').addEventListener('click', () => {
    if (state.currentDraft) copyText(state.currentDraft.body_html, 'HTML을');
  });

  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (event) => {
    if (event.target === $('modal')) closeModal();
  });

  setInterval(() => {
    $('clock').textContent = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date());
  }, 30_000);
  $('clock').textContent = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

async function loadSidebarSchedule() {
  try {
    const scheduler = await api('/api/scheduler');
    const parts = [];
    parts.push(scheduler.rank.enabled ? `매일 ${scheduler.rank.time}` : '순위 점검 꺼짐');
    if (scheduler.content.enabled) parts.push(`초안 ${scheduler.content.time}`);
    const next = scheduler.rank.nextRunKst || scheduler.content.nextRunKst;
    $('sidebar-schedule').innerHTML = `${parts.join(' · ')}<br /><span class="muted tiny">${next ? `다음 ${esc(next)}` : '자동 실행 없음'}</span>`;
  } catch (err) {
    $('sidebar-schedule').textContent = '일정 확인 실패';
  }
}

async function boot() {
  try {
    const session = await api('/api/session');
    if (session.authRequired && !session.authenticated) {
      showLogin();
      return;
    }
    showApp();
    await loadApps();
    await loadSidebarSchedule();
    route();
  } catch (err) {
    if (err.message !== '로그인이 필요합니다.') showToastError(err);
  }
}

bindEvents();
boot();
