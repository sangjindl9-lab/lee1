import { api, can, GET, h, mount, POST, state, toast, fail, form, busy } from "./lib.js";
import * as dash from "./pages/dashboard.js";
import * as proj from "./pages/projects.js";
import * as rep from "./pages/reports.js";
import * as mat from "./pages/materials.js";
import * as appr from "./pages/approvals.js";
import * as adm from "./pages/admin.js";
import * as misc from "./pages/misc.js";

const root = document.getElementById("app");

const ROUTES = [
  [/^\/?$/, dash.page],
  [/^\/projects$/, proj.list],
  [/^\/projects\/new$/, proj.edit],
  [/^\/projects\/(\d+)\/edit$/, proj.edit],
  [/^\/projects\/(\d+)(?:\/(\w+))?$/, proj.detail],
  [/^\/reports$/, rep.list],
  [/^\/reports\/new$/, rep.create],
  [/^\/reports\/(\d+)$/, rep.editor],
  [/^\/worklogs$/, misc.worklogs],
  [/^\/material-requests$/, mat.requests],
  [/^\/material-requests\/new$/, mat.requestEdit],
  [/^\/material-requests\/(\d+)\/edit$/, mat.requestEdit],
  [/^\/material-requests\/(\d+)$/, mat.requestDetail],
  [/^\/pos$/, mat.pos],
  [/^\/pos\/new$/, mat.poEdit],
  [/^\/pos\/(\d+)\/edit$/, mat.poEdit],
  [/^\/pos\/(\d+)$/, mat.poDetail],
  [/^\/materials$/, mat.master],
  [/^\/vendors$/, mat.vendors],
  [/^\/approvals$/, appr.list],
  [/^\/approvals\/new$/, appr.general],
  [/^\/approvals\/(\d+)$/, appr.detail],
  [/^\/notices$/, misc.notices],
  [/^\/notifications$/, misc.notifications],
  [/^\/account$/, misc.account],
  [/^\/admin\/users$/, adm.users],
  [/^\/admin\/roles$/, adm.roles],
  [/^\/admin\/codes$/, adm.codes],
  [/^\/admin\/company$/, adm.company],
  [/^\/admin\/lines$/, adm.lines],
  [/^\/admin\/trash$/, adm.trash],
  [/^\/admin\/audit$/, adm.audit],
];

function menu() {
  const m = [
    ["업무", [["#/", "대시보드"], ["#/projects", "공사·현장"], ["#/reports", "작업일보"], ["#/worklogs", "업무일지"]]],
    ["자재", [["#/material-requests", "자재 요청"], can("po.manage") || can("po.receive") || can("amount.purchase") ? ["#/pos", "발주·입고"] : ["#/pos", "발주·입고"],
      ["#/materials", "자재 마스터"], ["#/vendors", "거래처"]]],
    ["결재·소통", [["#/approvals", "전자결재", "approvals"], ["#/notices", "공지사항"], ["#/notifications", "알림", "noti"]]],
  ];
  const adminItems = [];
  if (can("admin.users")) adminItems.push(["#/admin/users", "사용자"], ["#/admin/roles", "역할·권한"]);
  if (can("admin.settings")) adminItems.push(["#/admin/company", "회사·문서번호"], ["#/admin/codes", "부서·직책"], ["#/admin/lines", "결재선"]);
  if (can("admin.trash")) adminItems.push(["#/admin/trash", "휴지통"]);
  if (can("audit.view")) adminItems.push(["#/admin/audit", "변경이력"]);
  if (adminItems.length) m.push(["관리자", adminItems]);
  return m;
}

let sideEl, contentEl, crumbEl, counts = {};

function shell() {
  const me = state.me;
  sideEl = h("aside", { class: "side", id: "side" });
  contentEl = h("div", { class: "content", id: "content" });
  crumbEl = h("span", { class: "crumb" });
  const top = h("header", { class: "top" },
    h("button", { class: "menu-btn", "aria-label": "메뉴 열기", onclick: () => sideEl.classList.toggle("open") }, "☰ 메뉴"),
    crumbEl, h("span", { class: "grow" }),
    h("a", { href: "#/notifications", class: "btn sm", id: "noti-btn" }, "알림"));
  const quick = h("nav", { class: "quick", "aria-label": "현장 빠른 입력" },
    h("a", { href: "#/reports/new", class: "primary" }, "일보 작성"),
    h("a", { href: "#/reports" }, "일보 목록"),
    h("a", { href: "#/approvals" }, "결재"));
  mount(root, h("div", { class: "shell" }, sideEl, h("div", { class: "main" }, top, contentEl)), can("report.write") ? quick : null);
  drawSide();
  refreshCounts();
}

function drawSide() {
  const me = state.me;
  const cur = location.hash.split("?")[0] || "#/";
  mount(sideEl,
    h("div", { class: "brand" }, me.company_logo_file_id ? h("img", { src: `/api/files/${me.company_logo_file_id}/download?inline=true`, alt: "" }) : null, me.company_name),
    h("nav", { class: "nav" }, menu().map(([g, items]) => [h("div", { class: "grp" }, g), items.map(([href, label, key]) => {
      const on = href === "#/" ? cur === "#/" || cur === "#" || cur === "" : cur.startsWith(href);
      const cnt = key === "approvals" ? counts.pending_approvals : key === "noti" ? counts.unread_notifications : 0;
      return h("a", { href, class: on ? "on" : "", onclick: () => sideEl.classList.remove("open") }, label, cnt ? h("span", { class: "cnt" }, cnt) : null);
    })])),
    h("div", { class: "me" }, h("div", h("b", me.name), " ", h("span", { class: "muted small" }, [me.position, me.role].filter(Boolean).join(" / "))),
      h("div", { class: "row" }, h("a", { href: "#/account", class: "small", style: { color: "#c9d3e3" } }, "내 계정"),
        h("button", { class: "sm", onclick: logout }, "로그아웃"))));
}

async function refreshCounts() {
  try {
    const d = await GET("/api/dashboard");
    counts = d.counts;
    drawSide();
    const nb = document.getElementById("noti-btn");
    if (nb) nb.textContent = counts.unread_notifications ? `알림 ${counts.unread_notifications}` : "알림";
  } catch { /* 표시용 */ }
}
window.addEventListener("gw:refresh-counts", refreshCounts);

async function logout() {
  if (state.dirty && !confirm("저장하지 않은 내용이 있습니다. 로그아웃할까요?")) return;
  try { await POST("/api/auth/logout"); } catch { }
  state.me = null; state.dirty = false; location.hash = "#/"; loginPage();
}

let lastHash = location.hash;
async function route() {
  if (!state.me) return;
  const [path, qs] = (location.hash.slice(1) || "/").split("?");
  const query = Object.fromEntries(new URLSearchParams(qs || ""));
  const hit = ROUTES.find(([re]) => re.test(path));
  drawSide();
  window.scrollTo(0, 0);
  if (!hit) { mount(contentEl, h("div", { class: "empty" }, h("b", "페이지를 찾을 수 없습니다."), h("a", { href: "#/" }, "대시보드로 이동"))); return; }
  const params = path.match(hit[0]).slice(1);
  mount(contentEl, h("div", { class: "empty" }, "불러오는 중…"));
  try {
    await hit[1](contentEl, params, query, (t) => { crumbEl.textContent = t; document.title = `${t} · 현장통합 그룹웨어`; });
  } catch (e) {
    if (e.status === 401 || e.status === 428) return;
    mount(contentEl, h("div", { class: "panel" }, h("div", { class: "empty" }, h("b", e.status === 403 ? "접근 권한이 없습니다." : e.status === 404 ? "자료를 찾을 수 없습니다." : "화면을 불러오지 못했습니다."), e.message)));
  }
}

window.addEventListener("hashchange", () => {
  if (state.dirty && !confirm("저장하지 않은 변경 내용이 있습니다. 이 화면을 떠나면 변경 내용이 사라집니다. 이동할까요?")) {
    history.replaceState(null, "", lastHash || "#/");
    return;
  }
  state.dirty = false;
  lastHash = location.hash;
  route();
});
window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------------------------------------------------------------- 로그인
function loginPage(msg) {
  const id = h("input", { autocomplete: "username", required: true, autocapitalize: "off" });
  const pw = h("input", { type: "password", autocomplete: "current-password", required: true });
  const err = h("div", { class: "msg", role: "alert" }, msg || "");
  const btn = h("button", { type: "submit", class: "primary" }, "로그인");
  const f = h("form", {},
    h("h1", "로그인"),
    h("div", { class: "f" }, h("label", "아이디"), id),
    h("div", { class: "f" }, h("label", "비밀번호"), pw),
    err, btn,
    h("p", { class: "small muted" }, "계정은 회사 관리자가 발급합니다. 비밀번호를 잊으면 관리자에게 초기화를 요청하세요."));
  f.addEventListener("submit", busy(btn, async () => {
    err.textContent = "";
    try {
      await api("POST", "/api/auth/login", { login_id: id.value.trim(), password: pw.value }, { noRedirect: true });
      await boot();
    } catch (e) { err.textContent = e.message; pw.value = ""; pw.focus(); }
  }));
  mount(root, h("div", { class: "login" },
    h("div", { class: "l" }, h("h1", "현장과 본사를", h("br"), "한 화면에서"), h("div", "전기·정보통신공사 현장 업무 통합 관리"),
      h("div", { class: "flow" }, "공사 등록 › 설계내역 › 공정계획 › 작업일보 › 공정률", h("br"), "자재 요청 › 결재 › 발주 › 입고")),
    h("div", { class: "r" }, f)));
  setTimeout(() => id.focus(), 30);
}

function mustChangePage() {
  const f = form([
    { k: "current_password", label: "현재(임시) 비밀번호", type: "password", req: true, cls: "full" },
    { k: "new_password", label: "새 비밀번호", type: "password", req: true, cls: "full", hint: "8자 이상, 영문·숫자·특수문자 중 2종류 이상" },
    { k: "confirm", label: "새 비밀번호 확인", type: "password", req: true, cls: "full" },
  ]);
  const btn = h("button", { type: "submit", class: "primary" }, "비밀번호 변경");
  const fe = h("form", {}, h("h1", "비밀번호 변경"), h("p", { class: "small muted" }, "처음 로그인했거나 관리자가 비밀번호를 초기화했습니다. 새 비밀번호를 정해야 사용할 수 있습니다."), f.el, btn,
    h("button", { type: "button", class: "link", onclick: logout }, "로그아웃"));
  fe.addEventListener("submit", busy(btn, async () => {
    if (!f.validate()) return;
    const v = f.get();
    if (v.new_password !== v.confirm) { toast("새 비밀번호 확인이 일치하지 않습니다.", "bad"); return; }
    await POST("/api/auth/password", { current_password: v.current_password, new_password: v.new_password });
    toast("비밀번호를 변경했습니다.", "ok");
    await boot();
  }));
  mount(root, h("div", { class: "login" }, h("div", { class: "l" }, h("h1", state.me?.company_name || "")), h("div", { class: "r" }, fe)));
}

window.addEventListener("gw:logout", () => loginPage("로그인 세션이 만료되었습니다. 다시 로그인하세요."));
window.addEventListener("gw:mustchange", () => mustChangePage());

async function boot() {
  try {
    state.me = await api("GET", "/api/auth/me", undefined, { noRedirect: true });
  } catch (e) {
    if (e.status === 401) return loginPage();
    mount(root, h("div", { class: "empty" }, h("b", "서버에 연결할 수 없습니다."), e.message));
    return;
  }
  state.users = null; state.codes = null;
  if (state.me.must_change_password) return mustChangePage();
  shell();
  lastHash = location.hash;
  route();
}
boot();
