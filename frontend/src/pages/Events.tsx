import { useState } from "react";
import { Link } from "react-router-dom";
import { get, post, qs } from "../api";
import { fmtDateTime, todayIn, zonedToDate } from "../format";
import { Alert, useData } from "../ui";

const TYPES: Record<string, string> = {
  "": "전체 종류", motion: "모션 감지", tamper: "가림·훼손", input: "알람 입력", analytics: "분석 이벤트", manual: "수동 이벤트",
  camera_offline: "카메라 연결 끊김", camera_online: "카메라 연결 복구", storage_low: "저장공간 부족", storage_full: "저장공간 확보 불가",
  disk_write_error: "디스크 쓰기 실패", event_subscription: "이벤트 구독 실패", edge_offline: "현장 서버 연결 끊김",
};
const SOURCES: Record<string, string> = { "": "전체 출처", camera: "카메라 제공", system: "서버 감지", analytics: "분석 모듈" };

export default function Events() {
  const [openOnly, setOpenOnly] = useState(false);
  const [type, setType] = useState("");
  const [source, setSource] = useState("");
  const [camera, setCamera] = useState("");
  const [q, setQ] = useState("");
  const [day, setDay] = useState("");
  const cams = useData(() => get("/api/cameras?include_deleted=true"), []);
  const range = day ? { start: zonedToDate(day, "00:00:00").toISOString(), end: zonedToDate(day, "23:59:59").toISOString() } : {};
  const evs = useData(() => get(`/api/events/search?${qs({ open_only: openOnly, type, source, camera_id: camera, q, limit: 300, ...range })}`),
    [openOnly, type, source, camera, q, day], 10000);
  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>이벤트 센터</h1>
          <p className="muted">카메라가 보낸 이벤트(모션·가림·알람 입력), 서버가 감지한 장애, 외부 분석 모듈 이벤트를 출처별로 구분해 보여줍니다. 이 NVR 에는 자체 AI 분석 기능이 없습니다.</p></div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="종류">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="출처">{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={camera} onChange={(e) => setCamera(e.target.value)} aria-label="카메라">
          <option value="">전체 카메라</option>
          {(cams.data?.items ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={day} max={todayIn()} onChange={(e) => setDay(e.target.value)} aria-label="날짜" />
        <input placeholder="내용·메모 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색어" />
        <label className="check"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />미확인만</label>
      </div>
      {evs.data?.last24h && (
        <p className="muted small">최근 24시간: {Object.entries(evs.data.last24h).map(([k, n]) => `${TYPES[k] ?? k} ${n}건`).join(", ") || "없음"}</p>
      )}
      {evs.error && <Alert kind="err">{evs.error}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>발생</th><th>종료</th><th>종류</th><th>카메라</th><th>내용</th><th>출처</th><th /></tr></thead>
          <tbody>{(evs.data?.items ?? []).map((e: any) => (
            <tr key={e.id}>
              <td className="small num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.start)}</td>
              <td className="small num" style={{ whiteSpace: "nowrap" }}>{e.end ? (new Date(e.end) > new Date() ? <span className="muted">{fmtDateTime(e.end)} 예정</span> : fmtDateTime(e.end)) : <b style={{ color: "var(--warn)" }}>진행 중</b>}</td>
              <td><span className={`badge ${e.severity === "critical" ? "rec" : e.severity === "warning" ? "warn" : "ok"}`}>{e.type_label}</span>
                {e.triggers_recording && <div className="small muted">녹화 트리거</div>}</td>
              <td>{e.camera_name ?? "-"}</td>
              <td>{e.message}{e.note && <div className="muted small">메모: {e.note}{e.acknowledged_by ? ` (${e.acknowledged_by})` : ""}</div>}</td>
              <td className="small">{SOURCES[e.source] ?? e.source}</td>
              <td><div className="row">
                {e.camera_id && <Link className="btn" to={`/playback?${qs({ camera: e.camera_id, at: e.start })}`}>영상 보기</Link>}
                {!e.acknowledged_at
                  ? <button onClick={async () => { const note = window.prompt("담당자 메모(선택)") ?? ""; await post(`/api/events/${e.id}/ack`, { note }); evs.reload(); }}>확인</button>
                  : <span className="muted small">확인됨</span>}
              </div></td>
            </tr>))}
          </tbody>
        </table>
        {evs.data?.items?.length === 0 && <div className="empty">조건에 맞는 이벤트가 없습니다.</div>}
      </div>
    </div>
  );
}
