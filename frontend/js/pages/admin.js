import { GET, POST, PUT, h, mount, can, table, form, badge, fmtNum, fmtDT, toast, modal, confirmBox, button, users as lookupUsers, uploader, state, codes as getCodes } from "../lib.js";

export async function users(el, _p, _q, title) {
  title("사용자 관리");
  const [rows, roleRes, c] = await Promise.all([GET("/api/admin/users"), GET("/api/admin/roles"), getCodes()]);
  const roles = roleRes.roles, catalog = roleRes.catalog;
  const reload = () => { state.users = null; users(el, _p, _q, title); };
  const dlg = async (u) => {
    const isNew = !u;
    const f = form([
      { k: "login_id", label: "아이디", req: true, hint: "영문·숫자·._- (변경 불가)", attrs: { autocapitalize: "off" } }, { k: "name", label: "이름", req: true },
      { k: "role_id", label: "역할", type: "select", req: true, int: true, options: roles.map((r) => ({ value: r.id, label: r.name })) },
      { k: "department_id", label: "부서", type: "select", int: true, options: c.departments.map((d) => ({ value: d.id, label: d.name })) },
      { k: "position_id", label: "직책", type: "select", int: true, options: c.positions.map((d) => ({ value: d.id, label: d.name })) },
      { k: "phone", label: "연락처" }, { k: "email", label: "이메일" },
      ...(isNew ? [{ k: "password", label: "초기 비밀번호", type: "password", req: true, hint: "첫 로그인 시 본인이 변경해야 합니다" }] : [{ k: "is_active", label: "사용 중(해제 시 즉시 로그아웃·로그인 차단)", type: "checkbox" }]),
    ], u || { is_active: true });
    if (!isNew) f.inputs.login_id.disabled = true;
    const extra = new Set(u?.extra_permissions || []), denied = new Set(u?.denied_permissions || []);
    const permBox = h("div", { class: "tbl-wrap", style: { maxHeight: "260px" } }, h("table", { class: "t" }, h("thead", h("tr", h("th", "권한"), h("th", "역할 기본"), h("th", "추가 허용"), h("th", "차단"))),
      h("tbody", Object.entries(catalog).map(([k, label]) => {
        const role = roles.find((r) => r.id === Number(f.inputs.role_id.value));
        return h("tr", h("td", label), h("td", { class: "small" }, role && role.permissions.includes(k) ? "✓" : ""),
          h("td", h("input", { type: "checkbox", checked: extra.has(k), onchange: (e) => (e.target.checked ? extra.add(k) : extra.delete(k)) })),
          h("td", h("input", { type: "checkbox", checked: denied.has(k), onchange: (e) => (e.target.checked ? denied.add(k) : denied.delete(k)) })));
      }))));
    const r = await modal(isNew ? "사용자 등록" : `사용자 수정 · ${u.name}`, h("div", {}, f.el, h("h3", { style: { margin: "14px 0 6px" } }, "개인별 권한 조정"),
      h("p", { class: "small muted" }, "역할 권한에 더하거나 뺄 권한만 체크하세요. 민감정보(계약금액·단가) 조회 권한도 여기서 조정합니다."), permBox,
      !isNew ? h("p", { class: "small muted" }, "담당 현장 배정은 공사 화면 > 개요 > 참여 직원에서 합니다.") : null),
    [{ label: "저장", cls: "primary", run: async () => {
      if (!f.validate()) return false;
      const v = { ...f.get(), extra_permissions: [...extra], denied_permissions: [...denied] };
      return isNew ? POST("/api/admin/users", v) : PUT(`/api/admin/users/${u.id}`, v);
    } }], { wide: true });
    if (r) { toast("저장했습니다.", "ok"); reload(); }
  };
  const reset = async (u) => {
    if (!(await confirmBox(`${u.name}님의 비밀번호를 초기화할까요? 기존 로그인은 모두 끊깁니다.`, "초기화", "danger"))) return;
    const r = await POST(`/api/admin/users/${u.id}/reset-password`);
    await modal("임시 비밀번호", h("div", {}, h("p", "아래 임시 비밀번호를 본인에게 전달하세요. ", h("b", "이 화면을 닫으면 다시 볼 수 없습니다.")),
      h("p", { style: { fontSize: "20px", fontWeight: 700, userSelect: "all" } }, r.temporary_password), h("p", { class: "small muted" }, r.notice)));
  };
  mount(el, h("div", { class: "page-head" }, h("h1", "사용자"), h("span", { class: "grow" }), button("사용자 등록", () => dlg(), "primary")),
    h("div", { class: "panel" }, table([{ k: "login_id", label: "아이디" }, { k: "name", label: "이름" }, { k: "department", label: "부서" }, { k: "position", label: "직책" }, { k: "role", label: "역할" },
      { k: "is_active", label: "상태", render: (u) => [h("span", { class: "st " + (u.is_active ? "ok" : "draft") }, u.is_active ? "사용" : "비활성"), u.locked ? h("span", { class: "st bad" }, "잠김") : null] },
      { k: "last_login_at", label: "최근 로그인", render: (u) => fmtDT(u.last_login_at) },
      { k: "x", label: "", sort: false, render: (u) => h("div", { class: "row" }, button("수정", () => dlg(u), "sm"), button("비밀번호 초기화", () => reset(u), "sm")) }],
    rows, { filters: [{ k: "role", label: "역할" }, { k: "department", label: "부서" }] })));
}

export async function roles(el, _p, _q, title) {
  title("역할·권한");
  const { roles: rs, catalog } = await GET("/api/admin/roles");
  const sets = rs.map((r) => new Set(r.permissions));
  const save = button("변경 저장", async () => {
    for (let i = 0; i < rs.length; i++) {
      const p = [...sets[i]];
      if (JSON.stringify([...p].sort()) !== JSON.stringify([...rs[i].permissions].sort())) await PUT(`/api/admin/roles/${rs[i].id}`, { name: rs[i].name, permissions: p });
    }
    toast("역할 권한을 저장했습니다. 해당 사용자의 다음 요청부터 적용됩니다.", "ok");
    state.dirty = false;
  }, "primary");
  mount(el, h("div", { class: "page-head" }, h("h1", "역할별 권한"), h("span", { class: "grow" }), save),
    h("p", { class: "small muted" }, "메뉴 표시와 서버 API 권한 검사가 모두 이 설정을 따릅니다. '전체 현장 조회'가 없는 역할은 배정된 현장만 볼 수 있습니다."),
    h("div", { class: "panel" }, h("div", { class: "tbl-wrap" }, h("table", { class: "t" },
      h("thead", h("tr", h("th", "권한"), rs.map((r) => h("th", { style: { textAlign: "center" } }, r.name)))),
      h("tbody", Object.entries(catalog).map(([k, label]) => h("tr", h("td", label, h("div", { class: "small muted" }, k)),
        rs.map((r, i) => h("td", { style: { textAlign: "center" } }, h("input", { type: "checkbox", checked: sets[i].has(k), disabled: r.code === "admin" && k.startsWith("admin."),
          onchange: (e) => { e.target.checked ? sets[i].add(k) : sets[i].delete(k); state.dirty = true; } }))))))))));
}

export async function codes(el, _p, _q, title) {
  title("부서·직책");
  const [deps, poss] = await Promise.all([GET("/api/admin/codes/departments"), GET("/api/admin/codes/positions")]);
  const reload = () => { state.codes = null; codes(el, _p, _q, title); };
  const panel = (kind, label, rows) => {
    const name = h("input", { placeholder: `새 ${label}` });
    return h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", label), h("span", { class: "grow" }), name, button("추가", async () => { if (!name.value.trim()) return; await POST(`/api/admin/codes/${kind}`, { name: name.value.trim(), sort: rows.length * 10 }); reload(); }, "sm primary")),
      table([{ k: "name", label: "이름", render: (r) => { const i = h("input", { value: r.name }); i.addEventListener("change", () => PUT(`/api/admin/codes/${kind}/${r.id}`, { ...r, name: i.value }).then(() => toast("저장했습니다.", "ok")).catch((e) => toast(e.message, "bad"))); return i; } },
        { k: "sort", label: "순서", render: (r) => { const i = h("input", { value: r.sort, type: "number", style: { width: "80px" } }); i.addEventListener("change", () => PUT(`/api/admin/codes/${kind}/${r.id}`, { ...r, sort: Number(i.value) }).then(reload)); return i; } },
        { k: "is_active", label: "사용", render: (r) => h("input", { type: "checkbox", checked: r.is_active, onchange: (e) => PUT(`/api/admin/codes/${kind}/${r.id}`, { ...r, is_active: e.target.checked }).then(reload) }) }], rows, { search: false }));
  };
  mount(el, h("div", { class: "page-head" }, h("h1", "부서·직책")), h("div", { class: "grid g2" }, panel("departments", "부서", deps), panel("positions", "직책", poss)));
}

export async function company(el, _p, _q, title) {
  title("회사 설정");
  const c = await GET("/api/admin/company");
  const f = form([{ type: "section", label: "회사 정보 (문서 출력에 사용)" },
    { k: "name", label: "회사명", req: true }, { k: "biz_no", label: "사업자등록번호" }, { k: "ceo_name", label: "대표자" }, { k: "phone", label: "대표 전화" }, { k: "address", label: "주소", cls: "full" },
    { type: "section", label: "금액 계산" },
    { k: "amount_rounding", label: "원 미만 처리", type: "select", blank: false, options: [{ value: "floor", label: "절사(버림)" }, { value: "half_up", label: "반올림" }] },
    { k: "vat_rate", label: "부가세율", hint: "예: 0.1 = 10%" },
    { type: "section", label: "목록 값 (쉼표로 구분)" },
    { k: "trades", label: "직종", cls: "full" }, { k: "weather_options", label: "날씨", cls: "full" }, { k: "photo_phases", label: "사진 구분", cls: "full" }],
  { ...c, trades: c.trades.join(", "), weather_options: c.weather_options.join(", "), photo_phases: c.photo_phases.join(", ") });
  const fmt = Object.fromEntries(Object.entries(c.doc_formats).map(([k, v]) => [k, h("input", { value: v, style: { width: "100%" } })]));
  const ids = { logo_file_id: c.logo_file_id, seal_file_id: c.seal_file_id };
  const img = (k, label) => {
    const box = h("div", { class: "f" });
    const draw = () => mount(box, h("label", label), ids[k] ? h("img", { src: `/api/files/${ids[k]}/download?inline=true`, style: { height: "56px", border: "1px solid var(--line)", padding: "4px", background: "#fff" } }) : h("div", { class: "muted small" }, "등록 안 됨"),
      uploader({ owner_type: "company", category: k === "logo_file_id" ? "로고" : "직인", photo: false, accept: "image/png,image/jpeg", onDone: (r) => { ids[k] = r[0].id; draw(); toast("이미지를 올렸습니다. '저장'을 눌러야 적용됩니다."); } }),
      ids[k] ? h("button", { class: "link small", onclick: () => { ids[k] = null; draw(); } }, "사용 안 함") : null);
    draw(); return box;
  };
  const LBL = { MR: "자재요청", PO: "발주서", RC: "입고전표", DR: "작업일보", AP: "결재문서" };
  const save = button("저장", async () => {
    if (!f.validate()) return;
    const v = f.get();
    const split = (s) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
    await PUT("/api/admin/company", { ...v, ...ids, trades: split(v.trades), weather_options: split(v.weather_options), photo_phases: split(v.photo_phases),
      doc_formats: Object.fromEntries(Object.entries(fmt).map(([k, i]) => [k, i.value.trim()])) });
    state.codes = null; toast("회사 설정을 저장했습니다. 로고는 다시 로그인하면 메뉴에 반영됩니다.", "ok");
  }, "primary");
  mount(el, h("div", { class: "page-head" }, h("h1", "회사·문서번호 설정"), h("span", { class: "grow" }), save),
    h("div", { class: "panel" }, h("div", { class: "pb" }, f.el)),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "로고·직인")), h("div", { class: "pb grid g2" }, img("logo_file_id", "회사 로고 (PDF 머리글·메뉴)"), img("seal_file_id", "직인 (발주서)"))),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "문서번호 체계")), h("div", { class: "pb" },
      h("p", { class: "small muted" }, "사용 가능 토큰: {YYYY} {YY} {MM} {DD} {PROJECT}(공사번호) {SEQ:n}(n자리 일련번호). 일련번호는 토큰에 포함된 기간(연/월/일)마다 1부터 다시 시작합니다."),
      h("table", { class: "t" }, h("tbody", Object.entries(fmt).map(([k, i]) => h("tr", h("td", { style: { width: "120px" } }, LBL[k] || k), h("td", i))))))));
}

export async function lines(el, _p, _q, title) {
  title("결재선 설정");
  const [rows, us, c] = await Promise.all([GET("/api/approval-lines"), lookupUsers(), getCodes()]);
  const reload = () => lines(el, _p, _q, title);
  const name = (id) => us.find((u) => u.id === id)?.name || `#${id}`;
  const dlg = async (t) => {
    const f = form([{ k: "doc_type", label: "문서 종류", type: "select", req: true, blank: false, options: Object.entries(c.doc_types).map(([value, label]) => ({ value, label })) },
      { k: "name", label: "결재선 이름", req: true }, { k: "min_amount", label: "적용 금액 이상(원)", type: "money", hint: "비우면 하한 없음" },
      { k: "max_amount", label: "적용 금액 미만(원)", type: "money", hint: "비우면 상한 없음" }, { k: "is_active", label: "사용", type: "checkbox", default: true }], t || { is_active: true });
    const steps = (t?.steps || []).map((s) => ({ ...s }));
    const sbox = h("div");
    const draw = () => mount(sbox, h("table", { class: "t" }, h("tbody", steps.map((s, i) => h("tr", h("td", i + 1),
      h("td", h("select", { onchange: (e) => (s.kind = e.target.value) }, ["결재", "합의", "참조"].map((k) => h("option", { selected: s.kind === k }, k)))),
      h("td", h("select", { onchange: (e) => (s.user_id = Number(e.target.value)) }, h("option", { value: "" }, "선택"), us.map((u) => h("option", { value: u.id, selected: u.id === s.user_id }, `${u.name} ${u.position || ""}`)))),
      h("td", h("button", { class: "sm", onclick: () => { steps.splice(i, 1); draw(); } }, "삭제")))))),
      h("button", { class: "sm", onclick: () => { steps.push({ kind: "결재", user_id: null }); draw(); } }, "단계 추가"));
    draw();
    const r = await modal(t ? "결재선 수정" : "결재선 추가", h("div", {}, f.el, h("h3", { style: { margin: "12px 0 6px" } }, "결재 순서"), sbox),
      [{ label: "저장", cls: "primary", run: async () => {
        if (!f.validate()) return false;
        if (!steps.length || steps.some((s) => !s.user_id)) { toast("결재자를 모두 선택하세요.", "bad"); return false; }
        const v = { ...f.get(), steps };
        return t ? PUT(`/api/approval-lines/${t.id}`, v) : POST("/api/approval-lines", v);
      } }], { wide: true });
    if (r) { toast("저장했습니다.", "ok"); reload(); }
  };
  mount(el, h("div", { class: "page-head" }, h("h1", "결재선"), h("span", { class: "grow" }), button("결재선 추가", () => dlg(), "primary")),
    h("p", { class: "small muted" }, "문서 종류와 금액 구간별 기본 결재선입니다. 상신할 때 자동으로 불러오며, 기안자가 상신 화면에서 조정할 수 있습니다."),
    h("div", { class: "panel" }, table([{ k: "doc_type_label", label: "문서 종류" }, { k: "name", label: "이름" },
      { k: "min_amount", label: "금액 이상", num: true }, { k: "max_amount", label: "금액 미만", num: true },
      { k: "steps", label: "결재 순서", sort: false, render: (t) => t.steps.map((s) => `${s.kind}:${name(s.user_id)}`).join(" → ") },
      { k: "is_active", label: "사용", render: (t) => t.is_active ? "사용" : "중지" }], rows, { onRow: dlg, empty: "설정된 결재선이 없습니다. 결재선이 없으면 기안자가 상신 시 직접 지정합니다." })));
}

export async function trash(el, _p, _q, title) {
  title("휴지통");
  const rows = await GET("/api/admin/trash");
  const LBL = { project: "공사", boq_item: "설계내역 항목", file: "파일", material: "자재", vendor: "거래처", daily_report: "작업일보" };
  mount(el, h("div", { class: "page-head" }, h("h1", "휴지통")), h("p", { class: "small muted" }, "삭제한 자료는 영구 삭제되지 않고 이곳에 보관됩니다. 복구하면 원래 위치로 돌아갑니다."),
    h("div", { class: "panel" }, table([{ k: "kind", label: "종류", render: (r) => LBL[r.kind] || r.kind }, { k: "label", label: "이름" }, { k: "deleted_at", label: "삭제일시", render: (r) => fmtDT(r.deleted_at) },
      { k: "x", label: "", sort: false, render: (r) => button("복구", async () => { await POST(`/api/admin/trash/${r.kind}/${r.id}/restore`); toast("복구했습니다.", "ok"); trash(el, _p, _q, title); }, "sm") }], rows, { filters: [{ k: "kind", label: "종류" }], empty: "휴지통이 비어 있습니다." })));
}

export async function audit(el, _p, q, title) {
  title("변경이력");
  const rows = await GET("/api/admin/audit?limit=1000" + (q.entity ? `&entity=${q.entity}` : ""));
  const show = (a) => modal(`${a.summary}`, h("div", {}, h("p", `${fmtDT(a.at)} · ${a.user || "-"} · ${a.ip || ""}`),
    h("h3", "변경 전"), h("pre", { style: { whiteSpace: "pre-wrap", fontSize: "12px", background: "#f6f8fb", padding: "8px" } }, a.before ? JSON.stringify(a.before, null, 2) : "-"),
    h("h3", "변경 후"), h("pre", { style: { whiteSpace: "pre-wrap", fontSize: "12px", background: "#f6f8fb", padding: "8px" } }, a.after ? JSON.stringify(a.after, null, 2) : "-")), [], { wide: true });
  mount(el, h("div", { class: "page-head" }, h("h1", "변경이력 (감사로그)")),
    h("div", { class: "panel" }, table([{ k: "at", label: "일시", render: (a) => fmtDT(a.at) }, { k: "user", label: "사용자" }, { k: "action", label: "동작" }, { k: "entity", label: "대상" },
      { k: "entity_id", label: "ID" }, { k: "summary", label: "내용" }, { k: "ip", label: "IP" }], rows, { onRow: show, filters: [{ k: "entity", label: "대상" }, { k: "action", label: "동작" }, { k: "user", label: "사용자" }], pageSize: 50 })));
}
