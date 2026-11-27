"use client";
import Link from "next/link";
import { STATUS, tc, usd, when } from "@/lib/api";
import { cx, Empty, Status } from "./ui";

const GROUPS: [string, string][] = [["RESEARCHING", "조사"], ["SCRIPTING", "대본"], ["STORYBOARDING", "스토리보드"], ["GENERATING", "생성"], ["EDITING", "편집"], ["RENDERING", "렌더·검수"]];

/** 제작 단계 표시: 필름 프레임 눈금. 지금 도는 단계만 탤리 색. */
export function StageStrip({ stages, compact = false }: { stages: any[]; compact?: boolean }) {
  const groupOf = (g: string) => (g === "REVIEWING" ? "RENDERING" : g);
  return (
    <div className={cx("flex", compact ? "gap-2" : "gap-4 overflow-x-auto pb-1")}>
      {GROUPS.map(([g, label]) => {
        const items = stages.filter((s) => groupOf(s.group) === g);
        return (
          <div key={g} className="min-w-0">
            <div className="flex gap-1">
              {items.map((s) => (
                <span key={s.key} title={`${s.label} · ${s.status === "done" ? "완료" : s.status === "running" ? "진행 중" : s.status === "failed" ? "실패" : "대기"}`}
                  className={cx("rounded-[2px] transition-colors duration-300 ease-out", compact ? "w-1.5 h-4" : "w-3 h-7",
                    s.status === "done" ? "bg-ink/70" : s.status === "running" ? "bg-tally animate-pulse" : s.status === "failed" ? "bg-bad" : "bg-raised")} />
              ))}
            </div>
            {!compact && <div className="text-mute text-[12px] mt-2 whitespace-nowrap">{label}</div>}
          </div>
        );
      })}
    </div>
  );
}

export function ProjectRows({ items, empty = "아직 제작한 영상이 없습니다" }: { items: any[] | null; empty?: string }) {
  if (!items) return <Empty>불러오는 중</Empty>;
  if (!items.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="min-w-[640px]">
        <thead><tr><th className="!pl-5">주제</th><th>상태</th><th>진행</th><th className="text-right">비용</th><th className="text-right !pr-5">시작</th></tr></thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-raised/40 transition-colors duration-150">
              <td className="!pl-5 max-w-[420px]"><Link href={`/projects/${p.id}`} className="text-ink hover:underline underline-offset-4 block truncate">{p.title || p.topic}</Link></td>
              <td><Status s={p.status} /></td>
              <td className="num text-[13px]">{p.status === "COMPLETED" ? "100%" : `${p.progress}%`}</td>
              <td className="num text-right text-[13px]">{usd(p.actual_cost_usd, 3)}</td>
              <td className="num text-right text-[13px] !pr-5">{when(p.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function VideoTile({ p }: { p: any }) {
  return (
    <Link href={`/projects/${p.id}`} className="group block">
      <div className="aspect-[9/16] rounded-xl overflow-hidden bg-card border relative">
        {p.thumbnail_url ? <img src={p.thumbnail_url} alt="" className="w-full h-full object-cover transition-opacity duration-150 group-hover:opacity-90" /> : null}
        <span className="num absolute left-2 bottom-2 text-[12px] bg-deep/80 rounded px-1.5 py-0.5">{usd(p.actual_cost_usd)}</span>
      </div>
      <div className="mt-2 leading-5 line-clamp-2">{p.title || p.topic}</div>
      <div className="num text-mute text-[12px] mt-1">{when(p.created_at)}</div>
    </Link>
  );
}

export { STATUS, tc };
