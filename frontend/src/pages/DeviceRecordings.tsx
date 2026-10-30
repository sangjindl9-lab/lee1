import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { get } from "../api";
import { fmtDateTime } from "../format";
import { Alert, errMsg, useData } from "../ui";

/** ONVIF Profile G: 카메라 자체(SD카드 등)에 저장된 녹화 목록 조회. */
export default function DeviceRecordings() {
  const [params] = useSearchParams();
  const cams = useData(() => get("/api/cameras"), []);
  const [cam, setCam] = useState<string>(params.get("camera") ?? "");
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const list = (cams.data?.items ?? []).filter((c: any) => c.connection_type === "onvif");
  const search = async () => {
    setBusy(true);
    setErr("");
    try {
      setRes(await get(`/api/cameras/${cam}/device-recordings`));
    } catch (e) {
      setErr(errMsg(e));
      setRes(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page wide">
      <div className="pagehead"><div><h1>카메라 저장영상 검색(Profile G)</h1>
        <p className="muted">NVR 이 꺼져 있던 동안 카메라가 SD카드 등에 따로 저장한 녹화가 있는지 확인합니다. 지금은 목록·재생 주소 조회까지 지원하며, NVR 로 가져오기(회수)는 아직 지원하지 않습니다.</p></div></div>
      <div className="row">
        <select value={cam} onChange={(e) => setCam(e.target.value)} aria-label="카메라">
          <option value="">ONVIF 카메라 선택</option>
          {list.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.capabilities?.recording_profile_g ? "" : " (Profile G 미확인)"}</option>)}
        </select>
        <button className="primary" disabled={!cam || busy} onClick={search}>{busy ? "조회 중…" : "조회"}</button>
      </div>
      {err && <Alert kind="err">{err}</Alert>}
      {res && (
        <div className="panel tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>녹화</th><th>기간</th><th>상태</th><th>재생 주소(인증정보 제외)</th></tr></thead>
            <tbody>{res.items.map((r: any) => (
              <tr key={r.token}><td><b>{r.source || r.token}</b><div className="muted small">{r.token} / {r.content}</div></td>
                <td className="small num">{fmtDateTime(r.earliest)} ~ {fmtDateTime(r.latest)}</td><td className="small">{r.status}</td>
                <td className="small" style={{ wordBreak: "break-all" }}>{r.replay_uri || r.replay_error || "-"}</td></tr>))}
            </tbody>
          </table>
          {res.items.length === 0 && <div className="empty">카메라에 저장된 녹화가 없습니다.</div>}
          <p className="muted small">{res.note}</p>
        </div>
      )}
    </div>
  );
}
