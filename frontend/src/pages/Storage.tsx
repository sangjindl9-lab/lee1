import { useState } from "react";
import { get, post, put } from "../api";
import { useAuth } from "../auth";
import { fmtBytes, fmtDateTime } from "../format";
import { Alert, Field, errMsg, useData } from "../ui";

export default function Storage() {
  const { isSuper } = useAuth();
  const st = useData(() => get("/api/system/storage"), [], 30000);
  const s = st.data;
  const [cfg, setCfg] = useState<any>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [est, setEst] = useState({ cameras: 8, bitrate_mbps: 4, hours_per_day: 24, retention_days: 30, audio_kbps: 0, overhead_percent: 2, reserve_percent: 15 });
  const [estRes, setEstRes] = useState<any>(null);
  const c = cfg ?? s?.settings;
  const usedPct = s ? Math.round((s.disk.used / s.disk.total) * 100) : 0;
  return (
    <div className="page wide">
      <div className="pagehead"><div><h1>저장장치·보관</h1><p className="muted">아래 사용량은 실측치입니다. 용량 산정기의 결과는 추정치입니다.</p></div></div>
      {st.error && <Alert kind="err">{st.error}</Alert>}
      {s && <div className="grid2">
        <section className="panel">
          <h2>녹화 저장소</h2>
          <p className="num"><b>{fmtBytes(s.disk.free)}</b> 남음 / 전체 {fmtBytes(s.disk.total)} ({s.disk.free_percent}% 여유)</p>
          <div className={`meter${usedPct > 85 ? " hot" : ""}`}><i style={{ width: `${usedPct}%` }} /></div>
          <p className="muted small" style={{ marginTop: 8 }}>경로 {s.disk.path} / 정리 시작 기준 여유 {fmtBytes(s.min_free_bytes)} / 내보내기 파일 {fmtBytes(s.exports_bytes)}</p>
          <table><tbody>
            <tr><th>최근 24시간 실측 기록량</th><td className="num">{fmtBytes(s.measured.bytes_last_24h)} ({s.measured.hours_observed}시간 관측)</td></tr>
            <tr><th>하루 환산</th><td className="num">{fmtBytes(s.measured.bytes_per_day)}</td></tr>
            <tr><th>공간 기준 정리 시작까지</th><td className="num">{s.measured.days_until_cleanup_threshold === null ? "계산 불가(기록 없음)" : `약 ${s.measured.days_until_cleanup_threshold}일`}</td></tr>
          </tbody></table>
          <p className="muted small">{s.measured.note}</p>
        </section>
        <section className="panel">
          <h2>보관 정책</h2>
          <div className="form">
            <Field label="기본 보관 기간(일)"><input type="number" disabled={!isSuper} value={c?.default_retention_days ?? ""} onChange={(e) => setCfg({ ...c, default_retention_days: Number(e.target.value) })} /></Field>
            <Field label="최소 여유 공간(%)"><input type="number" disabled={!isSuper} value={c?.min_free_percent ?? ""} onChange={(e) => setCfg({ ...c, min_free_percent: Number(e.target.value) })} /></Field>
            <Field label="최소 여유 공간(GB)"><input type="number" disabled={!isSuper} value={c?.min_free_gb ?? ""} onChange={(e) => setCfg({ ...c, min_free_gb: Number(e.target.value) })} /></Field>
            <Field label="내보내기 파일 보관(시간)"><input type="number" disabled={!isSuper} value={c?.export_ttl_hours ?? ""} onChange={(e) => setCfg({ ...c, export_ttl_hours: Number(e.target.value) })} /></Field>
          </div>
          <p className="muted small">보관 기간이 지난 녹화와, 여유 공간이 기준보다 적을 때 가장 오래된 녹화부터 삭제합니다. 보호 구간과 녹화 중인 파일은 삭제하지 않습니다. 카메라별 보관 기간은 카메라 수정에서 바꿉니다.</p>
          {isSuper && <button className="primary" onClick={async () => { try { await put("/api/system/settings", c); setMsg({ k: "ok", t: "저장했습니다. 다음 정리 주기(1분 이내)부터 적용됩니다." }); st.reload(); } catch (e) { setMsg({ k: "err", t: errMsg(e) }); } }}>정책 저장</button>}
          {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
        </section>
      </div>}
      {s && <section className="panel tablewrap" style={{ marginTop: 16 }}>
        <h2>카메라별 사용량(실측)</h2>
        <table><thead><tr><th>카메라</th><th>구간 수</th><th>용량</th><th>가장 오래된 녹화</th><th>최근 녹화</th><th>보관</th></tr></thead>
          <tbody>{s.per_camera.map((r: any) => (
            <tr key={r.camera_id}><td>{r.name}{r.deleted && <span className="tag" style={{ marginLeft: 6 }}>삭제된 카메라</span>}</td><td className="num">{r.segments}</td><td className="num">{fmtBytes(r.bytes)}</td>
              <td className="small num">{fmtDateTime(r.first)}</td><td className="small num">{fmtDateTime(r.last)}</td><td className="num">{r.retention_days}일</td></tr>))}
          </tbody></table>
      </section>}
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>저장 용량 산정기(추정)</h2>
        <div className="form">
          {([["cameras", "카메라 수"], ["bitrate_mbps", "평균 영상 비트레이트(Mbps)"], ["hours_per_day", "하루 녹화 시간"], ["retention_days", "보관 기간(일)"], ["audio_kbps", "음성(kbps, 없으면 0)"], ["overhead_percent", "컨테이너 부가정보(%)"], ["reserve_percent", "운영 여유분(%)"]] as const).map(([k, l]) => (
            <Field key={k} label={l}><input type="number" step="any" value={(est as any)[k]} onChange={(e) => setEst({ ...est, [k]: Number(e.target.value) })} /></Field>))}
        </div>
        <button className="primary" style={{ marginTop: 12 }} onClick={async () => setEstRes(await post("/api/system/storage/estimate", est))}>계산</button>
        {estRes && <div style={{ marginTop: 12 }}>
          <p className="num">영상 {fmtBytes(estRes.video_bytes)} + 음성 {fmtBytes(estRes.audio_bytes)} → 부가정보 포함 {fmtBytes(estRes.with_overhead_bytes)}</p>
          <p className="num"><b>권장 디스크 용량 {fmtBytes(estRes.recommended_disk_bytes)}</b> / 입력 대역폭 {estRes.ingest_mbps} Mbps / 권장 지속 쓰기 {estRes.disk_write_mbps_recommended} Mbps 이상</p>
          <p className="muted small">{estRes.note}</p>
        </div>}
      </section>
    </div>
  );
}
