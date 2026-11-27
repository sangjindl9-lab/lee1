"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button, Card, Empty, Field, Note, Page, useAction } from "@/components/ui";
import { api, tc, useApi } from "@/lib/api";

const ORDER = ["narration", "images", "videos", "music", "subs", "timeline", "render"];
const LABEL: any = { narration: "내레이션부터", images: "이미지부터", videos: "영상부터", subs: "자막부터", timeline: "편집부터", render: "렌더링만" };
const TR = ["cut", "fade", "dissolve", "slideleft", "slideup", "wipeleft", "fadeblack", "circleopen"];

function Inner() {
  const q = useSearchParams();
  const router = useRouter();
  const id = q.get("id");
  const list = useApi<any[]>(id ? null : "/projects");
  const { data: p, reload } = useApi<any>(id ? `/projects/${id}` : null);
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [from, setFrom] = useState<string | null>(null);
  const [style, setStyle] = useState<any>(null);
  const act = useAction();
  useEffect(() => { if (p) setStyle({ size: 86, highlight: "#FFE500", margin_v: 470, kinetic: true, ...(p.settings?.subtitle_style || {}) }); }, [p?.id]);

  if (!id) {
    const items = (list.data || []).filter((x) => ["COMPLETED", "FAILED", "CANCELLED"].includes(x.status));
    return <Page title="AI 영상 편집기" meta="장면의 문장·프롬프트·전환·자막을 고치면 필요한 단계만 다시 만듭니다">
      {!list.data ? <Empty>불러오는 중</Empty> : !items.length ? <Empty>편집할 수 있는 프로젝트가 없습니다</Empty> :
        <Card><ul>{items.map((x) => <li key={x.id} className="h-10 flex items-center border-b last:border-0"><Link href={`/editor?id=${x.id}`} className="truncate hover:underline underline-offset-4">{x.title || x.topic}</Link></li>)}</ul></Card>}
    </Page>;
  }
  if (!p) return <Page title="AI 영상 편집기"><Empty>불러오는 중</Empty></Page>;
  const earlier = (a: string | null, b: string | null) => (!a ? b : !b ? a : ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);
  const setE = (sid: string, k: string, v: any) => setEdits({ ...edits, [sid]: { ...(edits[sid] || {}), [k]: v } });

  async function saveScene(s: any) {
    const body = edits[s.id];
    if (!body) return;
    const r = await act.run(s.id, () => api(`/projects/${id}/scenes/${s.id}`, { method: "PATCH", body }));
    if (r) { setFrom((f) => earlier(f, r.rebuild_from)); setEdits((e) => { const c = { ...e }; delete c[s.id]; return c; }); reload(); }
  }
  const rebuild = (stage: string, withStyle = false) => act.run("rebuild", () => api(`/projects/${id}/rebuild`, { body: { from_stage: stage, subtitle_style: withStyle ? { ...style, size: Number(style.size), margin_v: Number(style.margin_v) } : undefined } }).then(() => router.push(`/projects/${id}`)));

  return (
    <Page title="AI 영상 편집기" meta={p.title || p.topic}
      actions={<><Link href={`/projects/${id}`}><Button kind="ghost">돌아가기</Button></Link>
        <Button kind="primary" busy={act.busy === "rebuild"} disabled={!from} onClick={() => rebuild(from!)}>{from ? `${LABEL[from]} 다시 만들기` : "수정 사항 없음"}</Button></>}>
      {act.view}
      <div className="grid xl:grid-cols-[1fr_340px] gap-6 items-start mt-2">
        <div className="flex flex-col gap-3">
          {p.scenes.map((s: any) => {
            const e = edits[s.id] || {};
            return (
              <Card key={s.id} className="!p-4 flex gap-4">
                <div className="w-[72px] shrink-0"><div className="aspect-[9/16] rounded-lg overflow-hidden bg-deep border">{s.image_url && <img src={s.image_url} alt="" className="w-full h-full object-cover" />}</div><div className="num text-mute text-[12px] mt-2 text-center">{tc(s.start)}</div></div>
                <div className="flex-1 min-w-0 flex flex-col gap-3">
                  <Field label={`#${String(s.idx + 1).padStart(2, "0")} 내레이션`}><textarea rows={2} value={e.narration ?? s.narration} onChange={(ev) => setE(s.id, "narration", ev.target.value)} /></Field>
                  <Field label="이미지 프롬프트"><textarea rows={2} className="text-[13px]" value={e.image_prompt ?? s.image_prompt ?? ""} onChange={(ev) => setE(s.id, "image_prompt", ev.target.value)} /></Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="화면"><select value={e.kind ?? s.kind} onChange={(ev) => setE(s.id, "kind", ev.target.value)}><option value="image">이미지</option><option value="video">영상</option></select></Field>
                    <Field label="다음 전환"><select value={e.transition ?? s.transition} onChange={(ev) => setE(s.id, "transition", ev.target.value)}>{TR.map((t) => <option key={t}>{t}</option>)}</select></Field>
                    <Field label="자막 위치"><select value={e.subtitle_position ?? s.subtitle_position} onChange={(ev) => setE(s.id, "subtitle_position", ev.target.value)}><option value="lower">하단</option><option value="center">중앙</option></select></Field>
                  </div>
                  <div className="flex gap-2">
                    <Button busy={act.busy === s.id} disabled={!edits[s.id]} onClick={() => saveScene(s)}>변경 저장</Button>
                    <Button kind="ghost" onClick={async () => { const r = await act.run(s.id, () => api(`/projects/${id}/scenes/${s.id}`, { method: "PATCH", body: { regenerate: true } })); if (r) setFrom((f) => earlier(f, r.rebuild_from)); }}>이 장면 이미지 다시 생성</Button>
                  </div>
                </div>
              </Card>);
          })}
        </div>
        {style && <Card className="xl:sticky xl:top-6">
          <h2 className="text-[15px] font-medium mb-4">자막 디자인</h2>
          <div className="flex flex-col gap-4">
            <Field label="글자 크기 (1080×1920 기준 px)"><input className="num" value={style.size} onChange={(e) => setStyle({ ...style, size: e.target.value })} /></Field>
            <Field label="강조 색"><input value={style.highlight} onChange={(e) => setStyle({ ...style, highlight: e.target.value })} /></Field>
            <Field label="하단 여백" hint="쇼츠 화면 하단 제목·버튼 영역을 피하려면 420 이상"><input className="num" value={style.margin_v} onChange={(e) => setStyle({ ...style, margin_v: e.target.value })} /></Field>
            <label className="inline-flex items-center gap-2 text-sub"><input type="checkbox" checked={!!style.kinetic} onChange={(e) => setStyle({ ...style, kinetic: e.target.checked })} />단어 강조 움직임</label>
            <Button busy={act.busy === "rebuild"} onClick={() => rebuild(from && ORDER.indexOf(from) < ORDER.indexOf("subs") ? from : "subs", true)}>자막 적용해 다시 렌더링</Button>
          </div>
          <div className="mt-5"><Note>문장을 바꾸면 그 장면의 음성만, 프롬프트를 바꾸면 그 장면의 이미지만 새로 만들고 나머지는 재사용합니다</Note></div>
        </Card>}
      </div>
    </Page>
  );
}
export default function Editor() { return <Suspense><Inner /></Suspense>; }
