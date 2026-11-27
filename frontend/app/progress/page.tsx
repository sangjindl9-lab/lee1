"use client";
import { ProjectRows } from "@/components/Projects";
import { Card, H2, Page } from "@/components/ui";
import { useApi } from "@/lib/api";

export default function Progress() {
  const act = useApi<any[]>("/projects?status=active", 4000);
  const all = useApi<any[]>("/projects", 10000);
  const rest = (all.data || []).filter((p) => ["FAILED", "CANCELLED"].includes(p.status));
  return (
    <Page title="제작 진행 현황" meta="창을 닫아도 서버에서 계속 진행됩니다. 실패한 작업은 실패한 단계부터 다시 시작할 수 있습니다">
      <Card className="mb-6"><H2>진행 중 · 대기</H2><ProjectRows items={act.data} empty="진행 중인 작업이 없습니다" /></Card>
      <Card><H2>실패 · 중지</H2><ProjectRows items={all.data ? rest : null} empty="실패하거나 중지한 작업이 없습니다" /></Card>
    </Page>
  );
}
