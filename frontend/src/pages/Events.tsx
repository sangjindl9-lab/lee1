import { useState } from "react";
import { Link } from "react-router-dom";
import { get, post, qs } from "../api";
import { fmtDateTime } from "../format";
import { Alert, useData } from "../ui";

export default function Events() {
  const [openOnly, setOpenOnly] = useState(true);
  const evs = useData(() => get(`/api/events?${qs({ open_only: openOnly, limit: 300 })}`), [openOnly], 10000);
  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>이벤트 센터</h1><p className="muted">현재는 서버가 감지한 시스템 이벤트(카메라 연결·녹화·저장공간)만 표시합니다. 카메라 모션·탬퍼링 이벤트와 이메일·웹훅 알림은 2단계입니다.</p></div>
        <span className="spacer" />
        <label className="check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />미확인만</label>
      </div>
      {evs.error && <Alert kind="err">{evs.error}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>발생</th><th>종료</th><th>종류</th><th>카메라</th><th>내용</th><th>출처</th><th /></tr></thead>
          <tbody>{(evs.data?.items ?? []).map((e: any) => (
            <tr key={e.id}>
              <td className="small num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.start)}</td>
              <td className="small num" style={{ whiteSpace: "nowrap" }}>{e.end ? fmtDateTime(e.end) : <b style={{ color: "var(--warn)" }}>진행 중</b>}</td>
              <td><span className={`badge ${e.severity === "critical" ? "rec" : e.severity === "warning" ? "warn" : "ok"}`}>{e.type_label}</span></td>
              <td>{e.camera_name ?? "-"}</td>
              <td>{e.message}{e.note && <div className="muted small">메모: {e.note}</div>}</td>
              <td className="small">{e.source === "system" ? "서버 감지" : e.source === "camera" ? "카메라 제공" : "분석 모듈"}</td>
              <td><div className="row">
                {e.camera_id && <Link className="btn" to={`/playback`}>녹화 보기</Link>}
                {!e.acknowledged_at
                  ? <button onClick={async () => { const note = window.prompt("담당자 메모(선택)") ?? ""; await post(`/api/events/${e.id}/ack`, { note }); evs.reload(); }}>확인</button>
                  : <span className="muted small">확인됨</span>}
              </div></td>
            </tr>))}
          </tbody>
        </table>
        {evs.data?.items?.length === 0 && <div className="empty">표시할 이벤트가 없습니다.</div>}
      </div>
    </div>
  );
}
