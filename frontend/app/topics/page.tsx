"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Empty, Field, Page, useAction } from "@/components/ui";
import { api } from "@/lib/api";

export default function Topics() {
  const [region, setRegion] = useState("KR");
  const [data, setData] = useState<any>(null);
  const act = useAction();
  return (
    <Page title="인기 주제 찾기" meta="YouTube 공식 인기 차트의 공개 지표를 근거로, 같은 관심사를 다른 각도로 다루는 주제를 제안합니다"
      actions={<><Field label="" className="w-32 -mt-2"><select value={region} onChange={(e) => setRegion(e.target.value)}><option value="KR">한국</option><option value="US">미국</option><option value="JP">일본</option><option value="ES">스페인</option><option value="TW">대만</option></select></Field>
        <Button kind="primary" busy={!!act.busy} onClick={() => act.run("t", () => api(`/youtube/topics?region=${region}`).then(setData))}>주제 찾기</Button></>}>
      {act.view}
      {!data ? <Empty>지역을 고르고 주제 찾기를 누르세요. YouTube 쿼터 약 2단위와 언어 AI 1회를 씁니다</Empty> : (
        <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="flex flex-col gap-3">{data.topics.map((t: any, i: number) => (
            <Card key={i} className="!p-4 flex items-start justify-between gap-4">
              <div><div className="text-[16px] leading-6">{t.topic}</div><p className="text-sub text-[13px] mt-1">{t.why}</p><div className="text-mute text-[12px] mt-2">{t.content_type}</div></div>
              <Link href={`/create?topic=${encodeURIComponent(t.topic)}`}><Button>만들기<ArrowRight size={16} strokeWidth={1.5} /></Button></Link>
            </Card>))}
            <p className="text-mute text-[12px]">{data.note}</p></div>
          <Card><h2 className="text-[15px] font-medium mb-3">근거가 된 인기 영상</h2><ul className="flex flex-col gap-3 text-[13px]">{data.based_on.map((v: any) => <li key={v.video_id}><div className="truncate">{v.title}</div><div className="num text-mute text-[12px]">{Number(v.views || 0).toLocaleString()}회 · {v.channel}</div></li>)}</ul></Card>
        </div>)}
    </Page>
  );
}
