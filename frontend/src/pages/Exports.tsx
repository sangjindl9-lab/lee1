import { post, get } from "../api";
import { fmtBytes, fmtDateTime } from "../format";
import { Alert, useData } from "../ui";

export default function Exports() {
  const jobs = useData(() => get("/api/exports"), [], 3000);
  return (
    <div className="page wide">
      <div className="pagehead"><div><h1>내보내기 작업</h1><p className="muted">녹화 검색·재생 화면에서 구간을 지정해 요청합니다. 완료된 파일은 기한이 지나면 자동 삭제됩니다.</p></div></div>
      {jobs.error && <Alert kind="err">{jobs.error}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>번호</th><th>카메라</th><th>요청 구간</th><th>방식</th><th>상태</th><th>결과</th><th /></tr></thead>
          <tbody>{(jobs.data?.items ?? []).map((j: any) => (
            <tr key={j.id}>
              <td className="num">#{j.id}</td>
              <td>{j.camera_name}</td>
              <td className="small num">{fmtDateTime(j.start)}<br />~ {fmtDateTime(j.end)}</td>
              <td className="small">{j.mode === "copy" ? "원본 복사" : "정확(재인코딩)"}{j.watermark && <div className="muted">워터마크</div>}</td>
              <td>
                <span className={`badge ${j.status === "done" ? "ok" : j.status === "failed" ? "warn" : j.status === "running" ? "rec" : "off"}`}>{j.status_label}</span>
                {j.status === "running" && <div className="meter" style={{ marginTop: 6, width: 120 }}><i style={{ width: `${j.progress}%` }} /></div>}
                {j.status === "running" && <div className="small num muted">{j.progress}%</div>}
              </td>
              <td className="small" style={{ maxWidth: 380 }}>
                {j.error && <div style={{ color: "var(--warn)" }}>{j.error}</div>}
                {j.status === "done" && <>
                  <div className="num">{fmtBytes(j.size_bytes)} / 실제 {fmtDateTime(j.actual_start)} ~ {fmtDateTime(j.actual_end).slice(-8)}</div>
                  <div className="muted">SHA-256 {j.sha256.slice(0, 16)}…</div>
                  <div className="muted">다운로드 기한 {fmtDateTime(j.expires_at)}</div>
                </>}
                {j.note && <div className="muted">{j.note}</div>}
              </td>
              <td>
                {j.status === "done" && <a className="btn primary" href={`/api/exports/${j.id}/download`}>다운로드</a>}
                {(j.status === "queued" || j.status === "running") && !j.cancel_requested && <button onClick={async () => { await post(`/api/exports/${j.id}/cancel`); jobs.reload(); }}>취소</button>}
              </td>
            </tr>))}
          </tbody>
        </table>
        {jobs.data?.items?.length === 0 && <div className="empty">내보내기 요청이 없습니다.</div>}
      </div>
    </div>
  );
}
