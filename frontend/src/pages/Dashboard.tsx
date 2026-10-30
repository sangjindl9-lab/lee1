import { Link } from "react-router-dom";
import { get } from "../api";
import { useAuth } from "../auth";
import { ago, fmtBytes, fmtDateTime } from "../format";
import { Alert, StatusBadge, useData } from "../ui";

export default function Dashboard() {
  const { can } = useAuth();
  const st = useData(() => get("/api/system/status"), [], 10000);
  const cams = useData(() => get("/api/cameras"), [], 10000);
  const evs = useData(() => (can("live_view") ? get("/api/events?limit=8") : Promise.resolve({ items: [] })), [], 15000);
  const s = st.data;
  const problems = (cams.data?.items ?? []).filter((c: any) => c.enabled && c.status.state !== "recording" && c.record_mode !== "off");
  const d = s?.disk;
  const usedPct = d && d.total ? Math.round((d.used / d.total) * 100) : 0;
  return (
    <div className="page">
      <div className="pagehead"><div><h1>운영 대시보드</h1><p className="muted">녹화는 서버에서 계속되며, 이 화면을 닫아도 멈추지 않습니다.</p></div></div>
      {st.error && <Alert kind="err">{st.error}</Alert>}
      {s && (
        <div className="kpis">
          <div className="kpi"><b>{s.cameras.recording}<span className="muted small"> / {s.cameras.enabled}</span></b><span>녹화 중 / 사용 카메라</span></div>
          <div className="kpi"><b style={{ color: s.cameras.problem ? "var(--warn)" : undefined }}>{s.cameras.problem}</b><span>연결 문제</span></div>
          <div className="kpi"><b>{s.cameras.record_off}</b><span>녹화 꺼짐</span></div>
          <div className="kpi"><b>{s.open_events}</b><span>미확인 이벤트</span></div>
          {d && !d.error && (
            <div className="kpi">
              <b>{fmtBytes(d.free)}</b><span>남은 저장공간 ({d.free_percent}%)</span>
              <div className={`meter${usedPct > 85 ? " hot" : ""}`} style={{ marginTop: 6 }}><i style={{ width: `${usedPct}%` }} /></div>
            </div>
          )}
        </div>
      )}
      {s?.cameras.test_sources > 0 && (
        <Alert kind="info">시험용 합성 스트림으로 등록된 카메라가 {s.cameras.test_sources}대 있습니다. 실제 현장 영상이 아닙니다.</Alert>
      )}
      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>확인이 필요한 카메라</h2>
          {problems.length === 0 ? <p className="muted">모든 녹화 대상 카메라가 정상 녹화 중입니다.</p> : (
            <table><tbody>
              {problems.map((c: any) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b><div className="muted small">{c.site_name}</div></td>
                  <td><StatusBadge status={c.status} /><div className="small muted" style={{ maxWidth: 360 }}>{c.status.error_message}</div></td>
                  <td className="small muted">마지막 녹화<br />{ago(c.status.last_segment_at)}</td>
                </tr>
              ))}
            </tbody></table>
          )}
          {(cams.data?.items ?? []).length === 0 && <p><Link to="/cameras" className="btn primary">첫 카메라 등록하기</Link></p>}
        </section>
        <section className="panel">
          <h2>서비스 상태</h2>
          <table><tbody>
            {(s?.services ?? []).map((x: any) => (
              <tr key={x.name}>
                <td><b>{x.name === "recorder" ? "녹화 서비스" : x.name === "worker" ? "작업 서비스" : x.name}</b></td>
                <td><span className={`badge ${x.alive ? "ok" : "warn"}`}>{x.alive ? "정상" : `응답 없음 (${x.age_seconds}초)`}</span></td>
                <td className="small muted">시작 {fmtDateTime(x.started_at)}</td>
              </tr>
            ))}
            {s && s.services.length === 0 && <tr><td className="muted">녹화·작업 서비스가 아직 시작되지 않았습니다.</td></tr>}
          </tbody></table>
          <p className="muted small" style={{ marginTop: 10 }}>버전 {s?.version}</p>
        </section>
      </div>
      {can("live_view") && (
        <section className="panel" style={{ marginTop: 16 }}>
          <div className="row"><h2 style={{ flex: 1 }}>최근 이벤트</h2><Link to="/events">전체 보기</Link></div>
          <table><tbody>
            {(evs.data?.items ?? []).map((e: any) => (
              <tr key={e.id}>
                <td className="small num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.start)}</td>
                <td><span className={`badge ${e.severity === "critical" ? "rec" : e.severity === "warning" ? "warn" : "ok"}`}>{e.type_label}</span></td>
                <td>{e.message}</td>
              </tr>
            ))}
          </tbody></table>
        </section>
      )}
    </div>
  );
}
