"use client";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Card, Empty, Field, H2, Page, useAction } from "@/components/ui";
import { api, useApi } from "@/lib/api";

const BLANK = { id: "", name: "", face: "", body: "", hair: "", outfit: "", props: "", soul: "" };
export default function Characters() {
  const list = useApi<any[]>("/characters");
  const [f, setF] = useState<any>(BLANK);
  const act = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const edit = (c: any) => setF({ id: c.id, name: c.name, ...{ face: "", body: "", hair: "", outfit: "", props: "", ...c.bible }, soul: c.provider_ref?.higgsfield_soul_id || "" });
  const save = () => act.run("s", () => api(f.id ? `/characters/${f.id}` : "/characters", { method: f.id ? "PUT" : "POST", body: {
    name: f.name, bible: { face: f.face, body: f.body, hair: f.hair, outfit: f.outfit, props: f.props }, provider_ref: f.soul ? { higgsfield_soul_id: f.soul } : {} } }).then(() => { setF(BLANK); list.reload(); }));
  const upload = (id: string, file: File) => { const fd = new FormData(); fd.append("file", file); act.run("u", () => api(`/characters/${id}/image`, { form: fd }).then(list.reload)); };
  return (
    <Page title="캐릭터 관리" meta="얼굴·체형·의상·헤어·소품을 고정해 두면 장면이 바뀌어도 같은 인물로 그리도록 모든 장면 프롬프트에 넣습니다">
      <div className="grid lg:grid-cols-[1fr_400px] gap-6 items-start">
        <div className="grid sm:grid-cols-2 gap-4">
          {!list.data ? <Empty>불러오는 중</Empty> : !list.data.length ? <Empty>등록한 캐릭터가 없습니다</Empty> : list.data.map((c) => (
            <Card key={c.id} className="!p-4">
              <div className="flex gap-4">
                <label className="w-20 h-28 shrink-0 rounded-lg bg-deep border overflow-hidden cursor-pointer flex items-center justify-center text-mute text-[12px] text-center">
                  {c.reference_image_url ? <img src={c.reference_image_url} alt="" className="w-full h-full object-cover" /> : "참조 이미지"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(c.id, e.target.files[0])} />
                </label>
                <div className="min-w-0 flex-1"><div className="font-medium">{c.name}</div><p className="text-sub text-[13px] mt-1 line-clamp-3">{Object.values(c.bible || {}).filter(Boolean).join(" · ")}</p>
                  {c.provider_ref?.higgsfield_soul_id && <div className="num text-mute text-[12px] mt-1">Soul ID 연결됨</div>}</div>
              </div>
              <div className="flex gap-2 mt-4"><Button onClick={() => edit(c)}>수정</Button><Button kind="ghost" aria-label="삭제" onClick={() => act.run("d", () => api(`/characters/${c.id}`, { method: "DELETE" }).then(list.reload))}><Trash2 size={16} strokeWidth={1.5} /></Button></div>
            </Card>))}
        </div>
        <Card>
          <H2>{f.id ? "캐릭터 수정" : "새 캐릭터"}</H2>
          <div className="flex flex-col gap-4">
            <Field label="이름"><input value={f.name} onChange={set("name")} /></Field>
            <Field label="얼굴"><input value={f.face} onChange={set("face")} placeholder="예: 30대 여성, 둥근 얼굴, 짙은 눈썹" /></Field>
            <Field label="체형"><input value={f.body} onChange={set("body")} /></Field>
            <Field label="헤어"><input value={f.hair} onChange={set("hair")} /></Field>
            <Field label="의상"><input value={f.outfit} onChange={set("outfit")} /></Field>
            <Field label="소품"><input value={f.props} onChange={set("props")} /></Field>
            <Field label="Higgsfield Soul ID (선택)" hint="Higgsfield에서 학습을 마친 캐릭터 참조 UUID. 넣으면 SOUL 모델에 참조로 전달됩니다"><input className="num" value={f.soul} onChange={set("soul")} /></Field>
            <div className="flex gap-2"><Button kind="primary" busy={act.busy === "s"} disabled={!f.name} onClick={save}>저장</Button>{f.id && <Button kind="ghost" onClick={() => setF(BLANK)}>취소</Button>}</div>
          </div>
          {act.view}
        </Card>
      </div>
    </Page>
  );
}
