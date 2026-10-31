import {
  GET, POST, PUT, DEL, api, h, mount, can, table, form, badge, demoTag, fmtNum, fmtWon, fmtRate, fmtDT, pbar, toast, fail,
  modal, confirmBox, promptBox, button, users, uploader, fileList, saveState, state, todayKST, addDays, pdfButtons, codes,
} from "../lib.js";
import { reportTable } from "./reports.js";
import { reqTable, poTable } from "./materials.js";

const STATUSES = ["준비", "진행", "중지", "준공", "정산완료"];

export async function list(el, _p, q, title) {
  title("공사·현장");
  const rows = await GET("/api/projects" + (q.status ? `?status=${encodeURIComponent(q.status)}` : ""));
  const amt = can("amount.contract");
  mount(el,
    h("div", { class: "page-head" }, h("h1", "공사·현장"), q.status ? h("span", { class: "st info" }, `상태: ${q.status}`) : null,
      q.status ? h("a", { href: "#/projects", class: "small" }, "전체 보기") : null, h("span", { class: "grow" }),
      can("project.create") ? h("a", { class: "btn primary", href: "#/projects/new" }, "공사 등록") : null),
    h("div", { class: "panel" }, table([
      { k: "code", label: "공사번호", w: 120 },
      { k: "name", label: "공사명", render: (r) => [h("a", { href: `#/projects/${r.id}` }, r.name), demoTag(r)] },
      { k: "client", label: "발주처" },
      { k: "sector", label: "관급/민간" }, { k: "contract_type", label: "원/하도급" }, { k: "work_kind", label: "공종" },
      { k: "start_date", label: "착공일" }, { k: "planned_end_date", label: "준공예정" },
      amt ? { k: "total_amount", label: "계약총액", num: true } : null,
      { k: "site_manager_name", label: "현장소장" },
      { k: "status", label: "상태", render: (r) => badge(r.status) },
    ].filter(Boolean), rows, { onRow: (r) => (location.hash = `#/projects/${r.id}`), filters: [{ k: "status", label: "상태" }, { k: "sector", label: "관급/민간" }, { k: "work_kind", label: "공종" }],
      empty: can("project.create") ? "등록된 공사가 없습니다. 오른쪽 위 '공사 등록'으로 시작하세요." : "배정된 현장이 없습니다. 관리자에게 현장 배정을 요청하세요." })));
}

export async function edit(el, [pid], _q, title) {
  const isNew = !pid;
  const p = isNew ? { status: "진행", sector: "관급", contract_type: "원도급", work_kind: "전기", progress_method: "amount" } : await GET(`/api/projects/${pid}`);
  title(isNew ? "공사 등록" : "공사 수정");
  const us = await users();
  const uopts = us.map((u) => ({ value: u.id, label: `${u.name} ${u.position || ""}` }));
  const ss = saveState();
  const f = form([
    { type: "section", label: "기본 정보" },
    { k: "code", label: "공사번호", req: true }, { k: "name", label: "공사명", req: true, cls: "two" },
    { k: "address", label: "현장 주소", cls: "full" },
    { k: "client", label: "발주처" }, { k: "prime_contractor", label: "원도급사" }, { k: "supervisor", label: "감리단" },
    { k: "sector", label: "관급·민간", type: "select", options: ["관급", "민간"], blank: false },
    { k: "contract_type", label: "원도급·하도급", type: "select", options: ["원도급", "하도급"], blank: false },
    { k: "work_kind", label: "공사 구분", type: "select", options: ["전기", "통신", "복합"], blank: false },
    { k: "status", label: "공사 상태", type: "select", options: STATUSES, blank: false },
    { type: "section", label: "일정" },
    { k: "contract_date", label: "계약일", type: "date" }, { k: "start_date", label: "착공일", type: "date" },
    { k: "planned_end_date", label: "준공예정일", type: "date" }, { k: "actual_end_date", label: "실제 준공일", type: "date" },
    { type: "section", label: "계약금액" },
    ...(isNew ? [{ k: "supply_amount", label: "공급가액(원)", type: "money", req: true },
      { k: "vat_amount", label: "부가세(원)", type: "money", hint: "비우면 부가세율로 자동 계산" }] : []),
    { type: "section", label: "담당자·공정률 기준" },
    { k: "site_manager_id", label: "현장소장", type: "select", options: uopts, int: true },
    { k: "admin_staff_id", label: "공무 담당", type: "select", options: uopts, int: true },
    { k: "progress_method", label: "전체 공정률 계산", type: "select", blank: false, options: [{ value: "amount", label: "설계금액 가중" }, { value: "custom", label: "사용자 지정 가중치" }] },
    { k: "note", label: "특이사항", type: "textarea", cls: "full" },
  ], p, { onDirty: () => ss.set("dirty") });
  const save = button(isNew ? "등록" : "저장", async () => {
    if (!f.validate()) return;
    ss.set("saving");
    const body = { ...f.get(), version: p.version };
    try {
      const r = isNew ? await POST("/api/projects", body) : await PUT(`/api/projects/${pid}`, body);
      ss.set("saved"); state.dirty = false;
      toast(isNew ? "공사를 등록했습니다." : "저장했습니다.", "ok");
      location.hash = `#/projects/${r.id}`;
    } catch (e) { ss.set("failed", "저장 실패: " + e.message); throw e; }
  }, "primary");
  mount(el, h("div", { class: "page-head" }, h("h1", isNew ? "공사 등록" : `공사 수정 · ${p.name}`), h("span", { class: "grow" }), ss.el,
    h("a", { class: "btn", href: isNew ? "#/projects" : `#/projects/${pid}` }, "취소"), save),
    !isNew ? h("p", { class: "small muted" }, "계약금액은 '변경이력' 탭의 계약변경 등록으로만 바꿀 수 있습니다(변경 전후 이력 보존).") : null,
    h("div", { class: "panel" }, h("div", { class: "pb" }, f.el)),
    isNew ? h("p", { class: "small muted" }, "계약서·도면·내역서·시방서는 등록 후 '문서' 탭에서 첨부합니다.") : null);
}

const TABS = [["overview", "개요"], ["progress", "공정"], ["boq", "설계내역"], ["reports", "작업일보"], ["materials", "자재"],
  ["labor", "인력·장비"], ["photos", "사진"], ["docs", "문서"], ["changes", "변경이력"]];
const LATER = ["원가", "기성", "안전·품질"];

export async function detail(el, [pid, tab = "overview"], q, title) {
  const p = await GET(`/api/projects/${pid}`);
  title(p.name);
  const body = h("div");
  mount(el,
    h("div", { class: "page-head" }, h("div", h("h1", p.name, demoTag(p)), h("div", { class: "sub" }, `${p.code} · ${p.client || "발주처 미입력"} · ${p.sector}/${p.contract_type}/${p.work_kind}`)),
      badge(p.status), h("span", { class: "grow" }),
      can("project.edit") ? h("a", { class: "btn", href: `#/projects/${pid}/edit` }, "공사 수정") : null,
      can("report.write") ? h("a", { class: "btn primary", href: `#/reports/new?project=${pid}` }, "작업일보 작성") : null),
    h("nav", { class: "tabs" }, TABS.map(([k, l]) => h("a", { href: `#/projects/${pid}/${k}`, class: k === tab ? "on" : "" }, l)),
      LATER.map((l) => h("span", { class: "later", title: "2차 개발 예정 — 아직 사용할 수 없습니다" }, l + " (2차)"))),
    body);
  const fn = { overview, progress, boq, reports, materials, labor, photos, docs, changes }[tab];
  if (!fn) return mount(body, h("div", { class: "empty" }, "알 수 없는 탭"));
  await fn(body, p, q);
}

async function overview(el, p) {
  const amt = can("amount.contract");
  const members = p.members || [];
  mount(el, h("div", { class: "grid g2" },
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "공사 개요")), h("div", { class: "pb" }, h("dl", { class: "kv" },
      ...[["현장 주소", p.address], ["발주처", p.client], ["원도급사", p.prime_contractor], ["감리단", p.supervisor],
        ["계약일", p.contract_date], ["착공일", p.start_date], ["준공예정일", p.planned_end_date], ["실제 준공일", p.actual_end_date],
        ["현장소장", p.site_manager_name], ["공무 담당", p.admin_staff_name], ["특이사항", p.note]].flatMap(([k, v]) => [h("dt", k), h("dd", v || "—")])))),
    h("div", {},
      h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "공정률"), h("span", { class: "muted small" }, `기준일 ${p.progress.basis_date}`)),
        h("div", { class: "pb" }, pbar(p.progress.actual_rate, p.progress.plan_rate),
          h("p", "실적 ", h("b", fmtRate(p.progress.actual_rate)), " · 계획 ", fmtRate(p.progress.plan_rate), " · 편차 ", p.progress.deviation ?? "—", "%p"),
          h("a", { href: `#/projects/${p.id}/progress` }, "계산 근거 보기"))),
      amt ? h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "계약금액"), h("span", { class: "muted small" }, "공급가액·부가세 구분")),
        h("div", { class: "pb" }, h("dl", { class: "kv" }, h("dt", "최초 공급가액"), h("dd", fmtWon(p.original_supply_amount)), h("dt", "현재 공급가액"), h("dd", fmtWon(p.supply_amount)),
          h("dt", "부가세"), h("dd", fmtWon(p.vat_amount)), h("dt", "계약총액"), h("dd", h("b", fmtWon(p.total_amount))), h("dt", "설계내역 합계"), h("dd", fmtWon(p.boq_total))))) : null,
      h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "참여 직원"), h("span", { class: "grow" }), can("project.edit") ? button("배정 변경", () => editMembers(p), "sm") : null),
        h("div", { class: "pb" }, members.length ? h("ul", { style: { margin: 0, paddingLeft: "18px" } }, members.map((m) => h("li", `${m.name} ${m.position || ""} — ${m.role_in_project || "참여"}`))) : h("div", { class: "muted" }, "배정된 직원이 없습니다. 현장 직원은 배정된 현장만 볼 수 있습니다."))))));
}

async function editMembers(p) {
  const us = await users();
  const cur = new Map((p.members || []).map((m) => [m.user_id, m.role_in_project || ""]));
  const rows = us.map((u) => {
    const cb = h("input", { type: "checkbox", checked: cur.has(u.id) });
    const role = h("input", { value: cur.get(u.id) || "", placeholder: "역할(선택)" });
    return { u, cb, role };
  });
  const r = await modal("참여 직원 배정", h("div", {}, h("p", { class: "small muted" }, "체크한 직원이 이 현장에 접근할 수 있습니다. (현장소장·공무 담당은 자동 포함)"),
    h("table", { class: "t" }, h("tbody", rows.map(({ u, cb, role }) => h("tr", h("td", cb), h("td", `${u.name} ${u.position || ""}`), h("td", { class: "muted small" }, u.department || ""), h("td", role)))))),
    [{ label: "저장", cls: "primary", run: async () => {
      await PUT(`/api/projects/${p.id}/members`, rows.filter((x) => x.cb.checked).map((x) => ({ user_id: x.u.id, role_in_project: x.role.value || null })));
      toast("참여 직원을 저장했습니다.", "ok");
    } }]);
  if (r) location.reload();
}

// ---------------------------------------------------------------- 공정
async function progress(el, p, q) {
  const basis = q.basis || todayKST();
  const unit = q.unit || "week";
  const [pr, series] = await Promise.all([GET(`/api/projects/${p.id}/boq/progress?basis=${basis}`), GET(`/api/projects/${p.id}/boq/progress-series?unit=${unit}`)]);
  const basisInp = h("input", { type: "date", value: basis, onchange: (e) => (location.hash = `#/projects/${p.id}/progress?basis=${e.target.value}&unit=${unit}`) });
  mount(el,
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "전체 공정률"), h("span", { class: "muted small" }, "기준일"), basisInp, h("span", { class: "grow" }),
      pdfButtons(`/api/export/projects/${p.id}/progress.pdf?basis=${basis}`),
      can("export.data") ? h("a", { class: "btn", href: `/api/export/projects/${p.id}/boq.xlsx?basis=${basis}` }, "엑셀") : null),
      h("div", { class: "pb" }, pbar(pr.actual_rate, pr.plan_rate),
        h("p", "실적 ", h("b", fmtRate(pr.actual_rate)), " · 계획 ", fmtRate(pr.plan_rate), " · 편차 ", pr.deviation ?? "—", "%p · 방식: ", pr.method_label),
        h("p", { class: "small muted" }, "계산 근거: ", pr.basis_note, " 설계수량이 0인 항목은 계산 불가로 제외하며, 서로 다른 단위의 수량은 합산하지 않습니다."),
        pr.excluded.length ? h("p", { class: "small" }, "제외 항목: ", pr.excluded.map((x) => `${x.name}(${x.reason})`).join(", ")) : null)),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "항목별 공정률")), table([
      { k: "name", label: "품명" }, { k: "spec", label: "규격" }, { k: "unit", label: "단위" },
      { k: "design_qty", label: "설계수량", num: true }, { k: "plan_qty", label: "계획누계", num: true }, { k: "cum_qty", label: "실적누계", num: true },
      { k: "remaining_qty", label: "잔량", num: true },
      { k: "plan_rate", label: "계획(%)", num: true }, { k: "rate", label: "실적(%)", num: true, render: (r) => r.rate === null ? h("span", { class: "st draft" }, "계산불가") : fmtNum(r.rate) },
      { k: "over_qty", label: "초과수량", num: true, render: (r) => r.over_qty ? h("span", { class: "st warn" }, fmtNum(r.over_qty)) : "" },
      { k: "weight_share", label: "반영비율(%)", num: true }, { k: "excluded_reason", label: "비고" },
    ], pr.items, { pageSize: 100 })),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "공정표 (간트차트)"), h("span", { class: "muted small" }, "옅은 막대 = 계획기간, 진한 막대 = 실적기간(첫 실적일~마지막 실적일), 주황선 = 기준일")),
      h("div", { class: "pb" }, gantt(pr.items, basis, p))),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", unit === "month" ? "월간 공정 추이" : "주간 공정 추이"), h("span", { class: "grow" }),
      h("a", { class: "btn sm" + (unit === "week" ? " primary" : ""), href: `#/projects/${p.id}/progress?basis=${basis}&unit=week` }, "주간"),
      h("a", { class: "btn sm" + (unit === "month" ? " primary" : ""), href: `#/projects/${p.id}/progress?basis=${basis}&unit=month` }, "월간")),
      table([{ k: "date", label: "기준일" }, { k: "plan", label: "계획(%)", num: true }, { k: "actual", label: "실적(%)", num: true },
        { k: "bar", label: "", sort: false, render: (r) => pbar(r.actual, r.plan) }], series, { search: false, pageSize: 60 })));
}

function gantt(items, basis, p) {
  const dated = items.filter((i) => i.plan_start || i.actual_start);
  if (!dated.length) return h("div", { class: "empty" }, h("b", "계획 일정이 입력된 항목이 없습니다."), "설계내역 탭에서 항목별 계획 시작일·종료일을 입력하세요.");
  const dates = dated.flatMap((i) => [i.plan_start, i.plan_end, i.actual_start, i.actual_end]).filter(Boolean).concat([basis]);
  if (p.start_date) dates.push(p.start_date);
  if (p.planned_end_date) dates.push(p.planned_end_date);
  const min = dates.reduce((a, b) => (a < b ? a : b)), max = dates.reduce((a, b) => (a > b ? a : b));
  const t0 = Date.parse(min), span = Math.max(1, (Date.parse(max) - t0) / 864e5 + 1);
  const pos = (d) => ((Date.parse(d) - t0) / 864e5 / span) * 100;
  const wid = (a, b) => Math.max(0.6, ((Date.parse(b) - Date.parse(a)) / 864e5 + 1) / span * 100);
  const ticks = [];
  const stepDays = span > 120 ? 30 : 7;
  for (let d = min; d <= max; d = addDays(d, stepDays)) ticks.push(d);
  return h("div", { class: "gantt" },
    h("div", { class: "gh" }, h("div", { class: "gname muted small" }, "항목"), h("div", { class: "gscale" }, ticks.map((d) => [h("div", { class: "tick", style: { left: pos(d) + "%" } }), h("span", { style: { left: pos(d) + "%" } }, d.slice(5))]))),
    dated.map((i) => h("div", { class: "gr" }, h("div", { class: "gname", title: `${i.name} ${i.spec || ""}` }, i.name, " ", h("span", { class: "muted small" }, `${fmtRate(i.rate)}`)),
      h("div", { class: "gtrack" }, ticks.map((d) => h("div", { class: "tick", style: { left: pos(d) + "%" } })),
        h("div", { class: "today", style: { left: pos(basis) + "%" } }),
        i.plan_start && i.plan_end ? h("div", { class: "bp", style: { left: pos(i.plan_start) + "%", width: wid(i.plan_start, i.plan_end) + "%" }, title: `계획 ${i.plan_start} ~ ${i.plan_end}` }) : null,
        i.actual_start ? h("div", { class: "ba", style: { left: pos(i.actual_start) + "%", width: wid(i.actual_start, i.actual_end) + "%" }, title: `실적 ${i.actual_start} ~ ${i.actual_end}` }) : null))));
}

// ---------------------------------------------------------------- 설계내역
async function boq(el, p) {
  const b = await GET(`/api/projects/${p.id}/boq`);
  const edit = can("boq.edit");
  const showAmt = b.show_amounts;
  const g1 = b.groups.filter((g) => g.level === 1);
  const kids = (gid) => b.groups.filter((g) => g.parent_id === gid);
  const itemsOf = (gid) => b.items.filter((i) => i.group_id === gid);
  const reload = () => boq(el, p);
  const colCount = showAmt ? 11 : 7;
  const itemRow = (i, depth) => h("tr", {},
    h("td", { style: { paddingLeft: 16 + depth * 18 + "px" } }, i.name, i.include_in_progress ? null : h("span", { class: "st draft", style: { marginLeft: "6px" } }, "공정률 미반영")),
    h("td", i.spec || ""), h("td", i.unit), h("td", { class: "num" }, fmtNum(i.design_qty)),
    showAmt ? [h("td", { class: "num" }, fmtNum(i.mat_unit_price)), h("td", { class: "num" }, fmtNum(i.labor_unit_price)), h("td", { class: "num" }, fmtNum(i.exp_unit_price)), h("td", { class: "num" }, fmtNum(i.amount))] : null,
    h("td", { class: "small" }, i.plan_start ? `${i.plan_start} ~ ${i.plan_end || ""}` : h("span", { class: "muted" }, "미입력"), i.plans.length ? h("div", { class: "muted" }, `기간별 계획 ${i.plans.length}건`) : null),
    h("td", { class: "small" }, i.assignee_name || ""),
    h("td", edit ? h("div", { class: "row" }, button("수정", () => itemDialog(p, b, i).then((r) => r && reload()), "sm"),
      button("계획", () => planDialog(p, i).then((r) => r && reload()), "sm"),
      button("삭제", async () => { if (await confirmBox(`'${i.name}' 항목을 삭제할까요? (휴지통으로 이동)`, "삭제", "danger")) { await DEL(`/api/projects/${p.id}/boq/items/${i.id}`); toast("삭제했습니다."); reload(); } }, "sm danger")) : null));
  const groupRow = (g, depth) => h("tr", { style: { background: depth ? "#fafbfd" : "#f1f4f9" } },
    h("td", { colspan: colCount - 1, style: { paddingLeft: 10 + depth * 18 + "px", fontWeight: 700 } }, (depth ? "└ " : "") + g.name, h("span", { class: "muted small" }, depth ? " 중공종" : " 대공종")),
    h("td", edit ? h("div", { class: "row" },
      depth === 0 ? button("중공종", () => addGroup(p, g.id).then((r) => r && reload()), "sm") : null,
      button("항목 추가", () => itemDialog(p, b, { group_id: g.id }).then((r) => r && reload()), "sm"),
      button("이름", async () => { const n = await promptBox("공종 이름 변경", "공종명", { multiline: false, value: g.name }); if (n) { await PUT(`/api/projects/${p.id}/boq/groups/${g.id}`, { name: n, sort: g.sort }); reload(); } }, "sm"),
      button("순서", async () => { const n = await promptBox("정렬 순서", "숫자가 작을수록 위에 표시", { multiline: false, value: String(g.sort) }); if (n !== null && !isNaN(Number(n))) { await PUT(`/api/projects/${p.id}/boq/groups/${g.id}`, { name: g.name, sort: Number(n) }); reload(); } }, "sm"),
      button("삭제", async () => { if (await confirmBox(`'${g.name}' 공종을 삭제할까요?`, "삭제", "danger")) { await DEL(`/api/projects/${p.id}/boq/groups/${g.id}`); reload(); } }, "sm danger")) : null));
  const rows = [];
  for (const g of g1) {
    rows.push(groupRow(g, 0));
    itemsOf(g.id).forEach((i) => rows.push(itemRow(i, 1)));
    for (const c of kids(g.id)) { rows.push(groupRow(c, 1)); itemsOf(c.id).forEach((i) => rows.push(itemRow(i, 2))); }
  }
  const total = b.items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  mount(el, h("div", { class: "panel" },
    h("div", { class: "ph" }, h("h2", "설계내역"), h("span", { class: "muted small" }, `세부항목 ${b.items.length}개`), h("span", { class: "grow" }),
      edit ? button("대공종 추가", () => addGroup(p, null).then((r) => r && reload()), "") : null,
      edit && !b.groups.length ? button("전기·통신 공종 샘플 넣기", async () => { await POST(`/api/projects/${p.id}/boq/sample`); toast("샘플 공종을 넣었습니다. 자유롭게 수정·삭제하세요."); reload(); }) : null,
      edit ? button("엑셀 업로드", () => importDialog("boq", p.id).then((r) => r && reload())) : null,
      h("a", { class: "btn", href: "/api/import/template/boq.xlsx" }, "업로드 양식"),
      can("export.data") ? h("a", { class: "btn", href: `/api/export/projects/${p.id}/boq.xlsx` }, "엑셀 내보내기") : null),
    h("div", { class: "tbl-wrap" }, h("table", { class: "t" },
      h("thead", h("tr", h("th", "공종 / 품명"), h("th", "규격"), h("th", "단위"), h("th", { class: "num" }, "설계수량"),
        showAmt ? [h("th", { class: "num" }, "재료비단가"), h("th", { class: "num" }, "노무비단가"), h("th", { class: "num" }, "경비단가"), h("th", { class: "num" }, "설계금액")] : null,
        h("th", "계획기간"), h("th", "담당"), h("th", ""))),
      h("tbody", rows.length ? rows : h("tr", h("td", { colspan: colCount }, h("div", { class: "empty" }, h("b", "설계내역이 없습니다."), edit ? "대공종을 추가하거나 엑셀 양식으로 업로드하세요." : "")))),
      showAmt && b.items.length ? h("tfoot", h("tr", h("td", { colspan: 7, style: { textAlign: "right" } }, "설계금액 합계"), h("td", { class: "num" }, fmtNum(total)), h("td", { colspan: 3 }))) : null)),
    !showAmt ? h("p", { class: "small muted", style: { padding: "0 16px 12px" } }, "단가·금액은 권한이 있는 사용자에게만 표시됩니다.") : null));
}

async function addGroup(p, parent_id) {
  const n = await promptBox(parent_id ? "중공종 추가" : "대공종 추가", "공종명", { multiline: false });
  if (!n) return null;
  await POST(`/api/projects/${p.id}/boq/groups`, { name: n, parent_id, sort: 999 });
  return true;
}

async function itemDialog(p, b, it) {
  const us = await users();
  const groups = b.groups.map((g) => ({ value: g.id, label: (g.level === 2 ? "　└ " : "") + g.name }));
  const showAmt = b.show_amounts;
  const f = form([
    { k: "group_id", label: "공종", type: "select", options: groups, req: true, int: true, blank: false },
    { k: "name", label: "품명", req: true }, { k: "spec", label: "규격" }, { k: "unit", label: "단위", req: true, hint: "예: m, EA, 식, 면, 대" },
    { k: "design_qty", label: "설계수량", type: "qty", req: true },
    ...(showAmt ? [{ k: "mat_unit_price", label: "재료비 단가", type: "money" }, { k: "labor_unit_price", label: "노무비 단가", type: "money" }, { k: "exp_unit_price", label: "경비 단가", type: "money" }] : []),
    { k: "plan_start", label: "계획 시작일", type: "date" }, { k: "plan_end", label: "계획 종료일", type: "date" },
    { k: "assignee_id", label: "담당자", type: "select", options: us.map((u) => ({ value: u.id, label: u.name })), int: true },
    { k: "include_in_progress", label: "전체 공정률에 반영", type: "checkbox", default: true },
    { k: "custom_weight", label: "사용자 지정 가중치", type: "qty", hint: "공정률 방식이 '사용자 지정'일 때 사용" },
    { k: "sort", label: "정렬 순서", type: "number", default: 0 },
  ], { include_in_progress: true, ...it });
  return modal(it.id ? "세부항목 수정" : "세부항목 추가", f.el, [{ label: "저장", cls: "primary", run: async () => {
    if (!f.validate()) return false;
    const v = f.get();
    v.sort = Number(v.sort || 0);
    v.version = it.version;
    if (!showAmt) { delete v.mat_unit_price; delete v.labor_unit_price; delete v.exp_unit_price; }
    if (it.id) await PUT(`/api/projects/${p.id}/boq/items/${it.id}`, v); else await POST(`/api/projects/${p.id}/boq/items`, v);
    toast("저장했습니다.", "ok");
  } }], { wide: true });
}

async function planDialog(p, it) {
  let rows = it.plans.map((x) => ({ ...x }));
  const box = h("div");
  const draw = () => mount(box,
    h("p", { class: "small muted" }, `설계수량 ${fmtNum(it.design_qty)} ${it.unit}. 날짜별 '계획 누계수량'을 입력하면 계획공정률이 그 값으로 계산됩니다. 비워두면 계획 시작~종료일 균등 배분으로 계산합니다.`),
    h("table", { class: "t" }, h("thead", h("tr", h("th", "기준일"), h("th", { class: "num" }, "계획 누계수량"), h("th", ""))),
      h("tbody", rows.map((r, i) => h("tr", h("td", h("input", { type: "date", value: r.plan_date, onchange: (e) => (r.plan_date = e.target.value) })),
        h("td", h("input", { value: r.planned_cum_qty, inputMode: "decimal", onchange: (e) => (r.planned_cum_qty = e.target.value.replace(/,/g, "")) })),
        h("td", h("button", { class: "sm", onclick: () => { rows.splice(i, 1); draw(); } }, "삭제")))))),
    h("button", { class: "sm", style: { marginTop: "8px" }, onclick: () => { rows.push({ plan_date: todayKST(), planned_cum_qty: "" }); draw(); } }, "행 추가"));
  draw();
  return modal(`공정계획 · ${it.name}`, box, [{ label: "저장", cls: "primary", run: async () => {
    if (rows.some((r) => !r.plan_date || r.planned_cum_qty === "")) { toast("날짜와 수량을 모두 입력하세요.", "bad"); return false; }
    await PUT(`/api/projects/${p.id}/boq/items/${it.id}/plans`, rows);
    toast("공정계획을 저장했습니다.", "ok");
  } }]);
}

/** 엑셀 업로드: 파일 선택 → 미리보기·열 매핑·검증 → 정상 행 선택 반영 */
export async function importDialog(kind, project_id) {
  const box = h("div");
  const fileInp = h("input", { type: "file", accept: ".xlsx" });
  let job = null, mapping = {}, selected = new Set();
  const render = (res) => {
    const valid = res.rows.filter((r) => r.valid).length;
    mount(box,
      h("h3", "열 매핑"), h("p", { class: "small muted" }, "엑셀의 어느 열이 어떤 항목인지 확인하세요. 필수(*) 항목은 반드시 지정해야 합니다."),
      h("div", { class: "form" }, job.fields.map((f) => h("div", { class: "f" }, h("label", f.label, f.required ? h("span", { class: "req" }, "*") : null),
        h("select", { onchange: async (e) => { mapping[f.key] = e.target.value === "" ? null : Number(e.target.value); await revalidate(); } },
          h("option", { value: "" }, "(사용 안 함)"), job.headers.map((hd, i) => h("option", { value: i, selected: mapping[f.key] === i }, hd || `${i + 1}열`)))))),
      res.mapping_error ? h("p", { class: "msg" }, res.mapping_error) : null,
      h("h3", { style: { marginTop: "14px" } }, `검증 결과: 전체 ${res.rows.length}행 · 정상 ${valid}행 · 오류 ${res.rows.length - valid}행`),
      h("div", { class: "row" }, h("button", { class: "sm", onclick: () => { selected = new Set(res.rows.filter((r) => r.valid).map((r) => r.index)); render(res); } }, "정상 행 모두 선택"),
        h("button", { class: "sm", onclick: () => { selected.clear(); render(res); } }, "선택 해제")),
      h("div", { class: "tbl-wrap", style: { maxHeight: "40vh", marginTop: "8px" } }, h("table", { class: "t" },
        h("thead", h("tr", h("th", "반영"), h("th", "엑셀 행"), job.fields.map((f) => h("th", f.label)), h("th", "검증"))),
        h("tbody", res.rows.map((r) => h("tr", { style: r.valid ? null : { background: "#fff6f5" } },
          h("td", h("input", { type: "checkbox", disabled: !r.valid, checked: selected.has(r.index), onchange: (e) => { e.target.checked ? selected.add(r.index) : selected.delete(r.index); } })),
          h("td", r.index + 2), job.fields.map((f) => h("td", String(r.values[f.key] ?? ""))),
          h("td", { class: "small" }, r.errors.map((e) => h("div", { style: { color: "var(--bad)" } }, e)), r.warnings.map((w) => h("div", { style: { color: "var(--warn)" } }, w)), r.valid && !r.warnings.length ? h("span", { class: "st ok" }, "정상") : null)))))));
  };
  const revalidate = async () => { try { const r = await POST(`/api/import/${job.job_id}/validate`, { mapping }); selected.clear(); render({ rows: r.rows }); } catch (e) { fail(e); } };
  mount(box, h("p", "업로드 양식(.xlsx)에 작성한 파일을 선택하세요. 반영 전에 미리보기에서 오류를 확인합니다."), fileInp);
  fileInp.addEventListener("change", async () => {
    const fd = new FormData(); fd.append("kind", kind); if (project_id) fd.append("project_id", project_id); fd.append("file", fileInp.files[0]);
    try { job = await api("POST", "/api/import/preview", fd); mapping = { ...job.mapping }; render(job); } catch (e) { fail(e); }
  });
  return modal(kind === "boq" ? "설계내역 엑셀 업로드" : "자재 엑셀 업로드", box, [{ label: "선택한 행 반영", cls: "primary", run: async () => {
    if (!job) { toast("파일을 먼저 선택하세요.", "bad"); return false; }
    if (!selected.size) { toast("반영할 정상 행을 선택하세요.", "bad"); return false; }
    const r = await POST(`/api/import/${job.job_id}/commit`, { mapping, selected: [...selected] });
    toast(`${r.inserted}행을 반영했습니다.`, "ok");
  } }], { wide: true });
}

// ---------------------------------------------------------------- 하위 목록 탭
async function reports(el, p) {
  const rows = await GET(`/api/daily-reports?project_id=${p.id}`);
  mount(el, h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "작업일보"), h("span", { class: "grow" }),
    can("export.data") ? h("a", { class: "btn", href: `/api/export/daily-reports.xlsx?project_id=${p.id}` }, "엑셀") : null,
    can("report.write") ? h("a", { class: "btn primary", href: `#/reports/new?project=${p.id}` }, "작성") : null), reportTable(rows, false)));
}

async function materials(el, p) {
  const [reqs, pos] = await Promise.all([GET(`/api/material-requests?project_id=${p.id}`), GET(`/api/purchase-orders?project_id=${p.id}`)]);
  mount(el,
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "자재 요청"), h("span", { class: "grow" }),
      can("material.request") ? h("a", { class: "btn primary", href: `#/material-requests/new?project=${p.id}` }, "자재 요청") : null), reqTable(reqs, false)),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "발주·입고")), poTable(pos, false)),
    h("p", { class: "small muted" }, "현장 재고·현장 간 이동·관급자재 관리는 2차 개발 범위입니다. 현재는 발주별 입고·반품 수량만 관리합니다."));
}

async function labor(el, p) {
  const rows = await GET(`/api/daily-reports?project_id=${p.id}&status=approved`);
  const details = await Promise.all(rows.slice(0, 60).map((r) => GET(`/api/daily-reports/${r.id}`)));
  const byTrade = {}; const equip = [];
  for (const d of details) {
    for (const l of d.labor) byTrade[l.trade] = (byTrade[l.trade] || 0) + Number(l.headcount);
    for (const e of d.equipment) equip.push({ date: d.report_date, ...e });
  }
  mount(el, h("p", { class: "small muted" }, "승인된 작업일보(최근 60건)의 투입인원·장비를 모아 보여줍니다. 출역관리·노무비·장비 단가 집계는 2차 개발 범위입니다."),
    h("div", { class: "grid g2" },
      h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "직종별 누적 투입인원")), table([{ k: "trade", label: "직종" }, { k: "n", label: "누적 인원", num: true }],
        Object.entries(byTrade).map(([trade, n]) => ({ trade, n: String(n) })), { search: false })),
      h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "장비 사용")), table([{ k: "date", label: "일자" }, { k: "kind", label: "장비" }, { k: "spec", label: "규격" },
        { k: "count", label: "대수", num: true }, { k: "hours", label: "시간", num: true }], equip))));
}

async function photos(el, p, q) {
  const c = await codes();
  const params = new URLSearchParams({ project_id: p.id, category: "사진" });
  if (q.phase) params.set("phase", q.phase);
  if (q.from) params.set("date_from", q.from);
  if (q.to) params.set("date_to", q.to);
  const files = await GET(`/api/files?${params}`);
  const sel = new Set();
  const meta = { taken_date: h("input", { type: "date", value: todayKST() }), phase: h("select", {}, h("option", { value: "" }, "구분"), c.photo_phases.map((x) => h("option", x))),
    work_type: h("input", { placeholder: "공종" }), location: h("input", { placeholder: "위치" }), title: h("input", { placeholder: "제목·작업내용" }) };
  const go = (k, v) => { const n = { ...q, [k]: v }; location.hash = `#/projects/${p.id}/photos?` + new URLSearchParams(Object.fromEntries(Object.entries(n).filter(([, x]) => x))); };
  const perPage = h("select", {}, [2, 4, 6].map((n) => h("option", { value: n, selected: n === 4 }, `페이지당 ${n}장`)));
  const ledger = () => {
    const ps = new URLSearchParams({ per_page: perPage.value });
    if (sel.size) ps.set("ids", [...sel].join(","));
    else { if (q.phase) ps.set("phase", q.phase); if (q.from) ps.set("date_from", q.from); if (q.to) ps.set("date_to", q.to); }
    window.open(`/api/export/projects/${p.id}/photo-ledger.pdf?${ps}&inline=true`, "_blank");
  };
  const cardOf = (f) => {
    const cb = h("input", { type: "checkbox", "aria-label": "사진대장에 포함", onchange: (e) => (e.target.checked ? sel.add(f.id) : sel.delete(f.id)) });
    return h("div", { class: "ph-card" }, cb,
      h("a", { href: `/api/files/${f.id}/download?inline=true`, target: "_blank" }, h("img", { src: `/api/files/${f.id}/thumb`, loading: "lazy", alt: f.title || f.name })),
      h("div", { class: "cap" }, h("div", h("b", f.phase || ""), " ", f.title || f.name), h("div", { class: "muted" }, `${f.taken_date || ""} ${f.location || ""}`),
        h("button", { class: "link small", onclick: () => photoMeta(f, c).then((r) => r && photos(el, p, q)) }, "정보 수정")));
  };
  mount(el,
    can("file.upload") ? h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "사진 등록"), h("span", { class: "muted small" }, "입력한 분류가 이번에 올리는 사진 전체에 적용됩니다")),
      h("div", { class: "pb" }, h("div", { class: "row", style: { marginBottom: "10px" } }, Object.values(meta)),
        uploader({ owner_type: "project", owner_id: p.id, category: "사진", photo: true, meta: () => Object.fromEntries(Object.entries(meta).map(([k, i]) => [k, i.value])), onDone: () => photos(el, p, q) }))) : null,
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", `현장 사진 ${files.length}장`),
      h("select", { onchange: (e) => go("phase", e.target.value) }, h("option", { value: "" }, "구분 전체"), c.photo_phases.map((x) => h("option", { selected: q.phase === x }, x))),
      h("input", { type: "date", value: q.from || "", onchange: (e) => go("from", e.target.value), title: "촬영일 시작" }), "~",
      h("input", { type: "date", value: q.to || "", onchange: (e) => go("to", e.target.value), title: "촬영일 끝" }),
      h("span", { class: "grow" }), can("export.data") ? [perPage, h("button", { class: "primary", onclick: ledger }, "사진대장 PDF")] : null),
      h("div", { class: "pb" }, h("p", { class: "small muted" }, "체크한 사진만 사진대장에 넣습니다. 체크하지 않으면 현재 필터 조건의 사진 전체를 넣습니다. 작업일보에 첨부한 사진도 이곳에 함께 표시됩니다."),
        files.length ? h("div", { class: "photos" }, files.map(cardOf)) : h("div", { class: "empty" }, "등록된 사진이 없습니다."))));
}

async function photoMeta(f, c) {
  const fm = form([{ k: "title", label: "제목" }, { k: "taken_date", label: "촬영일", type: "date" },
    { k: "phase", label: "구분", type: "select", options: c.photo_phases }, { k: "work_type", label: "공종" }, { k: "location", label: "위치" },
    { k: "description", label: "작업내용", type: "textarea", cls: "full" }], f);
  return modal("사진 정보", fm.el, [{ label: "저장", cls: "primary", run: async () => { await PUT(`/api/files/${f.id}`, fm.get()); toast("저장했습니다.", "ok"); } },
    ...(can("file.delete") ? [{ label: "삭제", cls: "danger", run: async () => { if (!(await confirmBox("이 사진을 삭제할까요? (휴지통)", "삭제", "danger"))) return false; await DEL(`/api/files/${f.id}`); } }] : [])]);
}

const DOC_CATS = ["계약서", "도면", "내역서", "시방서", "공문", "회의록", "승인자료", "성적서", "기타"];
async function docs(el, p, q) {
  const all = (await GET(`/api/files?project_id=${p.id}`)).filter((f) => f.category !== "사진");
  const cat = h("select", {}, DOC_CATS.map((x) => h("option", x)));
  mount(el,
    can("file.upload") ? h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "문서 첨부"), h("span", { class: "muted small" }, "분류"), cat),
      h("div", { class: "pb" }, uploader({ owner_type: "project", owner_id: p.id, category: () => cat.value, onDone: () => docs(el, p, q) }))) : null,
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "현장 문서")), table([
      { k: "category", label: "분류" }, { k: "name", label: "파일명", render: (f) => can("file.download") ? h("a", { href: `/api/files/${f.id}/download` }, f.name) : f.name },
      { k: "owner_type", label: "출처", render: (f) => ({ project: "현장", daily_report: "작업일보", material_request: "자재요청", quote: "견적", po: "발주", approval: "결재" }[f.owner_type] || f.owner_type) },
      { k: "uploaded_by", label: "등록자" }, { k: "created_at", label: "등록일", render: (f) => fmtDT(f.created_at) },
      { k: "size", label: "크기", num: true, render: (f) => (f.size / 1024 / 1024).toFixed(2) + "MB" },
      { k: "x", label: "", sort: false, render: (f) => can("file.delete") ? button("삭제", async () => { if (await confirmBox(`'${f.name}'을(를) 삭제할까요?`, "삭제", "danger")) { await DEL(`/api/files/${f.id}`); docs(el, p, q); } }, "sm danger") : null },
    ], all, { filters: [{ k: "category", label: "분류" }] })),
    h("p", { class: "small muted" }, "문서번호·제출처·버전 관리는 2차 개발 범위입니다. 현재는 분류별 첨부·검색·다운로드를 제공합니다."));
}

async function changes(el, p) {
  const rows = await GET(`/api/projects/${p.id}/changes`);
  const add = async (kind) => {
    const f = form([{ k: "change_date", label: "변경일", type: "date", req: true, default: todayKST() },
      ...(kind === "계약변경" ? [{ k: "new_supply_amount", label: "변경 후 공급가액(원)", type: "money", req: true, hint: `현재 ${fmtNum(p.supply_amount)}원` }]
        : [{ k: "amount_delta", label: "증감액(원, 선택)", type: "money", hint: "비우면 직전 설계변경 대비 설계내역 합계 차이로 계산" }]),
      { k: "reason", label: "변경 사유", type: "textarea", req: true, cls: "full" }]);
    const r = await modal(kind + " 등록", h("div", {}, kind === "설계변경" ? h("p", { class: "small muted" }, "설계내역을 먼저 수정한 뒤 등록하세요. 등록 시점의 설계내역이 '변경 후' 기준으로 보관됩니다.") : null, f.el),
      [{ label: "등록", cls: "primary", run: async () => { if (!f.validate()) return false; await POST(`/api/projects/${p.id}/changes`, { kind, ...f.get() }); toast("등록했습니다.", "ok"); } }]);
    if (r) changes(el, p);
  };
  const show = async (c) => {
    const items = (x) => x && x.items ? h("table", { class: "t" }, h("thead", h("tr", h("th", "품명"), h("th", "규격"), h("th", "단위"), h("th", { class: "num" }, "수량"), h("th", { class: "num" }, "금액"))),
      h("tbody", x.items.map((i) => h("tr", h("td", i.name), h("td", i.spec || ""), h("td", i.unit), h("td", { class: "num" }, fmtNum(i.design_qty)), h("td", { class: "num" }, fmtNum(i.amount)))))) : h("pre", JSON.stringify(x, null, 1) || "-");
    await modal(`${c.kind} 상세`, h("div", {}, h("p", c.reason), h("h3", "변경 전"), c.before ? items(c.before) : h("p", { class: "muted" }, "최초 기준(이전 기록 없음)"), h("h3", "변경 후"), items(c.after)), [], { wide: true });
  };
  mount(el, h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "계약변경·설계변경 이력"), h("span", { class: "grow" }),
    can("project.edit") && can("amount.contract") ? button("계약변경 등록", () => add("계약변경")) : null,
    can("project.edit") ? button("설계변경 등록", () => add("설계변경")) : null),
    table([{ k: "change_date", label: "변경일" }, { k: "kind", label: "구분" }, { k: "reason", label: "사유" },
      { k: "amount_delta", label: "증감액", num: true }, { k: "created_by_name", label: "등록자" },
      { k: "d", label: "", sort: false, render: (c) => h("button", { class: "sm", onclick: () => show(c) }, "변경 전후 보기") }], rows, { empty: "변경 이력이 없습니다." })));
}
