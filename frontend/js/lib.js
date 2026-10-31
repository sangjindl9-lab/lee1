// 공통 라이브러리: API 호출, DOM 헬퍼, 표, 모달, 폼, 상태 표시
export const state = { me: null, codes: null, users: null, dirty: false };

// ---------------------------------------------------------------- API
export class ApiError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}

export async function api(method, url, body, opts = {}) {
  const headers = {};
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  if (method !== "GET" && state.me) headers["X-CSRF-Token"] = state.me.csrf;
  let res;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: "same-origin" });
  } catch (e) {
    throw new ApiError(0, "서버에 연결할 수 없습니다. 네트워크 상태를 확인하세요.");
  }
  if (res.status === 401 && !opts.noRedirect) {
    state.me = null;
    window.dispatchEvent(new CustomEvent("gw:logout"));
  }
  if (res.status === 428 && !opts.noRedirect) window.dispatchEvent(new CustomEvent("gw:mustchange"));
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.blob();
  if (!res.ok) {
    let msg = (data && data.detail) || `요청을 처리하지 못했습니다 (${res.status})`;
    if (typeof msg !== "string") msg = JSON.stringify(msg);
    throw new ApiError(res.status, msg);
  }
  return data;
}
export const GET = (u) => api("GET", u);
export const POST = (u, b) => api("POST", u, b ?? {});
export const PUT = (u, b) => api("PUT", u, b);
export const DEL = (u) => api("DELETE", u);

export const can = (p) => !!state.me && state.me.permissions.includes(p);

// ---------------------------------------------------------------- DOM
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs !== null && attrs !== undefined && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "list" && k !== "form") { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export function mount(el, ...kids) { clear(el); append(el, kids); return el; }

// ---------------------------------------------------------------- 포맷
export function fmtNum(v, digits) {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
  const neg = s.startsWith("-");
  let [ip, fp = ""] = s.replace("-", "").split(".");
  ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (digits !== undefined) fp = fp.slice(0, digits);
  fp = fp.replace(/0+$/, "");
  return (neg ? "-" : "") + ip + (fp ? "." + fp : "");
}
export const fmtWon = (v) => (v === null || v === undefined) ? "—" : fmtNum(v) + "원";
export const fmtRate = (v) => (v === null || v === undefined) ? "—" : fmtNum(v, 2) + "%";
export function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  // 한국 시간 표시
  const k = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  return `${k.getFullYear()}-${p(k.getMonth() + 1)}-${p(k.getDate())} ${p(k.getHours())}:${p(k.getMinutes())}`;
}
export function todayKST() {
  const k = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const p = (n) => String(n).padStart(2, "0");
  return `${k.getFullYear()}-${p(k.getMonth() + 1)}-${p(k.getDate())}`;
}
export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36));

const STATUS_TONE = {
  "승인": "ok", "승인완료": "ok", "발주확정": "info", "입고완료": "ok", "진행": "info", "준공": "ok", "정산완료": "ok", "발주완료": "ok", "완료": "ok",
  "제출": "warn", "결재중": "warn", "부분입고": "warn", "결재차례": "warn", "정정중": "warn", "중지": "warn", "준비": "draft", "진행중": "info",
  "반려": "bad", "발주취소": "bad", "회수": "draft", "작성중": "draft", "임시저장": "draft", "대기": "draft", "참조": "draft", "보류": "draft", "예정": "draft",
};
export const badge = (label) => h("span", { class: "st " + (STATUS_TONE[label] || "draft") }, label || "-");
export const demoTag = (p) => p && p.is_demo ? h("span", { class: "demo-tag", title: "데모 데이터" }, "데모") : null;

// ---------------------------------------------------------------- 알림
export function toast(msg, tone = "") {
  const t = h("div", { class: "toast " + tone, role: "status" }, msg);
  document.getElementById("toasts").appendChild(t);
  setTimeout(() => t.remove(), tone === "bad" ? 7000 : 3500);
}
export const fail = (e) => toast(e.message || String(e), "bad");

/** 중복 클릭 방지 + 진행 표시. fn 이 끝날 때까지 버튼을 잠근다. */
export function busy(btn, fn) {
  return async (ev) => {
    if (ev) ev.preventDefault();
    if (btn.classList.contains("busy")) return;
    btn.classList.add("busy"); btn.disabled = true;
    try { return await fn(ev); }
    catch (e) { fail(e); }
    finally { btn.classList.remove("busy"); btn.disabled = false; }
  };
}
export function button(label, fn, cls = "") {
  const b = h("button", { type: "button", class: cls }, label);
  b.addEventListener("click", busy(b, fn));
  return b;
}

// ---------------------------------------------------------------- 모달
export function modal(title, body, actions = [], { wide = false } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { ov.remove(); document.removeEventListener("keydown", esc); resolve(v); };
    const esc = (e) => { if (e.key === "Escape") close(null); };
    const foot = h("div", { class: "mf" });
    for (const a of actions) {
      const b = h("button", { type: "button", class: a.cls || "" }, a.label);
      b.addEventListener("click", busy(b, async () => { const r = a.run ? await a.run() : a.value; if (r !== false) close(r ?? true); }));
      foot.appendChild(b);
    }
    foot.appendChild(h("button", { type: "button", onclick: () => close(null) }, "닫기"));
    const ov = h("div", { class: "overlay", onclick: (e) => { if (e.target === ov) close(null); } },
      h("div", { class: "modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true" },
        h("div", { class: "mh" }, h("h2", title)), h("div", { class: "mb" }, body), foot));
    document.body.appendChild(ov);
    document.addEventListener("keydown", esc);
    setTimeout(() => (ov.querySelector("input,select,textarea") || ov.querySelector("button"))?.focus(), 30);
  });
}
export async function confirmBox(msg, label = "확인", cls = "primary") {
  return !!(await modal("확인", h("p", msg), [{ label, cls, value: true }]));
}
export async function promptBox(title, label, { required = true, multiline = true, value = "" } = {}) {
  const inp = multiline ? h("textarea", { value }) : h("input", { value });
  const msg = h("div", { class: "msg" });
  const r = await modal(title, h("div", { class: "f" }, h("label", label, required ? h("span", { class: "req" }, "*") : null), inp, msg), [{
    label: "확인", cls: "primary", run: () => {
      if (required && !inp.value.trim()) { inp.classList.add("err"); msg.textContent = `${label}을(를) 입력하세요.`; return false; }
      return inp.value.trim() || "";
    },
  }]);
  return r === null ? null : r;
}

// ---------------------------------------------------------------- 폼
/** fields: [{k, label, type, req, options, hint, cls, attrs}] → {el, get(), set(), validate(), markDirty} */
export function form(fields, init = {}, { onDirty } = {}) {
  const inputs = {};
  const msgs = {};
  const wrap = h("div", { class: "form" });
  for (const f of fields) {
    if (f.type === "section") { wrap.appendChild(h("h3", { class: "full", style: { marginTop: "6px" } }, f.label)); continue; }
    let inp;
    const val = init[f.k] ?? f.default ?? "";
    if (f.type === "select") {
      inp = h("select", {}, f.blank !== false ? h("option", { value: "" }, f.blank || "선택") : null,
        (f.options || []).map((o) => h("option", { value: String(o.value ?? o), selected: String(o.value ?? o) === String(val) }, o.label ?? o)));
    } else if (f.type === "textarea") inp = h("textarea", { value: val, rows: f.rows || 3 });
    else if (f.type === "checkbox") inp = h("input", { type: "checkbox", checked: !!val });
    else inp = h("input", { type: f.type || "text", value: val, inputMode: f.type === "money" || f.type === "qty" ? "decimal" : undefined, ...(f.attrs || {}) });
    if (f.type === "money" || f.type === "qty") { inp.type = "text"; inp.value = val === "" ? "" : fmtNum(val); }
    inp.addEventListener("input", () => { inp.classList.remove("err"); msgs[f.k].textContent = ""; onDirty && onDirty(); });
    inp.addEventListener("change", () => onDirty && onDirty());
    inputs[f.k] = inp;
    msgs[f.k] = h("div", { class: "msg" });
    const lab = h("label", f.label, f.req ? h("span", { class: "req", title: "필수" }, "*") : null);
    const cell = f.type === "checkbox" ? h("div", { class: "f " + (f.cls || "") }, h("label", { class: "row" }, inp, f.label), msgs[f.k])
      : h("div", { class: "f " + (f.cls || "") }, lab, inp, f.hint ? h("div", { class: "hint" }, f.hint) : null, msgs[f.k]);
    wrap.appendChild(cell);
  }
  const get = () => {
    const o = {};
    for (const f of fields) {
      if (f.type === "section") continue;
      const i = inputs[f.k];
      let v = f.type === "checkbox" ? i.checked : i.value.trim();
      if ((f.type === "money" || f.type === "qty") && typeof v === "string") v = v.replace(/,/g, "");
      if (v === "" && !["text", "textarea", undefined].includes(f.type)) v = null;
      if (f.type === "select" && f.int && v !== null) v = Number(v);
      if (v === "" && f.nullable) v = null;
      o[f.k] = v;
    }
    return o;
  };
  const validate = () => {
    let ok = true; let first = null;
    for (const f of fields) {
      if (f.type === "section") continue;
      const i = inputs[f.k]; const v = f.type === "checkbox" ? true : i.value.trim();
      let m = "";
      if (f.req && !v) m = `${f.label}을(를) 입력하세요.`;
      else if (v && (f.type === "money" || f.type === "qty") && !/^-?[\d,]+(\.\d+)?$/.test(v)) m = "숫자만 입력하세요.";
      if (m) { ok = false; i.classList.add("err"); msgs[f.k].textContent = m; first = first || i; }
    }
    if (first) { first.focus(); toast("입력값을 확인하세요. 빨간색 항목에 오류가 있습니다.", "bad"); }
    return ok;
  };
  const set = (k, v) => { const i = inputs[k]; if (i.type === "checkbox") i.checked = !!v; else i.value = v ?? ""; };
  return { el: wrap, get, set, validate, inputs };
}

/** 저장 상태 표시줄 */
export function saveState() {
  const el = h("span", { class: "savebar" });
  const set = (s, msg) => {
    el.className = "savebar " + s;
    el.textContent = msg || { saving: "저장 중…", saved: "저장됨", failed: "저장 실패", dirty: "저장하지 않은 변경 있음", "": "" }[s];
    state.dirty = s === "dirty" || s === "failed";
  };
  return { el, set };
}

// ---------------------------------------------------------------- 표 (정렬·검색·필터·페이지·열 너비 조절)
/** cols: [{k, label, num, render(row), sort:false, w, filter:true}] */
export function table(cols, rows, { pageSize = 30, onRow, search = true, filters = [], tools = [], empty = "자료가 없습니다.", foot } = {}) {
  let sortK = null, sortDir = 1, page = 0, q = "";
  const fvals = {};
  const tbody = h("tbody");
  const pager = h("div", { class: "pager" });
  const ths = cols.map((c) => {
    const th = h("th", { class: (c.num ? "num " : "") + (c.sort === false ? "" : "sortable"), style: c.w ? { width: c.w + "px" } : null }, c.label);
    if (c.sort !== false) th.addEventListener("click", (e) => {
      if (e.target.classList.contains("rz")) return;
      if (sortK === c.k) sortDir = -sortDir; else { sortK = c.k; sortDir = 1; }
      page = 0; draw();
    });
    const rz = h("span", { class: "rz", title: "드래그하여 열 너비 조절" });
    rz.addEventListener("mousedown", (e) => {
      e.preventDefault(); const sx = e.clientX; const sw = th.offsetWidth;
      const mv = (ev) => { th.style.width = Math.max(50, sw + ev.clientX - sx) + "px"; th.style.minWidth = th.style.width; };
      const up = () => { document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
    });
    th.appendChild(rz);
    return th;
  });
  const val = (r, c) => { const v = r[c.k]; return v === null || v === undefined ? "" : v; };
  const filtered = () => {
    let out = rows;
    if (q) { const ql = q.toLowerCase(); out = out.filter((r) => cols.some((c) => String(val(r, c)).toLowerCase().includes(ql))); }
    for (const f of filters) if (fvals[f.k]) out = out.filter((r) => String(r[f.k]) === fvals[f.k]);
    if (sortK) {
      const c = cols.find((x) => x.k === sortK);
      out = [...out].sort((a, b) => {
        let x = val(a, c), y = val(b, c);
        const nx = Number(x), ny = Number(y);
        if (x !== "" && y !== "" && !isNaN(nx) && !isNaN(ny)) return (nx - ny) * sortDir;
        return String(x).localeCompare(String(y), "ko") * sortDir;
      });
    }
    return out;
  };
  function draw() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, pages - 1);
    const slice = list.slice(page * pageSize, (page + 1) * pageSize);
    ths.forEach((th, i) => { th.querySelector(".arrow")?.remove(); if (cols[i].k === sortK) th.insertBefore(h("span", { class: "arrow" }, sortDir > 0 ? "▲" : "▼"), th.querySelector(".rz")); });
    mount(tbody, slice.length ? slice.map((r) => {
      const tr = h("tr", { class: onRow ? "click" : "" }, cols.map((c) => h("td", { class: c.num ? "num" : "" }, c.render ? c.render(r) : (c.num ? fmtNum(val(r, c)) : String(val(r, c))))));
      if (onRow) tr.addEventListener("click", (e) => { if (!e.target.closest("button,a,input,select")) onRow(r); });
      return tr;
    }) : h("tr", h("td", { colspan: cols.length }, h("div", { class: "empty" }, empty))));
    mount(pager, `총 ${fmtNum(list.length)}건`, pages > 1 ? [
      h("span", { class: "right" }),
      h("button", { class: "sm", disabled: page === 0, onclick: () => { page--; draw(); } }, "이전"),
      `${page + 1} / ${pages}`,
      h("button", { class: "sm", disabled: page >= pages - 1, onclick: () => { page++; draw(); } }, "다음"),
    ] : null);
  }
  const searchInput = search ? h("input", { type: "search", placeholder: "표 안에서 검색", oninput: (e) => { q = e.target.value.trim(); page = 0; draw(); } }) : null;
  const filterEls = filters.map((f) => h("select", { onchange: (e) => { fvals[f.k] = e.target.value; page = 0; draw(); } },
    h("option", { value: "" }, f.label + " 전체"), [...new Set(rows.map((r) => r[f.k]).filter((x) => x !== null && x !== undefined && x !== ""))].map((v) => h("option", { value: String(v) }, String(v)))));
  const el = h("div", {},
    (search || filters.length || tools.length) ? h("div", { class: "tbl-tools" }, searchInput, filterEls, h("span", { class: "grow" }), tools) : null,
    h("div", { class: "tbl-wrap" }, h("table", { class: "t" }, h("thead", h("tr", ths)), tbody, foot || null)),
    pager);
  draw();
  return el;
}

// ---------------------------------------------------------------- 파일 업로드
export function uploader({ owner_type, owner_id, category = "첨부", photo = false, meta = () => ({}), onDone, accept }) {
  const inp = h("input", { type: "file", multiple: true, accept: accept || (photo ? "image/*" : undefined), class: "hidden" });
  const cam = photo ? h("input", { type: "file", accept: "image/*", capture: "environment", class: "hidden" }) : null;
  const status = h("div", { class: "small muted" });
  const drop = h("div", { class: "drop" },
    h("div", photo ? "사진을 끌어다 놓거나 선택하세요 (여러 장 가능)" : "파일을 끌어다 놓거나 선택하세요"),
    h("div", { class: "row", style: { justifyContent: "center", marginTop: "8px" } },
      h("button", { type: "button", onclick: () => inp.click() }, photo ? "사진 선택" : "파일 선택"),
      cam ? h("button", { type: "button", class: "primary", onclick: () => cam.click() }, "카메라로 촬영") : null),
    status, inp, cam);
  async function send(files) {
    if (!files.length) return;
    const fd = new FormData();
    fd.append("owner_type", owner_type);
    if (owner_id) fd.append("owner_id", owner_id);
    fd.append("category", typeof category === "function" ? category() : category);
    for (const [k, v] of Object.entries(meta() || {})) if (v) fd.append(k, v);
    for (const f of files) fd.append("files", f);
    status.textContent = `${files.length}개 업로드 중…`; status.className = "small savebar saving";
    try {
      const r = await api("POST", "/api/files", fd);
      status.textContent = `${r.length}개 업로드 완료`; status.className = "small savebar saved";
      onDone && onDone(r);
    } catch (e) { status.textContent = "업로드 실패: " + e.message; status.className = "small savebar failed"; }
    inp.value = ""; if (cam) cam.value = "";
  }
  inp.addEventListener("change", () => send([...inp.files]));
  cam && cam.addEventListener("change", () => send([...cam.files]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); send([...e.dataTransfer.files]); });
  return drop;
}

export function fileList(files, { onDelete } = {}) {
  if (!files.length) return h("div", { class: "muted small" }, "첨부된 파일이 없습니다.");
  return h("ul", { style: { margin: 0, paddingLeft: "18px" } }, files.map((f) => h("li", {},
    can("file.download") ? h("a", { href: `/api/files/${f.id}/download` }, f.name) : f.name,
    h("span", { class: "muted small" }, ` ${f.category || ""} ${f.size ? (f.size / 1024 / 1024).toFixed(2) + "MB" : ""}`),
    onDelete ? h("button", { class: "link small", onclick: () => onDelete(f) }, "삭제") : null)));
}

/** 결재선 표시 */
export function approvalLine(steps, drafter) {
  return h("div", { class: "aline" },
    drafter ? h("div", { class: "s done" }, "기안", h("b", drafter)) : null,
    steps.map((s) => h("div", { class: "s " + ({ pending: "cur", approved: "done", rejected: "rej" }[s.status] || "") },
      s.kind + (s.position ? `(${s.position})` : ""), h("b", s.approver_name), s.status_label, s.acted_at ? h("div", { class: "small muted" }, fmtDT(s.acted_at)) : null)));
}

/** 공정률 바 */
export function pbar(actual, plan) {
  const a = actual === null || actual === undefined ? null : Math.min(100, Number(actual));
  const p = plan === null || plan === undefined ? null : Math.min(100, Number(plan));
  const behind = a !== null && p !== null && a + 0.001 < p;
  return h("div", { class: "pbar", title: `실적 ${fmtRate(actual)} / 계획 ${fmtRate(plan)}`, role: "img", "aria-label": `실적 ${fmtRate(actual)}, 계획 ${fmtRate(plan)}` },
    a !== null ? h("div", { class: "act" + (behind ? " behind" : ""), style: { width: a + "%" } }) : null,
    p !== null ? h("div", { class: "plan", style: { left: `calc(${p}% - 1px)` } }) : null);
}

/** 사용자 선택 목록 */
export async function users() {
  if (!state.users) state.users = await GET("/api/lookup/users");
  return state.users;
}
export async function codes() {
  if (!state.codes) state.codes = await GET("/api/lookup/codes");
  return state.codes;
}

/** 결재선 지정 대화상자: 기본 결재선(관리자 설정) 불러와 수정 가능 */
export async function pickLine(docType, amount) {
  const [us, def] = await Promise.all([users(), GET(`/api/approvals/default-line?doc_type=${docType}${amount ? "&amount=" + amount : ""}`)]);
  let steps = def.map((s) => ({ user_id: s.user_id, kind: s.kind }));
  const box = h("div");
  const draw = () => mount(box,
    def.length ? h("p", { class: "small muted" }, "관리자가 설정한 기본 결재선을 불러왔습니다. 필요하면 수정하세요.") : h("p", { class: "small muted" }, "설정된 기본 결재선이 없습니다. 결재자를 지정하세요."),
    h("table", { class: "t" }, h("thead", h("tr", h("th", "순서"), h("th", "구분"), h("th", "결재자"), h("th", ""))),
      h("tbody", steps.map((s, i) => h("tr",
        h("td", i + 1),
        h("td", h("select", { onchange: (e) => { s.kind = e.target.value; } }, ["결재", "합의", "참조"].map((k) => h("option", { selected: s.kind === k }, k)))),
        h("td", h("select", { onchange: (e) => { s.user_id = Number(e.target.value); } }, h("option", { value: "" }, "선택"),
          us.map((u) => h("option", { value: u.id, selected: u.id === s.user_id }, `${u.name} ${u.position || ""} ${u.department ? "· " + u.department : ""}`)))),
        h("td", h("button", { class: "sm", onclick: () => { steps.splice(i, 1); draw(); } }, "삭제")))))),
    h("button", { class: "sm", style: { marginTop: "8px" }, onclick: () => { steps.push({ user_id: null, kind: "결재" }); draw(); } }, "결재자 추가"));
  draw();
  return modal("결재 상신", box, [{
    label: "상신", cls: "primary", run: () => {
      if (!steps.length || steps.some((s) => !s.user_id)) { toast("결재자를 모두 선택하세요.", "bad"); return false; }
      if (!steps.some((s) => s.kind !== "참조")) { toast("결재 또는 합의 단계가 1명 이상 필요합니다.", "bad"); return false; }
      return steps;
    },
  }]);
}

export function download(url) {
  const a = h("a", { href: url, download: "" }); document.body.appendChild(a); a.click(); a.remove();
}
export function pdfButtons(url) {
  if (!can("export.data")) return null;
  return [h("a", { class: "btn", href: url + (url.includes("?") ? "&" : "?") + "inline=true", target: "_blank", rel: "noopener" }, "PDF 미리보기"),
    h("a", { class: "btn", href: url }, "PDF 저장")];
}
