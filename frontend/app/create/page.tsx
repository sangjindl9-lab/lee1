"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Composer from "@/components/Composer";
import { Card, Page } from "@/components/ui";

function Inner() {
  const q = useSearchParams();
  return (
    <Page title="AI 쇼츠 만들기" meta="제작 시작을 누르면 17단계가 자동으로 진행됩니다. 예산 안에서는 추가 질문 없이 끝까지 만들고, 넘을 것 같으면 과금 전에 멈춥니다">
      <Card className="!p-5 sm:!p-8"><Composer advancedOpen initialTopic={q.get("topic") || ""} /></Card>
    </Page>
  );
}
export default function Create() { return <Suspense><Inner /></Suspense>; }
