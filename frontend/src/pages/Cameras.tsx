import { useState } from "react";
import { api, del, get, patch, post } from "../api";
import { useAuth } from "../auth";
import { ago, fmtBytes } from "../format";
import { Alert, Field, Modal, StatusBadge, errMsg, useData } from "../ui";
import CameraWizard from "./CameraWizard";
import RecordPolicy, { type Policy } from "../components/RecordPolicy";

export default function Cameras() {
  const { can } = useAuth();
  const cams = useData(() => get("/api/cameras"), [], 10000);
  const sites = useData(() => get("/api/sites"), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [csv, setCsv] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [testRes, setTestRes] = useState<Record<number, any>>({});
  const settings = can("settings");

  const act = async (fn: () => Promise<any>, ok?: string) => {
    try {
      const r = await fn();
      setMsg(ok ? { k: "ok", t: ok } : r?.message ? { k: "ok", t: r.message } : null);
      cams.reload();
    } catch (e) {
      setMsg({ k: "err", t: errMsg(e) });
    }
  };

  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>카메라 관리</h1><p className="muted">카메라 등록정보 삭제와 녹화 삭제는 별개입니다. 등록을 지워도 녹화는 보관 정책에 따라 남습니다.</p></div>
        <span className="spacer" />
        {settings && <button onClick={() => setCsv(true)}>CSV 일괄 등록</button>}
        {settings && <button className="primary" onClick={() => setAdding(true)}>카메라 등록</button>}
      </div>
      {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
      {cams.error && <Alert kind="err">{cams.error}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>카메라</th><th>현장 / 위치</th><th>연결</th><th>영상</th><th>상태</th><th>마지막 녹화</th><th>저장 사용량</th><th /></tr></thead>
          <tbody>
            {(cams.data?.items ?? []).map((c: any) => {
              const info = c.stream_info?.main;
              return (
                <tr key={c.id}>
                  <td><b>{c.name}</b>{c.is_test_source && <span className="tag test" style={{ marginLeft: 6 }}>시험 영상</span>}
                    <div className="muted small">{[c.vendor, c.model].filter(Boolean).join(" ") || "-"}</div></td>
                  <td>{c.site_name}<div className="muted small">{[c.building, c.zone].filter(Boolean).join(" / ")}</div></td>
                  <td className="small">{c.connection_type.toUpperCase()} / {c.rtsp_transport.toUpperCase()}<div className="muted">{c.host}</div></td>
                  <td className="small num">{info ? `${(info.video?.codec ?? "").toUpperCase()} ${info.video?.width}×${info.video?.height} ${info.measured_fps ?? info.video?.fps ?? "-"}fps ${info.bitrate_kbps ? Math.round(info.bitrate_kbps) + "kbps" : ""}` : <span className="muted">연결 시험 전</span>}
                    {info?.audio && <div className="muted">음성 {info.audio.codec}</div>}</td>
                  <td><StatusBadge status={c.status} />{c.enabled && <div className="muted small">{({ off: "녹화 꺼짐", continuous: "연속", schedule: "일정", event: "이벤트 녹화" } as any)[c.record_mode]}{c.events_enabled ? " · 이벤트 수신" : ""}</div>}
                    {c.status.error_message && <div className="small" style={{ color: "var(--warn)", maxWidth: 280 }}>{c.status.error_message}</div>}
                    {c.status.next_retry_at && c.status.state === "retry_wait" && <div className="muted small">재시도 {c.status.retry_count}회째</div>}</td>
                  <td className="small">{ago(c.status.last_segment_at)}</td>
                  <td className="small num">{fmtBytes(c.storage_bytes)}<div className="muted">보관 {c.effective_retention_days}일</div></td>
                  <td>{settings && (
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button onClick={async () => { try { setTestRes((t) => ({ ...t, [c.id]: { busy: true } })); const r = await post(`/api/cameras/${c.id}/test`); setTestRes((t) => ({ ...t, [c.id]: r })); cams.reload(); } catch (e) { setTestRes((t) => ({ ...t, [c.id]: { ok: false, error_message: errMsg(e) } })); } }}>연결 시험</button>
                      <button onClick={() => setEditing(c)}>수정</button>
                      {c.record_mode !== "off"
                        ? <button onClick={() => act(() => post(`/api/cameras/${c.id}/recording`, { action: "stop" }), "녹화를 껐습니다.")}>녹화 중지</button>
                        : <button onClick={() => act(() => post(`/api/cameras/${c.id}/recording`, { action: "start" }), "연속 녹화를 켰습니다.")}>녹화 시작</button>}
                      {c.record_mode === "off" && (c.manual_record_until
                        ? <button onClick={() => act(() => post(`/api/cameras/${c.id}/recording`, { action: "manual_stop" }), "수동 녹화를 끝냈습니다.")}>수동 녹화 종료</button>
                        : <button onClick={() => act(() => post(`/api/cameras/${c.id}/recording`, { action: "manual_start", minutes: 60 }), "60분 수동 녹화를 시작했습니다.")}>수동 녹화 60분</button>)}
                      <button onClick={() => act(() => patch(`/api/cameras/${c.id}`, { enabled: !c.enabled }), c.enabled ? "사용 안 함으로 바꿨습니다(녹화·시청 중지)." : "다시 사용합니다.")}>{c.enabled ? "사용 안 함" : "사용"}</button>
                      <button className="danger" onClick={() => window.confirm(`“${c.name}” 등록정보를 삭제합니다. 녹화 파일은 남습니다. 계속할까요?`) && act(() => del(`/api/cameras/${c.id}`))}>등록 삭제</button>
                    </div>)}
                    {testRes[c.id] && !testRes[c.id].busy && (
                      <div className="small" style={{ color: testRes[c.id].ok ? "var(--ok)" : "var(--warn)", textAlign: "right" }}>
                        {testRes[c.id].ok ? `정상: ${testRes[c.id].video.codec} ${testRes[c.id].video.width}×${testRes[c.id].video.height}` : testRes[c.id].error_message}
                      </div>)}
                    {testRes[c.id]?.busy && <div className="small muted" style={{ textAlign: "right" }}>시험 중…</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cams.data?.items?.length === 0 && <div className="empty">등록된 카메라가 없습니다. “카메라 등록”으로 시작하세요.</div>}
      </div>
      {adding && sites.data && (
        <Modal title="카메라 등록" onClose={() => { setAdding(false); cams.reload(); }}>
          <CameraWizard sites={sites.data.items} onDone={() => { setAdding(false); cams.reload(); }} />
        </Modal>
      )}
      {editing && <EditCamera cam={editing} onClose={() => { setEditing(null); cams.reload(); }} />}
      {csv && <CsvImport onClose={() => { setCsv(false); cams.reload(); }} />}
    </div>
  );
}

function EditCamera({ cam, onClose }: { cam: any; onClose: () => void }) {
  const { isSuper } = useAuth();
  const [f, setF] = useState({
    name: cam.name, building: cam.building, zone: cam.zone, main_stream_url: cam.main_stream_url, sub_stream_url: cam.sub_stream_url,
    snapshot_url: cam.snapshot_url, username: cam.username, password: "", rtsp_transport: cam.rtsp_transport,
    retention_days: cam.retention_days ?? "", location_note: cam.location_note, tags: (cam.tags ?? []).join(", "),
    is_test_source: cam.is_test_source, tls_insecure: cam.tls_insecure,
  });
  const [pol, setPol] = useState<Policy>({
    record_mode: cam.record_mode, schedule: cam.schedule ?? [], event_pre_seconds: cam.event_pre_seconds ?? 10,
    event_post_seconds: cam.event_post_seconds ?? 20, event_triggers: cam.event_triggers ?? [], events_enabled: !!cam.events_enabled,
  });
  const [err, setErr] = useState("");
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const body: Record<string, unknown> = { ...f, ...pol, tags: f.tags.split(",").map((t: string) => t.trim()).filter(Boolean), retention_days: f.retention_days === "" ? 0 : Number(f.retention_days) };
      if (!f.password) delete body.password;
      if (!isSuper) delete body.tls_insecure;
      await patch(`/api/cameras/${cam.id}`, body);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Modal title={`카메라 수정: ${cam.name}`} onClose={onClose}>
      <div className="form">
        <Field label="이름"><input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="건물"><input value={f.building} onChange={(e) => set("building", e.target.value)} /></Field>
        <Field label="구역"><input value={f.zone} onChange={(e) => set("zone", e.target.value)} /></Field>
        <Field label="태그"><input value={f.tags} onChange={(e) => set("tags", e.target.value)} /></Field>
        <Field label="메인 스트림" full><input value={f.main_stream_url} onChange={(e) => set("main_stream_url", e.target.value)} /></Field>
        <Field label="서브 스트림" full><input value={f.sub_stream_url} onChange={(e) => set("sub_stream_url", e.target.value)} /></Field>
        <Field label="스냅샷 주소" full><input value={f.snapshot_url} onChange={(e) => set("snapshot_url", e.target.value)} /></Field>
        <Field label="카메라 계정"><input value={f.username} onChange={(e) => set("username", e.target.value)} /></Field>
        <Field label="새 비밀번호" hint="비워 두면 기존 비밀번호 유지. 바꾸면 녹화가 즉시 재인증합니다."><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} /></Field>
        <Field label="RTSP 전송"><select value={f.rtsp_transport} onChange={(e) => set("rtsp_transport", e.target.value)}><option value="tcp">TCP</option><option value="udp">UDP</option></select></Field>
        <Field label="보관 기간(일)" hint="비우면 기본값"><input type="number" value={f.retention_days} onChange={(e) => set("retention_days", e.target.value)} /></Field>
        <Field label="설치 위치 메모" full><textarea value={f.location_note} onChange={(e) => set("location_note", e.target.value)} /></Field>
        <div className="full"><RecordPolicy value={pol} onChange={setPol} isOnvif={cam.connection_type === "onvif"} hasEvents={cam.capabilities?.events} /></div>
        <label className="check full"><input type="checkbox" checked={f.is_test_source} onChange={(e) => set("is_test_source", e.target.checked)} />시험용 스트림으로 표시</label>
        {isSuper && f.main_stream_url.startsWith("rtsps") && (
          <label className="check full"><input type="checkbox" checked={f.tls_insecure} onChange={(e) => set("tls_insecure", e.target.checked)} />
            RTSPS 인증서 검증 예외(최고관리자 승인, 감사로그 기록) — 사설 인증서 장치에만 사용</label>)}
      </div>
      {err && <Alert kind="err">{err}</Alert>}
      <div className="row" style={{ marginTop: 12 }}><span style={{ flex: 1 }} /><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장</button></div>
    </Modal>
  );
}

function CsvImport({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (dry: boolean) => {
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api("POST", `/api/cameras-csv/import?dry_run=${dry}`, fd);
      setRes(r.results);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="CSV 일괄 등록" onClose={onClose}>
      <p>양식을 내려받아 작성한 뒤 업로드하세요. ONVIF 행은 업로드할 때 카메라에 접속해 스트림 주소를 조회합니다(행마다 수 초).</p>
      <p><a href="/api/cameras-csv/template">양식 내려받기 (camera_import_template.csv)</a></p>
      <Alert>CSV에 카메라 비밀번호가 들어갑니다. 업로드 후 PC에서 파일을 삭제하세요.</Alert>
      <div className="row"><input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button onClick={() => run(true)} disabled={!file || busy}>검증만</button>
        <button className="primary" onClick={() => run(false)} disabled={!file || busy}>{busy ? "처리 중…" : "등록"}</button></div>
      {err && <Alert kind="err">{err}</Alert>}
      {res && (
        <table style={{ marginTop: 12 }}><thead><tr><th>행</th><th>결과</th><th>내용</th></tr></thead>
          <tbody>{res.map((r) => <tr key={r.row}><td>{r.row}</td><td><span className={`badge ${r.ok ? "ok" : "warn"}`}>{r.ok ? "성공" : "실패"}</span></td><td>{r.name ? `${r.name}: ` : ""}{r.message}</td></tr>)}</tbody></table>
      )}
    </Modal>
  );
}
