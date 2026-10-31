import {
  GET, POST, PUT, DEL, h, mount, can, table, badge, fmtNum, fmtRate, fmtDT, toast, fail, modal, confirmBox, promptBox, button,
  uploader, saveState, state, todayKST, addDays, pdfButtons, codes, busy,
} from "../lib.js";

export function reportTable(rows, showProject = true) {
  return table([
    { k: "report_date", label: "작업일", w: 110 },
    showProject ? { k: "project_name", label: "현장" } : null,
    { k: "work_summary", label: "작업내용", render: (r) => h("a", { href: `#/reports/${r.id}` }, r.work_summary || "(내용 없음)") },
    { k: "weather", label: "날씨" }, { k: "author_name", label: "작성자" },
    { k: "status_label", label: "상태", render: (r) => [badge(r.status_label), r.revision > 1 ? h("span", { class: "small muted" }, ` 정정${r.revision - 1}`) : null] },
  ].filter(Boolean), rows, { onRow: (r) => (location.hash = `#/reports/${r.id}`), filters: [{ k: "status_label", label: "상태" }, ...(showProject ? [{ k: "project_name", label: "현장" }] : [])] });
}

export async function list(el, _p, q, title) {
  title("작업일보");
  const projects = await GET("/api/projects");
  const from = q.from || addDays(todayKST(), -30), to = q.to || todayKST();
  const ps = new URLSearchParams({ date_from: from, date_to: to });
  if (q.project) ps.set("project_id", q.project);
  if (q.status) ps.set("status", q.status);
  const rows = await GET(`/api/daily-reports?${ps}`);
  const go = (k, v) => { const n = { from, to, ...q, [k]: v }; location.hash = "#/reports?" + new URLSearchParams(Object.fromEntries(Object.entries(n).filter(([, x]) => x))); };
  const xps = new URLSearchParams({ date_from: from, date_to: to }); if (q.project) xps.set("project_id", q.project);
  mount(el, h("div", { class: "page-head" }, h("h1", "작업일보"), h("span", { class: "grow" }),
    can("report.write") ? h("a", { class: "btn primary", href: "#/reports/new" + (q.project ? `?project=${q.project}` : "") }, "작업일보 작성") : null),
    h("div", { class: "panel" }, h("div", { class: "ph" },
      h("select", { onchange: (e) => go("project", e.target.value) }, h("option", { value: "" }, "전체 현장"), projects.map((p) => h("option", { value: p.id, selected: String(p.id) === q.project }, p.name))),
      h("input", { type: "date", value: from, onchange: (e) => go("from", e.target.value) }), "~", h("input", { type: "date", value: to, onchange: (e) => go("to", e.target.value) }),
      h("select", { onchange: (e) => go("status", e.target.value) }, [["", "상태 전체"], ["draft", "작성중"], ["submitted", "제출(검토 대기)"], ["rejected", "반려"], ["approved", "승인"], ["correcting", "정정중"]]
        .map(([v, l]) => h("option", { value: v, selected: (q.status || "") === v }, l))),
      h("span", { class: "grow" }), can("export.data") ? h("a", { class: "btn", href: `/api/export/daily-reports.xlsx?${xps}` }, "엑셀 내보내기") : null),
      reportTable(rows)));
}

export async function create(el, _p, q, title) {
  title("작업일보 작성");
  const projects = (await GET("/api/projects?status=준비,진행,중지"));
  const proj = h("select", {}, h("option", { value: "" }, "현장 선택"), projects.map((p) => h("option", { value: p.id, selected: String(p.id) === q.project || projects.length === 1 }, p.name)));
  const date = h("input", { type: "date", value: q.date || todayKST(), max: todayKST() });
  const make = (copy) => async () => {
    if (!proj.value) return toast("현장을 선택하세요.", "bad");
    const body = { project_id: Number(proj.value), report_date: date.value };
    const r = copy ? await POST("/api/daily-reports/copy-previous", body) : await POST("/api/daily-reports", { ...body, items: [] });
    toast(copy ? "이전 일보를 복사했습니다. 수량·인원은 확인 후 제출하세요." : "작업일보를 만들었습니다.", "ok");
    location.hash = `#/reports/${r.id}`;
  };
  const b1 = h("button", { class: "primary" }, "새로 작성"); b1.addEventListener("click", busy(b1, make(false)));
  const b2 = h("button", {}, "직전 일보 복사해서 작성"); b2.addEventListener("click", busy(b2, make(true)));
  mount(el, h("div", { class: "page-head" }, h("h1", "작업일보 작성")),
    h("div", { class: "panel" }, h("div", { class: "pb" }, h("div", { class: "form" },
      h("div", { class: "f two" }, h("label", "현장", h("span", { class: "req" }, "*")), proj), h("div", { class: "f" }, h("label", "작업일", h("span", { class: "req" }, "*")), date)),
      h("div", { class: "row", style: { marginTop: "16px" } }, b1, b2),
      h("p", { class: "small muted" }, "복사하면 작업내용·인원·장비·자재 행이 그대로 들어오지만, 금일 수량과 인원은 '확인' 표시를 해야 제출됩니다. 사진은 복사되지 않습니다."))));
}

const SEC_NAME = { items: "시공수량", labor: "투입인원", equipment: "장비", materials: "사용자재" };

export async function editor(el, [rid], _q, title) {
  const [r, c] = await Promise.all([GET(`/api/daily-reports/${rid}`), codes()]);
  title(`작업일보 ${r.report_date}`);
  const [boq, prevPr, mats] = await Promise.all([
    GET(`/api/projects/${r.project_id}/boq`),
    GET(`/api/projects/${r.project_id}/boq/progress?basis=${addDays(r.report_date, -1)}`),
    GET("/api/materials"),
  ]);
  const prevCum = Object.fromEntries(prevPr.items.map((i) => [i.id, i.cum_qty]));
  const groupName = Object.fromEntries(boq.groups.map((g) => [g.id, g.name]));
  const boqById = Object.fromEntries(boq.items.map((i) => [i.id, i]));
  const ed = r.editable;
  const ss = saveState();
  const dirty = () => ed && ss.set("dirty");
  const confirmed = new Set();
  let version = r.version;

  // 상태 (편집 대상 데이터)
  const S = {
    items: r.items.map((i) => ({ boq_item_id: i.boq_item_id, qty_today: i.qty_today, location: i.location || "", note: i.note || "" })),
    labor: r.labor.map((x) => ({ ...x })), equipment: r.equipment.map((x) => ({ ...x })), materials: r.materials.map((x) => ({ ...x })),
  };
  const txt = (k, multi = true, attrs = {}) => {
    const i = multi ? h("textarea", { value: r[k] || "", disabled: !ed, rows: 3, ...attrs }) : h("input", { value: r[k] || "", disabled: !ed, ...attrs });
    i.addEventListener("input", dirty); i.dataset.k = k; return i;
  };
  const T = {
    weather: (() => { const s = h("select", { disabled: !ed, onchange: dirty }, h("option", { value: "" }, "선택"), [...new Set([...(c.weather_options || []), r.weather].filter(Boolean))].map((w) => h("option", { selected: w === r.weather }, w))); s.dataset.k = "weather"; return s; })(),
    temp_low: txt("temp_low", false, { inputMode: "decimal", placeholder: "최저" }), temp_high: txt("temp_high", false, { inputMode: "decimal", placeholder: "최고" }),
    work_location: txt("work_location", false), work_summary: txt("work_summary", true, { rows: 4 }),
    safety_education: txt("safety_education"), hazards: txt("hazards"), safety_actions: txt("safety_actions"),
    delay_reason: txt("delay_reason"), remarks: txt("remarks"), tomorrow_plan: txt("tomorrow_plan"),
  };
  const flag = (sec) => (r.needs_confirm || []).includes(sec) && !confirmed.has(sec) ? h("div", { class: "confirm-flag" },
    `이전 일보에서 복사한 ${SEC_NAME[sec]}입니다. 오늘 값이 맞는지 확인하세요.`, h("span", { class: "grow" }),
    ed ? h("button", { class: "sm primary", onclick: () => { confirmed.add(sec); dirty(); drawAll(); } }, "확인했습니다") : null) : null;

  // 시공수량 표
  const itemsBox = h("div");
  const drawItems = () => {
    const opts = boq.items.map((i) => h("option", { value: i.id }, `${groupName[i.group_id] || ""} › ${i.name} ${i.spec || ""} (${i.unit})`));
    mount(itemsBox, flag("items"),
      h("div", { class: "tbl-wrap" }, h("table", { class: "t" },
        h("thead", h("tr", h("th", "내역항목"), h("th", "단위"), h("th", { class: "num" }, "설계"), h("th", { class: "num" }, "전일누계"), h("th", { class: "num" }, "금일"),
          h("th", { class: "num" }, "누계"), h("th", { class: "num" }, "잔량"), h("th", { class: "num" }, "공정률"), h("th", "위치·구간"), h("th", ""))),
        h("tbody", S.items.length ? S.items.map((it, idx) => {
          const b = boqById[it.boq_item_id];
          const snap = r.status === "approved" ? r.items.find((x) => x.boq_item_id === it.boq_item_id) : null;
          const design = snap ? Number(snap.design_qty) : Number(b?.design_qty || 0);
          const prev = snap ? Number(snap.prev_cum) : Number(prevCum[it.boq_item_id] || 0);
          const today = Number(String(it.qty_today || 0).replace(/,/g, "")) || 0;
          const cum = prev + today, rem = design - cum;
          const rate = design > 0 ? (cum / design * 100) : null;
          const qi = h("input", { value: it.qty_today, inputMode: "decimal", disabled: !ed, style: { width: "90px", textAlign: "right" }, oninput: (e) => { it.qty_today = e.target.value; dirty(); updateRow(); } });
          const cells = { cum: h("td", { class: "num" }), rem: h("td", { class: "num" }), rate: h("td", { class: "num" }) };
          const updateRow = () => {
            const t = Number(String(it.qty_today || 0).replace(/,/g, "")) || 0; const cu = prev + t;
            cells.cum.textContent = fmtNum(String(+cu.toFixed(3))); cells.rem.textContent = fmtNum(String(+(design - cu).toFixed(3)));
            cells.rate.textContent = design > 0 ? fmtRate((cu / design * 100).toFixed(2)) + (cu > design ? " 초과" : "") : "계산불가";
            cells.rate.style.color = cu > design ? "var(--warn)" : "";
          };
          updateRow();
          return h("tr",
            h("td", ed ? h("select", { onchange: (e) => { it.boq_item_id = Number(e.target.value); dirty(); drawItems(); } }, opts.map((o) => { const x = o.cloneNode(true); x.selected = Number(x.value) === it.boq_item_id; return x; }))
              : (b ? `${b.name} ${b.spec || ""}` : "(삭제된 항목)")),
            h("td", b?.unit || ""), h("td", { class: "num" }, fmtNum(String(design))), h("td", { class: "num" }, fmtNum(String(prev))),
            h("td", { class: "num" }, qi), cells.cum, cells.rem, cells.rate,
            h("td", h("input", { value: it.location, disabled: !ed, oninput: (e) => { it.location = e.target.value; dirty(); } })),
            h("td", ed ? h("button", { class: "sm", onclick: () => { S.items.splice(idx, 1); dirty(); drawItems(); } }, "삭제") : null));
        }) : h("tr", h("td", { colspan: 10 }, h("div", { class: "empty" }, boq.items.length ? "오늘 시공한 내역항목을 추가하세요." : "이 현장에 설계내역이 없습니다. 공사 > 설계내역에서 먼저 등록하세요.")))))),
      ed && boq.items.length ? h("button", { class: "sm", style: { marginTop: "8px" }, onclick: () => {
        const used = new Set(S.items.map((x) => x.boq_item_id)); const next = boq.items.find((i) => !used.has(i.id));
        if (!next) return toast("모든 내역항목이 이미 추가되었습니다.");
        S.items.push({ boq_item_id: next.id, qty_today: "", location: "", note: "" }); dirty(); drawItems();
      } }, "내역항목 추가") : null,
      h("p", { class: "small muted" }, "전일누계는 이 날짜 이전에 승인된 일보 기준입니다. 이 일보의 수량은 승인될 때 공정률에 반영됩니다."));
  };

  // 단순 반복 행 편집기
  const rowsEditor = (sec, cols, blank) => {
    const box = h("div");
    const draw = () => mount(box, flag(sec), h("div", { class: "tbl-wrap" }, h("table", { class: "t" },
      h("thead", h("tr", cols.map((c2) => h("th", { class: c2.num ? "num" : "" }, c2.label)), h("th", ""))),
      h("tbody", S[sec].length ? S[sec].map((row, idx) => h("tr", cols.map((c2) => h("td", c2.input ? c2.input(row, ed, dirty) :
        h("input", { value: row[c2.k] ?? "", disabled: !ed, inputMode: c2.num ? "decimal" : undefined, style: c2.num ? { textAlign: "right", width: "90px" } : null,
          oninput: (e) => { row[c2.k] = e.target.value; dirty(); } }))),
        h("td", ed ? h("button", { class: "sm", onclick: () => { S[sec].splice(idx, 1); dirty(); draw(); } }, "삭제") : null)))
        : h("tr", h("td", { colspan: cols.length + 1, class: "muted small" }, "입력된 내용 없음"))))),
      ed ? h("button", { class: "sm", style: { marginTop: "8px" }, onclick: () => { S[sec].push(blank()); dirty(); draw(); } }, "행 추가") : null);
    draw(); return { box, draw };
  };
  const trades = c.trades || [];
  const labor = rowsEditor("labor", [
    { k: "trade", label: "직종", input: (row, e2, d) => h("select", { disabled: !e2, onchange: (ev) => { row.trade = ev.target.value; d(); } }, [...new Set([...trades, row.trade].filter(Boolean))].map((t) => h("option", { selected: t === row.trade }, t))) },
    { k: "affiliation", label: "소속(협력업체)" }, { k: "headcount", label: "인원", num: true }, { k: "note", label: "비고" }], () => ({ trade: trades[0] || "기타", headcount: "" }));
  const equip = rowsEditor("equipment", [{ k: "kind", label: "장비" }, { k: "spec", label: "규격" }, { k: "count", label: "대수", num: true }, { k: "hours", label: "사용시간", num: true }, { k: "note", label: "비고" }], () => ({ kind: "", count: "1", hours: "" }));
  const matsEd = rowsEditor("materials", [
    { k: "name", label: "자재", input: (row, e2, d) => {
      const dl = "mat-dl";
      const i = h("input", { value: row.name || "", disabled: !e2, list: dl, oninput: (ev) => { row.name = ev.target.value; const m = mats.find((x) => `${x.name} ${x.spec || ""}`.trim() === ev.target.value || x.name === ev.target.value); if (m) { row.material_id = m.id; row.unit = m.unit; row.spec = m.spec; } d(); } });
      i.setAttribute("list", dl); return i;
    } },
    { k: "spec", label: "규격" }, { k: "unit", label: "단위" }, { k: "qty", label: "수량", num: true }, { k: "note", label: "비고" }], () => ({ name: "", qty: "" }));
  const datalist = h("datalist", { id: "mat-dl" }, mats.map((m) => h("option", { value: `${m.name} ${m.spec || ""}`.trim() })));

  // 사진
  const photoBox = h("div");
  const drawPhotos = async () => {
    const fs = await GET(`/api/files?owner_type=daily_report&owner_id=${r.id}`);
    const phase = h("select", {}, h("option", { value: "" }, "구분"), (c.photo_phases || []).map((x) => h("option", x)));
    const loc = h("input", { placeholder: "위치" }); const ttl = h("input", { placeholder: "작업내용" });
    mount(photoBox,
      fs.length ? h("div", { class: "photos", style: { marginBottom: "10px" } }, fs.map((f) => h("div", { class: "ph-card" },
        f.has_thumb ? h("a", { href: `/api/files/${f.id}/download?inline=true`, target: "_blank" }, h("img", { src: `/api/files/${f.id}/thumb`, alt: f.title || f.name })) : h("div", { class: "cap" }, h("a", { href: `/api/files/${f.id}/download` }, f.name)),
        h("div", { class: "cap" }, `${f.phase || ""} ${f.location || ""} ${f.title || ""}`,
          ed ? h("button", { class: "link small", onclick: async () => { if (await confirmBox("이 파일을 삭제할까요?", "삭제", "danger")) { await DEL(`/api/files/${f.id}`).catch(fail); drawPhotos(); } } }, "삭제") : null)))) : h("p", { class: "muted small" }, "첨부된 사진·파일이 없습니다."),
      ed && can("file.upload") ? [h("div", { class: "row", style: { marginBottom: "8px" } }, phase, loc, ttl),
        uploader({ owner_type: "daily_report", owner_id: r.id, category: "사진", photo: true, meta: () => ({ phase: phase.value, location: loc.value, title: ttl.value, taken_date: r.report_date }), onDone: drawPhotos })]
        : (r.status !== "draft" && r.editable === false ? h("p", { class: "small muted" }, "제출·승인된 일보의 사진은 정정 요청 후 변경할 수 있습니다.") : null));
  };

  const payload = () => {
    const o = { version, confirmed_sections: [...confirmed] };
    for (const [k, i] of Object.entries(T)) o[k] = i.value.trim() || null;
    const num = (v) => String(v ?? "").replace(/,/g, "").trim() || "0";
    o.items = S.items.map((x) => ({ ...x, qty_today: num(x.qty_today) }));
    o.labor = S.labor.map((x) => ({ ...x, headcount: num(x.headcount) }));
    o.equipment = S.equipment.filter((x) => x.kind).map((x) => ({ ...x, count: num(x.count), hours: num(x.hours) }));
    o.materials = S.materials.filter((x) => x.name).map((x) => ({ ...x, qty: num(x.qty) }));
    return o;
  };
  const doSave = async () => {
    const bad = S.items.find((x) => !/^\d+(\.\d+)?$/.test(String(x.qty_today || "0").replace(/,/g, "")));
    if (bad) { toast("금일 시공수량은 0 이상의 숫자로 입력하세요.", "bad"); throw new Error("입력 오류"); }
    ss.set("saving");
    try {
      const nr = await PUT(`/api/daily-reports/${r.id}`, payload());
      version = nr.version; r.needs_confirm = nr.needs_confirm; confirmed.clear();
      ss.set("saved"); state.dirty = false; return nr;
    } catch (e) { ss.set("failed", "저장 실패: " + e.message); throw e; }
  };
  const act = (label, fn, cls = "") => button(label, async () => { await fn(); window.dispatchEvent(new Event("gw:refresh-counts")); }, cls);
  const reload = () => editor(el, [rid], _q, title);
  const actions = [];
  if (ed) {
    actions.push(act("임시저장", async () => { await doSave(); toast("임시저장했습니다.", "ok"); }));
    actions.push(act(r.status === "correcting" ? "정정본 제출" : r.status === "rejected" ? "재제출" : "제출", async () => {
      await doSave(); await POST(`/api/daily-reports/${r.id}/submit`, { version }); toast("제출했습니다. 현장소장 검토를 기다립니다.", "ok"); reload();
    }, "primary"));
    if (r.status !== "correcting" && r.revision === 0) actions.push(act("삭제", async () => { if (await confirmBox("이 일보를 삭제할까요? (휴지통으로 이동)", "삭제", "danger")) { await DEL(`/api/daily-reports/${r.id}`); state.dirty = false; location.hash = "#/reports"; } }, "danger"));
  }
  if (r.status === "submitted" && can("report.approve")) {
    actions.push(act("승인", async () => { if (await confirmBox("승인하면 시공수량이 공정률에 반영됩니다. 승인할까요?", "승인", "ok solid")) { await POST(`/api/daily-reports/${r.id}/approve`, { version }); toast("승인했습니다.", "ok"); reload(); } }, "ok solid"));
    actions.push(act("반려", async () => { const why = await promptBox("일보 반려", "반려 사유"); if (why) { await POST(`/api/daily-reports/${r.id}/reject`, { reason: why }); toast("반려했습니다."); reload(); } }, "danger"));
  }
  if (r.status === "approved" && can("report.write")) actions.push(act("정정 요청", async () => { const why = await promptBox("승인된 일보 정정", "정정 사유"); if (why) { await POST(`/api/daily-reports/${r.id}/request-correction`, { reason: why }); toast("정정 중으로 바뀌었습니다. 정정본이 승인될 때까지 기존 실적이 유지됩니다."); reload(); } }));
  if (["approved", "correcting"].includes(r.status) && can("report.unapprove")) actions.push(act("승인취소", async () => { const why = await promptBox("승인 취소", "승인취소 사유"); if (why) { await POST(`/api/daily-reports/${r.id}/unapprove`, { reason: why }); toast("승인을 취소했습니다. 공정률에서 이 일보의 실적이 빠졌습니다."); reload(); } }, "danger"));

  const sec = (t, ...kids) => h("fieldset", {}, h("legend", t), ...kids);
  const drawAll = () => { drawItems(); labor.draw(); equip.draw(); matsEd.draw(); };
  mount(el,
    h("div", { class: "page-head" }, h("div", h("h1", `작업일보 · ${r.report_date}`), h("div", { class: "sub" }, h("a", { href: `#/projects/${r.project_id}/reports` }, r.project_name), ` · ${r.report_no || ""} · 작성 ${r.author_name}`)),
      badge(r.status_label), r.revision > 1 ? h("span", { class: "st info" }, `정정 ${r.revision - 1}회`) : null, h("span", { class: "grow" }), ss.el, pdfButtons(`/api/export/daily-reports/${r.id}.pdf`)),
    r.reject_reason && ["rejected", "correcting"].includes(r.status) ? h("div", { class: "confirm-flag", style: { background: "var(--bad-bg)", color: "var(--bad)", borderColor: "#f0c2bd" } }, "반려·취소 사유: ", r.reject_reason) : null,
    r.correction_reason && r.status === "correcting" ? h("div", { class: "confirm-flag" }, "정정 사유: ", r.correction_reason, " — 정정본이 승인될 때까지 이전 승인 실적이 공정률에 유지됩니다.") : null,
    sec("기본", h("div", { class: "form" }, h("div", { class: "f" }, h("label", "날씨"), T.weather), h("div", { class: "f" }, h("label", "기온(℃)"), h("div", { class: "row" }, T.temp_low, "~", T.temp_high)),
      h("div", { class: "f two" }, h("label", "작업 위치·구간"), T.work_location), h("div", { class: "f full" }, h("label", "금일 작업내용", h("span", { class: "req" }, "*")), T.work_summary))),
    sec("공종·내역항목별 시공수량", itemsBox),
    sec("투입 인원", labor.box), sec("장비", equip.box), sec("사용 자재", matsEd.box, datalist,
      h("p", { class: "small muted" }, "사용 자재는 기록용입니다. 재고 차감(출고 연계)은 2차 개발 범위입니다.")),
    sec("안전", h("div", { class: "form" }, h("div", { class: "f full" }, h("label", "안전교육·TBM"), T.safety_education), h("div", { class: "f" }, h("label", "위험요인"), T.hazards), h("div", { class: "f two" }, h("label", "조치사항"), T.safety_actions))),
    sec("특이사항·계획", h("div", { class: "form" }, h("div", { class: "f" }, h("label", "작업 지연 사유"), T.delay_reason), h("div", { class: "f two" }, h("label", "특이사항"), T.remarks), h("div", { class: "f full" }, h("label", "명일 작업계획"), T.tomorrow_plan))),
    sec("작업사진·첨부", photoBox),
    h("div", { class: "row actionbar" }, actions),
    r.revisions.length ? h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "승인 이력")), h("div", { class: "pb" }, h("ul", { style: { margin: 0, paddingLeft: "18px" } },
      r.revisions.map((v) => h("li", `${v.revision}차 승인 ${fmtDT(v.at)} ${v.by || ""} — ${v.reason || ""} `, h("button", { class: "link small", onclick: () => showRevision(r.id, v.revision) }, "원문 보기")))))) : null);
  drawAll(); drawPhotos();
}

async function showRevision(rid, rev) {
  const s = await GET(`/api/daily-reports/${rid}/revisions/${rev}`);
  await modal(`${rev}차 승인본 원문`, h("div", {}, h("p", s.work_summary || ""), h("table", { class: "t" },
    h("thead", h("tr", h("th", "항목"), h("th", { class: "num" }, "설계"), h("th", { class: "num" }, "전일누계"), h("th", { class: "num" }, "금일"), h("th", { class: "num" }, "누계"), h("th", { class: "num" }, "공정률"))),
    h("tbody", s.items.map((i) => h("tr", h("td", `${i.name} ${i.spec || ""}`), h("td", { class: "num" }, fmtNum(i.design_qty)), h("td", { class: "num" }, fmtNum(i.prev_cum)),
      h("td", { class: "num" }, fmtNum(i.qty_today)), h("td", { class: "num" }, fmtNum(i.cum)), h("td", { class: "num" }, fmtRate(i.rate))))))), [], { wide: true });
}
