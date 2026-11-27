"use client";
import { Check, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { useUser } from "@/components/Shell";
import { Button, Card, cx, Empty, Field, H2, Note, Page, useAction } from "@/components/ui";
import { api, useApi, usd, when } from "@/lib/api";

const FIELD: any = { key_id: "API Key ID", key_secret: "API Key Secret", api_key: "API 키", client_id: "클라이언트 ID", client_secret: "클라이언트 시크릿", region: "리전" };
const KIND: any = { llm: "언어 AI", image: "이미지", i2v: "이미지→영상", t2v: "텍스트→영상", tts: "음성 합성", stt: "음성 인식", search: "웹 검색", youtube: "유튜브 조사", oauth: "채널 연결" };
const UNIT: any = { per_image: "장", per_second: "초", per_mtok: "100만 입력 토큰", per_1k_chars: "1천 자", per_minute: "분" };

function ProviderCard({ p, admin, onChange }: any) {
  const [open, setOpen] = useState(false);
  const [cred, setCred] = useState<any>({});
  const [scope, setScope] = useState(p.admin_only ? "global" : "user");
  const [models, setModels] = useState<string[] | null>(null);
  const form = useRef<HTMLDivElement>(null);
  const act = useAction();
  const save = async () => {
    // 브라우저 자동 완성이 넣은 값도 놓치지 않도록 입력칸에서 직접 읽는다.
    const credentials: any = {};
    form.current?.querySelectorAll("input[data-field]").forEach((el: any) => { if (el.value.trim()) credentials[el.dataset.field] = el.value.trim(); });
    const ok = await act.run("s", () => api(`/providers/${p.id}`, { method: "PUT", body: { credentials, scope } }).then(() => true));
    if (!ok) return;
    const r = await act.run("t", () => api(`/providers/${p.id}/test?scope=${scope}`, { method: "POST" }), "연결을 확인했습니다");
    if (r?.models) setModels(r.models);
    if (r?.note) act.setError(null);
    setCred({}); onChange();
  };
  const state = !p.implemented ? "미구현" : p.verified ? "연결 확인됨" : p.connected ? (p.mine?.status === "error" ? "연결 실패" : "키 등록됨 · 미확인") : "미연결";
  return (
    <Card className="!p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><div className="font-medium flex items-center gap-2">{p.name}{p.verified && <Check size={16} strokeWidth={1.5} className="text-ok" />}</div>
          <div className="text-mute text-[12px] mt-1">{p.kinds.map((k: string) => KIND[k] || k).join(" · ")}</div></div>
        <span className={cx("text-[13px] whitespace-nowrap", p.verified ? "text-ok" : p.mine?.status === "error" ? "text-bad" : "text-mute")}>{state}{!p.mine && p.shared && p.connected ? " (공용 키)" : ""}</span>
      </div>
      {p.mine?.masked && <div className="num text-mute text-[12px] mt-3">{Object.values(p.mine.masked).join(" : ")} · 확인 {when(p.mine.last_checked_at)}</div>}
      {p.mine?.last_error && <div className="mt-3"><Note tone="bad">{p.mine.last_error}</Note></div>}
      {p.implemented && (!p.admin_only || admin) && (
        <div className="mt-4">
          {!open ? <div className="flex gap-2"><Button onClick={() => setOpen(true)}>{p.connected ? "키 변경" : "키 등록"}</Button>
            {p.connected && <Button kind="ghost" busy={act.busy === "t"} onClick={async () => { const r = await act.run("t", () => api(`/providers/${p.id}/test?scope=${p.mine ? "user" : "global"}`, { method: "POST" }), "연결을 확인했습니다"); if (r?.models) setModels(r.models); onChange(); }}>연결 테스트</Button>}
            {p.mine && <Button kind="ghost" onClick={() => act.run("d", () => api(`/providers/${p.id}`, { method: "DELETE" }).then(onChange))}>삭제</Button>}
            {p.docs && <a href={p.docs} target="_blank" className="inline-flex items-center gap-1 text-mute hover:text-ink text-[13px] ml-auto">문서<ExternalLink size={14} strokeWidth={1.5} /></a>}</div> : (
            <div ref={form} className="flex flex-col gap-3 rise">
              {p.fields.map((k: string) => <Field key={k} label={FIELD[k] || k}><input type="text" data-field={k} name={`sf-${p.id}-${k}`} autoComplete="off" spellCheck={false} className="num" value={cred[k] || ""} onChange={(e) => setCred({ ...cred, [k]: e.target.value })} /></Field>)}
              {admin && !p.admin_only && <label className="inline-flex items-center gap-2 text-sub text-[13px]"><input type="checkbox" checked={scope === "global"} onChange={(e) => setScope(e.target.checked ? "global" : "user")} />모든 사용자가 쓰는 서비스 공용 키로 등록</label>}
              <div className="flex gap-2"><Button kind="primary" busy={!!act.busy} onClick={save}>저장하고 연결 확인</Button><Button kind="ghost" onClick={() => setOpen(false)}>닫기</Button></div>
            </div>)}
          {p.help && <p className="text-mute text-[12px] mt-3 leading-4">{p.help}</p>}
        </div>)}
      {act.view}
      {models && <div className="mt-3"><Note>이 키로 쓸 수 있는 모델 {models.length}개: <span className="num break-all">{models.slice(0, 12).join(", ")}{models.length > 12 ? " …" : ""}</span>. 아래 모델 목록에서 실제로 쓸 모델 ID를 맞춰 주세요</Note></div>}
    </Card>
  );
}

function ModelRow({ m, admin, onChange }: any) {
  const [price, setPrice] = useState(m.unit_cost_usd ?? "");
  const [out, setOut] = useState(m.unit_cost_out_usd ?? "");
  const [ep, setEp] = useState(m.endpoint);
  const act = useAction();
  const dirty = String(price) !== String(m.unit_cost_usd ?? "") || String(out) !== String(m.unit_cost_out_usd ?? "") || ep !== m.endpoint;
  const patch = (body: any) => act.run("p", () => api(`/models/${m.model_key}`, { method: "PATCH", body }).then(onChange));
  return (
    <tr>
      <td className="!pl-5"><div className="text-ink">{m.display_name}</div><div className="text-mute text-[12px]">{KIND[m.kind]} · {m.tier}{m.schema_verified ? " · 스키마 확인" : " · 스키마 미검증"}{!m.provider_connected ? " · 공급자 미연결" : ""}</div>{act.error && <div className="text-bad text-[12px]">{act.error}</div>}</td>
      <td>{admin ? <input className="num !h-8 min-w-[220px] text-[13px]" value={ep} onChange={(e) => setEp(e.target.value)} /> : <span className="num text-[13px] break-all">{m.endpoint}</span>}</td>
      <td className="whitespace-nowrap">{admin ? <span className="inline-flex items-center gap-2"><input className="num !h-8 !w-24" placeholder="미등록" value={price} onChange={(e) => setPrice(e.target.value)} />{m.kind === "llm" && <input className="num !h-8 !w-24" placeholder="출력 단가" value={out} onChange={(e) => setOut(e.target.value)} />}<span className="text-mute text-[12px]">USD / {UNIT[m.unit]}</span></span>
        : <span className="num">{m.unit_cost_usd == null ? "미등록" : `${usd(m.unit_cost_usd, 3)} / ${UNIT[m.unit]}`}</span>}</td>
      <td className="!pr-5 text-right whitespace-nowrap">{admin && <span className="inline-flex gap-2">
        {dirty && <Button busy={!!act.busy} className="!h-8" onClick={() => patch(price === "" ? { endpoint: ep, clear_price: true } : { endpoint: ep, unit_cost_usd: Number(price), ...(out !== "" ? { unit_cost_out_usd: Number(out) } : {}), price_source: `관리자 입력 ${new Date().toISOString().slice(0, 10)}` })}>저장</Button>}
        <Button kind="ghost" className="!h-8" onClick={() => patch({ enabled: !m.enabled })}>{m.enabled ? "사용 중" : "꺼짐"}</Button></span>}</td>
    </tr>
  );
}

export default function Connections() {
  const user = useUser();
  const admin = user?.role === "admin";
  const prov = useApi<any[]>("/providers");
  const models = useApi<any[]>("/models");
  const [nm, setNm] = useState<any>({ provider: "anthropic", kind: "llm", model_key: "", display_name: "", endpoint: "", tier: "standard" });
  const act = useAction();
  const reload = () => { prov.reload(); models.reload(); };
  const done = (prov.data || []).filter((p) => p.implemented);
  const todo = (prov.data || []).filter((p) => !p.implemented);
  return (
    <Page title="API 연결 관리" meta="키는 서버에서 암호화해 저장하고 화면과 로그에는 일부만 보입니다. ‘키 등록됨’과 ‘연결 확인됨’은 구분해서 표시합니다">
      {!prov.data ? <Empty>불러오는 중</Empty> : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{done.map((p) => <ProviderCard key={p.id} p={p} admin={admin} onChange={reload} />)}</div>}
      <div className="mt-10"><H2>모델 목록 · 단가</H2>
        <p className="text-sub text-[13px] mb-4 max-w-[52rem]">모델 ID와 단가는 코드가 아니라 이 표에서 관리합니다. 단가가 비어 있는 모델은 비용을 계산할 수 없어 승인 없이는 쓰이지 않습니다. 공급자 콘솔의 실제 가격을 확인해 넣어 주세요{admin ? "" : " (관리자만 수정 가능)"}</p>
        <Card className="!p-0 overflow-x-auto"><table className="min-w-[860px]"><thead><tr><th className="!pl-5">모델</th><th>공급자 모델 경로 · ID</th><th>단가</th><th className="!pr-5" /></tr></thead>
          <tbody>{(models.data || []).map((m) => <ModelRow key={m.model_key + m.updated_at} m={m} admin={admin} onChange={models.reload} />)}</tbody></table></Card>
        {admin && <Card className="mt-4"><H2>모델 추가</H2>
          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
            <Field label="공급자"><select value={nm.provider} onChange={(e) => setNm({ ...nm, provider: e.target.value })}>{done.filter((p) => !p.admin_only && !["tavily", "brave", "youtube"].includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="종류"><select value={nm.kind} onChange={(e) => setNm({ ...nm, kind: e.target.value })}>{["llm", "image", "i2v", "t2v", "tts", "stt"].map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select></Field>
            <Field label="등급"><select value={nm.tier} onChange={(e) => setNm({ ...nm, tier: e.target.value })}><option value="economy">economy</option><option value="standard">standard</option><option value="premium">premium</option></select></Field>
            <Field label="표시 이름"><input value={nm.display_name} onChange={(e) => setNm({ ...nm, display_name: e.target.value, model_key: nm.model_key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-") })} /></Field>
            <Field label="모델 경로 · ID"><input className="num" value={nm.endpoint} onChange={(e) => setNm({ ...nm, endpoint: e.target.value })} /></Field>
            <Button busy={!!act.busy} disabled={!nm.display_name || !nm.endpoint} onClick={() => act.run("a", () => api("/models", { body: { ...nm, model_key: nm.model_key || nm.endpoint } }).then(() => { models.reload(); setNm({ ...nm, display_name: "", endpoint: "", model_key: "" }); }))}>추가</Button>
          </div>
          <p className="text-mute text-[12px] mt-3 leading-4">Higgsfield 영상·이미지 모델은 입력 필드가 모델마다 달라, 추가 뒤 공식 문서의 스키마에 맞춰 capabilities(param_map)를 API로 지정해야 합니다. 방법은 API 설정 매뉴얼에 있습니다</p>{act.view}</Card>}
      </div>
      {todo.length > 0 && <div className="mt-10"><H2>연동 예정 (미구현)</H2><p className="text-sub text-[13px]">{todo.map((p) => p.name).join(" · ")} — 공통 인터페이스에 어댑터를 추가하면 연결됩니다. 지금은 키를 등록할 수 없습니다</p></div>}
    </Page>
  );
}
