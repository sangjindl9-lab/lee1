"use client";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, MODES, useApi } from "@/lib/api";
import { Button, cx, Field, Note } from "./ui";

const DURATIONS = [0, 15, 30, 45, 60, 90, 120, 180];

/** 주제 한 줄 + 제작 시작. 나머지는 모두 'AI 자동'이 기본값이고 고급 설정에 접혀 있다. */
export default function Composer({ advancedOpen = false, initialTopic = "" }: { advancedOpen?: boolean; initialTopic?: string }) {
  const router = useRouter();
  const [topic, setTopic] = useState(initialTopic);
  const [adv, setAdv] = useState(advancedOpen);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<any>({ mode: "auto", language: "ko", duration: 0, max_cost_usd: "", resolution: "1080x1920", fps: 30, style: "", voice: "", image_model: "", video_model: "", tts_model: "", llm_model: "", character_id: "", allow_unpriced: false, no_music: false, sub_en: false });
  const models = useApi<any[]>(adv ? "/models" : null);
  const chars = useApi<any[]>(adv ? "/characters" : null);
  const voices = useApi<any>(adv ? "/voices" : null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const opts = (kind: string) => (models.data || []).filter((m) => m.kind === kind && m.enabled && m.provider_connected);

  async function start() {
    if (topic.trim().length < 2) { setErr("주제를 입력하세요"); return; }
    setBusy(true); setErr(null);
    try {
      const p = await api("/projects", {
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: {
          topic, mode: f.mode, language: f.language, duration: Number(f.duration), max_cost_usd: f.max_cost_usd ? Number(f.max_cost_usd) : null,
          options: { resolution: f.resolution, fps: Number(f.fps), style: f.style || null, voice: f.voice || null, image_model: f.image_model || null, video_model: f.video_model || null,
            tts_model: f.tts_model || null, llm_model: f.llm_model || null, character_id: f.character_id || null, allow_unpriced: f.allow_unpriced, no_music: f.no_music,
            subtitle_languages: f.sub_en && f.language !== "en" ? ["en"] : [] },
        },
      });
      router.push(`/projects/${p.id}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3">
        <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} autoFocus
          placeholder="주제 또는 키워드 한 줄" aria-label="주제" className="!h-14 !text-[18px] !px-5 !rounded-xl !bg-card" />
        <Button kind="primary" busy={busy} onClick={start} className="!h-14 !px-7 !text-[16px] !rounded-xl shrink-0">
          제작 시작 <ArrowRight size={18} strokeWidth={1.5} />
        </Button>
      </div>
      <button onClick={() => setAdv(!adv)} className="mt-3 inline-flex items-center gap-1.5 text-sub hover:text-ink text-[13px] transition-colors duration-150">
        <ChevronDown size={16} strokeWidth={1.5} className={cx("transition-transform duration-150 ease-out", adv && "rotate-180")} />
        고급 설정 <span className="text-mute">기본값은 모두 AI 자동 선택</span>
      </button>
      {err && <div className="mt-3"><Note tone="bad">{err}</Note></div>}
      {adv && (
        <div className="mt-5 pt-5 border-t rise">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-5">
            {MODES.map(([k, label, desc]) => (
              <button key={k} onClick={() => setF({ ...f, mode: k })}
                className={cx("text-left rounded-xl border p-3 transition-colors duration-150 ease-out", f.mode === k ? "bg-raised border-[rgba(237,237,237,0.24)]" : "hover:bg-raised/50")}>
                <div className="font-medium">{label}</div>
                <div className="text-mute text-[12px] mt-1 leading-4">{desc}</div>
              </button>
            ))}
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Field label="영상 길이"><select value={f.duration} onChange={set("duration")}>{DURATIONS.map((d) => <option key={d} value={d}>{d ? `${d}초` : "AI 자동 결정"}</option>)}</select></Field>
            <Field label="언어"><select value={f.language} onChange={set("language")}><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option><option value="es">Español</option></select></Field>
            <Field label="최대 비용 (USD)" hint="넘을 것 같으면 과금 없이 승인 대기로 멈춥니다"><input className="num" inputMode="decimal" placeholder="기본 한도 사용" value={f.max_cost_usd} onChange={set("max_cost_usd")} /></Field>
            <Field label="출력 규격"><select value={`${f.resolution}@${f.fps}`} onChange={(e) => { const [r, p] = e.target.value.split("@"); setF({ ...f, resolution: r, fps: Number(p) }); }}>
              <option value="1080x1920@30">1080×1920 · 30fps</option><option value="1080x1920@60">1080×1920 · 60fps</option><option value="2160x3840@30">2160×3840 · 30fps (확대 출력)</option></select></Field>
            <Field label="영상 스타일"><input placeholder="AI 자동" value={f.style} onChange={set("style")} /></Field>
            <Field label="고정 캐릭터"><select value={f.character_id} onChange={set("character_id")}><option value="">없음</option>{(chars.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="음성"><select value={f.voice} onChange={set("voice")}><option value="">AI 자동</option>{(voices.data?.voices || []).map((v: any) => <option key={v.provider + v.id} value={v.id}>{v.name} · {v.provider}</option>)}</select></Field>
            <Field label="음성 모델"><select value={f.tts_model} onChange={set("tts_model")}><option value="">AI 자동</option>{opts("tts").map((m) => <option key={m.model_key} value={m.model_key}>{m.display_name}</option>)}</select></Field>
            <Field label="이미지 모델"><select value={f.image_model} onChange={set("image_model")}><option value="">AI 자동</option>{opts("image").map((m) => <option key={m.model_key} value={m.model_key}>{m.display_name}</option>)}</select></Field>
            <Field label="영상 모델"><select value={f.video_model} onChange={set("video_model")}><option value="">AI 자동</option>{opts("i2v").map((m) => <option key={m.model_key} value={m.model_key}>{m.display_name}</option>)}</select></Field>
            <Field label="언어 AI"><select value={f.llm_model} onChange={set("llm_model")}><option value="">AI 자동</option>{opts("llm").map((m) => <option key={m.model_key} value={m.model_key}>{m.display_name}</option>)}</select></Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 mt-5 text-sub">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.sub_en} onChange={set("sub_en")} />영어 자막 파일 추가</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.no_music} onChange={set("no_music")} />배경음악 없이</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={f.allow_unpriced} onChange={set("allow_unpriced")} />단가 미등록 모델 사용 허용</label>
          </div>
        </div>
      )}
    </div>
  );
}
