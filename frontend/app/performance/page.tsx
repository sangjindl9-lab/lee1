"use client";
import Link from "next/link";
import { Button, Card, Empty, Page, useAction } from "@/components/ui";
import { api, n, tc, useApi, when } from "@/lib/api";

export default function Performance() {
  const a = useApi<any>("/youtube/analytics");
  const act = useAction();
  const pick = (v: any) => ["7d", "3d", "24h", "manual"].map((w) => v.snapshots.filter((s: any) => s.window === w).pop()).find(Boolean);
  return (
    <Page title="채널 성과 분석" meta={a.data?.note}
      actions={<Button busy={!!act.busy} onClick={() => act.run("c", () => api("/youtube/analytics/collect", { method: "POST" }).then((r) => { a.reload(); if (r.errors.length) throw new Error(r.errors.join(" / ")); }), "지금 수집했습니다")}>지금 수집</Button>}>
      {act.view}
      {!a.data ? <Empty>불러오는 중</Empty> : !a.data.videos.length ? <Empty>이 서비스로 업로드한 영상이 생기면 24시간·3일·7일 시점의 지표를 자동으로 모읍니다</Empty> : (
        <Card className="!p-0 overflow-x-auto mt-2"><table className="min-w-[860px]"><thead><tr><th className="!pl-5">영상</th><th>구간</th><th className="text-right">조회수</th><th className="text-right">시청 시간(분)</th><th className="text-right">평균 시청</th><th className="text-right">평균 시청률</th><th className="text-right">좋아요</th><th className="text-right">댓글</th><th className="text-right !pr-5">구독자 변화</th></tr></thead>
          <tbody>{a.data.videos.map((v: any) => { const s = pick(v); const m = s?.metrics || {};
            return <tr key={v.video_id}><td className="!pl-5 max-w-[300px]"><Link href={`/projects/${v.project_id}`} className="block truncate text-ink hover:underline underline-offset-4">{v.title}</Link><span className="num text-mute text-[12px]">{when(v.uploaded_at)} · {tc(v.duration)} · {v.mode}</span></td>
              <td className="num text-[13px]">{s ? s.window : "수집 전"}</td><td className="num text-right">{n(m.views)}</td><td className="num text-right">{n(m.estimatedMinutesWatched)}</td><td className="num text-right">{m.averageViewDuration != null ? `${m.averageViewDuration}초` : "—"}</td>
              <td className="num text-right">{m.averageViewPercentage != null ? `${Number(m.averageViewPercentage).toFixed(1)}%` : "—"}</td><td className="num text-right">{n(m.likes)}</td><td className="num text-right">{n(m.comments)}</td>
              <td className="num text-right !pr-5">{m.subscribersGained != null ? `+${m.subscribersGained} / -${m.subscribersLost}` : "—"}</td></tr>; })}</tbody></table></Card>)}
    </Page>
  );
}
