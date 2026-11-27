"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Empty, Field, H2, Page, Stat, Status, Tabs, useAction } from "@/components/ui";
import { api, n, useApi, usd, when } from "@/lib/api";

export default function Admin() {
  const [tab, setTab] = useState("ops");
  return (
    <Page title="관리자">
      <Tabs value={tab} onChange={setTab} tabs={[["ops", "운영 현황"], ["users", "사용자"], ["projects", "전체 제작 내역"], ["fail", "실패·장애"], ["policy", "품질·한도·정책"]]} />
      {tab === "ops" && <Ops />}{tab === "users" && <Users />}{tab === "projects" && <Projects />}{tab === "fail" && <Failures />}{tab === "policy" && <Policy />}
    </Page>
  );
}

function Ops() {
  const st = useApi<any>("/admin/stats");
  const sys = useApi<any>("/admin/system", 10000);
  if (!st.data || !sys.data) return <Empty>불러오는 중</Empty>;
  const s = st.data, y = sys.data;
  const max = Math.max(1, ...s.by_day.map((d: any) => d.created));
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="사용자" value={n(s.users)} /><Stat label="완성 영상" value={n(s.by_status.COMPLETED || 0)} sub={`실패 ${s.by_status.FAILED || 0}건`} />
        <Stat label="30일 API 비용" value={usd(s.cost_30d_usd)} sub={s.avg_cost_per_completed_usd != null ? `완성 1건당 ${usd(s.avg_cost_per_completed_usd, 3)}` : "완성 건 없음"} /><Stat label="지금 진행 중" value={n(y.active_projects)} />
      </div>
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <Card><H2>일별 제작 · 최근 30일</H2>{!s.by_day.length ? <Empty>기록 없음</Empty> : <div className="h-[280px] flex items-end gap-1 border-b">{s.by_day.map((d: any) => <div key={d.day} className="flex-1 h-full flex items-end justify-center" title={`${d.day} · 시작 ${d.created} · 완성 ${d.completed} · 실패 ${d.failed}`}><div className="w-full max-w-[28px] bg-ink/25 rounded-t-[3px] relative" style={{ height: `${(d.created / max) * 100}%` }}><div className="absolute bottom-0 inset-x-0 bg-ink/70 rounded-t-[3px]" style={{ height: `${d.created ? (d.completed / d.created) * 100 : 0}%` }} /></div></div>)}</div>}
          <p className="text-mute text-[12px] mt-2">옅은 막대는 시작한 작업, 진한 부분은 완성된 작업</p></Card>
        <Card><H2>서버 · 워커</H2><dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
          <dt className="text-mute">작업 실행</dt><dd>{y.task_mode}</dd><dt className="text-mute">데이터베이스</dt><dd className={y.database === "ok" ? "text-ok" : "text-bad"}>{y.database}</dd>
          <dt className="text-mute">Redis</dt><dd>{y.redis || "사용 안 함"}</dd><dt className="text-mute">워커</dt><dd>{Array.isArray(y.workers) ? (y.workers.length ? y.workers.map((w: any) => `${w.name} [${w.queues.join(",")}]`).join(" / ") : "응답하는 워커 없음") : y.workers}</dd>
          <dt className="text-mute">저장소</dt><dd>{y.storage} · 여유 {y.disk_free_gb}GB</dd><dt className="text-mute">FFmpeg</dt><dd className="num break-all">{y.ffmpeg}</dd></dl>
          <p className="text-mute text-[12px] mt-4">{s.billing}</p></Card>
      </div>
    </div>
  );
}

function Users() {
  const u = useApi<any[]>("/admin/users");
  const [nu, setNu] = useState({ username: "", password: "" });
  const act = useAction();
  const patch = (id: string, body: any) => act.run(id, () => api(`/admin/users/${id}`, { method: "PATCH", body }).then(u.reload));
  return (
    <div>
      {act.view}
      <Card className="!p-0 overflow-x-auto"><table className="min-w-[860px]"><thead><tr><th className="!pl-5">아이디</th><th>권한</th><th className="text-right">제작</th><th className="text-right">이번 달 비용</th><th>일 한도</th><th>월 한도</th><th>일 수량</th><th className="!pr-5" /></tr></thead>
        <tbody>{(u.data || []).map((x) => <tr key={x.id + x.updated_at}><td className="!pl-5 text-ink">{x.username}{!x.is_active && <span className="text-bad text-[12px] ml-2">정지</span>}</td><td>{x.role}</td><td className="num text-right">{x.projects}</td><td className="num text-right">{usd(x.month_cost_usd)}</td>
          {(["daily_cost_limit_usd", "monthly_cost_limit_usd", "daily_video_limit"] as const).map((k) => <td key={k}><input className="num !h-8 !w-20" defaultValue={x[k]} onBlur={(e) => Number(e.target.value) !== x[k] && patch(x.id, { [k]: Number(e.target.value) })} /></td>)}
          <td className="!pr-5 text-right whitespace-nowrap"><Button kind="ghost" className="!h-8" onClick={() => patch(x.id, { role: x.role === "admin" ? "user" : "admin" })}>{x.role === "admin" ? "관리자 해제" : "관리자로"}</Button><Button kind="ghost" className="!h-8" onClick={() => patch(x.id, { is_active: !x.is_active })}>{x.is_active ? "정지" : "해제"}</Button></td></tr>)}</tbody></table></Card>
      <Card className="mt-4 max-w-[560px]"><H2>사용자 추가</H2><div className="flex gap-3"><input placeholder="아이디" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} /><input type="password" placeholder="비밀번호 (8자 이상)" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /><Button busy={act.busy === "n"} onClick={() => act.run("n", () => api("/admin/users", { body: nu }).then(() => { setNu({ username: "", password: "" }); u.reload(); }))}>추가</Button></div></Card>
    </div>
  );
}

function Projects() {
  const p = useApi<any[]>("/admin/projects", 8000);
  const act = useAction();
  if (!p.data) return <Empty>불러오는 중</Empty>;
  return <Card className="!p-0 overflow-x-auto">{act.view}<table className="min-w-[860px]"><thead><tr><th className="!pl-5">주제</th><th>사용자</th><th>상태</th><th>단계</th><th className="text-right">비용</th><th className="text-right">시작</th><th className="!pr-5" /></tr></thead>
    <tbody>{p.data.map((x) => <tr key={x.id}><td className="!pl-5 max-w-[320px]"><Link href={`/projects/${x.id}`} className="block truncate text-ink hover:underline underline-offset-4">{x.title || x.topic}</Link></td><td>{x.username}</td><td><Status s={x.status} /></td><td className="text-[13px]">{x.current_stage || "—"}</td><td className="num text-right">{usd(x.actual_cost_usd, 3)}</td><td className="num text-right text-[13px]">{when(x.created_at)}</td>
      <td className="!pr-5 text-right">{!["COMPLETED", "CANCELLED", "FAILED"].includes(x.status) && <Button kind="danger" className="!h-8" onClick={() => act.run(x.id, () => api(`/admin/projects/${x.id}/stop`, { method: "POST" }).then(p.reload))}>강제 중지</Button>}</td></tr>)}</tbody></table></Card>;
}

function Failures() {
  const f = useApi<any>("/admin/failures");
  const h = useApi<any[]>("/admin/health");
  return (
    <div className="flex flex-col gap-6">
      <Card className="!p-0 overflow-x-auto"><div className="p-5 pb-0"><H2>공급자별 상태 · 최근 7일</H2></div>{!h.data?.length ? <Empty>호출 기록이 없습니다</Empty> : <table className="min-w-[760px]"><thead><tr><th className="!pl-5">공급자 · 모델</th><th>종류</th><th className="text-right">호출</th><th className="text-right">오류율</th><th className="text-right">평균 처리</th><th className="text-right">비용</th><th className="!pr-5">최근 오류</th></tr></thead>
        <tbody>{h.data.map((x, i) => <tr key={i}><td className="!pl-5 text-ink">{x.model || x.provider}</td><td>{x.kind}</td><td className="num text-right">{x.total}</td><td className={`num text-right ${x.error_rate > 0.2 ? "text-bad" : ""}`}>{(x.error_rate * 100).toFixed(0)}%</td><td className="num text-right">{x.avg_seconds != null ? `${x.avg_seconds}초` : "—"}</td><td className="num text-right">{usd(x.cost, 3)}</td><td className="!pr-5 text-[13px] max-w-[280px] truncate">{x.last_error || "—"}</td></tr>)}</tbody></table>}</Card>
      <Card><H2>작업 실패 기록</H2>{!f.data?.logs.length ? <Empty>실패 기록이 없습니다</Empty> : <ul className="flex flex-col gap-2 text-[13px]">{f.data.logs.map((l: any) => <li key={l.id} className="text-sub"><span className="num text-mute">{when(l.created_at)}</span> · <Link href={`/projects/${l.project_id}`} className="underline underline-offset-4">{l.project_id?.slice(0, 8)}</Link> · {l.message}</li>)}</ul>}</Card>
    </div>
  );
}

function Policy() {
  const g = useApi<any>("/admin/settings");
  const [f, setF] = useState<any>(null);
  const act = useAction();
  useEffect(() => { if (g.data) setF({ ...g.data, blocked_keywords: (g.data.blocked_keywords || []).join(", ") }); }, [g.data]);
  if (!f) return <Empty>불러오는 중</Empty>;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const num = (k: string) => Number(f[k]);
  return (
    <Card className="max-w-[760px]">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="품질 통과 기준 (100점 만점)"><input className="num" value={f.quality_pass_score} onChange={set("quality_pass_score")} /></Field>
        <Field label="자동 재제작 최대 횟수"><input className="num" value={f.max_regen_rounds} onChange={set("max_regen_rounds")} /></Field>
        <Field label="프로젝트당 YouTube 쿼터"><input className="num" value={f.youtube_quota_per_project} onChange={set("youtube_quota_per_project")} /></Field>
        <Field label="영상 1개 기본 최대 비용 (USD)"><input className="num" value={f.default_max_cost_usd} onChange={set("default_max_cost_usd")} /></Field>
        <Field label="신규 사용자 일 비용 한도"><input className="num" value={f.default_daily_cost_limit_usd} onChange={set("default_daily_cost_limit_usd")} /></Field>
        <Field label="신규 사용자 월 비용 한도"><input className="num" value={f.default_monthly_cost_limit_usd} onChange={set("default_monthly_cost_limit_usd")} /></Field>
        <Field label="신규 사용자 일일 제작 수량"><input className="num" value={f.default_daily_video_limit} onChange={set("default_daily_video_limit")} /></Field>
        <Field label="제작 금지 키워드 (쉼표로 구분)" className="sm:col-span-2"><input value={f.blocked_keywords} onChange={set("blocked_keywords")} /></Field>
      </div>
      <label className="inline-flex items-center gap-2 text-sub mt-5"><input type="checkbox" checked={!!f.allow_signup} onChange={set("allow_signup")} />회원가입 허용</label>
      <div><Button kind="primary" className="mt-5" busy={!!act.busy} onClick={() => act.run("s", () => api("/admin/settings", { method: "PUT", body: {
        quality_pass_score: num("quality_pass_score"), max_regen_rounds: num("max_regen_rounds"), youtube_quota_per_project: num("youtube_quota_per_project"), default_max_cost_usd: num("default_max_cost_usd"),
        default_daily_cost_limit_usd: num("default_daily_cost_limit_usd"), default_monthly_cost_limit_usd: num("default_monthly_cost_limit_usd"), default_daily_video_limit: num("default_daily_video_limit"),
        allow_signup: !!f.allow_signup, blocked_keywords: f.blocked_keywords.split(",").map((s: string) => s.trim()).filter(Boolean) } }).then(g.reload), "저장했습니다")}>저장</Button></div>
      {act.view}
    </Card>
  );
}
