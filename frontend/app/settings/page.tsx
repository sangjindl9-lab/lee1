"use client";
import { useEffect, useState } from "react";
import { Button, Card, Field, H2, Page, useAction } from "@/components/ui";
import { api, useApi } from "@/lib/api";

export default function SettingsPage() {
  const me = useApi<any>("/auth/me");
  const [f, setF] = useState<any>(null);
  const [pron, setPron] = useState("");
  const [pw, setPw] = useState("");
  const act = useAction();
  useEffect(() => {
    if (!me.data) return;
    const s = me.data.settings || {};
    setF({ daily_cost_limit_usd: me.data.daily_cost_limit_usd, monthly_cost_limit_usd: me.data.monthly_cost_limit_usd, daily_video_limit: me.data.daily_video_limit, default_max_cost_usd: s.default_max_cost_usd || "", allow_unpriced: !!s.allow_unpriced });
    setPron(Object.entries(s.pronunciation || {}).map(([k, v]) => `${k}=${v}`).join("\n"));
  }, [me.data]);
  if (!f) return null;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = () => act.run("s", () => api("/settings", { method: "PUT", body: {
    daily_cost_limit_usd: Number(f.daily_cost_limit_usd), monthly_cost_limit_usd: Number(f.monthly_cost_limit_usd), daily_video_limit: Number(f.daily_video_limit),
    settings: { default_max_cost_usd: f.default_max_cost_usd ? Number(f.default_max_cost_usd) : null, allow_unpriced: f.allow_unpriced,
      pronunciation: Object.fromEntries(pron.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter((a) => a.length === 2 && a[0])) } } }), "저장했습니다");
  return (
    <Page title="환경설정">
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card>
          <H2>비용 · 수량 한도</H2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="영상 1개 최대 비용 (USD)" hint="비우면 서비스 기본값"><input className="num" value={f.default_max_cost_usd} onChange={set("default_max_cost_usd")} /></Field>
            <Field label="일일 제작 수량"><input className="num" value={f.daily_video_limit} onChange={set("daily_video_limit")} /></Field>
            <Field label="일 비용 한도 (USD)"><input className="num" value={f.daily_cost_limit_usd} onChange={set("daily_cost_limit_usd")} /></Field>
            <Field label="월 비용 한도 (USD)"><input className="num" value={f.monthly_cost_limit_usd} onChange={set("monthly_cost_limit_usd")} /></Field>
          </div>
          <label className="inline-flex items-center gap-2 text-sub mt-5"><input type="checkbox" checked={f.allow_unpriced} onChange={set("allow_unpriced")} />단가 미등록 모델을 승인 없이 사용</label>
          <p className="text-mute text-[12px] mt-2 leading-4">한도 안에서는 추가 확인 없이 제작하고, 넘을 것 같으면 과금 전에 승인 대기로 멈춥니다. 단가 미등록 모델은 금액이 집계되지 않으니 켜기 전에 공급자 가격을 확인하세요</p>
        </Card>
        <Card>
          <H2>발음 사전</H2>
          <Field label="표기=읽는 법 (한 줄에 하나)" hint="내레이션 합성 전에 치환합니다"><textarea rows={6} className="font-mono" placeholder={"NASA=나사\nGPT=지피티"} value={pron} onChange={(e) => setPron(e.target.value)} /></Field>
        </Card>
      </div>
      <Button kind="primary" className="mt-6" busy={act.busy === "s"} onClick={save}>저장</Button>
      {act.view}
      <Card className="mt-8 max-w-[480px]"><H2>비밀번호 변경</H2><div className="flex gap-3"><input type="password" placeholder="새 비밀번호 (8자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} /><Button busy={act.busy === "p"} disabled={pw.length < 8} onClick={() => act.run("p", () => api("/settings", { method: "PUT", body: { password: pw } }).then(() => setPw("")), "비밀번호를 바꿨습니다")}>변경</Button></div></Card>
    </Page>
  );
}
