import { useEffect, useMemo, useRef, useState } from "react";
import { del, get, patch, post } from "../api";
import { useAuth } from "../auth";
import { fmtDateTime } from "../format";
import { Alert, errMsg, Field, useData } from "../ui";

type Pt = [number, number];
type Rule = {
  id: number; camera_id: number; type: string; type_label: string; name: string; enabled: boolean; zone: Pt[]; line: Pt[];
  params: Record<string, number>; custom_params: Record<string, number>; severity: string; cooldown_seconds: number;
  ref_requested_at: string | null; ref_set_at: string | null;
};
type Meta = { types: { type: string; label: string; person: boolean; defaults: Record<string, number>; severity: string; explain: string; experimental: boolean }[] };

const PARAM_LABEL: Record<string, [string, string]> = {
  min_area: ["최소 면적(화면 비율)", "0.002 = 구역의 0.2%"],
  persist_seconds: ["지속 시간(초)", "조건이 이 시간 이상 이어져야 알림"],
  flicker: ["흔들림 기준(0~1)", "낮출수록 민감, 오탐 증가"],
  sensitivity: ["민감도(0~1)", "높일수록 민감, 오탐 증가"],
  min_person_px: ["판정 최소 사람 키(px, 분석 화면 기준)", "이보다 작으면 판정하지 않음"],
  changed_ratio: ["구역 변화 비율(0~1)", "눈금선이 없을 때 사용"],
  danger_percent: ["위험 수위(%)", "눈금선 아래에서부터 덮인 높이"],
  min_seconds: ["머문 시간(초)", "구역에 들어온 뒤 이 시간이 지나면 알림"],
  dwell_seconds: ["배회 판단 시간(초)", ""],
  min_count: ["기준 인원(명)", ""],
  speed: ["속도 기준(몸 높이/초)", "보통 걸음 약 0.5~1.0"],
  seconds: ["움직임 없음 시간(초)", ""],
};
const SEV: Record<string, string> = { info: "참고", warning: "주의", critical: "긴급" };

export default function Analytics() {
  const { can } = useAuth();
  const editable = can("settings");
  const meta = useData<Meta>(() => get("/api/analytics/meta"), []);
  const status = useData<any>(() => get("/api/analytics/status"), [], 3000);
  const cams = useData<any>(() => get("/api/cameras"), []);
  const [camId, setCamId] = useState<number | null>(null);
  const rules = useData<Rule[]>(() => (camId ? get(`/api/cameras/${camId}/analytics/rules`) : Promise.resolve([])), [camId], 5000);
  const [sel, setSel] = useState<number | "new" | null>(null);
  const [msg, setMsg] = useState<{ kind: "" | "err" | "ok"; text: string } | null>(null);

  useEffect(() => {
    if (camId === null && cams.data?.items?.length) {
      const withRules = Object.keys(status.data?.rule_counts ?? {}).map(Number);
      setCamId(withRules[0] ?? cams.data.items[0].id);
    }
  }, [cams.data, status.data, camId]);

  const typeMeta = useMemo(() => Object.fromEntries((meta.data?.types ?? []).map((t) => [t.type, t])), [meta.data]);
  const camStatus = camId ? status.data?.cameras?.[String(camId)] : null;
  const current = typeof sel === "number" ? rules.data?.find((r) => r.id === sel) ?? null : null;

  return (
    <div className="page wide">
      <div className="pagehead">
        <div>
          <h1>지능형 분석</h1>
          <p className="muted">서버 CPU에서 불꽃·연기·안전모 미착용·수위·침입·배회·군집·쓰러짐·뛰기·장시간 정지를 분석합니다.
            규칙 기반·범용 모델이므로 현장 영상으로 감도를 조정한 뒤 사용하세요. 분석 결과는 보조 알림이며 사람의 확인이 필요합니다.</p>
        </div>
      </div>
      <ServiceBar st={status.data} err={status.error} />
      <div className="row" style={{ margin: "12px 0" }}>
        <select value={camId ?? ""} onChange={(e) => { setCamId(Number(e.target.value)); setSel(null); }} aria-label="카메라">
          {(cams.data?.items ?? []).map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}{status.data?.rule_counts?.[c.id] ? ` · 규칙 ${status.data.rule_counts[c.id]}개` : ""}</option>
          ))}
        </select>
        {camStatus && <span className="small muted">분석 {camStatus.state === "running" ? `동작 중 · ${camStatus.fps}fps · ${camStatus.width}×${camStatus.height} · 사람 ${camStatus.persons}명${camStatus.detect_ms ? ` · 검출 ${camStatus.detect_ms}ms` : ""}` : camStatus.state}
          {camStatus.error && <b style={{ color: "var(--warn)" }}> {camStatus.error}</b>}</span>}
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {camId && (
        <div className="analytics">
          <Stage key={camId} camId={camId} rule={sel === "new" ? null : current} editable={editable}
            onSave={async (zone, line) => {
              if (!current) return;
              try { await patch(`/api/analytics/rules/${current.id}`, { zone, line }); setMsg({ kind: "ok", text: "영역을 저장했습니다." }); rules.reload(); }
              catch (e) { setMsg({ kind: "err", text: errMsg(e) }); }
            }} />
          <div className="panel stack">
            <div className="row"><h2 style={{ margin: 0, flex: 1 }}>분석 규칙</h2>
              {editable && <button className="primary" onClick={() => setSel("new")}>규칙 추가</button>}</div>
            {rules.error && <Alert kind="err">{rules.error}</Alert>}
            {(rules.data ?? []).length === 0 && <div className="muted small">이 카메라에 분석 규칙이 없습니다.</div>}
            <div className="rulelist">
              {(rules.data ?? []).map((r) => {
                const rs = camStatus?.rules?.[String(r.id)];
                return (
                  <button key={r.id} className={`ruleitem ${sel === r.id ? "on" : ""}`} onClick={() => setSel(r.id)}>
                    <span className={`badge ${!r.enabled ? "off" : rs?.open ? "rec" : rs ? "ok" : ""}`}>{r.type_label}</span>
                    <span className="nm">{r.name || "(이름 없음)"}</span>
                    <span className="small muted">{!r.enabled ? "꺼짐" : rs?.open ? "감지 중" : rs?.ref_required ? "기준 영상 필요" : rs ? "감시 중" : "대기"}</span>
                  </button>
                );
              })}
            </div>
            {sel === "new" && editable && meta.data && (
              <RuleForm key="new" meta={meta.data} typeMeta={typeMeta} onCancel={() => setSel(null)}
                onSubmit={async (b) => {
                  try { const r = await post<Rule>(`/api/cameras/${camId}/analytics/rules`, b); setSel(r.id); rules.reload(); status.reload();
                    setMsg({ kind: "ok", text: "규칙을 추가했습니다. 왼쪽 화면에서 구역을 그려 저장하세요(그리지 않으면 화면 전체)." }); }
                  catch (e) { setMsg({ kind: "err", text: errMsg(e) }); }
                }} />
            )}
            {current && meta.data && (
              <RuleForm key={current.id} meta={meta.data} typeMeta={typeMeta} rule={current} readOnly={!editable} runtime={camStatus?.rules?.[String(current.id)]}
                onCancel={() => setSel(null)}
                onSubmit={async (b) => {
                  try { await patch(`/api/analytics/rules/${current.id}`, b); rules.reload(); setMsg({ kind: "ok", text: "저장했습니다. 수 초 안에 분석에 반영됩니다." }); }
                  catch (e) { setMsg({ kind: "err", text: errMsg(e) }); }
                }}
                onDelete={async () => {
                  if (!window.confirm("이 규칙을 삭제할까요?")) return;
                  try { await del(`/api/analytics/rules/${current.id}`); setSel(null); rules.reload(); } catch (e) { setMsg({ kind: "err", text: errMsg(e) }); }
                }}
                onReference={async () => {
                  try { const r = await post<any>(`/api/analytics/rules/${current.id}/reference`); setMsg({ kind: "ok", text: r.note }); rules.reload(); }
                  catch (e) { setMsg({ kind: "err", text: errMsg(e) }); }
                }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceBar({ st, err }: { st: any; err: string }) {
  if (err) return <Alert kind="err">{err}</Alert>;
  if (!st) return null;
  if (!st.service_alive)
    return <Alert kind="err">분석 서비스가 동작하지 않습니다{st.last_seen_at ? ` (마지막 응답 ${fmtDateTime(st.last_seen_at)})` : ""}. 서버에서 analytics 서비스 상태를 확인하세요.</Alert>;
  return (
    <div className="row small">
      <span className="badge ok">분석 서비스 동작 중</span>
      <span className="muted">사람 검출 모델: {st.model ?? "없음"} · 분석 {st.fps}fps · 사람 검출 {st.detect_interval}초 간격 · CPU 추론</span>
      {st.model_error && <b style={{ color: "var(--warn)" }}>{st.model_error}</b>}
    </div>
  );
}

// 분석 화면(1초 갱신) 위에 구역·눈금선을 그린다. 좌표는 0~1 비율.
function Stage({ camId, rule, editable, onSave }: { camId: number; rule: Rule | null; editable: boolean; onSave: (zone: Pt[], line: Pt[]) => void }) {
  const [tick, setTick] = useState(0);
  const [src, setSrc] = useState<"preview" | "snapshot">("preview");
  const [failed, setFailed] = useState(false);
  const [ar, setAr] = useState("16 / 9");
  const [mode, setMode] = useState<"" | "zone" | "line">("");
  const [zone, setZone] = useState<Pt[]>([]);
  const [line, setLine] = useState<Pt[]>([]);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => { setZone(rule?.zone ?? []); setLine(rule?.line ?? []); setMode(""); }, [rule?.id, rule?.zone, rule?.line]);
  useEffect(() => {
    if (src !== "preview") return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [src]);

  const url = src === "preview" ? `/api/cameras/${camId}/analytics/preview?t=${tick}` : `/api/cameras/${camId}/snapshot?t=${tick}`;
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!mode || !svg.current) return;
    const b = svg.current.getBoundingClientRect();
    const p: Pt = [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))];
    if (mode === "zone") setZone((z) => (z.length >= 20 ? z : [...z, p]));
    else setLine((l) => { const n = l.length >= 2 ? [p] : [...l, p]; if (n.length === 2) setMode(""); return n; });
  };
  const fmt = (pts: Pt[]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <div className="panel stack">
      <div className="stageimg" style={{ aspectRatio: ar }}>
        {!failed
          ? <img src={url} alt="분석 화면" onError={() => { setFailed(true); }} onLoad={(e) => { setFailed(false); const i = e.currentTarget; if (i.naturalWidth) setAr(`${i.naturalWidth} / ${i.naturalHeight}`); }} />
          : <div className="msg">{src === "preview"
            ? <>분석 화면이 아직 없습니다. 규칙이 켜져 있으면 수 초 뒤 표시됩니다.<br /><button onClick={() => { setSrc("snapshot"); setFailed(false); setTick((n) => n + 1); }}>카메라 스냅샷으로 보기</button></>
            : <>스냅샷을 가져오지 못했습니다.</>}</div>}
        <svg ref={svg} viewBox="0 0 1 1" preserveAspectRatio="none" onClick={click} style={{ cursor: mode ? "crosshair" : "default" }}>
          {zone.length >= 2 && <polygon points={fmt(zone)} fill="rgba(255,190,0,.15)" stroke="#ffbe00" strokeWidth={0.004} />}
          {zone.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.008} fill="#ffbe00" />)}
          {line.length >= 1 && <polyline points={fmt(line)} stroke="#33bbff" strokeWidth={0.006} fill="none" />}
          {line.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={0.01} fill={i === 0 ? "#33bbff" : "#fff"} />)}
        </svg>
      </div>
      <div className="row small">
        <span className="muted">{src === "preview" ? "분석 결과 화면(1초마다 갱신) — 빨간 상자: 감지, 초록: 검출된 사람" : "카메라 스냅샷"}</span>
        {src === "snapshot" && <button className="ghost" onClick={() => { setSrc("preview"); setFailed(false); }}>분석 화면으로</button>}
        {src === "snapshot" && <button className="ghost" onClick={() => setTick((n) => n + 1)}>새로 고침</button>}
      </div>
      {rule && editable && (
        <div className="row">
          <button className={mode === "zone" ? "primary" : ""} onClick={() => { setMode(mode === "zone" ? "" : "zone"); if (mode !== "zone") setZone([]); }}>
            {mode === "zone" ? "구역 점 찍는 중…(다시 누르면 끝)" : "구역 그리기"}</button>
          <button onClick={() => setZone([])}>구역 지우기(화면 전체)</button>
          {rule.type === "water_level" && (
            <button className={mode === "line" ? "primary" : ""} onClick={() => { setMode("line"); setLine([]); }}>
              {mode === "line" ? (line.length === 0 ? "바닥 지점을 누르세요" : "위쪽 지점을 누르세요") : "눈금선 그리기"}</button>)}
          {rule.type === "water_level" && <button onClick={() => setLine([])}>눈금선 지우기</button>}
          <button className="primary" disabled={(zone.length > 0 && zone.length < 3) || line.length === 1} onClick={() => { setMode(""); onSave(zone, line); }}>영역 저장</button>
        </div>)}
      {rule && <p className="small muted">구역은 사람의 <b>발 위치</b>(사람 규칙) 또는 감지 대상 범위(불꽃·연기·수위)입니다. {rule.type === "water_level" && "눈금선은 수위봉·벽면을 따라 바닥 → 위 순서로 두 점을 찍습니다."}</p>}
    </div>
  );
}

function RuleForm({ meta, typeMeta, rule, readOnly, runtime, onSubmit, onCancel, onDelete, onReference }: {
  meta: Meta; typeMeta: Record<string, Meta["types"][number]>; rule?: Rule; readOnly?: boolean; runtime?: any;
  onSubmit: (b: any) => void; onCancel: () => void; onDelete?: () => void; onReference?: () => void;
}) {
  const [type, setType] = useState(rule?.type ?? "intrusion");
  const [name, setName] = useState(rule?.name ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [severity, setSeverity] = useState(rule?.severity ?? typeMeta[type]?.severity ?? "warning");
  const [cooldown, setCooldown] = useState(rule?.cooldown_seconds ?? 60);
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(rule?.params ?? typeMeta[type]?.defaults ?? {}).map(([k, v]) => [k, String(v)])));
  const tm = typeMeta[type];
  useEffect(() => {
    if (!rule) { setParams(Object.fromEntries(Object.entries(tm?.defaults ?? {}).map(([k, v]) => [k, String(v)]))); setSeverity(tm?.severity ?? "warning"); }
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  const body = () => ({
    ...(rule ? {} : { type }), name, enabled, severity, cooldown_seconds: Number(cooldown),
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])),
  });
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSubmit(body()); }}>
      <h3 style={{ margin: 0 }}>{rule ? `${rule.type_label} 규칙` : "새 규칙"}</h3>
      <div className="form">
        {!rule && (
          <Field label="분석 종류" full>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {meta.types.map((t) => <option key={t.type} value={t.type}>{t.label}{t.experimental ? " (시험 기능)" : ""}</option>)}
            </select>
          </Field>)}
        {tm && <p className="small muted full">{tm.explain}</p>}
        <Field label="이름(위치)"><input value={name} disabled={readOnly} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="예: 2층 자재 적치장" /></Field>
        <Field label="중요도"><select value={severity} disabled={readOnly} onChange={(e) => setSeverity(e.target.value)}>
          {Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="재알림 간격(초)" hint="감지가 끝난 뒤 이 시간 안에는 다시 알리지 않음"><input type="number" min={0} max={86400} disabled={readOnly} value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} /></Field>
        {Object.keys(tm?.defaults ?? {}).map((k) => (
          <Field key={k} label={PARAM_LABEL[k]?.[0] ?? k} hint={PARAM_LABEL[k]?.[1]}>
            <input type="number" step="any" disabled={readOnly} value={params[k] ?? ""} onChange={(e) => setParams({ ...params, [k]: e.target.value })} />
          </Field>))}
        <label className="check full"><input type="checkbox" checked={enabled} disabled={readOnly} onChange={(e) => setEnabled(e.target.checked)} />사용</label>
      </div>
      {rule?.type === "water_level" && (
        <div className="alert info small">
          기준 영상: {rule.ref_set_at ? `${fmtDateTime(rule.ref_set_at)} 저장됨` : <b>없음 — 물이 없는 평상시에 저장하세요</b>}
          {rule.ref_requested_at && " · 저장 요청 처리 중"}
          {runtime?.info?.level_percent !== undefined && ` · 현재 추정 수위 ${runtime.info.level_percent}%`}
          {runtime?.info?.changed_ratio !== undefined && ` · 구역 변화 ${Math.round(runtime.info.changed_ratio * 100)}%`}
          {!readOnly && <div style={{ marginTop: 6 }}><button type="button" onClick={onReference}>지금 화면을 기준 영상으로 저장</button></div>}
        </div>)}
      {runtime?.info && rule?.type !== "water_level" && Object.keys(runtime.info).length > 0 && (
        <div className="small muted">현재 값: {Object.entries(runtime.info).map(([k, v]) => `${k}=${v}`).join(", ")}</div>)}
      <div className="row">
        {!readOnly && <button className="primary" type="submit">{rule ? "저장" : "추가"}</button>}
        <button type="button" className="ghost" onClick={onCancel}>닫기</button>
        {rule && !readOnly && <button type="button" className="danger" onClick={onDelete} style={{ marginLeft: "auto" }}>삭제</button>}
      </div>
    </form>
  );
}
