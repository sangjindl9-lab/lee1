import { GET, h, mount, fmtRate, fmtWon, pbar, can, fmtDT, todayKST } from "../lib.js";

export async function page(el, _p, q, title) {
  title("대시보드");
  const projects = await GET("/api/projects?status=준비,진행,중지");
  const d = await GET("/api/dashboard" + (q.project ? `?project_id=${q.project}` : ""));
  const c = d.counts;
  const go = (href) => (e) => { e.preventDefault(); location.hash = href; };
  const scroll = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const t = (n, label, href, alert) => h("a", { href: "#", class: (n ? (alert ? "alert" : "") : "zero"), onclick: href.startsWith("#") ? go(href) : scroll(href) }, h("b", n), h("span", label));
  const projSel = h("select", { onchange: (e) => { location.hash = "#/" + (e.target.value ? `?project=${e.target.value}` : ""); } },
    h("option", { value: "" }, "전체 현장"), projects.map((p) => h("option", { value: p.id, selected: String(p.id) === q.project }, p.name)));

  const prog = h("div", { class: "panel", id: "prog" },
    h("div", { class: "ph" }, h("h2", "현장별 공정률"), h("span", { class: "muted small" }, `기준일 ${d.today} · 막대 = 실적, 세로선 = 계획`)),
    h("div", { class: "pb flush" }, d.progress.length ? d.progress.map((p) => h("div", { class: "prow" },
      h("a", { href: `#/projects/${p.id}/progress` }, p.name),
      pbar(p.actual_rate, p.plan_rate),
      h("div", { class: "lab" }, "실적 ", h("b", fmtRate(p.actual_rate)), " / 계획 ", fmtRate(p.plan_rate),
        p.deviation !== null ? h("div", { style: { color: Number(p.deviation) < 0 ? "var(--bad)" : "var(--ok)" } }, `편차 ${Number(p.deviation) > 0 ? "+" : ""}${p.deviation}%p`) : null)))
      : h("div", { class: "empty" }, h("b", "진행 중인 현장이 없습니다."), can("project.create") ? h("a", { href: "#/projects/new" }, "공사 등록하기") : null)));

  const list = (id, ttl, rows, render, emptyMsg) => h("div", { class: "panel", id },
    h("div", { class: "ph" }, h("h2", ttl), h("span", { class: "muted small" }, rows.length + "건")),
    h("div", { class: "pb" }, rows.length ? h("ul", { style: { margin: 0, paddingLeft: "18px" } }, rows.map((r) => h("li", { style: { padding: "2px 0" } }, render(r)))) : h("div", { class: "muted" }, emptyMsg)));

  mount(el,
    h("div", { class: "page-head" }, h("div", h("h1", `${state_name()}님, 오늘 업무 현황입니다`), h("div", { class: "sub" }, d.today)), h("span", { class: "grow" }), projSel),
    h("div", { class: "tally" },
      t(c.active, "진행 중 공사", "#/projects?status=진행"),
      t(c.ending_soon, "30일 내 준공예정", "ending"),
      t(c.overdue, "준공예정일 경과", "ending", true),
      t(c.missing_reports, "미작성 작업일보(7일)", "missing", true),
      t(c.pending_approvals, "내 결재 대기", "#/approvals?box=pending", true),
      can("report.approve") ? t(c.reports_to_review, "일보 검토 대기", "#/reports?status=submitted", true) : null,
      t(c.requests_waiting_po, "발주 대기 자재요청", "#/material-requests?status=approved"),
      t(c.delayed_po, "납기 지연 발주", "#/pos?delayed=1", true),
      t(c.partial_po, "부분입고", "#/pos?status=partial"),
      t(c.not_received_po, "미입고 발주", "#/pos?status=ordered")),
    prog,
    h("div", { class: "grid g2" },
      list("missing", "미작성 작업일보", d.missing_reports, (r) => [h("a", { href: `#/reports/new?project=${r.project_id}&date=${r.date}` }, `${r.date} ${r.project_name}`), " ", h("span", { class: "muted small" }, "작성하기")], "최근 7일(일요일 제외) 미작성 일보가 없습니다."),
      list("sched", "이번 주 일정", d.schedule, (s) => [h("b", s.date.slice(5)), ` ${s.kind} · `, h("a", { href: s.link }, s.title), h("span", { class: "muted small" }, ` ${s.project}`)], "이번 주 계획된 공종 시작·완료 및 납기가 없습니다."),
      list("appr", "내 결재 대기", d.pending_approvals, (a) => h("a", { href: `#/approvals/${a.id}` }, a.title), "결재할 문서가 없습니다."),
      list("delay", "납기 지연·부분입고", [...d.delayed_po, ...d.partial_po.filter((p) => !p.delayed)], (p) => [h("a", { href: `#/pos/${p.id}` }, `${p.po_no} ${p.vendor_name}`), " ",
        h("span", { class: "small " + (p.delayed ? "st bad" : "st warn") }, p.delayed ? `납기 ${p.delivery_date} 지연` : "부분입고"), h("span", { class: "muted small" }, ` 미입고 ${p.outstanding_total}`)], "지연·부분입고 발주가 없습니다."),
      list("ending", "준공 예정·경과", [...d.overdue.map((x) => ({ ...x, over: true })), ...d.ending_soon], (p) => [h("a", { href: `#/projects/${p.id}` }, p.name), ` ${p.planned_end_date}`, p.over ? h("span", { class: "st bad", style: { marginLeft: "6px" } }, "경과") : null], "30일 내 준공 예정 현장이 없습니다."),
      list("notice", "공지사항", d.notices, (n) => [n.pinned ? h("span", { class: "st info" }, "고정") : null, " ", h("a", { href: "#/notices" }, n.title), h("span", { class: "muted small" }, ` ${n.author} ${fmtDT(n.created_at).slice(0, 10)}`)], "등록된 공지가 없습니다.")),
    d.money ? h("div", { class: "panel" }, h("div", { class: "ph" }, h("h2", "계약 현황"), h("span", { class: "muted small" }, "준비·진행·중지 현장 기준, 내부 관리용")),
      h("div", { class: "pb" }, h("dl", { class: "kv" }, h("dt", "공급가액 합계"), h("dd", fmtWon(d.money.active_supply_total)), h("dt", "계약총액(VAT포함)"), h("dd", fmtWon(d.money.active_contract_total))),
        h("p", { class: "small muted" }, d.money.note))) : null);
}

import { state } from "../lib.js";
const state_name = () => state.me?.name || "";
