"use client";
import Link from "next/link";
import { Card, Empty, H2, Page, Stat } from "@/components/ui";
import { useApi, usd, when } from "@/lib/api";

export default function Costs() {
  const { data: d } = useApi<any>("/costs");
  const models = useApi<any[]>("/models");
  if (!d) return <Page title="사용량 및 비용 관리"><Empty>불러오는 중</Empty></Page>;
  const max = Math.max(0.0001, ...d.by_day.map((x: any) => x.amount_usd));
  const today = new Date().toISOString().slice(5, 10);
  return (
    <Page title="사용량 및 비용 관리" meta={d.note}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="오늘" value={usd(d.today)} sub={`한도 ${usd(d.limits.daily)}`} />
        <Stat label="이번 달" value={usd(d.month)} sub={`한도 ${usd(d.limits.monthly)}`} />
        <Stat label="일일 제작 한도" value={`${d.limits.daily_videos}개`} sub="환경설정에서 변경" />
        <Stat label="실패 요청 (31일)" value={d.failed_requests.length} sub="아래에서 과금 여부 확인" />
      </div>
      <div className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
        <Card>
          <H2>일별 비용 · 최근 31일</H2>
          {!d.by_day.length ? <Empty>비용 기록이 없습니다</Empty> : (
            <div className="h-[280px] flex items-end gap-1 border-b pb-px">{d.by_day.map((x: any) => (
              <div key={x.day} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${x.day} · ${usd(x.amount_usd, 3)}`}>
                <div className={`w-full max-w-[28px] rounded-t-[3px] ${x.day === today ? "bg-tally" : "bg-ink/25"}`} style={{ height: `${Math.max(2, (x.amount_usd / max) * 100)}%` }} />
              </div>))}</div>)}
          {d.by_day.length > 0 && <div className="num text-mute text-[12px] flex justify-between mt-2"><span>{d.by_day[0].day}</span><span>{d.by_day[d.by_day.length - 1].day}</span></div>}
        </Card>
        <Card><H2>모델별</H2>{!d.by_model.length ? <Empty>기록 없음</Empty> : <ul className="flex flex-col">{d.by_model.map((m: any) => <li key={m.model} className="flex justify-between h-9 items-center border-b last:border-0 text-[13px]"><span className="text-sub truncate pr-3">{m.model}</span><span className="num shrink-0">{usd(m.amount_usd, 3)} <span className="text-mute">· {m.calls}회</span></span></li>)}</ul>}</Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-6 mt-6 items-start">
        <Card><H2>프로젝트별</H2>{!d.by_project.length ? <Empty>기록 없음</Empty> : <ul>{d.by_project.map((p: any) => <li key={p.project_id} className="flex justify-between h-9 items-center border-b last:border-0"><Link href={`/projects/${p.project_id}`} className="truncate pr-3 hover:underline underline-offset-4">{p.title}</Link><span className="num text-sub shrink-0">{usd(p.amount_usd, 3)}</span></li>)}</ul>}</Card>
        <Card><H2>모델 단가표</H2><ul>{(models.data || []).filter((m) => m.enabled).map((m) => <li key={m.model_key} className="flex justify-between h-9 items-center border-b last:border-0 text-[13px]"><span className="text-sub truncate pr-3">{m.display_name}</span><span className="num shrink-0">{m.unit_cost_usd == null ? <span className="text-mute">미등록</span> : `${usd(m.unit_cost_usd, 3)} / ${UNIT[m.unit] || m.unit}`}</span></li>)}</ul></Card>
      </div>
      {d.failed_requests.length > 0 && <Card className="mt-6"><H2>실패한 요청의 과금 여부</H2><ul className="flex flex-col gap-2 text-[13px] text-sub">{d.failed_requests.slice().reverse().map((f: any, i: number) => <li key={i}><span className="num text-mute">{when(f.at)}</span> · {f.model || f.provider} · {f.error} · {f.billed === false ? "과금 안 됨" : f.billed ? "과금됨" : "공급자 정책 확인 필요"}</li>)}</ul></Card>}
    </Page>
  );
}
const UNIT: any = { per_image: "장", per_second: "초", per_mtok: "100만 토큰", per_1k_chars: "1천 자", per_minute: "분" };
