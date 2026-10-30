import { Fragment, useState } from "react";
import { del, get, post } from "../api";
import { ago, fmtBytes } from "../format";
import { Alert, Field, Modal, errMsg, useData } from "../ui";

export default function Edges() {
  const edges = useData(() => get("/api/edges"), [], 15000);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>현장 서버 통합(Edge)</h1>
          <p className="muted">각 현장에 설치한 NVR 이 이 서버로 상태를 보고합니다(현장 → 중앙 방향만 연결, 현장 방화벽 개방 불필요). 녹화는 각 현장 서버가 하며,
            보고가 끊겨도 현장 녹화가 멈췄다고 단정하지 않습니다. 영상 보기는 각 현장 서버 주소로 이동합니다.</p></div>
        <span className="spacer" />
        <button className="primary" onClick={() => setAdding(true)}>현장 서버 등록</button>
      </div>
      {msg && <Alert kind="err">{msg}</Alert>}
      {created && <Alert kind="info">
        <b>{created.name}</b> 등록 토큰(지금 한 번만 표시): <code style={{ wordBreak: "break-all" }}>{created.token}</code>
        <div className="small">현장 서버의 <code>secrets/central.token</code> 파일에 저장하고, 현장 .env 에 <code>NVR_CENTRAL_URL=https://(이 서버 주소)</code>,
          <code>NVR_CENTRAL_TOKEN_FILE=/run/secrets/central_token</code> 를 넣은 뒤 재시작하세요(설치운영 설명서 8장).</div>
      </Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>현장 서버</th><th>상태</th><th>카메라</th><th>저장공간</th><th>버전</th><th /></tr></thead>
          <tbody>{(edges.data?.items ?? []).map((e: any) => (
            <Fragment key={e.id}>
              <tr>
                <td><b>{e.name}</b><div className="muted small">{e.url}</div></td>
                <td><span className={`badge ${e.online ? "ok" : "warn"}`}>{e.online ? "보고 중" : "연결 끊김"}</span>
                  <div className="muted small">마지막 보고 {ago(e.last_seen_at)} {e.last_ip}</div></td>
                <td className="num">{e.camera_recording}/{e.camera_total} 녹화 중{e.camera_problem > 0 && <div style={{ color: "var(--warn)" }}>문제 {e.camera_problem}대</div>}</td>
                <td className="num small">{e.disk?.free ? `${fmtBytes(e.disk.free)} 남음` : "-"}</td>
                <td className="small">{e.version ?? "-"}</td>
                <td><div className="row">
                  <button onClick={() => setOpen(open === e.id ? null : e.id)}>{open === e.id ? "접기" : "카메라 보기"}</button>
                  {e.url && <a className="btn" href={e.url} target="_blank" rel="noopener noreferrer">현장 화면 열기</a>}
                  <button className="danger" onClick={async () => { if (!window.confirm("등록을 삭제하면 이 현장 서버의 보고를 받지 않습니다.")) return; try { await del(`/api/edges/${e.id}`); edges.reload(); } catch (x) { setMsg(errMsg(x)); } }}>삭제</button>
                </div></td>
              </tr>
              {open === e.id && (
                <tr><td colSpan={6}>
                  <table><tbody>{e.cameras.map((c: any) => (
                    <tr key={c.id}><td>{c.name}{c.is_test_source && <span className="tag test" style={{ marginLeft: 6 }}>시험</span>}</td><td className="small">{c.site}</td>
                      <td><span className={`badge ${c.state === "recording" ? "rec" : c.state === "retry_wait" ? "warn" : "off"}`}>{c.state}</span> <span className="small muted">{c.error_code}</span></td>
                      <td className="small muted">마지막 녹화 {ago(c.last_segment_at)}</td></tr>))}</tbody></table>
                </td></tr>
              )}
            </Fragment>))}
          </tbody>
        </table>
        {edges.data?.items?.length === 0 && <div className="empty">등록된 현장 서버가 없습니다. 이 서버를 중앙으로 쓰려면 현장 서버를 등록하세요.</div>}
      </div>
      {adding && <EdgeForm onClose={(r) => { setAdding(false); if (r) setCreated(r); edges.reload(); }} />}
    </div>
  );
}

function EdgeForm({ onClose }: { onClose: (r?: any) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  return (
    <Modal title="현장 서버 등록" onClose={() => onClose()}>
      <div className="form">
        <Field label="이름"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: ○○현장 미니PC" /></Field>
        <Field label="현장 화면 주소(선택)" hint="VPN 등으로 접속 가능한 경우"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://10.8.0.5" /></Field>
      </div>
      {err && <Alert kind="err">{err}</Alert>}
      <div className="row" style={{ marginTop: 12 }}><span style={{ flex: 1 }} /><button onClick={() => onClose()}>취소</button>
        <button className="primary" disabled={!name.trim()} onClick={async () => { try { onClose(await post("/api/edges", { name, url })); } catch (e) { setErr(errMsg(e)); } }}>등록하고 토큰 받기</button></div>
    </Modal>
  );
}
