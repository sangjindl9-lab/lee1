import {
  GET, POST, PUT, DEL, h, mount, can, table, form, badge, fmtNum, fmtWon, fmtDT, toast, fail, modal, confirmBox, promptBox, button,
  uploader, fileList, saveState, state, todayKST, pdfButtons, pickLine, approvalLine, uid,
} from "../lib.js";
import { importDialog } from "./projects.js";

// ================================================================ 자재 요청
export function reqTable(rows, showProject = true) {
  return table([
    { k: "req_no", label: "요청번호", render: (r) => h("a", { href: `#/material-requests/${r.id}` }, r.req_no) },
    showProject ? { k: "project_name", label: "현장" } : null,
    { k: "first_item", label: "품목", render: (r) => `${r.first_item || ""}${r.item_count > 1 ? ` 외 ${r.item_count - 1}건` : ""}` },
    { k: "requester_name", label: "요청자" }, { k: "req_date", label: "요청일" }, { k: "need_date", label: "희망납기" },
    { k: "urgent", label: "긴급", render: (r) => r.urgent ? h("span", { class: "st bad" }, "긴급") : "" },
    { k: "status_label", label: "상태", render: (r) => badge(r.status_label) },
  ].filter(Boolean), rows, { onRow: (r) => (location.hash = `#/material-requests/${r.id}`), filters: [{ k: "status_label", label: "상태" }] });
}

export async function requests(el, _p, q, title) {
  title("자재 요청");
  const rows = await GET("/api/material-requests" + (q.status ? `?status=${q.status}` : ""));
  mount(el, h("div", { class: "page-head" }, h("h1", "자재 요청"), q.status ? [h("span", { class: "st info" }, q.status === "approved" ? "승인(발주 대기)" : q.status), h("a", { href: "#/material-requests", class: "small" }, "전체 보기")] : null,
    h("span", { class: "grow" }), can("material.request") ? h("a", { class: "btn primary", href: "#/material-requests/new" }, "자재 요청 작성") : null),
    h("div", { class: "panel" }, reqTable(rows)));
}

export async function requestEdit(el, [rid], q, title) {
  const r = rid ? await GET(`/api/material-requests/${rid}`) : { project_id: q.project ? Number(q.project) : null, items: [], req_date: todayKST() };
  title(rid ? "자재 요청 수정" : "자재 요청 작성");
  const [projects, mats] = await Promise.all([GET("/api/projects?status=준비,진행,중지"), GET("/api/materials")]);
  const ss = saveState();
  const dirty = () => ss.set("dirty");
  const f = form([
    { k: "project_id", label: "현장", type: "select", req: true, int: true, options: projects.map((p) => ({ value: p.id, label: p.name })), cls: "two" },
    { k: "need_date", label: "희망 납기", type: "date" },
    { k: "urgent", label: "긴급 요청", type: "checkbox" },
    { k: "reason", label: "요청 사유", type: "textarea", cls: "full" },
  ], r, { onDirty: dirty });
  if (rid) f.inputs.project_id.disabled = true;
  let boq = [];
  const items = r.items.map((i) => ({ material_id: i.material_id, name: i.name, spec: i.spec || "", unit: i.unit, qty: i.qty, boq_item_id: i.boq_item_id, use_location: i.use_location || "", note: i.note || "" }));
  if (!items.length) items.push({ name: "", spec: "", unit: "", qty: "", use_location: "" });
  const box = h("div");
  const loadBoq = async () => { boq = f.inputs.project_id.value ? (await GET(`/api/projects/${f.inputs.project_id.value}/boq`)).items : []; draw(); };
  f.inputs.project_id.addEventListener("change", loadBoq);
  const draw = () => mount(box, h("div", { class: "tbl-wrap" }, h("table", { class: "t" },
    h("thead", h("tr", h("th", "자재(마스터 검색)"), h("th", "품명*"), h("th", "규격"), h("th", "단위*"), h("th", { class: "num" }, "수량*"), h("th", "설계내역 연계"), h("th", "사용 위치"), h("th", ""))),
    h("tbody", items.map((it, idx) => {
      const ms = h("select", { onchange: (e) => { const m = mats.find((x) => x.id === Number(e.target.value)); it.material_id = m ? m.id : null; if (m) { it.name = m.name; it.spec = m.spec || ""; it.unit = m.unit; } dirty(); draw(); } },
        h("option", { value: "" }, "직접 입력"), mats.map((m) => h("option", { value: m.id, selected: m.id === it.material_id }, `${m.code} ${m.name} ${m.spec || ""}`)));
      const inp = (k, attrs = {}) => h("input", { value: it[k] ?? "", oninput: (e) => { it[k] = e.target.value; dirty(); }, ...attrs });
      return h("tr", h("td", ms), h("td", inp("name")), h("td", inp("spec")), h("td", inp("unit", { style: { width: "64px" } })), h("td", inp("qty", { inputMode: "decimal", style: { width: "90px", textAlign: "right" } })),
        h("td", h("select", { onchange: (e) => { it.boq_item_id = e.target.value ? Number(e.target.value) : null; dirty(); } }, h("option", { value: "" }, "-"), boq.map((b) => h("option", { value: b.id, selected: b.id === it.boq_item_id }, `${b.name} ${b.spec || ""}`)))),
        h("td", inp("use_location")), h("td", h("button", { class: "sm", onclick: () => { items.splice(idx, 1); dirty(); draw(); } }, "삭제")));
    })))), h("button", { class: "sm", style: { marginTop: "8px" }, onclick: () => { items.push({ name: "", spec: "", unit: "", qty: "" }); draw(); } }, "품목 추가"));
  await loadBoq();
  const save = button("저장", async () => {
    if (!f.validate()) return;
    const clean = items.filter((i) => i.name || i.qty);
    const bad = clean.find((i) => !i.name || !i.unit || !(Number(String(i.qty).replace(/,/g, "")) > 0));
    if (!clean.length || bad) return toast("품목마다 품명·단위·수량(0보다 큼)을 입력하세요.", "bad");
    ss.set("saving");
    const body = { ...f.get(), items: clean.map((i) => ({ ...i, qty: String(i.qty).replace(/,/g, "") })), version: r.version, req_date: r.req_date };
    if (rid) body.project_id = r.project_id;
    try {
      const nr = rid ? await PUT(`/api/material-requests/${rid}`, body) : await POST("/api/material-requests", body);
      ss.set("saved"); state.dirty = false; toast("저장했습니다. 결재 상신은 상세 화면에서 합니다.", "ok"); location.hash = `#/material-requests/${nr.id}`;
    } catch (e) { ss.set("failed", "저장 실패: " + e.message); throw e; }
  }, "primary");
  mount(el, h("div", { class: "page-head" }, h("h1", rid ? `자재 요청 수정 · ${r.req_no}` : "자재 요청 작성"), h("span", { class: "grow" }), ss.el,
    h("a", { class: "btn", href: rid ? `#/material-requests/${rid}` : "#/material-requests" }, "취소"), save),
    h("fieldset", {}, h("legend", "요청 정보"), f.el), h("fieldset", {}, h("legend", "요청 품목"), box));
}

export async function requestDetail(el, [rid], _q, title) {
  const r = await GET(`/api/material-requests/${rid}`);
  title(`자재 요청 ${r.req_no}`);
  const reload = () => requestDetail(el, [rid], _q, title);
  const acts = [];
  if (["draft", "rejected"].includes(r.status) && can("material.request")) {
    acts.push(h("a", { class: "btn", href: `#/material-requests/${rid}/edit` }, "수정"));
    acts.push(button(r.status === "rejected" ? "재상신" : "결재 상신", async () => {
      const steps = await pickLine("material_request"); if (!steps) return;
      await POST(`/api/material-requests/${rid}/submit`, { steps, version: r.version }); toast("결재를 상신했습니다.", "ok"); reload();
    }, "primary"));
    if (r.status === "draft") acts.push(button("삭제", async () => { if (await confirmBox("이 요청을 삭제할까요?", "삭제", "danger")) { await DEL(`/api/material-requests/${rid}`); location.hash = "#/material-requests"; } }, "danger"));
  }
  if (["approved", "closed"].includes(r.status) && can("po.manage")) acts.push(h("a", { class: "btn primary", href: `#/pos/new?request=${rid}` }, "발주서 작성"));
  const itemCols = [{ k: "name", label: "품명" }, { k: "spec", label: "규격" }, { k: "unit", label: "단위" }, { k: "qty", label: "요청수량", num: true },
    { k: "ordered_qty", label: "발주확정", num: true }, { k: "ordering_qty", label: "발주 진행중", num: true }, { k: "unordered_qty", label: "미발주", num: true }, { k: "use_location", label: "사용위치" }];
  mount(el,
    h("div", { class: "page-head" }, h("div", h("h1", `자재 요청 ${r.req_no}`), h("div", { class: "sub" }, `${r.project_name} · 요청 ${r.requester_name} · ${r.req_date}`)),
      badge(r.status_label), r.urgent ? h("span", { class: "st bad" }, "긴급") : null, h("span", { class: "grow" }), acts, pdfButtons(`/api/export/material-requests/${rid}.pdf`)),
    r.approval ? h("p", "결재문서: ", h("a", { href: `#/approvals/${r.approval.id}` }, r.approval.doc_no), " ", badge({ in_progress: "결재중", approved: "승인완료", rejected: "반려", withdrawn: "회수" }[r.approval.status])) : null,
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "요청 품목"), h("span", { class: "muted small" }, `희망납기 ${r.need_date || "-"} · 사유: ${r.reason || "-"}`)), table(itemCols, r.items, { search: false })),
    quotesPanel(r, reload),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "발주서")), poTable(r.purchase_orders, false)),
    await attachPanel("material_request", r.id, true));
}

function quotesPanel(r, reload) {
  const canQ = can("quote.manage");
  const items = r.items;
  if (!["approved", "closed"].includes(r.status)) return h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "견적 비교")), h("div", { class: "pb muted" }, "결재 승인 후 거래처 견적을 등록할 수 있습니다."));
  const qs = r.quotes;
  const add = async () => {
    const vendors = await GET("/api/vendors");
    if (!vendors.length) return toast("먼저 거래처를 등록하세요.", "bad");
    const f = form([{ k: "vendor_id", label: "거래처", type: "select", req: true, int: true, options: vendors.map((v) => ({ value: v.id, label: v.name })) },
      { k: "quote_date", label: "견적일", type: "date", default: todayKST() }, { k: "delivery_date", label: "납기", type: "date" },
      { k: "freight", label: "운송비(원)", type: "money" }, { k: "payment_terms", label: "결제조건" }, { k: "note", label: "비고", cls: "full" }]);
    const prices = items.map((i) => h("input", { inputMode: "decimal", style: { width: "110px", textAlign: "right" } }));
    const res = await modal("견적 등록", h("div", {}, f.el, h("h3", { style: { marginTop: "12px" } }, "품목별 단가"), h("table", { class: "t" }, h("tbody", items.map((i, k) => h("tr", h("td", `${i.name} ${i.spec || ""}`), h("td", { class: "num" }, `${fmtNum(i.qty)} ${i.unit}`), h("td", prices[k])))))),
      [{ label: "등록", cls: "primary", run: async () => {
        if (!f.validate()) return false;
        if (prices.some((p) => !/^[\d,]+(\.\d+)?$/.test(p.value.trim()))) { toast("모든 품목의 단가를 숫자로 입력하세요.", "bad"); return false; }
        return POST(`/api/material-requests/${r.id}/quotes`, { ...f.get(), items: items.map((i, k) => ({ request_item_id: i.id, unit_price: prices[k].value.replace(/,/g, "") })) });
      } }], { wide: true });
    if (res) { toast("견적을 등록했습니다. 견적서 파일은 표에서 첨부하세요.", "ok"); reload(); }
  };
  const minTotal = qs.length ? Math.min(...qs.map((q) => Number(q.total || Infinity))) : null;
  return h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "견적 비교"), h("span", { class: "muted small" }, "합계 = 품목 금액 + 운송비 (공급가액 기준)"), h("span", { class: "grow" }), canQ ? button("견적 등록", add) : null),
    qs.length ? h("div", { class: "tbl-wrap" }, h("table", { class: "t" },
      h("thead", h("tr", h("th", "품목"), qs.map((q) => h("th", { class: "num" }, q.vendor_name, q.selected ? h("div", h("span", { class: "st ok" }, "선정")) : null)))),
      h("tbody", items.map((i) => h("tr", h("td", `${i.name} ${i.spec || ""} (${fmtNum(i.qty)}${i.unit})`), qs.map((q) => { const qi = q.items.find((x) => x.request_item_id === i.id); return h("td", { class: "num" }, qi ? [fmtNum(qi.unit_price), h("div", { class: "small muted" }, fmtNum(qi.amount))] : "-"); }))),
        h("tr", h("td", "운송비"), qs.map((q) => h("td", { class: "num" }, fmtNum(q.freight)))),
        h("tr", h("td", h("b", "합계")), qs.map((q) => h("td", { class: "num", style: Number(q.total) === minTotal ? { color: "var(--ok)", fontWeight: 700 } : null }, fmtNum(q.total), Number(q.total) === minTotal ? h("div", { class: "small" }, "최저") : null))),
        h("tr", h("td", "납기 / 결제조건"), qs.map((q) => h("td", { class: "small" }, `${q.delivery_date || "-"} / ${q.payment_terms || "-"}`))),
        h("tr", h("td", "견적서"), qs.map((q) => h("td", { class: "small" }, q.files.map((f) => h("div", h("a", { href: `/api/files/${f.id}/download` }, f.name))),
          canQ ? uploaderMini("quote", q.id, reload) : null))),
        h("tr", h("td", "선정"), qs.map((q) => h("td", {}, q.selected ? h("div", { class: "small" }, "사유: ", q.select_reason) : canQ ? button("이 업체 선정", async () => {
          const why = await promptBox("업체 선정", "선정 사유"); if (why) { await POST(`/api/quotes/${q.id}/select`, { reason: why }); reload(); }
        }, "sm") : null, can("po.manage") && q.selected ? h("a", { class: "btn sm primary", href: `#/pos/new?request=${r.id}&quote=${q.id}` }, "이 견적으로 발주") : null))))))
      : h("div", { class: "pb muted" }, "등록된 견적이 없습니다."));
}

function uploaderMini(owner_type, owner_id, done) {
  const inp = h("input", { type: "file", class: "hidden", multiple: true });
  inp.addEventListener("change", async () => {
    const fd = new FormData(); fd.append("owner_type", owner_type); fd.append("owner_id", owner_id); fd.append("category", "견적서");
    for (const f of inp.files) fd.append("files", f);
    try { await (await import("../lib.js")).api("POST", "/api/files", fd); toast("첨부했습니다.", "ok"); done(); } catch (e) { fail(e); }
  });
  return h("span", {}, inp, h("button", { class: "link small", onclick: () => inp.click() }, "파일 첨부"));
}

export async function attachPanel(owner_type, owner_id, editable) {
  const files = await GET(`/api/files?owner_type=${owner_type}&owner_id=${owner_id}`);
  const box = h("div", { class: "panel" });
  const draw = async () => {
    const fs = await GET(`/api/files?owner_type=${owner_type}&owner_id=${owner_id}`);
    mount(box, h("div", { class: "ph" }, h("h2", "첨부파일")), h("div", { class: "pb" }, fileList(fs, { onDelete: editable && can("file.delete") ? async (f) => { if (await confirmBox(`'${f.name}' 삭제?`, "삭제", "danger")) { await DEL(`/api/files/${f.id}`).catch(fail); draw(); } } : null }),
      editable && can("file.upload") ? h("div", { style: { marginTop: "10px" } }, uploader({ owner_type, owner_id, onDone: draw })) : null));
  };
  mount(box, h("div", { class: "pb" }, fileList(files)));
  draw();
  return box;
}

// ================================================================ 발주
export function poTable(rows, showProject = true) {
  const amt = can("amount.purchase");
  return table([
    { k: "po_no", label: "발주번호", render: (r) => h("a", { href: `#/pos/${r.id}` }, r.po_no) },
    showProject ? { k: "project_name", label: "현장" } : null,
    { k: "vendor_name", label: "거래처" }, { k: "order_date", label: "발주일" },
    { k: "delivery_date", label: "납기", render: (r) => [r.delivery_date || "", r.delayed ? h("span", { class: "st bad", style: { marginLeft: "4px" } }, "지연") : null] },
    amt ? { k: "total_amount", label: "합계(VAT포함)", num: true } : null,
    { k: "outstanding_total", label: "미입고 수량", num: true },
    { k: "status_label", label: "상태", render: (r) => badge(r.status_label) },
  ].filter(Boolean), rows, { onRow: (r) => (location.hash = `#/pos/${r.id}`), filters: [{ k: "status_label", label: "상태" }, { k: "vendor_name", label: "거래처" }] });
}

export async function pos(el, _p, q, title) {
  title("발주·입고");
  const ps = new URLSearchParams(); if (q.status) ps.set("status", q.status); if (q.delayed) ps.set("delayed", "true");
  const rows = await GET("/api/purchase-orders?" + ps);
  mount(el, h("div", { class: "page-head" }, h("h1", "발주·입고"), q.status || q.delayed ? [h("span", { class: "st info" }, q.delayed ? "납기 지연" : rows[0]?.status_label || q.status), h("a", { href: "#/pos", class: "small" }, "전체 보기")] : null,
    h("span", { class: "grow" }), can("export.data") ? h("a", { class: "btn", href: "/api/export/purchase-orders.xlsx" }, "발주현황 엑셀") : null,
    can("po.manage") ? h("a", { class: "btn primary", href: "#/pos/new" }, "직접 발주서 작성") : null),
    h("p", { class: "small muted" }, "자재 요청에서 결재 승인된 건은 요청 상세의 '발주서 작성'으로 연결하면 요청수량 대비 발주수량이 관리됩니다."),
    h("div", { class: "panel" }, poTable(rows)));
}

export async function poEdit(el, [poid], q, title) {
  title(poid ? "발주서 수정" : "발주서 작성");
  const [vendors, projects, mats] = await Promise.all([GET("/api/vendors"), GET("/api/projects"), GET("/api/materials")]);
  let po, req = null;
  if (poid) { po = await GET(`/api/purchase-orders/${poid}`); if (po.request_id) req = await GET(`/api/material-requests/${po.request_id}`); }
  else {
    po = { order_date: todayKST(), items: [] };
    if (q.request) {
      req = await GET(`/api/material-requests/${q.request}`);
      const quote = q.quote ? req.quotes.find((x) => String(x.id) === q.quote) : null;
      Object.assign(po, { project_id: req.project_id, request_id: req.id, quote_id: quote?.id || null, vendor_id: quote?.vendor_id, delivery_date: quote?.delivery_date || req.need_date, payment_terms: quote?.payment_terms });
      po.items = req.items.filter((i) => Number(i.unordered_qty) > 0).map((i) => ({ request_item_id: i.id, material_id: i.material_id, name: i.name, spec: i.spec, unit: i.unit, qty: i.unordered_qty,
        unit_price: quote ? (quote.items.find((x) => x.request_item_id === i.id)?.unit_price || "") : (mats.find((m) => m.id === i.material_id)?.ref_price || "") }));
    }
  }
  if (!vendors.length) return mount(el, h("div", { class: "panel" }, h("div", { class: "empty" }, h("b", "등록된 거래처가 없습니다."), h("a", { href: "#/vendors" }, "거래처 등록하기"))));
  const ss = saveState(); const dirty = () => ss.set("dirty");
  const f = form([
    { k: "project_id", label: "현장", type: "select", req: true, int: true, options: projects.map((p) => ({ value: p.id, label: p.name })), cls: "two" },
    { k: "vendor_id", label: "공급업체", type: "select", req: true, int: true, options: vendors.map((v) => ({ value: v.id, label: v.name })) },
    { k: "order_date", label: "발주일", type: "date", req: true }, { k: "delivery_date", label: "납기", type: "date" },
    { k: "delivery_place", label: "납품 장소", cls: "two" }, { k: "receiver_name", label: "인수 담당자" },
    { k: "payment_terms", label: "결제조건" }, { k: "remarks", label: "특기사항", type: "textarea", cls: "full" },
  ], po, { onDirty: dirty });
  if (po.request_id || poid) f.inputs.project_id.disabled = true;
  const items = po.items.map((i) => ({ request_item_id: i.request_item_id, material_id: i.material_id, name: i.name, spec: i.spec || "", unit: i.unit, qty: i.qty, unit_price: i.unit_price ?? "" }));
  const box = h("div");
  const amtOn = can("amount.purchase");
  const draw = () => {
    let sup = 0;
    mount(box, h("div", { class: "tbl-wrap" }, h("table", { class: "t" },
      h("thead", h("tr", h("th", "품명"), h("th", "규격"), h("th", "단위"), h("th", { class: "num" }, "수량"), req ? h("th", { class: "num" }, "요청 잔량") : null, amtOn ? [h("th", { class: "num" }, "단가"), h("th", { class: "num" }, "공급가액")] : null, h("th", ""))),
      h("tbody", items.map((it, idx) => {
        const ri = req?.items.find((x) => x.id === it.request_item_id);
        const amount = Math.floor((Number(String(it.qty).replace(/,/g, "")) || 0) * (Number(String(it.unit_price).replace(/,/g, "")) || 0));
        sup += amount;
        const inp = (k, attrs = {}) => h("input", { value: it[k] ?? "", oninput: (e) => { it[k] = e.target.value; dirty(); }, onchange: draw, ...attrs });
        return h("tr", h("td", it.request_item_id ? it.name : inp("name")), h("td", it.request_item_id ? it.spec : inp("spec")), h("td", it.request_item_id ? it.unit : inp("unit", { style: { width: "64px" } })),
          h("td", inp("qty", { inputMode: "decimal", style: { width: "90px", textAlign: "right" } })),
          req ? h("td", { class: "num" }, ri ? fmtNum(String(Number(ri.unordered_qty) + (poid ? Number(po.items.find((x) => x.request_item_id === ri.id)?.qty || 0) : 0))) : "-") : null,
          amtOn ? [h("td", inp("unit_price", { inputMode: "decimal", style: { width: "110px", textAlign: "right" } })), h("td", { class: "num" }, fmtNum(String(amount)))] : null,
          h("td", h("button", { class: "sm", onclick: () => { items.splice(idx, 1); dirty(); draw(); } }, "삭제")));
      })),
      amtOn ? h("tfoot", h("tr", h("td", { colspan: req ? 6 : 5, style: { textAlign: "right" } }, "공급가액 합계(부가세는 저장 시 회사 설정 세율로 계산)"), h("td", { class: "num" }, fmtNum(String(sup))), h("td"))) : null)),
      !req ? h("button", { class: "sm", style: { marginTop: "8px" }, onclick: () => { items.push({ name: "", spec: "", unit: "", qty: "", unit_price: "" }); draw(); } }, "품목 추가") : h("p", { class: "small muted" }, "요청 품목에서 가져온 발주입니다. 부분 발주하려면 수량을 줄이세요. 요청 잔량을 초과할 수 없습니다."));
  };
  draw();
  const save = button("저장", async () => {
    if (!f.validate()) return;
    const clean = items.filter((i) => i.name);
    if (!clean.length || clean.some((i) => !i.unit || !(Number(String(i.qty).replace(/,/g, "")) > 0))) return toast("품목마다 품명·단위·수량을 입력하세요.", "bad");
    ss.set("saving");
    const body = { ...f.get(), project_id: po.project_id || Number(f.inputs.project_id.value), request_id: po.request_id || null, quote_id: po.quote_id || null, version: po.version,
      items: clean.map((i) => ({ ...i, qty: String(i.qty).replace(/,/g, ""), unit_price: String(i.unit_price || 0).replace(/,/g, "") })) };
    try {
      const r = poid ? await PUT(`/api/purchase-orders/${poid}`, body) : await POST("/api/purchase-orders", body);
      ss.set("saved"); state.dirty = false; toast("발주서를 저장했습니다. 결재 상신 후 확정됩니다.", "ok"); location.hash = `#/pos/${r.id}`;
    } catch (e) { ss.set("failed", "저장 실패: " + e.message); throw e; }
  }, "primary");
  mount(el, h("div", { class: "page-head" }, h("h1", poid ? `발주서 수정 · ${po.po_no}` : "발주서 작성"), req ? h("span", { class: "muted" }, `자재요청 ${req.req_no}`) : null, h("span", { class: "grow" }), ss.el,
    h("a", { class: "btn", href: poid ? `#/pos/${poid}` : "#/pos" }, "취소"), save),
    h("fieldset", {}, h("legend", "발주 정보"), f.el), h("fieldset", {}, h("legend", "발주 품목"), box));
}

export async function poDetail(el, [poid], _q, title) {
  const po = await GET(`/api/purchase-orders/${poid}`);
  title(`발주서 ${po.po_no}`);
  const reload = () => poDetail(el, [poid], _q, title);
  const amt = can("amount.purchase");
  const acts = [];
  if (["draft", "rejected"].includes(po.status) && can("po.manage")) {
    acts.push(h("a", { class: "btn", href: `#/pos/${poid}/edit` }, "수정"));
    acts.push(button(po.status === "rejected" ? "재상신" : "발주 품의 상신", async () => {
      const steps = await pickLine("purchase_order", po.total_amount); if (!steps) return;
      await POST(`/api/purchase-orders/${poid}/submit`, { steps, version: po.version }); toast("결재를 상신했습니다. 승인되면 발주가 확정됩니다.", "ok"); reload();
    }, "primary"));
    if (po.status === "draft") acts.push(button("삭제", async () => { if (await confirmBox("작성중인 발주서를 삭제할까요?", "삭제", "danger")) { await DEL(`/api/purchase-orders/${poid}`); location.hash = "#/pos"; } }, "danger"));
  }
  if (["ordered", "partial"].includes(po.status) && can("po.receive")) acts.push(button("입고 처리", () => receiveDialog(po, "입고").then((r) => r && reload()), "primary"));
  if (["ordered", "partial", "received"].includes(po.status) && can("po.receive") && po.items.some((i) => Number(i.net_received_qty) > 0)) acts.push(button("반품 처리", () => receiveDialog(po, "반품").then((r) => r && reload())));
  if (can("po.manage") && ["draft", "rejected", "ordered", "partial"].includes(po.status)) acts.push(button("발주 취소", async () => {
    const net = po.items.some((i) => Number(i.net_received_qty) > 0);
    const mode = net || po.status === "partial" ? "remaining" : "all";
    const why = await promptBox(mode === "all" ? "발주 전체 취소" : "미입고 잔량 취소", "취소 사유"); if (!why) return;
    await POST(`/api/purchase-orders/${poid}/cancel`, { mode, reason: why }); toast("취소 처리했습니다."); reload();
  }, "danger"));
  if (can("po.manage") && ["ordered", "partial", "received"].includes(po.status)) acts.push(button("업체에 발송", async () => { await POST(`/api/purchase-orders/${poid}/send`); }));
  mount(el,
    h("div", { class: "page-head" }, h("div", h("h1", `발주서 ${po.po_no}`), h("div", { class: "sub" }, `${po.project_name} · ${po.vendor_name} · 발주일 ${po.order_date} · 납기 ${po.delivery_date || "-"}`)),
      badge(po.status_label), po.delayed ? h("span", { class: "st bad" }, "납기 지연") : null, h("span", { class: "small muted" }, `외부 발송: ${po.send_status}`), h("span", { class: "grow" }),
      acts, pdfButtons(`/api/export/purchase-orders/${poid}.pdf`), can("export.data") ? h("a", { class: "btn", href: `/api/export/purchase-orders/${poid}.xlsx` }, "엑셀") : null),
    po.approval ? h("p", "결재문서: ", h("a", { href: `#/approvals/${po.approval.id}` }, po.approval.doc_no)) : null,
    po.request_id ? h("p", "자재요청: ", h("a", { href: `#/material-requests/${po.request_id}` }, "요청 보기")) : null,
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "발주 품목·입고 현황"), amt ? h("span", { class: "muted small" }, `공급가액 ${fmtWon(po.supply_amount)} · 부가세 ${fmtWon(po.vat_amount)} · 합계 ${fmtWon(po.total_amount)}`) : null),
      table([{ k: "name", label: "품명" }, { k: "spec", label: "규격" }, { k: "unit", label: "단위" }, { k: "qty", label: "발주", num: true }, { k: "cancelled_qty", label: "취소", num: true },
        { k: "received_qty", label: "입고 누계", num: true }, { k: "returned_qty", label: "반품 누계", num: true }, { k: "net_received_qty", label: "순입고", num: true },
        { k: "outstanding_qty", label: "미입고", num: true, render: (i) => Number(i.outstanding_qty) > 0 ? h("b", { style: { color: "var(--warn)" } }, fmtNum(i.outstanding_qty)) : fmtNum(i.outstanding_qty) },
        ...(amt ? [{ k: "unit_price", label: "단가", num: true }, { k: "supply_amount", label: "공급가액", num: true }, { k: "vat_amount", label: "부가세", num: true }] : [])], po.items, { search: false })),
    h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "입고·반품 이력")), table([{ k: "receipt_no", label: "전표번호" }, { k: "kind", label: "구분", render: (r) => h("span", { class: "st " + (r.kind === "입고" ? "ok" : "warn") }, r.kind) },
      { k: "receipt_date", label: "일자" }, { k: "received_by", label: "처리자" }, { k: "items", label: "품목", sort: false, render: (r) => r.items.map((i) => `${i.name} ${fmtNum(i.qty)}`).join(", ") }, { k: "note", label: "비고" }],
    po.receipts, { search: false, empty: "입고 기록이 없습니다." })),
    h("div", { class: "panel" }, h("div", { class: "pb" }, h("b", "특기사항 "), h("span", { style: { whiteSpace: "pre-wrap" } }, po.remarks || "-"), h("div", { class: "small muted" }, "결제조건: ", po.payment_terms || "-", " · 납품장소: ", po.delivery_place || "-", " · 인수자: ", po.receiver_name || "-"))),
    await attachPanel("po", po.id, true));
}

async function receiveDialog(po, kind) {
  const key = uid(); // 같은 대화상자에서 여러 번 눌러도 한 번만 처리
  const date = h("input", { type: "date", value: todayKST(), max: todayKST() });
  const note = h("input", { placeholder: "비고(거래명세서 번호 등)" });
  const rows = po.items.map((i) => ({ i, inp: h("input", { inputMode: "decimal", style: { width: "100px", textAlign: "right" }, placeholder: "0" }) }));
  const limit = (i) => Number(kind === "입고" ? i.outstanding_qty : i.net_received_qty);
  return modal(kind === "입고" ? "입고 처리" : "반품 처리", h("div", {},
    h("div", { class: "row" }, h("label", "일자 "), date, note),
    h("table", { class: "t", style: { marginTop: "10px" } }, h("thead", h("tr", h("th", "품명"), h("th", { class: "num" }, kind === "입고" ? "미입고" : "순입고"), h("th", { class: "num" }, kind + " 수량"), h("th", ""))),
      h("tbody", rows.map(({ i, inp }) => h("tr", h("td", `${i.name} ${i.spec || ""}`), h("td", { class: "num" }, `${fmtNum(String(limit(i)))} ${i.unit}`), h("td", inp),
        h("td", limit(i) > 0 ? h("button", { class: "sm", onclick: () => (inp.value = String(limit(i))) }, "전량") : null))))),
    h("p", { class: "small muted" }, kind === "입고" ? "미입고 수량을 넘길 수 없습니다. 일부만 들어오면 들어온 수량만 입력하세요(부분입고)." : "반품하면 미입고 수량이 다시 늘어납니다. 재입고하지 않을 경우 '발주 취소'로 잔량을 취소하세요.")),
  [{ label: kind + " 확정", cls: "primary", run: async () => {
    const items = rows.map(({ i, inp }) => ({ po_item_id: i.id, qty: inp.value.replace(/,/g, "").trim() || "0" })).filter((x) => Number(x.qty) !== 0);
    for (const { i, inp } of rows) { const v = Number(inp.value.replace(/,/g, "") || 0); if (isNaN(v) || v < 0 || v > limit(i)) { inp.classList.add("err"); toast(`[${i.name}] 수량은 0 ~ ${limit(i)} 사이여야 합니다.`, "bad"); return false; } }
    if (!items.length) { toast("수량을 1개 이상 입력하세요.", "bad"); return false; }
    await POST(`/api/purchase-orders/${po.id}/receipts`, { kind, receipt_date: date.value, note: note.value, request_key: key, items });
    toast(`${kind} 처리했습니다.`, "ok");
  } }], { wide: true });
}

// ================================================================ 자재 마스터·거래처
export async function master(el, _p, _q, title) {
  title("자재 마스터");
  const [rows, vendors] = await Promise.all([GET("/api/materials"), GET("/api/vendors")]);
  const ed = can("material.master");
  const reload = () => master(el, _p, _q, title);
  const dlg = async (m = {}) => {
    const f = form([{ k: "code", label: "자재코드", req: true }, { k: "name", label: "품명", req: true }, { k: "spec", label: "규격" }, { k: "unit", label: "단위", req: true },
      { k: "maker", label: "제조사" }, { k: "model", label: "모델명" }, { k: "default_vendor_id", label: "기본 거래처", type: "select", int: true, options: vendors.map((v) => ({ value: v.id, label: v.name })) },
      ...(can("amount.purchase") ? [{ k: "ref_price", label: "참고단가", type: "money" }] : []),
      { k: "supply_type", label: "관급/사급", type: "select", options: ["사급", "관급"], blank: false },
      { k: "stock_managed", label: "재고 관리 대상", type: "checkbox" }, { k: "min_stock", label: "최소재고", type: "qty" }], m);
    const r = await modal(m.id ? "자재 수정" : "자재 등록", h("div", {}, f.el, m.id ? h("div", { style: { marginTop: "12px" } }, h("h3", "승인자료·성적서·인증서"), await attachPanel("material", m.id, true)) : h("p", { class: "small muted" }, "승인자료·성적서는 등록 후 첨부할 수 있습니다.")),
      [{ label: "저장", cls: "primary", run: async () => { if (!f.validate()) return false; const v = f.get(); return m.id ? PUT(`/api/materials/${m.id}`, v) : POST("/api/materials", v); } }], { wide: true });
    if (r) { toast("저장했습니다.", "ok"); reload(); }
  };
  mount(el, h("div", { class: "page-head" }, h("h1", "자재 마스터"), h("span", { class: "grow" }), h("a", { class: "btn", href: "/api/import/template/material.xlsx" }, "업로드 양식"),
    ed ? button("엑셀 업로드", () => importDialog("material").then((r) => r && reload())) : null, ed ? button("자재 등록", () => dlg(), "primary") : null),
    h("div", { class: "panel" }, table([{ k: "code", label: "코드" }, { k: "name", label: "품명" }, { k: "spec", label: "규격" }, { k: "unit", label: "단위" }, { k: "maker", label: "제조사" },
      { k: "model", label: "모델" }, { k: "supply_type", label: "관급/사급" }, ...(can("amount.purchase") ? [{ k: "ref_price", label: "참고단가", num: true }] : []),
      { k: "stock_managed", label: "재고관리", render: (m) => m.stock_managed ? "예" : "" },
      ed ? { k: "x", label: "", sort: false, render: (m) => button("삭제", async () => { if (await confirmBox(`${m.code} ${m.name} 삭제?`, "삭제", "danger")) { await DEL(`/api/materials/${m.id}`); reload(); } }, "sm danger") } : null].filter(Boolean),
    rows, { onRow: ed ? (m) => dlg(m) : null, filters: [{ k: "supply_type", label: "관급/사급" }] })),
    h("p", { class: "small muted" }, "재고 수량·최소재고 경고는 2차(재고·입출고) 개발 범위입니다."));
}

export async function vendors(el, _p, _q, title) {
  title("거래처");
  const rows = await GET("/api/vendors");
  const ed = can("material.master");
  const reload = () => vendors(el, _p, _q, title);
  const dlg = async (v = {}) => {
    const f = form([{ k: "name", label: "거래처명", req: true }, { k: "kind", label: "구분", type: "select", blank: false, options: ["자재업체", "외주업체", "장비업체", "발주처", "원도급사", "감리단", "기타"] },
      { k: "biz_no", label: "사업자번호" }, { k: "contact_name", label: "담당자" }, { k: "phone", label: "전화" }, { k: "email", label: "이메일" },
      { k: "address", label: "주소", cls: "full" }, { k: "note", label: "비고", type: "textarea", cls: "full" }], v);
    const r = await modal(v.id ? "거래처 수정" : "거래처 등록", f.el, [{ label: "저장", cls: "primary", run: async () => { if (!f.validate()) return false; return v.id ? PUT(`/api/vendors/${v.id}`, f.get()) : POST("/api/vendors", f.get()); } }]);
    if (r) { toast("저장했습니다.", "ok"); reload(); }
  };
  const showPos = async (v) => {
    const list = await GET(`/api/purchase-orders?vendor_id=${v.id}`);
    await modal(`${v.name} 발주 내역`, poTable(list), [], { wide: true });
  };
  mount(el, h("div", { class: "page-head" }, h("h1", "거래처·연락처"), h("span", { class: "grow" }), ed ? button("거래처 등록", () => dlg(), "primary") : null),
    h("div", { class: "panel" }, table([{ k: "name", label: "거래처명" }, { k: "kind", label: "구분" }, { k: "contact_name", label: "담당자" },
      { k: "phone", label: "전화", render: (v) => v.phone ? h("a", { href: `tel:${v.phone}` }, v.phone) : "" }, { k: "email", label: "이메일" }, { k: "biz_no", label: "사업자번호" },
      { k: "x", label: "", sort: false, render: (v) => h("div", { class: "row" }, h("button", { class: "sm", onclick: () => showPos(v) }, "발주 내역"), ed ? button("삭제", async () => { if (await confirmBox(`${v.name} 삭제?`, "삭제", "danger")) { await DEL(`/api/vendors/${v.id}`); reload(); } }, "sm danger") : null) }],
    rows, { onRow: ed ? (v) => dlg(v) : null, filters: [{ k: "kind", label: "구분" }] })),
    h("p", { class: "small muted" }, "거래처별 계약·미지급 내역은 2차(원가·기성) 개발 범위입니다."));
}
