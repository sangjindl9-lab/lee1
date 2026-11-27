"use client";
import { Download, ExternalLink, Package, RotateCcw, Scissors, Square, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StageStrip } from "@/components/Projects";
import { Button, Card, cx, Empty, Field, H2, Note, Status, Tabs, useAction } from "@/components/ui";
import { ACTIVE, API, api, authed, n, tc, token, useApi, usd, when } from "@/lib/api";

const SCORE: [string, string, number][] = [["visual", "영상 시각 품질", 25], ["story", "스토리·전개", 20], ["accuracy", "정보 정확성", 15], ["audio", "음성·음향", 15], ["subtitle", "자막", 10], ["consistency", "시각적 일관성", 10], ["spec", "출력 규격", 5], ["visual_technical", "화면 기술 측정", 25]];

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: p, reload } = useApi<any>(`/projects/${id}`);
  const [live, setLive] = useState<any>(null);
  const [tab, setTab] = useState("package");
  const act = useAction();
  const lastStatus = useRef<string | null>(null);

  // 진행 상황 스트림(SSE). 상태가 바뀌면 상세를 다시 읽는다.
  useEffect(() => {
    const es = new EventSource(`${API}/api/projects/${id}/events?token=${token()}`);
    es.onmessage = (e) => {
      const d = JSON.parse(e.data);
      setLive(d);
      if (lastStatus.current !== d.status + d.stage) { lastStatus.current = d.status + d.stage; reload(); }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [id, reload]);

  if (!p) return <div className="p-8"><Empty>불러오는 중</Empty></div>;
  const status = live?.status || p.status;
  const stages = live?.stages || p.stages;
  const logs = live?.logs || p.logs;
  const running = ACTIVE.includes(status) || status === "PENDING";
  const done = status === "COMPLETED";
  const current = stages.find((s: any) => s.status === "running");
  const doneCount = stages.filter((s: any) => s.status === "done").length;
  const plan = p.stage_data?.plan_budget;
  const post = (path: string, body: any = {}) => act.run(path, () => api(`/projects/${id}/${path}`, { body }).then(reload));

  return (
    <div className="rise mx-auto w-full max-w-[1440px] px-4 sm:px-8 py-6 sm:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-2"><Status s={status} /><span className="num text-mute text-[12px]">{when(p.created_at)}</span></div>
          <h1 className="text-[24px] sm:text-[28px] leading-[1.2] font-medium break-keep">{p.title || p.topic}</h1>
          {p.title && p.title !== p.topic && <p className="text-mute mt-1">주제 · {p.topic}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {done && <a href={authed(`/projects/${id}/download`)}><Button kind="primary"><Download size={16} strokeWidth={1.5} />MP4 받기</Button></a>}
          {done && <a href={authed(`/projects/${id}/package.zip`)}><Button><Package size={16} strokeWidth={1.5} />업로드 패키지</Button></a>}
          {(done || status === "FAILED") && p.scenes.length > 0 && <Link href={`/editor?id=${id}`}><Button><Scissors size={16} strokeWidth={1.5} />편집</Button></Link>}
          {running && <Button kind="danger" busy={act.busy === "cancel"} onClick={() => post("cancel")}><Square size={14} strokeWidth={1.5} />중지</Button>}
          {["FAILED", "CANCELLED"].includes(status) && <Button kind="primary" busy={act.busy === "retry"} onClick={() => post("retry")}><RotateCcw size={16} strokeWidth={1.5} />실패한 단계부터 다시</Button>}
          {!running && <Button kind="ghost" aria-label="삭제" onClick={() => confirm("이 프로젝트와 생성 파일을 삭제할까요?") && act.run("del", () => api(`/projects/${id}`, { method: "DELETE" }).then(() => router.push("/progress")))}><Trash2 size={16} strokeWidth={1.5} /></Button>}
        </div>
      </header>

      <Card className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <StageStrip stages={stages} />
          <div className="flex flex-wrap gap-x-8 gap-y-3 whitespace-nowrap">
            <div><div className="text-mute text-[12px]">단계</div><div className="num text-[20px] mt-1">{doneCount} / {stages.length}</div></div>
            <div><div className="text-mute text-[12px]">사용 비용</div><div className="num text-[20px] mt-1">{usd(live?.actual_cost_usd ?? p.actual_cost_usd, 3)}</div></div>
            <div><div className="text-mute text-[12px]">예상 최대</div><div className="num text-[20px] mt-1">{p.estimated_cost_usd ? usd(live?.estimated_cost_usd ?? p.estimated_cost_usd, 3) : "—"}</div></div>
            <div><div className="text-mute text-[12px]">한도</div><div className="num text-[20px] mt-1">{usd(p.max_cost_usd)}</div></div>
          </div>
        </div>
        {current && <p className="text-sub mt-4">{current.label} 진행 중</p>}
      </Card>

      {act.view}
      {status === "AWAITING_APPROVAL" && <Approval p={p} onDone={reload} />}
      {status === "FAILED" && <div className="mb-6"><Note tone="bad">{live?.error || p.error}</Note></div>}

      <div className="grid lg:grid-cols-[minmax(260px,360px)_1fr] gap-6 items-start">
        <div className="lg:sticky lg:top-6">
          <div className="aspect-[9/16] rounded-[18px] overflow-hidden bg-deep border relative">
            {done && p.video_url ? <video src={p.video_url} poster={p.thumbnail_url || undefined} controls playsInline className="w-full h-full object-contain bg-black" /> : (
              <div className="absolute inset-0 flex flex-col">
                <div className="grid grid-cols-2 gap-px flex-1 overflow-hidden">{p.scenes.slice(0, 6).map((s: any) => <div key={s.id} className="bg-card">{s.image_url && <img src={s.image_url} alt="" className="w-full h-full object-cover rise" />}</div>)}</div>
                {!p.scenes.some((s: any) => s.image_url) && <div className="absolute inset-0 flex items-center justify-center text-mute text-[13px] px-8 text-center">{running ? "장면 이미지가 만들어지면 여기에 나타납니다" : "완성된 영상이 없습니다"}</div>}
              </div>
            )}
          </div>
          {done && <div className="num text-mute text-[12px] mt-3 flex justify-between"><span>{p.package?.video?.width}×{p.package?.video?.height} · {p.package?.video?.fps}fps · {p.package?.video?.vcodec}/{p.package?.video?.acodec}</span><span>{tc(p.package?.video?.duration)}</span></div>}
        </div>

        <div className="min-w-0">
          <Tabs value={tab} onChange={setTab} tabs={[["package", "업로드 패키지"], ["scenes", "장면"], ["script", "대본·출처"], ["research", "기획·조사"], ["quality", "품질검수"], ["cost", "비용"], ["log", "기록"]]} />
          {tab === "package" && (done ? <PackageTab p={p} id={id} /> : <Empty>제작이 끝나면 제목·설명·해시태그·커버가 여기에 정리됩니다</Empty>)}
          {tab === "scenes" && <Scenes p={p} plan={plan} />}
          {tab === "script" && <ScriptTab p={p} />}
          {tab === "research" && <Research p={p} />}
          {tab === "quality" && <Quality p={p} />}
          {tab === "cost" && <Cost p={p} plan={plan} />}
          {tab === "log" && <Card><ul className="flex flex-col gap-1.5 max-h-[560px] overflow-y-auto">{logs.map((l: any, i: number) => (
            <li key={i} className="flex gap-3 text-[13px]"><span className="num text-mute shrink-0">{new Date(l.at).toLocaleTimeString("ko-KR", { hour12: false })}</span>
              <span className={cx(l.level === "error" ? "text-bad" : l.level === "warn" ? "text-ink" : "text-sub")}>{l.message}</span></li>))}</ul></Card>}
        </div>
      </div>
    </div>
  );
}

function Approval({ p, onDone }: any) {
  const act = useAction();
  const [max, setMax] = useState(String(Math.max(p.max_cost_usd, Math.ceil((p.estimated_cost_usd || p.max_cost_usd) * 10) / 10)));
  const unpriced = p.stage_data?.plan_budget?.unpriced_models || [];
  const [allow, setAllow] = useState(unpriced.length > 0);
  return (
    <Card className="mb-6 !border-[rgba(237,237,237,0.24)]">
      <H2>승인이 필요합니다</H2>
      <p className="text-sub">{p.error}</p>
      <p className="text-mute text-[13px] mt-1">아직 이 단계의 유료 호출은 실행되지 않았습니다</p>
      <div className="flex flex-wrap items-end gap-4 mt-4">
        <Field label="최대 비용 (USD)" className="w-40"><input className="num" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
        {unpriced.length > 0 && <label className="inline-flex items-center gap-2 h-9 text-sub"><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} />단가 미등록 모델({unpriced.join(", ")}) 사용 허용</label>}
        <Button kind="primary" busy={!!act.busy} onClick={() => act.run("ok", () => api(`/projects/${p.id}/approve`, { body: { max_cost_usd: Number(max), allow_unpriced: allow } }).then(onDone))}>승인하고 계속</Button>
      </div>
      {act.view}
    </Card>
  );
}

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1200); }} className="text-mute hover:text-ink text-[12px] transition-colors duration-150">{ok ? "복사됨" : "복사"}</button>;
}

function PackageTab({ p, id }: any) {
  const pk = p.package;
  const ch = useApi<any>("/youtube/channels");
  const act = useAction();
  const [f, setF] = useState({ channel_id: "", privacy: "private", synthetic: !!pk.ai_disclosure?.likely_required, confirm: false });
  const [res, setRes] = useState<any>(null);
  const channels = ch.data?.channels || [];
  return (
    <div className="flex flex-col gap-4">
      {pk.quality && !pk.quality.passed && <Note tone="warn">품질 점수 {pk.quality.total}점으로 기준에 못 미쳤습니다. 품질검수 탭의 지적 사항을 확인하세요</Note>}
      {pk.unverified && <Note tone="warn">검색 API가 연결되지 않았거나 근거 자료가 없어, 검증된 사실 없이 작성된 대본입니다</Note>}
      <Card>
        <H2 right={<Copy text={pk.final_title} />}>최종 추천 제목</H2>
        <p className="text-[18px] leading-7">{pk.final_title}</p>
        <ul className="mt-3 flex flex-col gap-1 text-sub">{pk.titles.filter((t: string) => t !== pk.final_title).map((t: string) => <li key={t}>{t}</li>)}</ul>
      </Card>
      <Card><H2 right={<Copy text={`${pk.description}\n\n${pk.hashtags.join(" ")}`} />}>설명 · 해시태그</H2><p className="text-sub whitespace-pre-wrap">{pk.description}</p><p className="mt-3">{pk.hashtags.join(" ")}</p>
        {pk.keywords?.length > 0 && <p className="text-mute text-[13px] mt-2">검색 키워드 · {pk.keywords.join(", ")}</p>}</Card>
      {pk.pinned_comment && <Card><H2 right={<Copy text={pk.pinned_comment} />}>고정 댓글</H2><p className="text-sub">{pk.pinned_comment}</p></Card>}
      <Card>
        <H2>대표 이미지 · 커버 프레임</H2>
        <div className="flex gap-3 overflow-x-auto">{[pk.thumbnail_url, ...(pk.cover_urls || [])].filter(Boolean).map((u: string) => <a key={u} href={u} target="_blank" className="shrink-0"><img src={u} alt="" className="h-48 rounded-lg border" /></a>)}</div>
        <p className="text-mute text-[12px] mt-3 leading-4">{pk.thumbnail_note}</p>
      </Card>
      <Card>
        <H2>자막 파일</H2>
        <div className="flex flex-wrap gap-2">{p.subtitles.filter((s: any) => s.format !== "ass").map((s: any) => <a key={s.url} href={s.url} download><Button><Download size={16} strokeWidth={1.5} />{s.language.toUpperCase()} · {s.format.toUpperCase()}</Button></a>)}</div>
        <p className="text-mute text-[12px] mt-3">싱크 방식 · {p.subtitles[0]?.sync || "—"}. 영상에는 자막이 이미 입혀져 있습니다</p>
      </Card>
      <Card>
        <H2>공개 전 확인</H2>
        <dl className="grid sm:grid-cols-[160px_1fr] gap-x-4 gap-y-3 text-sub">
          <dt className="text-mute">AI 생성 표시</dt><dd>{pk.ai_disclosure?.likely_required ? "표시가 필요할 가능성이 높습니다" : "필요 가능성이 낮습니다"} · {pk.ai_disclosure?.reason}</dd>
          <dt className="text-mute">정책 사전 검사</dt><dd>위험도 {pk.policy_check?.risk || "—"}{pk.policy_check?.notes?.length ? ` · ${pk.policy_check.notes.join(" / ")}` : ""}</dd>
          <dt className="text-mute">배경음악</dt><dd>{pk.music ? `${pk.music.title} · ${pk.music.license?.name} (${pk.music.license?.type || "유형 미기재"})` : "사용 안 함"}</dd>
        </dl>
        <p className="text-mute text-[12px] mt-3 leading-4">{pk.policy_disclaimer}</p>
      </Card>
      <Card>
        <H2>유튜브 업로드</H2>
        {!channels.length ? <p className="text-sub">연결된 채널이 없습니다 · <Link href="/channels" className="text-ink underline underline-offset-4">유튜브 채널 연결</Link></p> : res ? (
          <div><Note tone="ok">업로드했습니다 ({res.privacy})</Note>{res.note && <div className="mt-2"><Note tone="warn">{res.note}</Note></div>}<a href={res.url} target="_blank" className="inline-flex items-center gap-1.5 mt-3 underline underline-offset-4">{res.url}<ExternalLink size={14} strokeWidth={1.5} /></a></div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="채널"><select value={f.channel_id} onChange={(e) => setF({ ...f, channel_id: e.target.value })}><option value="">선택</option>{channels.map((c: any) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field>
              <Field label="공개 범위" hint="기본은 비공개입니다"><select value={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.value })}><option value="private">비공개</option><option value="unlisted">일부 공개</option><option value="public">공개</option></select></Field>
            </div>
            <label className="inline-flex items-center gap-2 text-sub"><input type="checkbox" checked={f.synthetic} onChange={(e) => setF({ ...f, synthetic: e.target.checked })} />변경되었거나 합성된 콘텐츠로 표시</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} />이 영상을 내 채널에 올리는 것을 승인합니다</label>
            <div><Button kind="primary" disabled={!f.confirm || !f.channel_id} busy={!!act.busy} onClick={() => act.run("up", () => api(`/projects/${id}/upload`, { body: f }).then(setRes))}><Upload size={16} strokeWidth={1.5} />업로드</Button></div>
            {act.view}
          </div>
        )}
        {p.uploads?.length > 0 && <ul className="mt-4 text-[13px] text-sub flex flex-col gap-1">{p.uploads.map((u: any) => <li key={u.id} className="num">{when(u.created_at)} · {u.status} · {u.privacy}{u.video_id ? ` · ${u.video_id}` : ""}{u.error ? ` · ${u.error}` : ""}</li>)}</ul>}
      </Card>
    </div>
  );
}

function Scenes({ p, plan }: any) {
  if (!p.scenes.length) return <Empty>스토리보드 단계가 끝나면 장면이 나타납니다</Empty>;
  return (
    <div className="flex flex-col gap-3">
      {plan && <p className="text-sub text-[13px]">영상 {plan.video_scenes}장면 · 이미지 {plan.image_scenes}장면 · 이미지 {plan.image_model} · 영상 {plan.video_model || "없음"} · 음성 {plan.tts_model}</p>}
      {p.scenes.map((s: any) => (
        <Card key={s.id} className="!p-4 flex gap-4">
          <div className="w-[72px] sm:w-[96px] shrink-0 aspect-[9/16] rounded-lg overflow-hidden bg-deep border">
            {s.video_url ? <video src={s.video_url} muted loop playsInline onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} poster={s.image_url || undefined} className="w-full h-full object-cover" /> : s.image_url ? <img src={s.image_url} alt="" className="w-full h-full object-cover" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="num text-mute text-[12px] flex flex-wrap gap-x-3">
              <span>#{String(s.idx + 1).padStart(2, "0")}</span><span>{tc(s.start)} → {tc(s.end)}</span><span>{s.kind === "video" ? "영상" : "이미지"}</span>
              <span>{s.kind === "video" ? s.video_model : s.image_model}</span>{s.est_cost_usd != null && <span>예상 {usd(s.est_cost_usd, 3)}</span>}{s.attempts > 0 && <span>재생성 {s.attempts}회</span>}
            </div>
            <p className="mt-2 leading-6">{s.narration}</p>
            <p className="text-mute text-[13px] mt-2 leading-5 break-words">{[s.shot, s.camera_move, s.lighting, s.transition !== "cut" && `전환 ${s.transition}`].filter(Boolean).join(" · ")}</p>
            <p className="text-mute text-[12px] mt-1 leading-4 break-words line-clamp-2">{s.image_prompt}</p>
            {s.audio_url && <audio src={s.audio_url} controls preload="none" className="mt-3 h-8 w-full max-w-[360px]" />}
          </div>
        </Card>
      ))}
    </div>
  );
}

function ScriptTab({ p }: any) {
  const facts = p.sources.filter((s: any) => s.kind === "fact");
  const web = p.sources.filter((s: any) => s.kind === "web");
  if (!p.script) return <Empty>대본 단계가 끝나면 나타납니다</Empty>;
  const ROLE: any = { hook: "오프닝", setup: "궁금증", body: "전개", payoff: "핵심", outro: "마무리" };
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <H2 right={<span className="num text-mute text-[12px]">v{p.script.version} · 예상 {p.script.est_duration}초 · {p.script.content_type}</span>}>대본</H2>
        <div className="flex flex-col gap-3">{p.script.sections.map((s: any, i: number) => <div key={i} className="grid grid-cols-[64px_1fr] gap-3"><span className="text-mute text-[13px] pt-0.5">{ROLE[s.role] || s.role}</span><p className="leading-6">{s.text}</p></div>)}</div>
        {p.script.policy_notes?.length > 0 && <div className="mt-4"><Note tone="warn">주의 메모 · {p.script.policy_notes.join(" / ")}</Note></div>}
      </Card>
      <Card>
        <H2>검증된 사실 · 출처</H2>
        {!facts.length ? <p className="text-sub">검증된 사실이 없습니다. 이 경우 대본에는 구체적 수치·날짜·발언을 쓰지 않도록 지시됩니다</p> : (
          <ul className="flex flex-col gap-4">{facts.map((f: any) => (
            <li key={f.id}><p>{f.claim}{f.conflicting && <span className="text-bad"> · 자료 상충</span>}</p>
              <a href={f.url} target="_blank" className="text-sub text-[13px] underline underline-offset-4 break-all">{f.title || f.url}</a>
              <div className="num text-mute text-[12px] mt-1">신뢰도 {f.reliability} · 발표 {f.published_at || "미상"} · 확인 {when(f.checked_at)}</div></li>))}</ul>)}
      </Card>
      {web.length > 0 && <Card><H2>수집 자료 {web.length}건</H2><ul className="flex flex-col gap-2 text-[13px]">{web.map((w: any) => <li key={w.id} className="truncate"><a href={w.url} target="_blank" className="text-sub hover:text-ink underline underline-offset-4">{w.title || w.url}</a></li>)}</ul></Card>}
    </div>
  );
}

function Research({ p }: any) {
  const st = p.stage_data?.strategy;
  const yt = p.stage_data?.youtube_research;
  return (
    <div className="flex flex-col gap-4">
      {st ? (
        <Card>
          <H2>기획안 {st.concepts.length}개 중 선정</H2>
          <div className="flex flex-col gap-3">{st.concepts.map((c: any) => {
            const on = String(c.id) === String(st.selected?.id);
            const ev = (st.evaluation || []).find((e: any) => String(e.id) === String(c.id));
            return <div key={c.id} className={cx("rounded-xl border p-4", on && "bg-raised border-[rgba(237,237,237,0.24)]")}>
              <div className="flex justify-between gap-3"><span className="font-medium">{c.title}</span><span className="num text-mute text-[12px] shrink-0">{on ? "선정 · " : ""}{ev?.total != null ? `${ev.total}점` : ""}</span></div>
              <p className="text-sub text-[13px] mt-1">{[c.angle, c.hook, c.differentiation].filter(Boolean).join(" · ")}</p></div>;
          })}</div>
          <p className="text-sub mt-4">{st.reason}</p>
          {st.insights?.data_limits && <p className="text-mute text-[12px] mt-2">자료의 한계 · {st.insights.data_limits}</p>}
        </Card>
      ) : <Empty>기획 단계가 끝나면 나타납니다</Empty>}
      {p.youtube.length > 0 && (
        <Card>
          <H2 right={<span className="num text-mute text-[12px]">쿼터 {yt?.quota_used}단위 사용</span>}>참고한 유튜브 영상</H2>
          <div className="overflow-x-auto -mx-5"><table className="min-w-[640px]"><thead><tr><th className="!pl-5">제목</th><th className="text-right">조회수</th><th className="text-right">시간당 평균</th><th className="text-right">구독자 대비</th><th className="text-right !pr-5">길이</th></tr></thead>
            <tbody>{p.youtube.slice(0, 15).map((v: any) => <tr key={v.id}><td className="!pl-5 max-w-[320px]"><a href={v.url} target="_blank" className="block truncate text-ink hover:underline underline-offset-4">{v.title}</a></td>
              <td className="num text-right">{n(v.view_count)}</td><td className="num text-right">{n(v.metrics.avg_views_per_hour)}</td><td className="num text-right">{v.metrics.views_per_subscriber ?? "—"}</td><td className="num text-right !pr-5">{v.duration_sec}초</td></tr>)}</tbody></table></div>
          <p className="text-mute text-[12px] mt-3 leading-4">{yt?.short_note} 시간당 평균은 게시 후 평균값이며 실제 증가 곡선이 아닙니다. {yt?.note}</p>
        </Card>
      )}
    </div>
  );
}

function Quality({ p }: any) {
  if (!p.quality.length) return <Empty>렌더링 뒤 품질검수 결과가 나타납니다</Empty>;
  return (
    <div className="flex flex-col gap-4">
      {[...p.quality].reverse().map((q: any) => (
        <Card key={q.id}>
          <div className="flex items-end justify-between mb-5">
            <div><div className="text-mute text-[12px]">{q.round + 1}차 검수 · {when(q.created_at)}</div><div className="num text-[32px] leading-9 font-medium mt-1">{q.total}<span className="text-mute text-[14px]"> / 100</span></div></div>
            <span className={q.passed ? "text-ok" : "text-bad"}>{q.passed ? "통과" : "미달"}</span>
          </div>
          <div className="flex flex-col gap-2">{SCORE.filter(([k]) => q.scores[k] != null).map(([k, label, max]) => (
            <div key={k} className="grid grid-cols-[120px_1fr_56px] items-center gap-3 text-[13px]"><span className="text-sub">{label}</span>
              <span className="h-1.5 rounded-full bg-raised overflow-hidden"><span className="block h-full bg-ink/70 rounded-full" style={{ width: `${(q.scores[k] / max) * 100}%` }} /></span>
              <span className="num text-right text-sub">{Number(q.scores[k]).toFixed(1)}/{max}</span></div>))}</div>
          {q.partial && <div className="mt-4"><Note tone="warn">AI 시각 검수를 하지 못해 기술 측정 항목만으로 환산한 점수입니다</Note></div>}
          {q.fatal.length > 0 && <div className="mt-4"><Note tone="bad">치명적 문제 · {q.fatal.join(" / ")}</Note></div>}
          {q.issues.length > 0 && <ul className="mt-4 flex flex-col gap-1.5 text-[13px] text-sub">{q.issues.map((it: any, i: number) => <li key={i}><span className="num text-mute">{it.scene != null ? `#${String(it.scene + 1).padStart(2, "0")} ` : ""}</span>{it.msg}</li>)}</ul>}
          <p className="num text-mute text-[12px] mt-4">음량 {q.technical?.loudness?.integrated_lufs ?? "—"} LUFS · 피크 {q.technical?.loudness?.true_peak_db ?? "—"} dBTP · 검은 화면 {q.technical?.black_seconds ?? 0}초</p>
        </Card>
      ))}
      <p className="text-mute text-[12px]">내부 품질 지표이며 유튜브 알고리즘이나 조회수를 보장하지 않습니다</p>
    </div>
  );
}

function Cost({ p, plan }: any) {
  const KIND: any = { llm: "언어 AI", image: "이미지", video: "영상", tts: "음성 합성", stt: "음성 인식" };
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <H2>실제 사용</H2>
        {!p.costs.length ? <Empty>아직 비용이 없습니다</Empty> : <div className="overflow-x-auto -mx-5"><table className="min-w-[480px]"><thead><tr><th className="!pl-5">종류</th><th>모델</th><th className="text-right">호출</th><th className="text-right !pr-5">금액</th></tr></thead>
          <tbody>{p.costs.map((c: any, i: number) => <tr key={i}><td className="!pl-5 text-ink">{KIND[c.kind] || c.kind}</td><td>{c.model || c.provider}</td><td className="num text-right">{c.calls}</td><td className="num text-right !pr-5">{usd(c.amount_usd, 4)}</td></tr>)}</tbody></table></div>}
        <p className="text-mute text-[12px] mt-3 leading-4">등록된 단가표로 계산한 금액입니다. 공급자가 응답에 금액을 주지 않으므로 실제 청구액은 공급자 콘솔에서 확인하세요</p>
      </Card>
      {plan && <Card><H2>제작 전 산정</H2><dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sub"><dt className="text-mute">생성 예상</dt><dd className="num">{usd(plan.generation_estimate_usd, 3)}</dd><dt className="text-mute">재생성 여유 포함 최대</dt><dd className="num">{usd(plan.max_estimate_usd, 3)}</dd>
        {plan.unpriced_models?.length > 0 && <><dt className="text-mute">단가 미등록</dt><dd>{plan.unpriced_models.join(", ")}</dd></>}</dl></Card>}
      {p.failed_requests.length > 0 && <Card><H2>실패한 API 요청</H2><ul className="flex flex-col gap-2 text-[13px]">{p.failed_requests.map((r: any) => <li key={r.id} className="text-sub"><span className="num text-mute">{when(r.created_at)}</span> · {r.model_key || r.provider} · {r.error} · 과금 {r.billed === false ? "안 됨" : r.billed ? "됨" : "확인 불가"}</li>)}</ul></Card>}
    </div>
  );
}
