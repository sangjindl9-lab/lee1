import { useState } from "react";
import { get, qs } from "../api";
import { fmtDateTime } from "../format";
import { Alert, useData } from "../ui";

const ACTIONS: Record<string, string> = {
  "": "전체", "auth.": "로그인·로그아웃", "live.": "실시간 시청", "recording.": "녹화 재생·제어·삭제", "export.": "내보내기·다운로드",
  "camera.": "카메라 설정", "site.": "현장 설정", "user.": "사용자 관리", "access.denied": "권한 거부", "settings.": "시스템 설정",
};

export default function Audit() {
  const [action, setAction] = useState("");
  const [username, setUsername] = useState("");
  const logs = useData(() => get(`/api/audit?${qs({ action, username, limit: 300 })}`), [action, username]);
  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>감사로그</h1><p className="muted">누가 언제 무엇을 했는지와 결과를 기록합니다. 비밀번호는 기록하지 않습니다.</p></div>
        <span className="spacer" />
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="동작">{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input placeholder="사용자 ID" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="사용자 ID" />
      </div>
      {logs.error && <Alert kind="err">{logs.error}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>시각</th><th>사용자</th><th>IP</th><th>동작</th><th>대상</th><th>결과</th><th>내용</th></tr></thead>
          <tbody>{(logs.data?.items ?? []).map((a: any) => (
            <tr key={a.id}>
              <td className="small num" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.at)}</td>
              <td>{a.username}</td><td className="small num">{a.ip}</td><td className="small">{a.action}</td>
              <td className="small">{a.target_type}{a.target_id ? ` #${a.target_id}` : ""}</td>
              <td><span className={`badge ${a.result === "ok" ? "ok" : "warn"}`}>{a.result === "ok" ? "성공" : a.result === "denied" ? "거부" : "실패"}</span></td>
              <td className="small muted" style={{ maxWidth: 420, wordBreak: "break-all" }}>{Object.keys(a.details || {}).length ? JSON.stringify(a.details) : ""}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
