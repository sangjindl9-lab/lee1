import { GET, POST, PUT, DEL, h, mount, can, table, form, badge, fmtDT, toast, modal, confirmBox, promptBox, button, todayKST, addDays, state } from "../lib.js";

export async function worklogs(el, _p, q, title) {
  title("업무일지");
  const from = q.from || addDays(todayKST(), -14), to = q.to || todayKST();
  const [rows, projects] = await Promise.all([GET(`/api/worklogs?date_from=${from}&date_to=${to}`), GET("/api/projects")]);
  const reload = () => worklogs(el, _p, q, title);
  const dlg = async (w) => {
    const ro = w && (w.author_id !== state.me.id || !["draft", "rejected"].includes(w.status));
    const f = form([{ k: "log_date", label: "일자", type: "date", req: true, default: todayKST() }, { k: "task", label: "담당 업무", req: true, cls: "two" },
      { k: "project_id", label: "관련 현장", type: "select", int: true, options: projects.map((p) => ({ value: p.id, label: p.name })) },
      { k: "progress_status", label: "진행 상태", type: "select", blank: false, options: ["예정", "진행중", "완료", "보류"] }, { k: "due_date", label: "마감일", type: "date" },
      { k: "detail", label: "처리 내용", type: "textarea", cls: "full" }, { k: "follow_up", label: "후속 조치", type: "textarea", cls: "full" },
      { k: "cooperation", label: "협조 요청", type: "textarea", cls: "full" }], w || {});
    if (ro) Object.values(f.inputs).forEach((i) => (i.disabled = true));
    const acts = [];
    if (!ro) {
      acts.push({ label: "임시저장", run: async () => { if (!f.validate()) return false; return w ? PUT(`/api/worklogs/${w.id}`, { ...f.get(), version: w.version }) : POST("/api/worklogs", f.get()); } });
      acts.push({ label: "제출", cls: "primary", run: async () => { if (!f.validate()) return false; const r = w ? await PUT(`/api/worklogs/${w.id}`, { ...f.get(), version: w.version }) : await POST("/api/worklogs", f.get()); return POST(`/api/worklogs/${r.id}/action`, { action: "submit" }); } });
    }
    if (w && w.status === "submitted" && can("worklog.review")) {
      acts.push({ label: "승인", cls: "ok solid", run: () => POST(`/api/worklogs/${w.id}/action`, { action: "approve" }) });
      acts.push({ label: "반려", cls: "danger", run: async () => { const r = await promptBox("업무일지 반려", "반려 사유"); if (!r) return false; return POST(`/api/worklogs/${w.id}/action`, { action: "reject", reason: r }); } });
    }
    const res = await modal(w ? `업무일지 · ${w.log_date}` : "업무일지 작성", h("div", {}, w?.reject_reason ? h("div", { class: "confirm-flag" }, "반려 사유: ", w.reject_reason) : null, f.el), acts, { wide: true });
    if (res) { toast("처리했습니다.", "ok"); reload(); }
  };
  const go = (k, v) => (location.hash = "#/worklogs?" + new URLSearchParams({ from, to, [k]: v }));
  mount(el, h("div", { class: "page-head" }, h("h1", "본사 업무일지"), h("span", { class: "grow" }), can("worklog.write") ? button("업무일지 작성", () => dlg(), "primary") : null),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("input", { type: "date", value: from, onchange: (e) => go("from", e.target.value) }), "~", h("input", { type: "date", value: to, onchange: (e) => go("to", e.target.value) }),
      h("span", { class: "muted small" }, can("worklog.review") ? "제출된 전체 업무일지와 내 일지" : "내 업무일지")),
    table([{ k: "log_date", label: "일자" }, { k: "author_name", label: "작성자" }, { k: "task", label: "업무" }, { k: "project_name", label: "현장" },
      { k: "progress_status", label: "진행", render: (w) => badge(w.progress_status) }, { k: "due_date", label: "마감" }, { k: "status_label", label: "결재", render: (w) => badge(w.status_label) }],
    rows, { onRow: dlg, filters: [{ k: "status_label", label: "결재" }, { k: "author_name", label: "작성자" }] })));
}

export async function notices(el, _p, _q, title) {
  title("공지사항");
  const [rows, projects] = await Promise.all([GET("/api/notices"), GET("/api/projects")]);
  const reload = () => notices(el, _p, _q, title);
  const add = async () => {
    const f = form([{ k: "title", label: "제목", req: true, cls: "full" }, { k: "project_id", label: "대상 현장", type: "select", int: true, blank: "전사 공지", options: projects.map((p) => ({ value: p.id, label: p.name })) },
      { k: "pinned", label: "상단 고정", type: "checkbox" }, { k: "body", label: "내용", type: "textarea", req: true, cls: "full", rows: 8 }]);
    const r = await modal("공지 작성", f.el, [{ label: "등록", cls: "primary", run: () => f.validate() ? POST("/api/notices", f.get()) : false }], { wide: true });
    if (r) { toast("등록했습니다.", "ok"); reload(); }
  };
  const show = (n) => modal(n.title, h("div", {}, h("p", { class: "small muted" }, `${n.author} · ${fmtDT(n.created_at)} · ${n.project_name || "전사"}`), h("div", { style: { whiteSpace: "pre-wrap" } }, n.body)),
    can("notice.write") ? [{ label: "삭제", cls: "danger", run: async () => { if (!(await confirmBox("공지를 삭제할까요?", "삭제", "danger"))) return false; await DEL(`/api/notices/${n.id}`); reload(); } }] : []);
  mount(el, h("div", { class: "page-head" }, h("h1", "공지사항"), h("span", { class: "grow" }), can("notice.write") ? button("공지 작성", add, "primary") : null),
    h("div", { class: "panel" }, table([{ k: "title", label: "제목", render: (n) => [n.pinned ? h("span", { class: "st info" }, "고정") : null, " ", n.title] }, { k: "project_name", label: "대상", render: (n) => n.project_name || "전사" },
      { k: "author", label: "작성자" }, { k: "created_at", label: "등록일", render: (n) => fmtDT(n.created_at) }], rows, { onRow: show })));
}

export async function notifications(el, _p, _q, title) {
  title("알림");
  const rows = await GET("/api/notifications");
  mount(el, h("div", { class: "page-head" }, h("h1", "알림"), h("span", { class: "grow" }),
    button("모두 읽음으로 표시", async () => { await POST("/api/notifications/read", []); window.dispatchEvent(new Event("gw:refresh-counts")); notifications(el, _p, _q, title); })),
    h("p", { class: "small muted" }, "현재는 앱 안 알림만 제공합니다. 이메일·문자·메신저 알림은 외부 서비스 연동 후 사용할 수 있습니다."),
    h("div", { class: "panel" }, table([{ k: "read", label: "", render: (n) => n.read ? "" : h("span", { class: "st warn" }, "새 알림") }, { k: "title", label: "내용" }, { k: "created_at", label: "일시", render: (n) => fmtDT(n.created_at) }],
      rows, { onRow: async (n) => { if (!n.read) await POST("/api/notifications/read", [n.id]).catch(() => {}); window.dispatchEvent(new Event("gw:refresh-counts")); if (n.link) location.hash = n.link; }, empty: "알림이 없습니다." })));
}

export async function account(el, _p, _q, title) {
  title("내 계정");
  const me = state.me;
  const f = form([{ k: "current_password", label: "현재 비밀번호", type: "password", req: true }, { k: "new_password", label: "새 비밀번호", type: "password", req: true, hint: "8자 이상, 영문·숫자·특수문자 중 2종류 이상" },
    { k: "confirm", label: "새 비밀번호 확인", type: "password", req: true }]);
  mount(el, h("div", { class: "page-head" }, h("h1", "내 계정")),
    h("div", { class: "grid g2" },
      h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "정보")), h("div", { class: "pb" }, h("dl", { class: "kv" }, h("dt", "아이디"), h("dd", me.login_id), h("dt", "이름"), h("dd", me.name),
        h("dt", "부서·직책"), h("dd", [me.department, me.position].filter(Boolean).join(" / ") || "—"), h("dt", "역할"), h("dd", me.role)),
        h("h3", { style: { marginTop: "12px" } }, "내 권한"), h("ul", { class: "small", style: { paddingLeft: "18px" } }, me.permissions.map((p) => h("li", me.permission_labels[p] || p))))),
      h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "비밀번호 변경")), h("div", { class: "pb" }, f.el, h("div", { style: { marginTop: "12px" } }, button("변경", async () => {
        if (!f.validate()) return;
        const v = f.get();
        if (v.new_password !== v.confirm) return toast("새 비밀번호 확인이 일치하지 않습니다.", "bad");
        await POST("/api/auth/password", { current_password: v.current_password, new_password: v.new_password });
        toast("비밀번호를 변경했습니다.", "ok"); ["current_password", "new_password", "confirm"].forEach((k) => f.set(k, ""));
      }, "primary"))))));
}
