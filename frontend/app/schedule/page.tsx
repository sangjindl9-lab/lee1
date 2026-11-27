"use client";
import { useState } from "react";
import { ProjectRows } from "@/components/Projects";
import { Button, Card, Field, H2, Note, Page, useAction } from "@/components/ui";
import { api, MODES, useApi } from "@/lib/api";

export default function Schedule() {
  const list = useApi<any[]>("/batches", 8000);
  const [topics, setTopics] = useState("");
  const [f, setF] = useState({ mode: "economy", start_at: "", max_cost_usd: "" });
  const [res, setRes] = useState<any>(null);
  const act = useAction();
  const lines = topics.split("\n").map((s) => s.trim()).filter(Boolean);
  const submit = () => act.run("b", () => api("/batches", { body: { topics: lines, mode: f.mode, start_at: f.start_at ? new Date(f.start_at).toISOString() : null, max_cost_usd: f.max_cost_usd ? Number(f.max_cost_usd) : null } }).then((r) => { setRes(r); setTopics(""); list.reload(); }));
  return (
    <Page title="예약 제작" meta="여러 주제를 등록하면 한 번에 하나씩 순서대로 만듭니다. 일·월 비용 한도와 일일 제작 수량 안에서만 진행됩니다">
      <div className="grid lg:grid-cols-[420px_1fr] gap-6 items-start">
        <Card>
          <H2>주제 등록</H2>
          <Field label="주제 (한 줄에 하나)" hint={`${lines.length}개`}><textarea rows={8} value={topics} onChange={(e) => setTopics(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label="제작 모드"><select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="영상당 최대 비용"><input className="num" placeholder="기본 한도" value={f.max_cost_usd} onChange={(e) => setF({ ...f, max_cost_usd: e.target.value })} /></Field>
            <Field label="시작 시각" hint="비우면 바로 시작" className="col-span-2"><input type="datetime-local" value={f.start_at} onChange={(e) => setF({ ...f, start_at: e.target.value })} /></Field>
          </div>
          <Button kind="primary" className="mt-5" busy={!!act.busy} disabled={!lines.length} onClick={submit}>큐에 등록</Button>
          {act.view}
          {res && <div className="mt-4 flex flex-col gap-2"><Note tone="ok">{res.created.length}개 등록</Note>{res.skipped.map((s: any, i: number) => <Note key={i} tone="warn">제외 · {s.topic} — {s.reason}</Note>)}</div>}
          <p className="text-mute text-[12px] mt-4 leading-4">거의 같은 주제는 자동으로 걸러 반복적인 대량 생산 콘텐츠가 되지 않게 합니다</p>
        </Card>
        <Card><H2>등록된 작업</H2><ProjectRows items={list.data} empty="등록된 예약 작업이 없습니다" /></Card>
      </div>
    </Page>
  );
}
