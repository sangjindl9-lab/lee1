"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button, Card, Empty, Note, Page, useAction } from "@/components/ui";
import { api, useApi, when } from "@/lib/api";

function Inner() {
  const q = useSearchParams();
  const ch = useApi<any>("/youtube/channels");
  const act = useAction();
  const connect = () => act.run("c", () => api("/youtube/oauth/start").then((r) => { location.href = r.url; }));
  return (
    <Page title="유튜브 채널 연결" meta="본인 채널을 연결하면 승인한 영상을 올리고, 본인 채널의 실제 성과를 수집할 수 있습니다. 조회수·좋아요·댓글을 인위적으로 만드는 기능은 없습니다"
      actions={<Button kind="primary" busy={act.busy === "c"} disabled={ch.data && !ch.data.oauth_configured} onClick={connect}>채널 연결</Button>}>
      {q.get("connected") && <div className="mb-4"><Note tone="ok">채널을 연결했습니다</Note></div>}
      {q.get("error") && <div className="mb-4"><Note tone="bad">연결하지 못했습니다 ({q.get("error")})</Note></div>}
      {ch.data && !ch.data.oauth_configured && <div className="mb-4"><Note tone="warn">Google OAuth 클라이언트가 아직 등록되지 않았습니다. 관리자가 API 연결 관리에서 클라이언트 ID·시크릿을 넣고, Google Cloud 콘솔의 승인된 리디렉션 URI에 <span className="num break-all">{ch.data.redirect_uri}</span> 를 등록해야 합니다</Note></div>}
      {act.view}
      {!ch.data ? <Empty>불러오는 중</Empty> : !ch.data.channels.length ? <Empty>연결된 채널이 없습니다</Empty> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{ch.data.channels.map((c: any) => (
          <Card key={c.id} className="!p-4 flex items-center gap-4">
            {c.thumbnail && <img src={c.thumbnail} alt="" className="w-12 h-12 rounded-full" />}
            <div className="min-w-0 flex-1"><div className="font-medium truncate">{c.title}</div><div className="num text-mute text-[12px]">{c.status === "connected" ? "연결됨" : "인증 만료"} · {when(c.updated_at)}</div></div>
            <Button kind="danger" onClick={() => confirm("연결을 해제하고 권한을 회수할까요?") && act.run("d", () => api(`/youtube/channels/${c.id}`, { method: "DELETE" }).then(ch.reload))}>해제</Button>
          </Card>))}</div>)}
      <p className="text-mute text-[12px] mt-6 max-w-[44rem] leading-4">업로드는 영상마다 직접 승인해야 실행되며 기본 공개 범위는 비공개입니다. Google의 API 감사를 통과하지 않은 프로젝트로 올린 영상은 공개를 선택해도 비공개로 제한될 수 있습니다</p>
    </Page>
  );
}
export default function Channels() { return <Suspense><Inner /></Suspense>; }
