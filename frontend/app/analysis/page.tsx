"use client";
import { useState } from "react";
import { Button, Card, Empty, H2, Page, useAction } from "@/components/ui";
import { api, n } from "@/lib/api";

export default function Analysis() {
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState(false);
  const [d, setD] = useState<any>(null);
  const act = useAction();
  const go = () => q.trim() && act.run("a", () => api(`/youtube/analyze?q=${encodeURIComponent(q)}&deep=${deep}`).then(setD));
  const max = d ? Math.max(1, ...Object.values(d.duration_distribution as Record<string, number>)) : 1;
  return (
    <Page title="유튜브 콘텐츠 분석" meta="검색어의 최근 인기 쇼츠 후보를 YouTube Data API로 수집해 공개 지표로 비교합니다">
      <div className="flex flex-col sm:flex-row gap-3 mb-2">
        <input placeholder="검색어" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} className="!h-11" />
        <Button kind="primary" busy={!!act.busy} onClick={go} className="!h-11 shrink-0">분석</Button>
      </div>
      <label className="inline-flex items-center gap-2 text-sub text-[13px] mb-6"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />24시간·90일 구간까지 넓게 수집 (쿼터 약 400단위)</label>
      {act.view}
      {!d ? <Empty>기본 수집은 7일·30일 구간이며 쿼터 약 200단위를 씁니다</Empty> : (
        <div className="grid xl:grid-cols-[1fr_320px] gap-6 items-start">
          <Card>
            <H2 right={<span className="num text-mute text-[12px]">{d.videos.length}개 · 쿼터 {d.quota_used}단위</span>}>성과 순</H2>
            <div className="overflow-x-auto -mx-5"><table className="min-w-[760px]"><thead><tr><th className="!pl-5">영상</th><th className="text-right">조회수</th><th className="text-right">시간당 평균</th><th className="text-right">구독자 대비</th><th className="text-right">좋아요율</th><th className="text-right">길이</th><th className="!pr-5">쇼츠 판단</th></tr></thead>
              <tbody>{d.videos.map((v: any) => <tr key={v.id}>
                <td className="!pl-5 max-w-[340px]"><a href={v.url} target="_blank" className="block truncate text-ink hover:underline underline-offset-4">{v.title}</a><span className="text-mute text-[12px]">{v.channel_title}{v.subscriber_count != null ? ` · 구독자 ${n(v.subscriber_count)}` : " · 구독자 비공개"}</span></td>
                <td className="num text-right">{n(v.view_count)}</td><td className="num text-right">{n(v.metrics.avg_views_per_hour)}</td><td className="num text-right">{v.metrics.views_per_subscriber ?? "—"}</td>
                <td className="num text-right">{v.metrics.like_rate != null ? `${(v.metrics.like_rate * 100).toFixed(1)}%` : "—"}</td><td className="num text-right">{v.duration_sec}초</td><td className="!pr-5 text-[13px]">{v.metrics.short_basis}</td></tr>)}</tbody></table></div>
          </Card>
          <div className="flex flex-col gap-4">
            <Card><H2>길이 분포</H2><div className="flex flex-col gap-2">{Object.entries(d.duration_distribution).map(([k, v]: any) => <div key={k} className="grid grid-cols-[72px_1fr_24px] items-center gap-3 text-[13px]"><span className="text-sub">{k}</span><span className="h-1.5 bg-raised rounded-full overflow-hidden"><span className="block h-full bg-ink/70 rounded-full" style={{ width: `${(v / max) * 100}%` }} /></span><span className="num text-right text-sub">{v}</span></div>)}</div></Card>
            {Object.keys(d.comments).length > 0 && <Card><H2>상위 영상 댓글</H2><ul className="flex flex-col gap-2 text-[13px] text-sub max-h-[320px] overflow-y-auto">{Object.values(d.comments).flat().slice(0, 20).map((c: any, i) => <li key={i}>{c}</li>)}</ul></Card>}
            <p className="text-mute text-[12px] leading-4">{d.short_note} 시청 유지율·이탈률·노출 클릭률은 공개 API로 확인할 수 없어 표시하지 않습니다. 실제 조회수 증가량은 같은 영상을 다시 수집해 스냅샷이 쌓였을 때만 계산합니다. {d.note}</p>
          </div>
        </div>)}
    </Page>
  );
}
