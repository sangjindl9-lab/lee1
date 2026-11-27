"use client";
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useUser } from "@/components/Shell";
import { Button, Card, Empty, Field, H2, Page, useAction } from "@/components/ui";
import { api, tc, useApi } from "@/lib/api";

const MOODS = ["긴장감", "감동", "미래 기술", "공포", "신비", "여행", "자연", "코미디", "액션", "다큐멘터리"];
export default function MusicPage() {
  const list = useApi<any[]>("/music");
  const user = useUser();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<any>({ title: "", mood: "", kind: "music", license_name: "", license_type: "", source_url: "", attribution: "", commercial_ok: false, shared: false });
  const act = useAction();
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = () => { const fd = new FormData(); if (!file.current?.files?.[0]) return act.setError("파일을 선택하세요"); fd.append("file", file.current.files[0]); Object.entries(f).forEach(([k, v]) => fd.append(k, String(v)));
    act.run("s", () => api("/music", { form: fd }).then(() => { list.reload(); setF({ ...f, title: "" }); file.current!.value = ""; })); };
  return (
    <Page title="음악 라이브러리" meta="이용 허락 정보가 등록된 음원만 쓰고, 상업적 이용 가능으로 표시된 곡만 자동 선정 대상이 됩니다. 장면 분위기와 맞는 곡을 고르고 내레이션 구간에서는 음량을 자동으로 낮춥니다">
      <div className="grid lg:grid-cols-[1fr_400px] gap-6 items-start">
        <Card className="!p-0 overflow-x-auto">
          {!list.data ? <Empty>불러오는 중</Empty> : !list.data.length ? <Empty>등록된 음원이 없습니다. 음원이 없으면 배경음악 없이 제작합니다</Empty> : (
            <table className="min-w-[640px]"><thead><tr><th className="!pl-5">곡</th><th>분위기</th><th>길이</th><th>이용 허락</th><th>듣기</th><th className="!pr-5" /></tr></thead>
              <tbody>{list.data.map((t) => <tr key={t.id}><td className="!pl-5 text-ink">{t.title}<span className="text-mute text-[12px] ml-2">{t.kind === "sfx" ? "효과음" : ""}{t.user_id ? "" : " 공용"}</span></td><td>{t.mood || "—"}</td><td className="num">{tc(t.duration)}</td>
                <td className="text-[13px]">{t.license?.name}<span className={t.usable ? "text-ok" : "text-mute"}> · {t.usable ? "상업 이용 가능" : "자동 선정 제외"}</span></td>
                <td><audio src={t.url} controls preload="none" className="h-8 w-40" /></td>
                <td className="!pr-5"><Button kind="ghost" aria-label="삭제" onClick={() => act.run("d", () => api(`/music/${t.id}`, { method: "DELETE" }).then(list.reload))}><Trash2 size={16} strokeWidth={1.5} /></Button></td></tr>)}</tbody></table>)}
        </Card>
        <Card>
          <H2>음원 등록</H2>
          <div className="flex flex-col gap-4">
            <Field label="파일 (mp3·wav·m4a)"><input ref={file} type="file" accept="audio/*" /></Field>
            <div className="grid grid-cols-2 gap-4"><Field label="제목"><input value={f.title} onChange={set("title")} /></Field>
              <Field label="분위기"><select value={f.mood} onChange={set("mood")}><option value="">지정 안 함</option>{MOODS.map((m) => <option key={m}>{m}</option>)}</select></Field></div>
            <Field label="라이선스 이름" hint="예: 직접 제작, 구매한 라이브러리 이름, CC BY 4.0"><input value={f.license_name} onChange={set("license_name")} /></Field>
            <div className="grid grid-cols-2 gap-4"><Field label="유형"><input value={f.license_type} onChange={set("license_type")} /></Field><Field label="출처 URL"><input value={f.source_url} onChange={set("source_url")} /></Field></div>
            <Field label="저작자 표시 문구"><input value={f.attribution} onChange={set("attribution")} /></Field>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.commercial_ok} onChange={set("commercial_ok")} />상업적 이용이 허락된 음원임을 확인했습니다</label>
            {user?.role === "admin" && <label className="inline-flex items-center gap-2 text-sub"><input type="checkbox" checked={f.shared} onChange={set("shared")} />모든 사용자 공용으로 등록</label>}
            <Button kind="primary" busy={act.busy === "s"} disabled={!f.title || !f.license_name} onClick={save}>등록</Button>
          </div>
          {act.view}
        </Card>
      </div>
    </Page>
  );
}
