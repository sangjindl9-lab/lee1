/* K-ElecTakeoff AI — 프런트엔드 (빌드 불필요 SPA). 모든 메뉴는 실제 API 와 연결된다. */
const S = { token: localStorage.getItem("ket_token"), user: null, route: "", pid: null };
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 2) => (v === null || v === undefined) ? "<span class='muted'>미산출</span>" : (Number.isInteger(v) ? v : Number(v).toFixed(d));
const KO = { auto: "자동 검출", verified: "검증 완료", edited: "수정 완료", review: "추가 검토", insufficient: "정보 부족", impossible: "산출 불가", excluded: "제외", manual: "수동 추가", approved: "승인", unresolved: "미확인", done: "완료", processing: "분석중", queued: "대기", failed: "실패", uploaded: "업로드", needs_converter: "변환기 필요" };
const CAT = { device: "기구", conduit: "전선관", tray: "트레이", cable: "케이블" };
const INST = { new: "신설", existing: "기존", remove: "철거", relocate: "이설" };

function toast(msg, err = false) { const d = document.createElement("div"); d.textContent = msg; if (err) d.className = "err"; $("#toast").appendChild(d); setTimeout(() => d.remove(), err ? 6000 : 3000); }

async function api(path, opt = {}) {
  const h = opt.headers || {};
  if (S.token) h["Authorization"] = "Bearer " + S.token;
  if (opt.json) { h["Content-Type"] = "application/json"; opt.body = JSON.stringify(opt.json); }
  const r = await fetch(path, { ...opt, headers: h });
  if (r.status === 401) { S.token = null; localStorage.removeItem("ket_token"); go("login"); throw new Error("로그인이 필요합니다."); }
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch (e) { } toast(typeof m === "string" ? m : JSON.stringify(m), true); throw new Error(m); }
  const ct = r.headers.get("content-type") || "";
  return ct.includes("json") ? r.json() : r;
}

function go(route) { location.hash = route; }
window.addEventListener("hashchange", render);

async function render() {
  const h = location.hash.replace("#", "") || "projects";
  if (!S.token) return renderLogin();
  if (!S.user) { try { S.user = await api("/api/auth/me"); } catch (e) { return; } }
  $("#userbox").innerHTML = `${esc(S.user.company)} · ${esc(S.user.name)} <span class="badge">${esc(S.user.role)}</span> <button class="sm" onclick="logout()">로그아웃</button>`;
  $("#nav").innerHTML = `<a class="${h.startsWith("projects") ? "active" : ""}" href="#projects">프로젝트</a><a class="${h === "refdata" ? "active" : ""}" href="#refdata">기준정보(적산)</a><a href="/docs" target="_blank">API 문서</a>`;
  if (h.startsWith("project/")) return renderWorkspace(parseInt(h.split("/")[1]));
  if (h === "refdata") return renderRefData();
  return renderProjects();
}
function logout() { S.token = null; S.user = null; localStorage.removeItem("ket_token"); go("login"); }

/* ---------------- 로그인 ---------------- */
function renderLogin() {
  $("#userbox").innerHTML = ""; $("#nav").innerHTML = "";
  $("#app").innerHTML = `<div class="page"><div class="card login"><h2>로그인</h2>
  <input id="l_email" placeholder="이메일"><input id="l_pw" type="password" placeholder="비밀번호">
  <div class="row"><button class="primary" onclick="doLogin()">로그인</button></div>
  <h3>회사 신규 등록</h3><input id="r_comp" placeholder="회사명"><input id="r_name" placeholder="이름"><input id="r_email" placeholder="이메일"><input id="r_pw" type="password" placeholder="비밀번호(8자 이상)">
  <div class="row"><button onclick="doRegister()">회사·관리자 등록</button></div></div></div>`;
}
async function doLogin() {
  const fd = new URLSearchParams({ username: $("#l_email").value, password: $("#l_pw").value });
  const r = await api("/api/auth/login", { method: "POST", body: fd });
  S.token = r.access_token; localStorage.setItem("ket_token", S.token); S.user = r.user; go("projects");
}
async function doRegister() {
  const r = await api("/api/auth/register", { method: "POST", json: { company_name: $("#r_comp").value, name: $("#r_name").value, email: $("#r_email").value, password: $("#r_pw").value } });
  S.token = r.access_token; localStorage.setItem("ket_token", S.token); S.user = r.user; go("projects");
}

/* ---------------- 프로젝트 목록 ---------------- */
async function renderProjects() {
  const ps = await api("/api/projects");
  $("#app").innerHTML = `<div class="page"><div class="card"><h2>공사 프로젝트</h2>
  <div class="row"><input id="p_name" placeholder="공사명" style="width:260px"><input id="p_client" placeholder="발주처"><input id="p_loc" placeholder="공사 위치"><select id="p_type"><option>전기공사</option><option>정보통신공사</option><option>전기·통신공사</option><option>CCTV 공사</option></select><input id="p_start" type="date"><input id="p_end" type="date"><button class="primary" onclick="createProject()">프로젝트 생성</button></div></div>
  <div class="card"><table><tr><th>공사명</th><th>발주처</th><th>위치</th><th>종류</th><th>착공~준공</th><th>도면</th><th>생성일</th><th></th></tr>
  ${ps.map(p => `<tr><td><a href="#project/${p.id}">${esc(p.name)}</a></td><td>${esc(p.client)}</td><td>${esc(p.location)}</td><td>${esc(p.work_type)}</td><td>${esc(p.start_date || "")}~${esc(p.end_date || "")}</td><td class="num">${p.file_count}</td><td>${p.created_at.slice(0, 10)}</td><td><button class="sm err" onclick="delProject(${p.id})">삭제</button></td></tr>`).join("")}
  </table>${ps.length ? "" : "<p class='muted'>프로젝트가 없습니다.</p>"}</div></div>`;
}
async function createProject() {
  await api("/api/projects", { method: "POST", json: { name: $("#p_name").value, client: $("#p_client").value, location: $("#p_loc").value, work_type: $("#p_type").value, start_date: $("#p_start").value || null, end_date: $("#p_end").value || null, author: S.user.name } });
  renderProjects();
}
async function delProject(id) { if (confirm("프로젝트와 모든 도면·산출 결과를 삭제합니다.")) { await api("/api/projects/" + id, { method: "DELETE" }); renderProjects(); } }

/* ---------------- 작업 공간 ---------------- */
const W = {};   // workspace state
async function renderWorkspace(pid) {
  clearTimeout(W.pollTimer);
  Object.assign(W, { pid, tab: "files", sheet: null, geo: null, img: null, hidden: new Set(), dets: [], routes: [], legends: [], items: [], issues: [], sel: null, mode: "pan", pts: [], view: null, showRoutes: true, showDets: true, legendsVisible: true });
  W.project = await api(`/api/projects/${pid}`);
  $("#app").innerHTML = `<div class="ws"><aside id="left"></aside><section class="center" id="center"><canvas id="cv"></canvas>
    <div class="vtools">
      <button id="m_pan" class="on" onclick="setMode('pan')">이동/선택</button><button id="m_region" onclick="setMode('region')">범례 영역 지정</button>
      <button id="m_measure" onclick="setMode('measure')">거리 측정/축척</button><button id="m_add" onclick="setMode('add')">기호 수동 추가</button><button id="m_sample" onclick="setMode('sample')">도면에서 기호 지정</button><button id="m_tally" class="hl" onclick="setMode('tally')">▣ 영역 집계(드래그)</button><button class="hl" onclick="tallyAll()">▦ 도면 전체 집계</button>
      <button onclick="fitView()">전체보기</button><button onclick="toggle('showDets')">기호표시</button><button onclick="toggle('showRoutes')">선로표시</button>
      <button class="primary" onclick="runTakeoff()">▶ 자동 물량산출 실행</button>
      <button onclick="exportXlsx()">Excel</button><button onclick="dl('/api/projects/${pid}/export/pdf','물량집계표.pdf')">PDF</button>
    </div><div class="vinfo" id="vinfo">도면을 선택하십시오</div></section><section class="right" id="right"></section></div>`;
  initViewer();
  await refreshAll();
}
function toggle(k) { W[k] = !W[k]; draw(); }
const busyFiles = files => (files || []).some(f => ["queued", "processing"].includes(f.status));
function userEditing() {   // 입력 중이거나 목록을 펼친 상태면 화면을 다시 그리지 않는다
  const a = document.activeElement;
  return a && ["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName) && a.type !== "file";
}
async function refreshAll() {
  clearTimeout(W.pollTimer); W.pollTimer = null;
  const pid = W.pid;
  [W.files, W.legends, W.items, W.issues, W.tallies] = await Promise.all([api(`/api/projects/${pid}/files`), api(`/api/projects/${pid}/legends`), api(`/api/projects/${pid}/takeoff/items`), api(`/api/projects/${pid}/takeoff/issues`), api(`/api/projects/${pid}/tallies`)]);
  W.sheets = W.files.flatMap(f => f.sheets.map(s => ({ ...s, file: f })));
  if (W.sheet) { W.dets = await api(`/api/projects/${pid}/takeoff/symbols?sheet_id=${W.sheet.id}`); W.routes = await api(`/api/projects/${pid}/takeoff/routes?sheet_id=${W.sheet.id}`); }
  renderLeft(); renderRight(); draw();
  // 아직 연 도면이 없으면 첫 도면(평면도 우선)을 자동으로 연다 — 휴대폰에서 목록을 못 찾아 빈 화면이 되는 문제 방지
  if (!W.sheet && W.sheets.length) {
    const first = W.sheets.find(x => x.drawing_type === "평면도") || W.sheets[0];
    await openSheet(first.id);
  }
  if (busyFiles(W.files)) schedulePoll();
}
// 도면 처리 중에는 파일 상태만 가볍게 확인 (타이머 1개만 유지). 진행률이 바뀔 때만 도면 목록을 다시 그리고,
// 처리가 끝나면 전체 갱신 1회.
function schedulePoll() {
  clearTimeout(W.pollTimer);
  const pid = W.pid;
  W.pollTimer = setTimeout(async () => {
    if (W.pid !== pid || !document.getElementById("left")) return;
    let files;
    try { files = await api(`/api/projects/${pid}/files`); } catch (e) { schedulePoll(); return; }
    if (W.pid !== pid) return;
    const sig = fs => JSON.stringify((fs || []).map(f => [f.id, f.status, f.progress]));
    const changed = sig(files) !== sig(W.files);
    if (!busyFiles(files)) { W.files = files; refreshAll(); return; }
    if (changed) {
      W.files = files; W.sheets = files.flatMap(f => f.sheets.map(s => ({ ...s, file: f })));
      if (W.tab === "files" && !userEditing()) renderLeft();
    }
    schedulePoll();
  }, 2500);
}

function renderLeft() {
  const tabs = [["files", "도면"], ["legend", "범례"], ["qty", "물량"], ["review", `검토(${W.issues.filter(i => !i.resolved).length})`], ["est", "적산"]];
  let html = `<div><b>${esc(W.project.name)}</b> <span class="muted small">${esc(W.project.client || "")}</span></div><div class="tabs">${tabs.map(([k, n]) => `<div class="${W.tab === k ? "on" : ""}" onclick="W.tab='${k}';renderLeft()">${n}</div>`).join("")}</div>`;
  if (W.tab === "files") html += leftFiles();
  if (W.tab === "legend") html += leftLegend();
  if (W.tab === "qty") html += leftQty();
  if (W.tab === "review") html += leftReview();
  if (W.tab === "est") { html += "<div id='estLeft'>불러오는 중…</div>"; $("#left").innerHTML = html; loadEstimate(); return; }
  $("#left").innerHTML = html;
  document.querySelectorAll("canvas.mini").forEach(drawMini);
  loadAuthImages();
}

function leftFiles() {
  const unconf = W.sheets.filter(s => !s.scale_confirmed && s.scale_factor).length;
  let h = (unconf ? `<div class="warnbox">추정 축척이 있는 시트 ${unconf}장이 아직 확정되지 않았습니다. 시트별 경고의 근거(용지·표기)를 확인한 뒤 <button class="sm ok" onclick="api('/api/projects/${W.pid}/sheets/confirm-scales',{method:'POST'}).then(r=>{toast(r.confirmed+'장 축척 확정');refreshAll()})">추정 축척 일괄 확정</button></div>` : "") + `<div class="drop" ondragover="event.preventDefault()" ondrop="dropFiles(event)">DWG·DXF·PDF·JPG·PNG·XLSX 파일을 끌어다 놓거나<br><input type="file" multiple onchange="uploadFiles(this.files)"></div><div class="list">`;
  for (const f of W.files) {
    h += `<div class="item" style="flex-direction:column;align-items:stretch"><div class="row" style="justify-content:space-between"><span>${esc(f.name)} <span class="badge ${f.status}">${KO[f.status] || f.status}</span></span><span><button class="sm" onclick="api('/api/projects/${W.pid}/files/${f.id}/reprocess',{method:'POST'}).then(refreshAll)">재분석</button><button class="sm err" onclick="if(confirm('삭제?'))api('/api/projects/${W.pid}/files/${f.id}',{method:'DELETE'}).then(refreshAll)">×</button></span></div>`;
    if (["queued", "processing"].includes(f.status)) h += `<div class="prog"><i style="width:${f.progress}%"></i></div>`;
    if (f.error) h += `<div class="errbox">${esc(f.error)}</div>`;
    const ws = f.warnings || [];
    if (ws.length > 2) h += `<details class="warns"><summary>⚠ 확인할 안내 ${ws.length}건 (축척·OCR 등) — 눌러서 보기</summary>${ws.map(w => `<div class="warnbox">${esc(w)}</div>`).join("")}</details>`;
    else for (const w of ws) h += `<div class="warnbox">${esc(w)}</div>`;
    for (const s of f.sheets) h += `<div class="item ${W.sheet && W.sheet.id === s.id ? "sel" : ""}" onclick="openSheet(${s.id})"><span>📄 ${esc(s.drawing_no || "")} ${esc(s.drawing_title || s.sheet_name)} <span class="muted small">${s.drawing_type || ""} ${s.discipline || ""}</span></span><span class="small ${s.scale_confirmed ? "muted" : ""}" style="color:${s.scale_confirmed ? "" : "var(--warn)"}">${s.scale_confirmed ? s.units : "축척 미확정"}</span></div>`;
    h += `</div>`;
  }
  h += `</div>`;
  if (W.sheet) {
    h += `<h3>레이어 (${W.sheet.layers.length})</h3><div class="list" style="max-height:220px;overflow:auto">` + W.sheet.layers.map(L => `<div class="item"><label><input type="checkbox" ${W.hidden.has(L.name) ? "" : "checked"} onchange="toggleLayer('${esc(L.name)}')"> <span style="color:${aciColor(L.color)}">■</span> ${esc(L.name)}</label><span class="muted small">${L.count} ${L.discipline || ""}</span></div>`).join("") + `</div>`;
  }
  return h;
}
function toggleLayer(n) { W.hidden.has(n) ? W.hidden.delete(n) : W.hidden.add(n); draw(); }

function leftLegend() {
  let h = `<div class="row"><button class="primary sm" onclick="runLegendAuto()">🔍 범례표 자동 인식</button><button class="sm ok" onclick="api('/api/projects/${W.pid}/legends/approve-all',{method:'POST'}).then(r=>{toast(r.approved+'건 승인');refreshAll()})">품명 있는 항목 일괄 승인</button>${W.legends.length ? `<button class="sm err" onclick="delAllLegends()">🗑 범례 전체 삭제</button>` : ""}</div><div class="small muted">자동 인식 실패 시 상단 '범례 영역 지정' 으로 도면에서 표를 드래그하십시오.</div>`;
  if (!W.legends.length) h += `<p class="muted">인식된 범례가 없습니다.</p>`;
  for (const t of W.legends) {
    h += `<div class="card" style="padding:8px"><div class="row" style="justify-content:space-between"><b>${esc(t.title)}</b><span><span class="badge">${t.source}</span> ${(t.confidence * 100).toFixed(0)}% <button class="sm" onclick="if(t=W.sheets.find(s=>s.id==${t.sheet_id}))openSheet(${t.sheet_id},${JSON.stringify(t.region)})">위치</button><button class="sm err" onclick="delLegend(${t.id},'${esc(t.title).replace(/'/g, "")}')">🗑 삭제</button></span></div>`;
    h += `<table><tr><th>기호</th><th>품명/규격/단위</th><th>범주</th><th>신뢰</th><th>검출</th><th></th></tr>`;
    for (const s of t.symbols) {
      const img = s.has_image ? `<img class="sym-img" data-src="/api/projects/${W.pid}/legends/symbols/${s.id}/image">` : (s.block_name ? `<canvas class="mini" data-block="${esc(s.block_name)}" data-sheet="${t.sheet_id}"></canvas>` : "");
      h += `<tr class="${W.sel && W.sel.type === "legend" && W.sel.id === s.id ? "sel" : ""}" onclick="selectLegend(${s.id})"><td>${img}<div class="small">${esc(s.symbol_name || "")}<br><span class="muted">${esc(s.block_name || "")}</span></div></td><td>${esc(s.item_name) || "<span class='muted'>미확인</span>"}<br><span class="muted small">${esc(s.spec || "")} / ${esc(s.unit || "")}</span></td><td>${CAT[s.category]}</td><td>${(s.confidence * 100).toFixed(0)}%</td><td class="num">${s.detected_count}</td><td><span class="badge ${s.status}">${KO[s.status]}</span><br><button class="sm err" title="이 행 삭제" onclick="event.stopPropagation();delLegendRow(${s.id})">×</button></td></tr>`;
    }
    h += `</table><div class="row"><button class="sm" onclick="addLegendRow(${t.id})">+ 미인식 기호 등록</button></div></div>`;
  }
  return h;
}
async function delLegend(id, title) { if (!confirm(`범례표 '${title}' 를 삭제합니다.\n이 범례로 검출된 기호·산출 수량도 함께 지워집니다.`)) return; await api(`/api/projects/${W.pid}/legends/${id}`, { method: "DELETE" }); toast("범례표를 삭제했습니다."); W.sel = null; refreshAll(); }
async function delAllLegends() { if (!confirm(`범례표 ${W.legends.length}개를 모두 삭제합니다.\n범례로 검출된 기호·산출 수량도 지워지고, '산출 제외' 영역이 모두 풀립니다. (영역 집계 내역은 유지)`)) return; const r = await api(`/api/projects/${W.pid}/legends`, { method: "DELETE" }); toast(`범례표 ${r.deleted}개 삭제`); W.sel = null; refreshAll(); }
async function delLegendRow(id) { if (!confirm("이 범례 행을 삭제합니다.")) return; await api(`/api/projects/${W.pid}/legends/symbols/${id}`, { method: "DELETE" }); if (W.sel && W.sel.id === id) W.sel = null; refreshAll(); }
function selectLegend(id) { W.sel = { type: "legend", id }; renderLeft(); renderRight(); draw(); }
async function addLegendRow(tid) {
  const block = prompt("CAD 블록명 (또는 비우고 기호명 입력)"); const sym = block ? "" : prompt("기호명(도면 문자 라벨)");
  if (!block && !sym) return;
  const item = prompt("품명"); const spec = prompt("규격"); const unit = prompt("단위", "개");
  const category = prompt("범주 (device|conduit|tray|cable)", "device"); const layer_hint = category !== "device" ? prompt("선로 레이어명(선형 기호일 때)") : null;
  await api(`/api/projects/${W.pid}/legends/${tid}/symbols`, { method: "POST", json: { block_name: block || null, symbol_name: sym || null, item_name: item, spec, unit, category, layer_hint } });
  refreshAll();
}

function leftQty() {
  const groups = {};
  for (const q of W.items) (groups[q.discipline || "미분류"] = groups[q.discipline || "미분류"] || []).push(q);
  let h = `<div class="row"><button class="sm" onclick="api('/api/projects/${W.pid}/takeoff/recompute',{method:'POST'}).then(refreshAll)">재계산</button><button class="sm" onclick="snapshot()">리비전 저장</button><button class="sm" onclick="showDiff()">변경 비교</button><select id="qgroup" onchange="renderLeft()"><option value="discipline">공종별</option><option value="floor">층·구간별</option></select></div>`;
  if (!W.items.length) h += `<p class="muted">산출된 물량이 없습니다. 범례 승인 후 '자동 물량산출 실행' 을 누르거나, 상단 '▣ 영역 집계(드래그)' 로 직접 세십시오.</p>`;
  if ((W.tallies || []).length) {
    h += `<h3>수동 영역 집계 내역 (${W.tallies.length})</h3><table><tr><th>도면</th><th>품명</th><th>규격</th><th>수량</th><th></th></tr>` + W.tallies.map(t => `<tr><td class="small">${esc(t.drawing_no || "")}</td><td>${esc(t.item_name)}</td><td class="small">${esc(t.spec || "")}</td><td class="num">${fmt(t.qty)} ${esc(t.unit)}</td><td><button class="sm" onclick="showTally(${t.id})">위치</button><button class="sm err" onclick="if(confirm('이 집계 내역을 삭제합니다.'))api('/api/projects/${W.pid}/tallies/${t.id}',{method:'DELETE'}).then(refreshAll)">×</button></td></tr>`).join("") + `</table>`;
  }
  for (const [g, qs] of Object.entries(groups)) {
    h += `<h3>${esc(g)}</h3><table><tr><th>품명</th><th>규격</th><th>단위</th><th>수량</th><th></th></tr>`;
    for (const q of qs) h += `<tr class="${W.sel && W.sel.type === "item" && W.sel.id === q.id ? "sel" : ""}" onclick="selectItem(${q.id})"><td>${esc(q.item_name)}${q.install_type !== "new" ? ` <span class="badge">${INST[q.install_type]}</span>` : ""}</td><td class="small">${esc(q.spec || "")}</td><td>${esc(q.unit)}</td><td class="num">${fmt(q.qty_total)}</td><td><span class="badge ${q.status}">${KO[q.status]}</span></td></tr>`;
    h += `</table>`;
  }
  return h;
}
function selectItem(id) { const q = W.items.find(x => x.id === id); W.sel = { type: "item", id }; const ev = q.evidence[0]; if (ev && (!W.sheet || W.sheet.id !== ev.sheet_id)) openSheet(ev.sheet_id).then(() => { renderLeft(); renderRight(); draw(); }); else { renderLeft(); renderRight(); draw(); } }
async function snapshot() { const reason = prompt("리비전 사유", "도면 변경 전 저장"); if (reason === null) return; const r = await api(`/api/projects/${W.pid}/takeoff/snapshot?reason=${encodeURIComponent(reason)}`, { method: "POST" }); toast(`리비전 ${r.revision_no} 저장 (${r.items}행)`); }
async function showDiff() {
  const revs = await api(`/api/projects/${W.pid}/takeoff/revisions`);
  if (!revs.length) return toast("저장된 리비전이 없습니다. 먼저 '리비전 저장' 을 하십시오.", true);
  const a = prompt("비교할 이전 리비전 번호 " + revs.map(r => `${r.revision_no}(${r.reason || ""})`).join(", "), revs[revs.length - 1].revision_no);
  if (!a) return;
  const rows = await api(`/api/projects/${W.pid}/takeoff/diff?a=${a}`);
  $("#right").innerHTML = `<h2>물량 변경 비교 (리비전 ${a} → 현재)</h2><table><tr><th>품명</th><th>규격</th><th>기존</th><th>변경후</th><th>증가</th><th>감소</th><th>도면</th></tr>${rows.map(r => `<tr><td>${esc(r.item_name)}</td><td>${esc(r.spec || "")}</td><td class="num">${fmt(r.before)}</td><td class="num">${fmt(r.after)}</td><td class="num">${fmt(r.increase)}</td><td class="num">${fmt(r.decrease)}</td><td>${(r.drawing_nos || []).join(",")}</td></tr>`).join("")}</table>${rows.length ? "" : "<p class='muted'>변경 없음</p>"}`;
}

function leftReview() {
  let h = `<div class="small muted">AI 가 임의로 일치시키지 않은 항목입니다. 확인 후 해결 처리하십시오.</div>`;
  for (const i of W.issues) h += `<div class="${i.severity === "error" ? "errbox" : "warnbox"}" style="${i.resolved ? "opacity:.5" : ""}"><b>${esc(i.code)}</b> ${esc(i.message)} ${i.sheet_id ? `<button class="sm" onclick="openSheet(${i.sheet_id})">도면</button>` : ""} ${i.resolved ? "" : `<button class="sm ok" onclick="api('/api/projects/${W.pid}/takeoff/issues/${i.id}/resolve',{method:'PUT'}).then(refreshAll)">해결</button>`}</div>`;
  const pend = W.items.filter(q => ["review", "insufficient", "impossible"].includes(q.status));
  if (pend.length) h += `<h3>미확정 물량 (${pend.length})</h3>` + pend.map(q => `<div class="warnbox" onclick="selectItem(${q.id})">${esc(q.item_name)} ${esc(q.spec || "")}: ${KO[q.status]} — ${esc(q.note || q.formula || "")}</div>`).join("");
  return h || "<p class='muted'>검토 항목 없음</p>";
}

/* ---------------- 적산 (5단계) ---------------- */
const E = { norms: [], mats: [], labor: [], est: null, rates: null, mapping: {} };
const DEFAULT_RATES = ["간접노무비", "산재보험료", "고용보험료", "건강보험료", "연금보험료", "노인장기요양보험료", "산업안전보건관리비", "환경보전비", "퇴직공제부금비", "기타경비", "일반관리비", "이윤"];
async function loadEstimate() {
  [E.norms, E.mats, E.labor, E.est] = await Promise.all([api("/api/norms"), api("/api/materials"), api("/api/labor-rates"), api(`/api/projects/${W.pid}/estimate`)]);
  if (E.est) { E.mapping = E.est.mapping || {}; E.rates = E.est.rates; E.vat = E.est.vat_pct; }
  if (!E.rates) E.rates = Object.fromEntries(DEFAULT_RATES.map(n => [n, { pct: "", base: n === "이윤" ? "직접공사비+간접비" : (["간접노무비", "산재보험료", "고용보험료", "건강보험료", "연금보험료", "노인장기요양보험료", "퇴직공제부금비"].includes(n) ? "직접노무비" : "직접공사비"), source: "" }]));
  renderEstimateLeft(); renderEstimateRight();
}
function renderEstimateLeft() {
  const el = $("#estLeft"); if (!el) return;
  let h = `<div class="small muted">물량 항목마다 표준품셈·자재단가를 매핑하십시오. 기준정보가 없는 항목은 미산정으로 표시됩니다. (기준정보 등록: 상단 '기준정보(적산)')</div><table><tr><th>품목</th><th>수량</th><th>품셈</th><th>자재</th></tr>`;
  for (const q of W.items) {
    const m = E.mapping[q.id] || {};
    h += `<tr><td>${esc(q.item_name)}<br><span class="small muted">${esc(q.spec || "")}</span></td><td class="num">${fmt(q.qty_total)} ${esc(q.unit)}</td>
    <td><select onchange="setMap(${q.id},'norm_code',this.value)" style="max-width:120px"><option value="">(없음)</option>${E.norms.map(n => `<option value="${esc(n.code)}" ${m.norm_code === n.code ? "selected" : ""}>${esc(n.code)} ${esc(n.title)}</option>`).join("")}</select></td>
    <td><select onchange="setMap(${q.id},'material_id',+this.value||null)" style="max-width:120px"><option value="">(없음)</option>${E.mats.map(x => `<option value="${x.id}" ${m.material_id === x.id ? "selected" : ""}>${esc(x.item_name)} ${esc(x.spec || "")} ${x.price ?? "단가없음"}</option>`).join("")}</select></td></tr>`;
  }
  h += `</table><div class="row"><button class="sm" onclick="autoMap()">품명·규격 자동 매핑</button></div>`;
  el.innerHTML = h;
}
function setMap(id, k, v) { E.mapping[id] = { ...(E.mapping[id] || {}), [k]: v || null }; }
function autoMap() {
  const norm = s => (s || "").replace(/\s/g, "").toUpperCase();
  for (const q of W.items) {
    const key = norm(q.item_name) + norm(q.spec);
    const m = E.mats.find(x => norm(x.item_name) + norm(x.spec) === key) || E.mats.find(x => norm(x.item_name) === norm(q.item_name));
    const n = E.norms.find(x => norm(x.title).includes(norm(q.item_name)));
    if (m || n) E.mapping[q.id] = { ...(E.mapping[q.id] || {}), ...(m ? { material_id: m.id } : {}), ...(n ? { norm_code: n.code } : {}) };
  }
  renderEstimateLeft(); toast("자동 매핑 완료 — 결과를 확인하십시오");
}
function renderEstimateRight() {
  const R = $("#right"); const r = E.rates; const est = E.est;
  let h = `<h2>원가계산 ${est ? `<span class="badge ${est.finalized ? "verified" : "auto"}">rev ${est.revision_no} ${est.finalized ? "확정" : "미확정"}</span>` : ""}</h2>
  <h3>제경비 비율 (근거 없는 항목은 미산정)</h3><table><tr><th>비목</th><th>%</th><th>기준</th><th>적용 근거</th></tr>`;
  for (const [n, c] of Object.entries(r)) h += `<tr><td>${esc(n)}</td><td><input type="number" step="0.01" style="width:60px" value="${c.pct ?? ""}" onchange="E.rates['${esc(n)}'].pct=this.value"></td><td><select onchange="E.rates['${esc(n)}'].base=this.value">${["직접노무비", "직접공사비", "재료비", "직접공사비+간접비"].map(b => `<option ${b === c.base ? "selected" : ""}>${b}</option>`).join("")}</select></td><td><input style="width:120px" placeholder="예: 조달청 2026 제비율" value="${esc(c.source || "")}" onchange="E.rates['${esc(n)}'].source=this.value"></td></tr>`;
  h += `</table><div class="row">부가세 <input type="number" id="e_vat" value="${E.vat ?? 10}" style="width:60px">% <button class="primary" onclick="computeEstimate()">원가 계산</button></div>`;
  if (est && est.lines) {
    const won = v => v === null || v === undefined ? "<span class='muted'>미산정</span>" : Math.round(v).toLocaleString();
    h += `<h3>결과</h3><div class="kv"><b>직접재료비</b><span>${won(est.direct_material)}</span><b>관급자재(별도)</b><span>${won(est.gov_material)}</span><b>직접노무비</b><span>${won(est.direct_labor)}</span>`;
    for (const [n, o] of Object.entries(est.overhead || {})) h += `<b>${esc(n)}</b><span>${won(o.amount)} ${o.note ? `<span class="small muted">${esc(o.note)}</span>` : ""}</span>`;
    h += `<b>공급가액</b><span>${won(est.supply)}</span><b>부가세</b><span>${won(est.vat)}</span><b>총공사비</b><span><b>${won(est.total)}</b></span></div>`;
    if (est.note) h += `<div class="warnbox">${esc(est.note)}</div>`;
    h += `<div class="row"><button onclick="dl('/api/projects/${W.pid}/estimate/${est.id}/xlsx','원가계산서.xlsx')">원가계산서 Excel</button><button class="ok" ${est.finalizable && !est.finalized ? "" : "disabled"} onclick="api('/api/projects/${W.pid}/estimate/${est.id}/finalize',{method:'POST'}).then(()=>{toast('원가내역서 확정');loadEstimate()})">확정</button></div>`;
    h += `<h3>품목별</h3><table><tr><th>품목</th><th>재료비</th><th>노무비</th><th>비고</th></tr>${est.lines.map(L => `<tr><td>${esc(L.item_name)}<br><span class="small muted">${esc(L.spec || "")} ${fmt(L.qty)} ${esc(L.unit || "")}</span></td><td class="num">${won(L.material_cost)}</td><td class="num">${won(L.labor_cost)}</td><td class="small">${(L.notes || []).map(esc).join("<br>")}</td></tr>`).join("")}</table>`;
  }
  R.innerHTML = h;
}
async function computeEstimate() {
  const rates = {}; for (const [n, c] of Object.entries(E.rates)) if (c.pct !== "" && c.pct !== null) rates[n] = { pct: +c.pct, base: c.base, source: c.source || "" };
  const r = await api(`/api/projects/${W.pid}/estimate`, { method: "POST", json: { rates, vat_pct: +$("#e_vat").value, mapping: E.mapping } });
  toast(`원가계산 rev ${r.revision_no} 저장`); await loadEstimate();
}

/* ---------------- 우측 패널 ---------------- */
function renderRight() {
  const R = $("#right"); if (!R) return;
  if (W.tally && W.sheet && W.tally.sheet_id === W.sheet.id) { R.innerHTML = tallyPanel(); drawTallyMinis(); return; }
  const sel = W.sel;
  if (!sel) { R.innerHTML = W.sheet ? sheetPanel() : `<p class="muted">도면·기호·물량을 선택하면 상세 정보와 수정 기능이 표시됩니다.</p>`; return; }
  if (sel.type === "det") {
    const d = W.dets.find(x => x.id === sel.id); if (!d) { W.sel = null; return renderRight(); }
    const ls = W.legends.flatMap(t => t.symbols).find(s => s.id === d.legend_symbol_id) || {};
    R.innerHTML = `<h2>검출 기호 #${d.seq_no} <span class="badge ${d.status}">${KO[d.status]}</span></h2>
    <div class="kv"><b>품명</b><span>${esc(ls.item_name)}</span><b>규격</b><span>${esc(ls.spec)}</span><b>단위</b><span>${esc(ls.unit)}</span><b>방법</b><span>${d.method} (${(d.confidence * 100).toFixed(0)}%)</span><b>좌표</b><span>${d.x.toFixed(1)}, ${d.y.toFixed(1)}</span><b>CAD핸들</b><span>${esc(d.handle || "-")}</span><b>구분</b><span>${INST[d.install_type]}</span><b>층·구간</b><span>${esc(d.floor_zone || "-")}</span></div>
    <h3>수정</h3><div class="row"><select id="d_sym">${W.legends.flatMap(t => t.symbols).filter(s => s.category === "device").map(s => `<option value="${s.id}" ${s.id === d.legend_symbol_id ? "selected" : ""}>${esc(s.item_name || s.block_name)} ${esc(s.spec || "")}</option>`).join("")}</select>
    <select id="d_inst">${Object.entries(INST).map(([k, v]) => `<option value="${k}" ${k === d.install_type ? "selected" : ""}>${v}</option>`).join("")}</select><input id="d_fz" placeholder="층·구간" value="${esc(d.floor_zone || "")}" style="width:90px"></div>
    <div class="row"><button class="ok" onclick="updDet(${d.id},{status:'verified'})">승인</button><button class="err" onclick="updDet(${d.id},{status:'excluded'})">제외(오검출)</button><button onclick="updDet(${d.id},{legend_symbol_id:+$('#d_sym').value,install_type:$('#d_inst').value,floor_zone:$('#d_fz').value||null})">변경 저장</button></div>
    <h3>일괄</h3><div class="row"><button class="sm ok" onclick="bulk('verified')">이 도면의 같은 품목 모두 승인</button></div>`;
    return;
  }
  if (sel.type === "route") {
    const r = W.routes.find(x => x.id === sel.id); if (!r) { W.sel = null; return renderRight(); }
    const ls = W.legends.flatMap(t => t.symbols).find(s => s.id === r.legend_symbol_id) || {};
    const cables = W.legends.flatMap(t => t.symbols).filter(s => s.category === "cable");
    R.innerHTML = `<h2>선로 ${esc(r.name)} <span class="badge ${r.status}">${KO[r.status]}</span></h2>
    <div class="kv"><b>구분</b><span>${CAT[r.kind]}</span><b>품명</b><span>${esc(ls.item_name)} ${esc(ls.spec || "")}</span><b>구간수</b><span>${r.segment_count}</span><b>도면길이</b><span>${fmt(r.horizontal_m)} m</span><b>수직(입상)</b><span>${fmt(r.vertical_m)} m</span><b>여장</b><span>${fmt(r.slack_m)} m</span></div>
    <div class="row"><input type="number" id="r_v" placeholder="입상 m" value="${r.vertical_m ?? ""}"><input type="number" id="r_s" placeholder="여장 m" value="${r.slack_m ?? ""}"><button onclick="api('/api/projects/${W.pid}/takeoff/routes/${r.id}',{method:'PUT',json:{vertical_m:num('#r_v'),slack_m:num('#r_s')}}).then(refreshAll)">저장</button><button class="ok" onclick="api('/api/projects/${W.pid}/takeoff/routes/${r.id}',{method:'PUT',json:{status:'verified'}}).then(refreshAll)">승인</button></div>
    <div class="small muted">입상·여장은 도면·시방서 근거가 없으면 비워 두십시오(미확정으로 표시됩니다).</div>
    <h3>구간</h3><table><tr><th>#</th><th>레이어</th><th>길이</th><th>상태</th></tr>${r.segments.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.layer)}</td><td class="num">${fmt(s.length_m)}</td><td>${s.dup_of ? `<span class="badge review">중복의심</span> <button class="sm" onclick="segStatus(${s.id},'excluded')">중복(제외)</button><button class="sm" onclick="segStatus(${s.id},'verified')">별도선로(포함)</button>` : `<span class="badge ${s.status}">${KO[s.status]}</span>`}</td></tr>`).join("")}</table>
    ${r.kind !== "cable" ? `<h3>케이블 회선 (이 경로 사용)</h3><table><tr><th>케이블</th><th>회선</th><th></th></tr>${r.circuits.map(c => { const cs = cables.find(s => s.id === c.cable_symbol_id) || {}; return `<tr><td>${esc(cs.item_name)} ${esc(cs.spec || "")}</td><td class="num">${c.circuit_count}${c.confirmed ? "" : " (미확정)"}</td><td><button class="sm err" onclick="api('/api/projects/${W.pid}/takeoff/circuits/${c.id}',{method:'DELETE'}).then(refreshAll)">×</button></td></tr>`; }).join("")}</table>
    <div class="row"><select id="c_sym">${cables.map(s => `<option value="${s.id}">${esc(s.item_name)} ${esc(s.spec || "")}</option>`).join("")}</select><input type="number" id="c_n" value="1" min="1" style="width:60px"> 회선 <button class="primary sm" onclick="api('/api/projects/${W.pid}/takeoff/circuits',{method:'POST',json:{route_id:${r.id},cable_symbol_id:+$('#c_sym').value,circuit_count:+$('#c_n').value,confirmed:true}}).then(refreshAll)">회선 확정</button></div>
    <div class="small muted">케이블 = 경로길이 × 회선수. 전선관 길이는 변하지 않습니다. 광케이블 심수(12C 등)는 회선 수가 아닙니다.</div>` : ""}`;
    return;
  }
  if (sel.type === "legend") {
    const s = W.legends.flatMap(t => t.symbols).find(x => x.id === sel.id); if (!s) { W.sel = null; return renderRight(); }
    R.innerHTML = `<h2>범례 기호 <span class="badge ${s.status}">${KO[s.status]}</span></h2><div class="legend-edit kv">
    <b>기호명</b><input id="g_sym" value="${esc(s.symbol_name || "")}"><b>CAD블록</b><input id="g_blk" value="${esc(s.block_name || "")}"><b>품명</b><input id="g_item" value="${esc(s.item_name || "")}"><b>규격</b><input id="g_spec" value="${esc(s.spec || "")}"><b>단위</b><input id="g_unit" value="${esc(s.unit || "")}">
    <b>공종</b><select id="g_disc">${["", "전기", "정보통신", "소방전기", "CCTV", "광통신", "방송설비", "접지·피뢰", "옥외"].map(d => `<option ${d === (s.discipline || "") ? "selected" : ""}>${d}</option>`).join("")}</select>
    <b>범주</b><select id="g_cat">${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${k === s.category ? "selected" : ""}>${v}</option>`).join("")}</select><b>선로 레이어</b><input id="g_layer" value="${esc(s.layer_hint || "")}" placeholder="선형 기호일 때 레이어명"></div>
    <div class="kv"><b>신뢰도</b><span>${(s.confidence * 100).toFixed(0)}%</span><b>도면 검출</b><span>${s.detected_count}개</span><b>지문</b><span class="small">${s.fingerprint ? `선${s.fingerprint.lines} 원${s.fingerprint.circles} 호${s.fingerprint.arcs} 문자${(s.fingerprint.texts || []).join("")}` : "-"}</span><b>원문</b><span class="small muted">${esc((s.extra.texts || []).join(" | "))}</span></div>
    <div class="row"><label><input type="checkbox" id="g_lib"> 회사 공통 라이브러리에도 저장</label></div>
    <div class="row"><button class="primary" onclick="saveLegend(${s.id},'edited')">수정 저장</button><button class="ok" onclick="saveLegend(${s.id},'approved')">승인</button><button class="err" onclick="if(confirm('삭제?'))api('/api/projects/${W.pid}/legends/symbols/${s.id}',{method:'DELETE'}).then(refreshAll)">삭제</button></div>
    <div class="small muted">수정 후 '자동 물량산출 실행' 을 다시 누르면 재산출됩니다. 사용자가 승인/제외한 검출은 보존됩니다.<br>범례 그림과 도면 기호 모양이 다르면 상단 <b>'도면에서 기호 지정'</b> 으로 도면 위 기호를 한 번 클릭해 등록하십시오.</div>`;
    return;
  }
  if (sel.type === "item") {
    const q = W.items.find(x => x.id === sel.id); if (!q) { W.sel = null; return renderRight(); }
    R.innerHTML = `<h2>${esc(q.item_name)} <span class="badge ${q.status}">${KO[q.status]}</span></h2>
    <div class="kv"><b>공종</b><span>${esc(q.discipline || "")} ${esc(q.sub_discipline || "")}</span><b>규격</b><span>${esc(q.spec || "")}</span><b>단위</b><span>${esc(q.unit)}</span><b>산출식</b><span class="small">${esc(q.formula || "")}</span>
    <b>도면길이/수량</b><span>${fmt(q.qty_drawing)}</span><b>수직</b><span>${fmt(q.qty_vertical)}</span><b>여장</b><span>${fmt(q.qty_slack)}</span><b>할증</b><span>${fmt(q.qty_markup)}</span><b>합계</b><span><b>${fmt(q.qty_total)}</b></span><b>도면</b><span>${(q.drawing_nos || []).join(", ")}</span><b>근거</b><span>${q.evidence.length}건 (도면에 강조 표시)</span></div>
    ${q.note ? `<div class="warnbox">${esc(q.note)}</div>` : ""}
    <h3>사용자 수정</h3><div class="row"><input type="number" id="q_total" value="${q.qty_total ?? ""}" placeholder="합계"><input id="q_note" placeholder="사유" value="${esc(q.note || "")}" style="width:140px"><button onclick="api('/api/projects/${W.pid}/takeoff/items/${q.id}',{method:'PUT',json:{qty_total:num('#q_total'),note:$('#q_note').value}}).then(refreshAll)">저장</button><button class="ok" onclick="api('/api/projects/${W.pid}/takeoff/items/${q.id}',{method:'PUT',json:{status:'verified'}}).then(refreshAll)">검증 완료</button></div>`;
    return;
  }
}
function sheetPanel() {
  const s = W.sheet;
  return `<h2>${esc(s.drawing_no || "")} ${esc(s.drawing_title || s.sheet_name)}</h2>
  <div class="kv"><b>파일</b><span>${esc(s.file.name)}</span><b>형식</b><span>${s.source_kind}</span><b>단위</b><span>${s.units || "?"}</span><b>축척계수</b><span>${s.scale_factor ?? "-"} (도면단위→m) ${s.scale_confirmed ? "<span class='badge verified'>확정</span>" : "<span class='badge review'>미확정</span>"}</span><b>객체</b><span class="small">${esc(JSON.stringify(s.stats).slice(0, 120))}</span></div>
  <h3>도면 메타데이터</h3><div class="legend-edit kv"><b>도면번호</b><input id="s_no" value="${esc(s.drawing_no || "")}"><b>도면명</b><input id="s_title" value="${esc(s.drawing_title || "")}"><b>종류</b><select id="s_type">${["", "평면도", "계통도", "일람표", "범례", "결선도", "포설도", "배치도"].map(t => `<option ${t === (s.drawing_type || "") ? "selected" : ""}>${t}</option>`).join("")}</select><b>공종</b><select id="s_disc">${["", "전기", "정보통신", "소방전기"].map(t => `<option ${t === (s.discipline || "") ? "selected" : ""}>${t}</option>`).join("")}</select><b>층·구역</b><input id="s_fz" value="${esc(s.floor_zone || "")}"></div>
  <div class="row"><button onclick="api('/api/projects/${W.pid}/sheets/${s.id}',{method:'PUT',json:{drawing_no:$('#s_no').value,drawing_title:$('#s_title').value,drawing_type:$('#s_type').value||null,discipline:$('#s_disc').value||null,floor_zone:$('#s_fz').value||null}}).then(refreshAll)">저장</button></div>
  <div class="small muted">계통도·일람표·범례 시트의 기호는 설치 수량에 합산되지 않고 교차검증에만 사용됩니다.</div>
  <h3>축척 확정</h3><div class="row"><input type="number" id="sc_f" step="any" placeholder="축척계수(도면단위→m)" value="${s.scale_factor ?? ""}"><button onclick="api('/api/projects/${W.pid}/sheets/${s.id}/scale',{method:'POST',json:{scale_factor:num('#sc_f')}}).then(refreshAll)">계수 확정</button></div>
  <div class="small muted">또는 상단 '거리 측정/축척' 으로 도면에서 두 점을 찍고 실제 거리를 입력하십시오. 축척 미확정 시 길이는 산출되지 않습니다.</div>
  <h3>프로젝트 산출 설정</h3><div class="row"><input type="number" id="mk_conduit" placeholder="전선관 할증%" value="${(W.project.takeoff_settings.markup_pct || {}).conduit ?? ""}"><input type="number" id="mk_cable" placeholder="케이블 할증%" value="${(W.project.takeoff_settings.markup_pct || {}).cable ?? ""}"><input type="number" id="mk_tray" placeholder="트레이 할증%" value="${(W.project.takeoff_settings.markup_pct || {}).tray ?? ""}"><button onclick="saveSettings()">저장</button></div><div class="small muted">근거(시방서 등)가 없으면 비워 두십시오. 비우면 할증은 미확정으로 표시됩니다.</div>`;
}
const num = (sel) => { const v = $(sel).value; return v === "" ? null : +v; };
async function saveSettings() { const mk = { conduit: num("#mk_conduit"), cable: num("#mk_cable"), tray: num("#mk_tray") }; for (const k in mk) if (mk[k] === null) delete mk[k]; W.project = await api(`/api/projects/${W.pid}`, { method: "PUT", json: { takeoff_settings: { ...W.project.takeoff_settings, markup_pct: mk } } }); await api(`/api/projects/${W.pid}/takeoff/recompute`, { method: "POST" }); refreshAll(); }
async function updDet(id, json) { await api(`/api/projects/${W.pid}/takeoff/symbols/${id}`, { method: "PUT", json }); refreshAll(); }
async function bulk(status) { const d = W.dets.find(x => x.id === W.sel.id); const ids = W.dets.filter(x => x.legend_symbol_id === d.legend_symbol_id && x.status !== "excluded").map(x => x.id); await api(`/api/projects/${W.pid}/takeoff/symbols/bulk?status=${status}`, { method: "POST", json: ids }); refreshAll(); }
async function segStatus(id, status) { await api(`/api/projects/${W.pid}/takeoff/segments/${id}?status=${status}`, { method: "PUT" }); refreshAll(); }
async function saveLegend(id, status) { await api(`/api/projects/${W.pid}/legends/symbols/${id}`, { method: "PUT", json: { symbol_name: $("#g_sym").value || null, block_name: $("#g_blk").value || null, item_name: $("#g_item").value || null, spec: $("#g_spec").value || null, unit: $("#g_unit").value || null, discipline: $("#g_disc").value || null, category: $("#g_cat").value, layer_hint: $("#g_layer").value || null, status, save_to_library: $("#g_lib").checked } }); refreshAll(); }
async function waitJob(jobId, label) {
  const box = document.createElement("div"); box.className = "jobbox"; document.body.appendChild(box);
  try {
    for (;;) {
      const j = await api(`/api/projects/${W.pid}/jobs/${jobId}`);
      box.innerHTML = `<b>${esc(label)}</b> ${j.progress}% <div class="prog"><i style="width:${j.progress}%"></i></div><span class="small">${esc(j.message || "")}</span>`;
      if (j.status === "done") return j.result;
      if (j.status === "failed") { toast(`${label} 실패: ${j.error}`, true); throw new Error(j.error); }
      await new Promise(r => setTimeout(r, 1500));
    }
  } finally { box.remove(); }
}
async function runTakeoff() {
  const { job_id } = await api(`/api/projects/${W.pid}/takeoff/run`, { method: "POST" });
  const r = await waitJob(job_id, "자동 물량산출");
  toast(`검출 ${r.detection.detected}개 (보존 ${r.detection.preserved}), 선로 ${r.routes.routes}개, 물량 ${r.items}행, 교차검증 이슈 ${r.cross_issues}건`); refreshAll();
}
async function runLegendAuto() {
  const { job_id } = await api(`/api/projects/${W.pid}/legends/auto`, { method: "POST" });
  const r = await waitJob(job_id, "범례표 자동 인식");
  toast(`범례표 ${r.created}개 (${r.rows}행) 인식, 라이브러리 보강 ${r.library_hits}건`); refreshAll();
}
function exportXlsx() { dl(`/api/projects/${W.pid}/export/xlsx`, `물량산출조서_${W.project.name}.xlsx`); }
async function dl(url, name) { const r = await fetch(url, { headers: { Authorization: "Bearer " + S.token } }); if (!r.ok) return toast("출력 실패: " + r.status, true); const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click(); }
async function loadAuthImages() { for (const im of document.querySelectorAll("img[data-src]")) { const u = im.dataset.src; delete im.dataset.src; try { const r = await fetch(u, { headers: { Authorization: "Bearer " + S.token } }); if (r.ok) im.src = URL.createObjectURL(await r.blob()); } catch (e) { } } }
async function uploadFiles(files) { const fd = new FormData(); for (const f of files) fd.append("files", f); const r = await api(`/api/projects/${W.pid}/files`, { method: "POST", body: fd }); for (const x of r) if (x.error) toast(`${x.name}: ${x.error}`, true); refreshAll(); }
function dropFiles(e) { e.preventDefault(); uploadFiles(e.dataTransfer.files); }

/* ---------------- 뷰어 ---------------- */
const isNarrow = () => window.matchMedia("(max-width: 1100px)").matches;
const V = { cv: null, ctx: null, scale: 1, tx: 0, ty: 0, drag: null, mouse: null };
function initViewer() {
  V.cv = $("#cv"); V.ctx = V.cv.getContext("2d");
  const ro = new ResizeObserver(() => { V.cv.width = V.cv.clientWidth; V.cv.height = V.cv.clientHeight; draw(); }); ro.observe($("#center"));
  V.cv.addEventListener("wheel", e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const [mx, my] = [e.offsetX, e.offsetY]; V.tx = mx - (mx - V.tx) * f; V.ty = my - (my - V.ty) * f; V.scale *= f; draw(); }, { passive: false });
  // 마우스·터치 공통(Pointer Events). 터치: 한 손가락 = 현재 모드 동작(이동/영역 드래그), 두 손가락 = 이동·확대
  V.ptrs = new Map();
  V.cv.style.touchAction = "none";
  V.cv.addEventListener("contextmenu", e => e.preventDefault());
  const pos = e => { const r = V.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  V.cv.addEventListener("pointerdown", e => {
    try { V.cv.setPointerCapture(e.pointerId); } catch (_) { } const [x, y] = pos(e); V.ptrs.set(e.pointerId, [x, y]);
    if (V.ptrs.size === 2) { const [a, b] = [...V.ptrs.values()]; V.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], scale: V.scale, tx: V.tx, ty: V.ty }; V.drag = null; return; }
    if (V.ptrs.size > 2) return;
    V.drag = { x, y, tx: V.tx, ty: V.ty, moved: false, start: toWorld(x, y), btn: e.pointerType === "mouse" && e.button !== 0 };
  });
  V.cv.addEventListener("pointermove", e => {
    const [x, y] = pos(e); if (V.ptrs.has(e.pointerId)) V.ptrs.set(e.pointerId, [x, y]);
    if (V.pinch && V.ptrs.size >= 2) { const [a, b] = [...V.ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const P = V.pinch, f = d / P.d; V.scale = P.scale * f; V.tx = m[0] - (P.m[0] - P.tx) * f; V.ty = m[1] - (P.m[1] - P.ty) * f; draw(); return; }
    V.mouse = toWorld(x, y);
    if (V.drag && (W.mode === "pan" || V.drag.btn)) { V.tx = V.drag.tx + x - V.drag.x; V.ty = V.drag.ty + y - V.drag.y; }
    if (V.drag && Math.abs(x - V.drag.x) + Math.abs(y - V.drag.y) > 3) V.drag.moved = true;
    draw();
  });
  const endPtr = e => {
    V.ptrs.delete(e.pointerId);
    if (V.pinch) { if (!V.ptrs.size) V.pinch = null; V.drag = null; return; }
    const d = V.drag; V.drag = null; if (!d || d.btn || e.type === "pointercancel") return;
    const [x, y] = pos(e); const p = toWorld(x, y); const moved = Math.abs(x - d.x) + Math.abs(y - d.y) > (e.pointerType === "mouse" ? 6 : 12);
    if (W.mode === "pan") { if (!moved) pick(p); }
    else if (W.mode === "tally") { if (moved) tallyRegion(d.start, p); else tallyToggleAt(p); }
    else if (W.mode === "region") { if (moved) finishRegion(d.start, p); }
    else if (W.mode === "measure") measureClick(p); else if (W.mode === "add") addSymbolAt(p); else if (W.mode === "sample") sampleSymbolAt(p);
  };
  V.cv.addEventListener("pointerup", endPtr); V.cv.addEventListener("pointercancel", endPtr);
}
function toWorld(px, py) { return [(px - V.tx) / V.scale, -(py - V.ty) / V.scale]; }
function toScreen(x, y) { return [x * V.scale + V.tx, -y * V.scale + V.ty]; }
function setMode(m) { W.mode = m; W.pts = []; document.querySelectorAll(".vtools button[id^=m_]").forEach(b => b.classList.toggle("on", b.id === "m_" + m)); V.cv.style.cursor = m === "pan" ? "grab" : "crosshair"; $("#vinfo").textContent = { pan: "클릭: 기호·선로 선택 / 드래그: 이동 / 휠: 확대", region: "표 영역을 드래그하여 범례로 등록", measure: "두 점을 클릭 → 실제 거리(m) 입력 시 축척 확정", tally: "집계할 영역을 드래그 → 영역 안 객체 개수·케이블 선 표시 / 객체 클릭: 개별 제외·포함 / 오른쪽 버튼(휴대폰: 두 손가락) 드래그: 화면 이동", add: "범례 기호를 선택한 뒤 도면을 클릭하면 기호가 추가됩니다", sample: "범례 탭에서 기호를 선택한 뒤, 도면 위 실제 기호 하나를 클릭 → 그 모양으로 전체 검색" }[m]; }
function fitView() { const b = W.sheet && W.sheet.bbox; if (!b) return; const w = b.x1 - b.x0 || 1, h = b.y1 - b.y0 || 1; V.scale = Math.min(V.cv.width / w, V.cv.height / h) * 0.92; V.tx = (V.cv.width - w * V.scale) / 2 - b.x0 * V.scale; V.ty = (V.cv.height + h * V.scale) / 2 + b.y0 * V.scale; draw(); }
async function openSheet(id, focusRegion) {
  const s = W.sheets.find(x => x.id === id); if (!s) return;
  W.sheet = s; W.geo = await api(`/api/projects/${W.pid}/sheets/${id}/geometry`); W.img = null;
  if (s.has_raster) { const im = new Image(); im.onload = () => draw(); const r = await fetch(`/api/projects/${W.pid}/sheets/${id}/raster`, { headers: { Authorization: "Bearer " + S.token } }); if (r.ok) { im.src = URL.createObjectURL(await r.blob()); W.img = im; } }
  [W.dets, W.routes] = await Promise.all([api(`/api/projects/${W.pid}/takeoff/symbols?sheet_id=${id}`), api(`/api/projects/${W.pid}/takeoff/routes?sheet_id=${id}`)]);
  if (!(W.sel && W.sel.type === "item")) W.sel = null;
  renderLeft(); renderRight();
  if (isNarrow()) $("#center").scrollIntoView({ behavior: "smooth", block: "start" });
  fitView();
  if (focusRegion) { const w = focusRegion.x1 - focusRegion.x0, h = focusRegion.y1 - focusRegion.y0; V.scale = Math.min(V.cv.width / w, V.cv.height / h) * 0.8; V.tx = (V.cv.width - w * V.scale) / 2 - focusRegion.x0 * V.scale; V.ty = (V.cv.height + h * V.scale) / 2 + focusRegion.y0 * V.scale; draw(); }
}
const ACI = ["#000", "#f44", "#ff0", "#4f4", "#4ff", "#44f", "#f4f", "#eee", "#999", "#ccc"];
const aciColor = c => (c === null || c === undefined) ? "#ddd" : (ACI[c] || `hsl(${(c * 37) % 360},70%,65%)`);
const symColor = id => `hsl(${(id * 67) % 360},85%,60%)`;
function draw() {
  const c = V.ctx; if (!c) return; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#1e1e1e"; c.fillRect(0, 0, V.cv.width, V.cv.height);
  if (!W.geo) {
    c.fillStyle = "#bbb"; c.font = "15px sans-serif"; c.textAlign = "center";
    const msg = !(W.sheets || []).length ? (busyFiles(W.files) ? "도면 분석 중입니다… 끝나면 자동으로 표시됩니다" : "도면 파일을 올리십시오") : (isNarrow() ? "위쪽 도면 목록에서 📄 도면을 누르십시오" : "왼쪽 도면 목록에서 📄 도면을 누르십시오");
    c.fillText(msg, V.cv.width / 2, V.cv.height / 2); c.textAlign = "start"; return;
  }
  const b = W.sheet.bbox;
  const T = W.tally && W.tally.sheet_id === W.sheet.id ? W.tally : null;
  if (T && T.only) { drawTallyOnly(c, T); return; }
  if (W.img && b) { const [sx, sy] = toScreen(b.x0, b.y1); c.drawImage(W.img, sx, sy, (b.x1 - b.x0) * V.scale, (b.y1 - b.y0) * V.scale); }
  const layerColor = {}; for (const L of W.sheet.layers) layerColor[L.name] = aciColor(L.color);
  c.lineWidth = 1;
  for (const p of W.geo.prims) {
    if (W.hidden.has(p.layer)) continue; if (p.p.length < 2) continue;
    c.strokeStyle = W.img ? "rgba(0,120,255,.35)" : (p.blk ? "#ddd" : (layerColor[p.layer] || "#ccc")); c.beginPath();
    p.p.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke();
  }
  if (V.scale > 0.02 && !W.img) { c.fillStyle = "#bbb"; for (const t of W.geo.texts) { if (W.hidden.has(t.layer)) continue; const h = (t.height || 2.5) * V.scale; if (h < 4) continue; c.font = `${Math.min(h, 40)}px sans-serif`; const [sx, sy] = toScreen(t.x, t.y); c.fillText(t.text, sx, sy); } }
  // 범례 영역
  for (const t of W.legends) if (t.sheet_id === W.sheet.id && t.region) { const r = t.region; const [x0, y0] = toScreen(r.x0, r.y1), [x1, y1] = toScreen(r.x1, r.y0); c.setLineDash([6, 4]); c.strokeStyle = "#ffd166"; c.lineWidth = 2; c.strokeRect(x0, y0, x1 - x0, y1 - y0); c.setLineDash([]); c.fillStyle = "#ffd166"; c.font = "12px sans-serif"; c.fillText("범례(산출 제외) " + t.title, x0, y0 - 4); }
  // 선로
  if (W.showRoutes) for (const r of W.routes) { const on = W.sel && ((W.sel.type === "route" && W.sel.id === r.id) || (W.sel.type === "item" && itemHas(W.sel.id, { route_id: r.id }))); c.lineWidth = on ? 5 : 3; c.strokeStyle = on ? "#ff6a00" : (r.kind === "cable" ? "#4ade80" : r.kind === "tray" ? "#c084fc" : "#38bdf8"); for (const s of r.segments) { c.setLineDash(s.dup_of ? [4, 4] : []); c.beginPath(); s.points.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); c.setLineDash([]); if (s.length_m !== null && V.scale > 0.004) { const m = s.points[Math.floor(s.points.length / 2)]; const [sx, sy] = toScreen(m[0], m[1]); c.fillStyle = "#fff"; c.font = "11px sans-serif"; c.fillText(s.length_m.toFixed(2) + "m", sx + 4, sy - 4); } } }
  // 검출 기호
  if (W.showDets) for (const d of W.dets) { const [sx, sy] = toScreen(d.x, d.y); const on = W.sel && ((W.sel.type === "det" && W.sel.id === d.id) || (W.sel.type === "legend" && W.sel.id === d.legend_symbol_id) || (W.sel.type === "item" && itemHas(W.sel.id, { detected_symbol_id: d.id }))); const col = d.status === "excluded" ? "#777" : symColor(d.legend_symbol_id); const R = on ? 11 : 8; c.beginPath(); c.arc(sx, sy, R, 0, Math.PI * 2); c.fillStyle = on ? "#ff6a00" : col; c.globalAlpha = .85; c.fill(); c.globalAlpha = 1; if (d.status === "review") { c.strokeStyle = "#ffd166"; c.lineWidth = 2; c.stroke(); } if (d.status === "excluded") { c.strokeStyle = "#fff"; c.beginPath(); c.moveTo(sx - 5, sy - 5); c.lineTo(sx + 5, sy + 5); c.moveTo(sx + 5, sy - 5); c.lineTo(sx - 5, sy + 5); c.stroke(); } c.fillStyle = "#000"; c.font = "bold 10px sans-serif"; c.textAlign = "center"; c.fillText(d.seq_no, sx, sy + 3.5); c.textAlign = "start"; }
  if (T) drawTallyMarks(c, T);
  // 영역/측정 드래그
  if (V.drag && (W.mode === "region" || W.mode === "tally") && V.mouse) { const [x0, y0] = toScreen(...V.drag.start), [x1, y1] = toScreen(...V.mouse); c.strokeStyle = "#ffd166"; c.setLineDash([4, 4]); c.strokeRect(x0, y0, x1 - x0, y1 - y0); c.setLineDash([]); }
  if (W.mode === "measure" && W.pts.length) { const [x0, y0] = toScreen(...W.pts[0]), [x1, y1] = toScreen(...(V.mouse || W.pts[0])); c.strokeStyle = "#ff6a00"; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); const d = Math.hypot(V.mouse[0] - W.pts[0][0], V.mouse[1] - W.pts[0][1]); c.fillStyle = "#fff"; c.fillText(`${d.toFixed(1)} 도면단위${W.sheet.scale_factor ? ` = ${(d * W.sheet.scale_factor).toFixed(2)} m` : ""}`, x1 + 8, y1); }
  if (V.mouse) $("#vinfo").textContent = `X ${V.mouse[0].toFixed(1)}  Y ${V.mouse[1].toFixed(1)}  (${W.sheet.units || "?"})  배율 ${V.scale.toFixed(4)}`;
}
function itemHas(itemId, key) { const q = W.items.find(x => x.id === itemId); if (!q) return false; const [k, v] = Object.entries(key)[0]; return q.evidence.some(e => e[k] === v); }
function pick(p) {
  const tol = 10 / V.scale; let best = null, bd = tol;
  for (const d of W.dets) { const dd = Math.hypot(d.x - p[0], d.y - p[1]); if (dd < bd) { bd = dd; best = { type: "det", id: d.id }; } }
  if (!best) for (const r of W.routes) for (const s of r.segments) for (let i = 0; i < s.points.length - 1; i++) { const dd = segDist(p, s.points[i], s.points[i + 1]); if (dd < bd) { bd = dd; best = { type: "route", id: r.id }; } }
  W.sel = best; renderRight(); renderLeft(); draw();
}
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const l2 = dx * dx + dy * dy; let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)); }
async function finishRegion(a, b) {
  const region = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
  if (region.x1 - region.x0 < 1e-6) return;
  const sb = W.sheet.bbox, ratio = (region.x1 - region.x0) * (region.y1 - region.y0) / Math.max((sb.x1 - sb.x0) * (sb.y1 - sb.y0), 1e-9);
  let force = false;
  if (ratio > 0.35) {
    if (!confirm(`지정한 영역이 도면의 ${Math.round(ratio * 100)}% 입니다.\n범례 영역 안의 기호는 수량에서 빠지므로, 보통은 범례 '표'만 작게 지정합니다.\n기호 개수를 세려면 '영역 집계'를 쓰십시오.\n\n그래도 이 영역을 범례로 지정할까요?`)) return;
    force = true;
  }
  const title = prompt("범례표 이름", "사용자 지정 범례"); if (title === null) return;
  const t = await api(`/api/projects/${W.pid}/legends/region${force ? "?force=1" : ""}`, { method: "POST", json: { sheet_id: W.sheet.id, region, title } });
  toast(`범례 행 ${t.symbols.length}개 추출`); W.tab = "legend"; setMode("pan"); refreshAll();
}
async function measureClick(p) {
  W.pts.push(p); if (W.pts.length < 2) return draw();
  const d = Math.hypot(W.pts[1][0] - W.pts[0][0], W.pts[1][1] - W.pts[0][1]);
  const m = prompt(`두 점 거리 = ${d.toFixed(2)} 도면단위${W.sheet.scale_factor ? ` (현재 축척으로 ${(d * W.sheet.scale_factor).toFixed(2)} m)` : ""}\n실제 거리(m)를 입력하면 이 시트의 축척을 확정합니다. 취소하면 측정만 합니다.`);
  if (m && +m > 0) { await api(`/api/projects/${W.pid}/sheets/${W.sheet.id}/scale`, { method: "POST", json: { ref_points: W.pts, ref_length_m: +m } }); toast("축척 확정. '자동 물량산출 실행' 으로 길이를 재산출하십시오."); }
  W.pts = []; refreshAll();
}
async function sampleSymbolAt(p) {
  if (!(W.sel && W.sel.type === "legend")) return toast("먼저 범례 탭에서 기호를 선택하십시오.", true);
  const r = await api(`/api/projects/${W.pid}/legends/symbols/${W.sel.id}/sample`, { method: "POST", json: { sheet_id: W.sheet.id, legend_symbol_id: W.sel.id, x: p[0], y: p[1] } });
  toast(`기호 등록: 도형 ${r.prims}개, 스타일 ${(r.layers || []).join(", ")} — '자동 물량산출 실행' 으로 검색하십시오`); setMode("pan"); refreshAll();
}
async function addSymbolAt(p) {
  if (!(W.sel && W.sel.type === "legend")) return toast("먼저 범례 탭에서 추가할 기호를 선택하십시오.", true);
  await api(`/api/projects/${W.pid}/takeoff/symbols/manual`, { method: "POST", json: { sheet_id: W.sheet.id, legend_symbol_id: W.sel.id, x: p[0], y: p[1] } }); refreshAll();
}
function drawMini(cv) {
  const blk = cv.dataset.block; const geo = W.geo; const def = geo && geo.blocks && geo.blocks[blk]; if (!def) return;
  cv.width = 120; cv.height = 72; const c = cv.getContext("2d"); const pts = def.prims.flatMap(p => p.p); if (!pts.length) return;
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); const s = Math.min(110 / (x1 - x0 || 1), 62 / (y1 - y0 || 1));
  c.strokeStyle = "#222"; c.lineWidth = 1.2; for (const p of def.prims) { c.beginPath(); p.p.forEach(([x, y], i) => { const sx = 5 + (x - x0) * s, sy = 67 - (y - y0) * s; i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); }
}


/* ---------------- 수동 영역 집계 ---------------- */
const TCOL = i => `hsl(${(i * 53 + 15) % 360},90%,58%)`;
function hexOf(key) { const m = /#([0-9a-f]{6})/i.exec(key || ""); return m ? "#" + m[1] : null; }
function isGreyish(hex) { if (!hex) return false; const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return Math.max(r, g, b) - Math.min(r, g, b) < 24 && r > 70 && r < 235; }
function lineColor(key, i) { const h = hexOf(key); if (h && !isGreyish(h) && h !== "#000000" && h !== "#ffffff") return h; const L = W.sheet && W.sheet.layers.find(x => x.name === key); return L && L.color !== null && L.color !== 7 ? aciColor(L.color) : TCOL(i + 7); }
async function tallyRegion(a, b) {
  const region = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
  $("#vinfo").textContent = "영역 분석 중…";
  const r = await api(`/api/projects/${W.pid}/sheets/${W.sheet.id}/region-analyze`, { method: "POST", json: { region, hidden_layers: [...W.hidden] } });
  r.objects.forEach((o, i) => { o.on = false; o.name = ""; o.spec = ""; o.unit = "개"; o.col = TCOL(i); o.bg = isGreyish(o.color); });
  r.lines.forEach((l, i) => { l.on = false; l.name = "케이블"; l.spec = ""; l.len = ""; l.col = lineColor(l.key, i); });
  W.tally = { ...r, region, sheet_id: W.sheet.id, only: true };
  W.sel = null; renderRight();
  $("#vinfo").textContent = `영역 분석 완료 — 객체 ${r.objects.length}종, 선 ${r.lines.length}종`;
  if (isNarrow()) fitTally(); else draw();
  toast(r.mode === "raster" ? "스캔 도면은 객체 자동 구분이 안 됩니다 (오른쪽 안내 참조)" : `영역 안 객체 ${r.objects.length}종 · 선 ${r.lines.length}종 — ${isNarrow() ? "아래" : "오른쪽"} 목록에서 집계할 항목에 품명을 입력하십시오`);
}
const tallyCount = o => o.items.filter(it => !it.off).length;
async function tallyAll() {
  if (!W.sheet) return toast("먼저 도면을 여십시오.", true);
  const b = W.sheet.bbox; setMode("tally");
  await tallyRegion([b.x0, b.y0], [b.x1, b.y1]);
}
function tallyFillBlocks() {
  let n = 0;
  for (const o of W.tally.objects) {
    if (o.kind !== "block" || o.note) continue;
    const sg = (o.suggest || [])[0];
    o.name = sg && sg.score >= 0.9 ? sg.name : o.block; o.on = true; n++;
  }
  renderRight(); draw(); toast(`CAD 블록 ${n}종에 이름을 채웠습니다. 확인 후 '물량표에 추가'를 누르십시오.`);
}
function tallyToggleAt(p) {
  const T = W.tally; if (!T || T.sheet_id !== W.sheet.id) return;
  const tol = 4 / V.scale;
  for (const o of T.objects) { if (!o.on) continue; for (const it of o.items) { const bb = it.bbox; if (p[0] >= bb.x0 - tol && p[0] <= bb.x1 + tol && p[1] >= bb.y0 - tol && p[1] <= bb.y1 + tol) { it.off = !it.off; renderRight(); draw(); return; } } }
}
function tallySet(kind, i, k, v) { const o = W.tally[kind][i]; o[k] = v; if (k === "on") { renderRight(); draw(); } else if (k === "focus") { W.tally.focus = v; draw(); } }
function tallyPanel() {
  const T = W.tally;
  const nOn = T.objects.filter(o => o.on).length, nL = T.lines.filter(l => l.on).length;
  let h = `<h2>영역 집계 <button class="sm" onclick="W.tally=null;renderRight();draw()">닫기</button></h2>
  <div class="row"><label><input type="checkbox" ${T.only ? "checked" : ""} onchange="W.tally.only=this.checked;draw()"> 영역 객체·선만 보기</label> <button class="sm" onclick="fitTally()">영역 확대</button></div>
  <div class="small muted">집계할 항목에 <b>품명을 입력</b>하면 자동으로 체크됩니다. 도면에서 객체를 클릭하면 개별로 빼거나 넣을 수 있습니다.</div>`;
  for (const n of T.notes || []) h += `<div class="warnbox small">${esc(n)}</div>`;
  if (T.objects.length) {
    const nb = T.objects.filter(o => o.kind === "block" && !o.note).length;
    h += `<h3>객체 ${T.objects.length}종 <span class="small muted">(체크 ${nOn})</span></h3>`;
    if (nb) h += `<div class="row"><button class="sm ok" onclick="tallyFillBlocks()">CAD 블록 ${nb}종 이름 자동 채우기 (블록명·추천)</button></div>`;
    T.objects.forEach((o, i) => {
      const n = tallyCount(o);
      h += `<div class="tcard ${o.on ? "on" : ""} ${o.note ? "note" : ""}" onmouseenter="tallySet('objects',${i},'focus','o${i}')" onmouseleave="tallySet('objects',${i},'focus',null)">
      <div class="trow"><input type="checkbox" ${o.on ? "checked" : ""} onchange="tallySet('objects',${i},'on',this.checked)"><span class="swatch" style="background:${o.col}"></span><canvas class="mini tmini" data-i="${i}" width="52" height="38"></canvas>
      <div class="tlab"><b>${esc(o.label)}</b><br><span class="small muted">${esc(o.shape || "")}</span></div><div class="tqty">${n}<span class="small"> ${esc(o.unit || "개")}</span>${n !== o.count ? `<div class="small muted">(${o.count - n}개 제외)</div>` : ""}</div></div>
      ${(o.suggest || []).length ? `<div class="trow sugs"><span class="small muted">추천</span>${o.suggest.map((sg, k) => `<button class="sm chip" title="${esc(sg.source)} · ${esc(sg.why || "")}" onclick="tallyPick(${i},${k})">${esc(sg.name)} <span class="small muted">${Math.round(sg.score * 100)}%</span></button>`).join("")}</div>` : ""}
      <div class="trow"><input class="tname" placeholder="품명 (예: LED 투광등)" value="${esc(o.name)}" oninput="tallyName('objects',${i},this.value)"><input class="tspec" placeholder="규격" value="${esc(o.spec)}" onchange="tallySet('objects',${i},'spec',this.value)"><input class="tunit" value="${esc(o.unit)}" onchange="tallySet('objects',${i},'unit',this.value)"></div></div>`;
    });
  } else if (T.mode !== "raster") h += `<p class="muted">영역 안에서 닫힌 외곽선의 객체를 찾지 못했습니다.</p>`;
  if (T.lines.length) {
    h += `<h3>선 ${T.lines.length}종 <span class="small muted">— 케이블이면 길이(m)를 입력 (체크 ${nL})</span></h3>`;
    T.lines.forEach((l, i) => {
      const ref = l.length_m !== null && l.length_m !== undefined ? `참고 ${fmt(l.length_m)} m` : `참고 ${fmt(l.length)} ${esc(T.units || "도면단위")} (축척 미확정)`;
      h += `<div class="tcard ${l.on ? "on" : ""}" onmouseenter="tallySet('lines',${i},'focus','l${i}')" onmouseleave="tallySet('lines',${i},'focus',null)">
      <div class="trow"><input type="checkbox" ${l.on ? "checked" : ""} onchange="tallySet('lines',${i},'on',this.checked)"><span class="swatch" style="background:${l.col};width:22px;height:4px"></span><div class="tlab"><span class="small">${esc(l.key)}</span><br><span class="small muted">${ref}</span></div></div>
      <div class="trow"><input class="tname" placeholder="품명 (예: 전선)" value="${esc(l.name)}" onchange="tallySet('lines',${i},'name',this.value)"><input class="tspec" placeholder="규격 (예: F-CV 6㎟)" value="${esc(l.spec)}" onchange="tallySet('lines',${i},'spec',this.value)"><input class="tunit" type="number" min="0" step="0.1" placeholder="m" value="${esc(l.len)}" oninput="tallyLen(${i},this.value)"></div></div>`;
    });
  }
  h += `<div class="row" style="position:sticky;bottom:0;background:var(--panel,#fff);padding:6px 0"><button class="primary" onclick="saveTally()">물량표에 추가</button></div>
  <div class="small muted">· 같은 기호가 두 종으로 나뉘면 같은 품명·규격을 입력하십시오 — 물량표에서 합산됩니다.<br>· 같은 곳을 다시 드래그해 추가하면 이중으로 집계됩니다. 잘못 넣은 내역은 '물량' 탭에서 삭제하십시오.</div>`;
  return h;
}
function tallyPick(i, k) { const o = W.tally.objects[i], sg = o.suggest[k]; o.name = sg.name; o.on = true; renderRight(); draw(); }
function tallyName(kind, i, v) { const o = W.tally[kind][i]; o.name = v; const want = !!v.trim(); if (o.on !== want) { o.on = want; const card = document.querySelectorAll(".tcard")[i]; if (card) { card.classList.toggle("on", want); card.querySelector("input[type=checkbox]").checked = want; } draw(); } }
function tallyLen(i, v) { const l = W.tally.lines[i]; l.len = v; const want = +v > 0; if (l.on !== want) { l.on = want; const card = document.querySelectorAll(".tcard")[W.tally.objects.length + i]; if (card) { card.classList.toggle("on", want); card.querySelector("input[type=checkbox]").checked = want; } draw(); } }
function drawTallyMinis() {
  for (const cv of document.querySelectorAll("canvas.tmini")) {
    const o = W.tally.objects[+cv.dataset.i]; const prims = o.sample || []; const pts = prims.flatMap(p => p.p); if (!pts.length) continue;
    const c = cv.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, cv.width, cv.height);
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((cv.width - 8) / (x1 - x0 || 1), (cv.height - 8) / (y1 - y0 || 1)); const ox = (cv.width - (x1 - x0) * s) / 2, oy = (cv.height + (y1 - y0) * s) / 2;
    c.strokeStyle = "#111"; c.fillStyle = "#111"; c.lineWidth = 1.2;
    for (const p of prims) { c.beginPath(); p.p.forEach(([x, y], i) => { const sx = ox + (x - x0) * s, sy = oy - (y - y0) * s; i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); p.t === "f" ? c.fill() : c.stroke(); }
  }
}
function drawTallyOnly(c, T) {
  const b = W.sheet.bbox;
  if (W.img && b) { c.globalAlpha = 0.12; const [sx, sy] = toScreen(b.x0, b.y1); c.drawImage(W.img, sx, sy, (b.x1 - b.x0) * V.scale, (b.y1 - b.y0) * V.scale); c.globalAlpha = 1; }
  else { c.strokeStyle = "rgba(200,200,200,.12)"; c.lineWidth = 1; for (const p of W.geo.prims) { if (p.p.length < 2) continue; c.beginPath(); p.p.forEach(([x, y], i) => { const [sx, sy] = toScreen(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); } }
  drawTallyMarks(c, T, true);
  if (V.drag && W.mode === "tally" && V.mouse) { const [x0, y0] = toScreen(...V.drag.start), [x1, y1] = toScreen(...V.mouse); c.strokeStyle = "#ffd166"; c.setLineDash([4, 4]); c.strokeRect(x0, y0, x1 - x0, y1 - y0); c.setLineDash([]); }
}
function drawTallyMarks(c, T, full) {
  const r = T.region; const [rx0, ry0] = toScreen(r.x0, r.y1), [rx1, ry1] = toScreen(r.x1, r.y0);
  c.setLineDash([8, 4]); c.strokeStyle = "#ffd166"; c.lineWidth = 2; c.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0); c.setLineDash([]);
  T.lines.forEach((l, i) => {
    if (!l.on && T.focus !== "l" + i && (!full || isGreyish(hexOf(l.key)))) return;
    c.strokeStyle = l.col; c.globalAlpha = l.on || T.focus === "l" + i ? 1 : 0.35; c.lineWidth = T.focus === "l" + i ? 4 : (l.on ? 2.5 : 1);
    for (const pc of l.pieces) { c.beginPath(); pc.forEach(([x, y], k) => { const [sx, sy] = toScreen(x, y); k ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.stroke(); }
    c.globalAlpha = 1;
  });
  const anyOn = T.objects.some(o => o.on);
  T.objects.forEach((o, i) => {
    const foc = T.focus === "o" + i;
    if (!o.on && !foc && (anyOn || o.bg || !full)) return;   // 체크 전에는 배경(회색) 외 모든 객체를 옅게 표시
    c.globalAlpha = o.on || foc ? 1 : 0.55;
    let n = 0;
    for (const it of o.items) {
      const bb = it.bbox; const [x0, y0] = toScreen(bb.x0, bb.y1), [x1, y1] = toScreen(bb.x1, bb.y0); const pad = 3;
      c.lineWidth = foc ? 3 : (o.on ? 2 : 1); c.strokeStyle = it.off ? "#777" : o.col;
      c.strokeRect(x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad);
      if (it.off) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.moveTo(x1, y0); c.lineTo(x0, y1); c.stroke(); continue; }
      n++; if ((o.on || foc) && V.scale * (bb.x1 - bb.x0) > 6) { c.fillStyle = o.col; c.font = "bold 11px sans-serif"; c.fillText(n, x1 + pad + 1, y0); }
    }
    c.globalAlpha = 1;
  });
}
function fitTally() { const r = W.tally.region; const w = r.x1 - r.x0, h = r.y1 - r.y0; V.scale = Math.min(V.cv.width / w, V.cv.height / h) * 0.9; V.tx = (V.cv.width - w * V.scale) / 2 - r.x0 * V.scale; V.ty = (V.cv.height + h * V.scale) / 2 + r.y0 * V.scale; draw(); }
async function saveTally() {
  const T = W.tally; const rows = [];
  for (const o of T.objects) { if (!o.on || !tallyCount(o)) continue; if (!o.name.trim()) return toast(`체크한 객체(${o.label})의 품명을 입력하십시오.`, true); rows.push({ kind: "object", item_name: o.name, spec: o.spec, unit: o.unit || "개", qty: tallyCount(o), marks: o.items.filter(it => !it.off).map(it => [(it.bbox.x0 + it.bbox.x1) / 2, (it.bbox.y0 + it.bbox.y1) / 2]) }); }
  for (const l of T.lines) { if (!l.on) continue; if (!(+l.len > 0)) return toast(`체크한 선(${l.key})의 케이블 길이(m)를 입력하십시오.`, true); if (!l.name.trim()) return toast("케이블 품명을 입력하십시오.", true); rows.push({ kind: "cable", item_name: l.name, spec: l.spec, unit: "m", qty: +l.len, ref_length: l.length_m ?? l.length, note: `선 종류 ${l.key}` }); }
  if (!rows.length) return toast("체크한 객체나 길이를 입력한 케이블이 없습니다.", true);
  await api(`/api/projects/${W.pid}/tallies`, { method: "POST", json: { sheet_id: T.sheet_id, region: T.region, rows } });
  toast(`${rows.length}개 항목을 물량표에 추가했습니다.`); W.tally = null; W.tab = "qty"; await refreshAll();
}
async function showTally(id) {
  const t = W.tallies.find(x => x.id === id); if (!t) return;
  if (!W.sheet || W.sheet.id !== t.sheet_id) await openSheet(t.sheet_id, t.region);
  else { const r = t.region; const w = r.x1 - r.x0, h = r.y1 - r.y0; V.scale = Math.min(V.cv.width / w, V.cv.height / h) * 0.8; V.tx = (V.cv.width - w * V.scale) / 2 - r.x0 * V.scale; V.ty = (V.cv.height + h * V.scale) / 2 + r.y0 * V.scale; }
  W.flash = t; draw();
  const c = V.ctx, r = t.region; const [x0, y0] = toScreen(r.x0, r.y1), [x1, y1] = toScreen(r.x1, r.y0); c.strokeStyle = "#ff6a00"; c.lineWidth = 3; c.strokeRect(x0, y0, x1 - x0, y1 - y0);
  for (const [x, y] of t.marks || []) { const [sx, sy] = toScreen(x, y); c.beginPath(); c.arc(sx, sy, 7, 0, Math.PI * 2); c.stroke(); }
}

/* ---------------- 기준정보 (적산) ---------------- */
async function renderRefData() {
  const [norms, labor, mats, linfo] = await Promise.all([api("/api/norms"), api("/api/labor-rates"), api("/api/materials"), api("/api/labor-rates/standard-info")]);
  const linfoHtml = `<div class="small" style="margin:4px 0 8px">` + linfo.sets.map(st => `✔ 기본 제공: <b>${esc(st.title)}</b> ${st.count}개 직종 (적용 ${esc(st.effective_date)}) — <a href="${esc(st.source_url)}" target="_blank" rel="noopener">출처</a>`).join("<br>") +
    linfo.missing.map(m => `<div class="warnbox small">⚠ ${esc(m.group)}: ${esc(m.reason)}. 보고서를 <a href="${esc(m.where)}" target="_blank" rel="noopener">여기</a>서 받아 아래 'Excel 일괄 등록' 또는 직접 입력으로 등록하십시오.</div>`).join("") + `</div>`;
  $("#app").innerHTML = `<div class="page">
  <div class="card"><h2>표준품셈 (적법하게 확보한 자료만 등록 — 임의 품셈 생성 금지)</h2><div class="row"><input id="n_code" placeholder="품셈번호"><input id="n_title" placeholder="항목명" style="width:220px"><input id="n_unit" placeholder="단위" style="width:60px"><input id="n_labor" placeholder='노무량 JSON 예 {"내선전공":0.12}' style="width:220px"><input id="n_pub" placeholder="발행기관"><input id="n_year" type="number" placeholder="적용연도"><input id="n_src" placeholder="출처"><button class="primary" onclick="addNorm()">등록</button></div>
  <table><tr><th>번호</th><th>항목</th><th>단위</th><th>노무량</th><th>발행기관</th><th>연도</th></tr>${norms.map(n => `<tr><td>${esc(n.code)}</td><td>${esc(n.title)}</td><td>${esc(n.unit)}</td><td>${esc(JSON.stringify(n.labor))}</td><td>${esc(n.publisher)}</td><td>${n.year}</td></tr>`).join("")}</table></div>
  <div class="card"><h2>노임단가</h2>${linfoHtml}<div class="row"><input id="l_trade" placeholder="직종"><input id="l_rate" type="number" placeholder="일당"><input id="l_pub" placeholder="발행기관"><input id="l_date" type="date"><button class="primary" onclick="addLabor()">등록</button></div>
  <table><tr><th>직종</th><th>일당(원)</th><th>출처·발행기관</th><th>적용일</th></tr>${labor.map(l => `<tr><td>${esc(l.trade)}</td><td class="num">${l.daily_rate.toLocaleString()}</td><td class="small">${esc(l.publisher)}</td><td>${l.effective_date}</td></tr>`).join("")}</table></div>
  <div class="card"><h2>자재단가</h2><div class="row"><input id="m_name" placeholder="품명"><input id="m_spec" placeholder="규격"><input id="m_unit" placeholder="단위" style="width:60px"><select id="m_sup"><option value="private">사급</option><option value="gov">관급</option></select><input id="m_price" type="number" placeholder="단가"><input id="m_src" placeholder="출처(물가지/견적)"><input id="m_date" type="date"><button class="primary" onclick="addMat()">등록</button></div>
  <table><tr><th>품명</th><th>규격</th><th>단위</th><th>관급/사급</th><th>단가</th><th>출처</th><th>적용일</th></tr>${mats.map(m => `<tr><td>${esc(m.item_name)}</td><td>${esc(m.spec)}</td><td>${esc(m.unit)}</td><td>${m.supply_type === "gov" ? "관급" : "사급"}</td><td class="num">${m.price ?? "미등록"}</td><td>${esc(m.price_source || "")}</td><td>${m.effective_date || ""}</td></tr>`).join("")}</table></div>
  <div class="card" id="symlib"><h2>표준 심볼 라이브러리 <span class="small muted">불러오는 중…</span></h2></div>
  <div class="card"><h2>Excel 일괄 등록</h2><div class="row">표준품셈 <input type="file" accept=".xlsx" onchange="importRef('norms',this.files[0])"> <span class="small muted">열: 품셈번호, 항목, 단위, 발행기관, 연도, 출처 + 직종명 열(노무량)</span></div>
  <div class="row">노임단가 <input type="file" accept=".xlsx" onchange="importRef('labor',this.files[0])"> <span class="small muted">열: 직종, 일당, 발행기관, 적용일</span></div>
  <div class="row">자재단가 <input type="file" accept=".xlsx" onchange="importRef('materials',this.files[0])"> <span class="small muted">열: 품명, 규격, 단위, 관급/사급, 단가, 출처, 적용일</span></div>
  <p class="small muted">공식 자료를 적법하게 확보해 등록하십시오. 원가계산은 각 프로젝트의 '적산' 탭에서 수행합니다.</p></div></div>`;
  loadSymLib();
}
async function loadSymLib(filter) {
  const el = $("#symlib"); if (!el) return;
  const L = W.symlib || (W.symlib = await api("/api/symbol-library"));
  const q = (filter || "").trim(); const syms = L.symbols.filter(x => !q || (x.name + " " + (x.code || "") + " " + x.discipline).includes(q));
  const by = {}; for (const x of syms) (by[x.discipline] = by[x.discipline] || []).push(x);
  el.innerHTML = `<h2>표준 심볼 라이브러리 (${L.symbols.length}종)</h2><div class="small muted">영역 집계에서 객체 모양을 이 기호들과 비교해 품명을 추천합니다. 출처: ${L.sources.map(esc).join(", ")}</div>
  <div class="row"><input id="symq" placeholder="검색 (예: 감지기, 콘센트)" value="${esc(q)}" oninput="loadSymLib(this.value)"></div>` +
    Object.entries(by).map(([d, xs]) => `<h3>${esc(d)} (${xs.length})</h3><div class="symgrid">${xs.map(x => `<div class="symcell" title="${esc(x.source)}${x.code ? " · " + esc(x.code) : ""}"><canvas class="libthumb" width="64" height="48" data-id="${x.id}"></canvas><div class="small">${esc(x.name)}</div></div>`).join("")}</div>`).join("");
  const ids = new Map(L.symbols.map(x => [x.id, x]));
  for (const cv of el.querySelectorAll("canvas.libthumb")) {
    const x = ids.get(+cv.dataset.id); const c = cv.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, 64, 48); c.strokeStyle = "#111"; c.fillStyle = "#111"; c.lineWidth = 1;
    const sc = Math.min(56 / 100, 40 / 100); for (const p of x.thumb) { c.beginPath(); p.p.forEach(([a, b], k) => { const sx = 4 + a * sc, sy = 44 - b * sc; k ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); p.t === "f" ? c.fill() : c.stroke(); }
    if (x.letters.length) { c.font = "9px sans-serif"; c.fillStyle = "#c00"; c.fillText(x.letters.join(" "), 2, 10); }
  }
  const qi = $("#symq"); if (qi && q) { qi.focus(); qi.setSelectionRange(q.length, q.length); }
}
async function importRef(kind, file) { if (!file) return; const fd = new FormData(); fd.append("file", file); const r = await api(`/api/refdata/${kind}/import`, { method: "POST", body: fd }); toast(`${r.imported}건 등록`); renderRefData(); }
async function addNorm() { let labor; try { labor = JSON.parse($("#n_labor").value); } catch (e) { return toast("노무량 JSON 형식 오류", true); } await api("/api/norms", { method: "POST", json: { code: $("#n_code").value, title: $("#n_title").value, unit: $("#n_unit").value, labor, publisher: $("#n_pub").value, year: +$("#n_year").value, source: $("#n_src").value } }); renderRefData(); }
async function addLabor() { await api("/api/labor-rates", { method: "POST", json: { trade: $("#l_trade").value, daily_rate: +$("#l_rate").value, publisher: $("#l_pub").value, effective_date: $("#l_date").value } }); renderRefData(); }
async function addMat() { await api("/api/materials", { method: "POST", json: { item_name: $("#m_name").value, spec: $("#m_spec").value, unit: $("#m_unit").value, supply_type: $("#m_sup").value, price: num("#m_price"), price_source: $("#m_src").value || null, effective_date: $("#m_date").value || null } }); renderRefData(); }

render();
