import { GET, POST, h, mount, can, table, form, badge, fmtNum, fmtWon, fmtDT, toast, promptBox, confirmBox, button, approvalLine, pdfButtons, pickLine, state } from "../lib.js";
import { attachPanel } from "./materials.js";

const BOXES = [["pending", "결재 대기"], ["drafted", "내가 올린 문서"], ["done", "내가 처리한 문서"], ["reference", "참조 문서"], ["all", "전체(접근 가능)"]];

export async function list(el, _p, q, title) {
  const box = q.box || "pending";
  title("전자결재");
  const rows = await GET(`/api/approvals?box=${box}`);
  mount(el, h("div", { class: "page-head" }, h("h1", "전자결재"), h("span", { class: "grow" }), can("approval.draft") ? h("a", { class: "btn primary", href: "#/approvals/new" }, "일반 품의서 작성") : null),
    h("nav", { class: "tabs" }, BOXES.map(([k, l]) => h("a", { href: `#/approvals?box=${k}`, class: k === box ? "on" : "" }, l))),
    h("div", { class: "panel" }, table([
      { k: "doc_no", label: "문서번호", w: 130 }, { k: "doc_type_label", label: "종류" },
      { k: "title", label: "제목", render: (d) => [h("a", { href: `#/approvals/${d.id}` }, d.title), d.my_turn ? h("span", { class: "st warn", style: { marginLeft: "6px" } }, "내 차례") : null] },
      { k: "drafter_name", label: "기안자" }, { k: "submitted_at", label: "상신일", render: (d) => fmtDT(d.submitted_at) },
      { k: "current_approver", label: "현재 결재자" }, { k: "status_label", label: "상태", render: (d) => badge(d.status_label) },
    ], rows, { onRow: (d) => (location.hash = `#/approvals/${d.id}`), filters: [{ k: "doc_type_label", label: "종류" }, { k: "status_label", label: "상태" }],
      empty: box === "pending" ? "결재할 문서가 없습니다." : "문서가 없습니다." })));
}

export async function detail(el, [did], _q, title) {
  const d = await GET(`/api/approvals/${did}`);
  title(d.title);
  const reload = () => { window.dispatchEvent(new Event("gw:refresh-counts")); detail(el, [did], _q, title); };
  const acts = [];
  if (d.my_turn) {
    acts.push(button("승인", async () => { const c = await promptBox("승인", "의견(선택)", { required: false }); if (c === null) return; await POST(`/api/approvals/${did}/act`, { action: "approve", comment: c || null }); toast("승인했습니다.", "ok"); reload(); }, "ok solid"));
    acts.push(button("반려", async () => { const c = await promptBox("반려", "반려 사유"); if (!c) return; await POST(`/api/approvals/${did}/act`, { action: "reject", comment: c }); toast("반려했습니다."); reload(); }, "danger"));
  }
  if (d.can_withdraw) acts.push(button("회수", async () => { if (await confirmBox("결재를 회수할까요? 회수하면 수정 후 다시 상신할 수 있습니다.", "회수")) { await POST(`/api/approvals/${did}/withdraw`); toast("회수했습니다."); reload(); } }));
  if (d.doc_type === "general" && d.drafter_id === state.me.id && ["rejected", "withdrawn"].includes(d.status)) acts.push(h("a", { class: "btn primary", href: `#/approvals/new?from=${did}` }, "수정 후 재상신"));
  if (d.link && ["rejected", "withdrawn"].includes(d.status)) acts.push(h("a", { class: "btn primary", href: d.link }, "원본 문서에서 수정·재상신"));
  const snap = d.content_snapshot || {};
  const itemTbl = snap.items ? table(Object.keys(snap.items[0] || {}).filter((k) => ["name", "spec", "unit", "qty", "unit_price", "supply_amount", "use_location"].includes(k))
    .map((k) => ({ k, label: { name: "품명", spec: "규격", unit: "단위", qty: "수량", unit_price: "단가", supply_amount: "공급가액", use_location: "사용위치" }[k], num: ["qty", "unit_price", "supply_amount"].includes(k) })), snap.items, { search: false }) : null;
  mount(el,
    h("div", { class: "page-head" }, h("div", h("h1", d.title), h("div", { class: "sub" }, `${d.doc_no} · ${d.doc_type_label} · 기안 ${d.drafter_name} · ${fmtDT(d.submitted_at)}${d.round > 1 ? ` · ${d.round}차 상신` : ""}`)),
      badge(d.status_label), h("span", { class: "grow" }), acts, pdfButtons(`/api/export/approvals/${did}.pdf`)),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "결재선")), h("div", { class: "pb" }, approvalLine(d.steps, d.drafter_name))),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "상신 원문"), h("span", { class: "muted small" }, "상신 시점 내용이 그대로 보존됩니다"), d.link ? h("a", { href: d.link, class: "right" }, "업무 문서 열기") : null),
      h("div", { class: "pb" }, d.project_name ? h("p", "현장: ", d.project_name) : null, d.amount ? h("p", "금액: ", h("b", fmtWon(d.amount))) : null,
        d.body ? h("div", { style: { whiteSpace: "pre-wrap", marginBottom: "10px" } }, d.body) : null,
        snap.supply_amount ? h("p", { class: "small" }, `공급가액 ${fmtWon(snap.supply_amount)} · 부가세 ${fmtWon(snap.vat_amount)} · 합계 ${fmtWon(snap.total_amount)}`) : null),
      itemTbl),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "처리 이력")), table([{ k: "at", label: "일시", render: (x) => fmtDT(x.at) }, { k: "user", label: "처리자" }, { k: "action", label: "처리" }, { k: "round", label: "차수", num: true }, { k: "comment", label: "의견" }], d.history, { search: false })),
    await attachPanel("approval", d.id, d.status === "in_progress" || d.drafter_id === state.me.id));
}

export async function general(el, _p, q, title) {
  title("일반 품의서");
  const prev = q.from ? await GET(`/api/approvals/${q.from}`) : null;
  const projects = await GET("/api/projects");
  const f = form([{ k: "title", label: "제목", req: true, cls: "full" },
    { k: "project_id", label: "관련 현장", type: "select", int: true, options: projects.map((p) => ({ value: p.id, label: p.name })) },
    { k: "amount", label: "금액(원, 선택)", type: "money", hint: "금액별 결재선이 설정되어 있으면 금액에 맞는 결재선을 불러옵니다" },
    { k: "body", label: "내용", type: "textarea", req: true, cls: "full", rows: 10 }], prev ? { title: prev.title, project_id: prev.project_id, amount: prev.amount, body: prev.body } : {});
  const send = button(prev ? "재상신" : "결재 상신", async () => {
    if (!f.validate()) return;
    const v = f.get();
    const steps = await pickLine("general", v.amount); if (!steps) return;
    const d = prev ? await POST(`/api/approvals/${prev.id}/resubmit`, { ...v, steps }) : await POST("/api/approvals/general", { ...v, steps });
    toast("상신했습니다.", "ok"); state.dirty = false; location.hash = `#/approvals/${d.id}`;
  }, "primary");
  mount(el, h("div", { class: "page-head" }, h("h1", prev ? "품의서 재상신" : "일반 업무 품의서"), h("span", { class: "grow" }), h("a", { class: "btn", href: "#/approvals" }, "취소"), send),
    h("div", { class: "panel" }, h("div", { class: "pb" }, f.el, h("p", { class: "small muted" }, "첨부파일은 상신 후 문서 화면에서 추가합니다."))),
    h("p", { class: "small muted" }, "지출결의서·외주/장비 품의·휴가/출장 신청서 전용 양식은 2차 개발 범위입니다. 현재는 일반 품의서로 작성하세요."));
}
