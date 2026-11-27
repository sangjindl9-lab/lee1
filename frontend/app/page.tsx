"use client";
import { Check, Minus } from "lucide-react";
import Link from "next/link";
import Composer from "@/components/Composer";
import { ProjectRows } from "@/components/Projects";
import { Card, H2, Stat } from "@/components/ui";
import { n, useApi, usd } from "@/lib/api";

export default function Dashboard() {
  const { data } = useApi<any>("/dashboard", 8000);
  const c = data?.counts || {};
  const active = ["RESEARCHING", "SCRIPTING", "STORYBOARDING", "GENERATING", "EDITING", "REVIEWING", "RENDERING", "PENDING"].reduce((a, k) => a + (c[k] || 0), 0);
  const ready = data?.readiness || {};
  const missing = Object.entries(ready).filter(([, v]) => !v).map(([k]) => k);
  return (
    <div className="rise mx-auto w-full max-w-[1440px] px-4 sm:px-8 py-6 sm:py-10">
      <section className="bg-card border rounded-[18px] p-5 sm:p-8 mb-6">
        <h1 className="text-[28px] sm:text-[32px] leading-[1.15] font-medium mb-2">어떤 쇼츠를 만들까요</h1>
        <p className="text-sub mb-6">주제만 넣으면 조사부터 업로드 준비까지 진행합니다</p>
        <Composer />
        {data && missing.length > 0 && (
          <p className="text-[13px] text-sub mt-5">아직 연결되지 않은 API가 있습니다: {missing.join(", ")} · <Link href="/connections" className="text-ink underline underline-offset-4">API 연결 관리</Link></p>
        )}
      </section>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="진행 중" value={n(active)} sub={c.AWAITING_APPROVAL ? `승인 대기 ${c.AWAITING_APPROVAL}건` : "승인 대기 없음"} />
        <Stat label="완성" value={n(c.COMPLETED || 0)} sub={`실패 ${c.FAILED || 0}건`} />
        <Stat label="오늘 비용" value={usd(data?.cost?.today)} sub={`일 한도 ${usd(data?.cost?.limits?.daily)}`} />
        <Stat label="이번 달 비용" value={usd(data?.cost?.month)} sub={`월 한도 ${usd(data?.cost?.limits?.monthly)}`} />
      </div>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <Card><H2 right={<Link href="/progress" className="text-sub hover:text-ink text-[13px]">전체 보기</Link>}>최근 제작</H2><ProjectRows items={data?.recent ?? null} /></Card>
        <Card>
          <H2>API 연결</H2>
          <ul className="flex flex-col gap-2">
            {Object.entries(ready).map(([k, v]) => (
              <li key={k} className="flex items-center gap-2.5 h-8 text-sub">
                {v ? <Check size={16} strokeWidth={1.5} className="text-ok" /> : <Minus size={16} strokeWidth={1.5} className="text-mute" />}
                <span className={v ? "text-ink" : ""}>{k}</span>
              </li>
            ))}
          </ul>
          <p className="text-mute text-[12px] mt-3 leading-4">언어 AI, 이미지, 음성 세 가지가 있어야 제작이 끝까지 진행됩니다. 검색과 YouTube 조사는 없으면 건너뜁니다</p>
        </Card>
      </div>
    </div>
  );
}
