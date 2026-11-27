"use client";
import { useEffect, useState } from "react";
import { Button, Card, Field, H2, Page, useAction } from "@/components/ui";
import { api, useApi } from "@/lib/api";

export default function Branding() {
  const b = useApi<any>("/branding");
  const [f, setF] = useState<any>(null);
  const act = useAction();
  useEffect(() => { if (b.data) setF({ channel_name: b.data.channel_name || "", palette: b.data.palette || "", size: b.data.subtitle_style?.size || 86, highlight: b.data.subtitle_style?.highlight || "#FFE500", emphasis: b.data.subtitle_style?.emphasis || "#3DE0FF" }); }, [b.data]);
  if (!f) return null;
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const logo = (file: File) => { const fd = new FormData(); fd.append("file", file); act.run("l", () => api("/branding/logo", { form: fd }).then(b.reload)); };
  return (
    <Page title="채널 브랜딩 관리" meta="새로 만드는 모든 영상에 적용됩니다">
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        <Card>
          <H2>채널</H2>
          <div className="flex flex-col gap-4">
            <Field label="채널 이름"><input value={f.channel_name} onChange={set("channel_name")} /></Field>
            <Field label="브랜드 색상" hint="스토리보드의 색 분위기를 정할 때 참고합니다"><input value={f.palette} onChange={set("palette")} placeholder="예: 남색, 크림색, 주황 포인트" /></Field>
            <Field label="로고 (투명 PNG)" hint="영상 좌측 상단에 작게 들어갑니다">
              <div className="flex items-center gap-4">{b.data.logo_url && <img src={b.data.logo_url} alt="" className="h-12 rounded bg-raised p-1" />}<input type="file" accept="image/png" onChange={(e) => e.target.files?.[0] && logo(e.target.files[0])} />
                {b.data.logo_url && <Button kind="ghost" onClick={() => act.run("r", () => api("/branding", { method: "PUT", body: { remove_logo: true } }).then(b.reload))}>제거</Button>}</div></Field>
          </div>
        </Card>
        <Card>
          <H2>기본 자막 스타일</H2>
          <div className="grid grid-cols-3 gap-4">
            <Field label="글자 크기"><input className="num" value={f.size} onChange={set("size")} /></Field>
            <Field label="말하는 단어 색"><input value={f.highlight} onChange={set("highlight")} /></Field>
            <Field label="강조 키워드 색"><input value={f.emphasis} onChange={set("emphasis")} /></Field>
          </div>
          <div className="mt-5 aspect-[16/7] rounded-xl bg-deep border flex items-end justify-center pb-6">
            <span style={{ fontSize: Math.max(18, Number(f.size) / 3.2), fontWeight: 700, WebkitTextStroke: "1px #000", paintOrder: "stroke" }}>심해에서 <span style={{ color: f.highlight }}>빛은</span> 곧 <span style={{ color: f.emphasis }}>언어</span>입니다</span>
          </div>
        </Card>
      </div>
      <Button kind="primary" className="mt-6" busy={act.busy === "s"} onClick={() => act.run("s", () => api("/branding", { method: "PUT", body: { channel_name: f.channel_name, palette: f.palette, subtitle_style: { size: Number(f.size), highlight: f.highlight, emphasis: f.emphasis } } }).then(b.reload), "저장했습니다")}>저장</Button>
      {act.view}
    </Page>
  );
}
