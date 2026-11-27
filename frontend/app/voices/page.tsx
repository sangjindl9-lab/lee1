"use client";
import Link from "next/link";
import { Button, Card, Empty, Note, Page, useAction } from "@/components/ui";
import { api, useApi } from "@/lib/api";

export default function Voices() {
  const v = useApi<any>("/voices");
  const act = useAction();
  const cur = v.data?.default_voice;
  const pick = (id: string | null) => act.run("v", () => api("/settings", { method: "PUT", body: { settings: { default_voice: id } } }).then(v.reload));
  return (
    <Page title="음성 라이브러리" meta="연결된 음성 합성 계정에서 쓸 수 있는 음성입니다. 기본 음성을 정하지 않으면 계정의 첫 음성을 씁니다">
      {v.data?.errors?.map((e: string) => <div key={e} className="mb-3"><Note tone="bad">{e}</Note></div>)}
      {act.view}
      {!v.data ? <Empty>불러오는 중</Empty> : !v.data.voices.length ? <Empty>연결된 음성 공급자가 없습니다 · <Link href="/connections" className="text-ink underline underline-offset-4">API 연결 관리</Link></Empty> : (
        <Card className="!p-0 overflow-x-auto"><table className="min-w-[640px]"><thead><tr><th className="!pl-5">음성</th><th>공급자</th><th>특성</th><th>미리 듣기</th><th className="!pr-5" /></tr></thead>
          <tbody>{v.data.voices.map((x: any) => <tr key={x.provider + x.id}>
            <td className="!pl-5 text-ink">{x.name}{cur === x.id && <span className="text-tally text-[12px] ml-2">기본</span>}</td><td>{x.provider}</td>
            <td className="text-[13px]">{Object.values(x.labels || {}).join(" · ") || "—"}</td>
            <td>{x.preview_url ? <audio src={x.preview_url} controls preload="none" className="h-8 w-48" /> : <span className="text-mute text-[13px]">제공 안 됨</span>}</td>
            <td className="!pr-5 text-right">{cur === x.id ? <Button kind="ghost" onClick={() => pick(null)}>해제</Button> : <Button onClick={() => pick(x.id)}>기본으로</Button>}</td></tr>)}</tbody></table></Card>)}
      <p className="text-mute text-[12px] mt-4 max-w-[44rem] leading-4">{v.data?.note}</p>
    </Page>
  );
}
