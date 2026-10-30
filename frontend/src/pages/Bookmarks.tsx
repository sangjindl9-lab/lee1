import { useState } from "react";
import { Link } from "react-router-dom";
import { del, get, qs } from "../api";
import { fmtDateTime } from "../format";
import { Alert, errMsg, useData } from "../ui";

export default function Bookmarks() {
  const [q, setQ] = useState("");
  const [camera, setCamera] = useState("");
  const [msg, setMsg] = useState("");
  const cams = useData(() => get("/api/cameras?include_deleted=true"), []);
  const bms = useData(() => get(`/api/bookmarks?${qs({ q, camera_id: camera })}`), [q, camera]);
  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>북마크·메모</h1><p className="muted">녹화 재생 화면에서 “북마크”로 남긴 지점을 제목·메모로 찾습니다.</p></div>
        <span className="spacer" />
        <select value={camera} onChange={(e) => setCamera(e.target.value)} aria-label="카메라">
          <option value="">전체 카메라</option>
          {(cams.data?.items ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input placeholder="제목·메모 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="검색어" />
      </div>
      {(bms.error || msg) && <Alert kind="err">{bms.error || msg}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>시각</th><th>카메라</th><th>제목</th><th>메모</th><th>작성</th><th /></tr></thead>
          <tbody>{(bms.data?.items ?? []).map((b: any) => (
            <tr key={b.id}>
              <td className="small num">{fmtDateTime(b.at)}</td><td>{b.camera_name}</td><td><b>{b.title}</b></td>
              <td className="small">{b.note}</td><td className="small muted">{b.user}</td>
              <td><div className="row">
                <Link className="btn" to={`/playback?${qs({ camera: b.camera_id, at: b.at })}`}>영상 보기</Link>
                <button className="danger" onClick={async () => { if (!window.confirm("북마크를 삭제할까요?")) return; try { await del(`/api/bookmarks/${b.id}`); bms.reload(); } catch (e) { setMsg(errMsg(e)); } }}>삭제</button>
              </div></td>
            </tr>))}
          </tbody>
        </table>
        {bms.data?.items?.length === 0 && <div className="empty">북마크가 없습니다.</div>}
      </div>
    </div>
  );
}
