import { get } from "../api";
import { useData } from "../ui";

const STATUS: Record<string, [string, string]> = {
  real: ["실장비 검증", "ok"], test: ["테스트 환경 검증", "warn"], unverified: ["미검증", "off"], unsupported: ["미지원(미구현)", "off"],
};

export default function Drivers() {
  const d = useData(() => get("/api/drivers"), []);
  return (
    <div className="page wide">
      <div className="pagehead"><div><h1>지원 장비·드라이버</h1>
        <p className="muted">모든 제조사·모델을 지원하지 않습니다. 표준 ONVIF·RTSP를 우선 사용하며, 제조사 전용 기능은 공식 문서를 확보한 뒤 단계적으로 추가합니다.</p></div></div>
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>제조사 / 드라이버</th><th>프로토콜</th><th>코덱</th><th>인증</th><th>기능</th><th>공식 문서(확인일)</th><th>검증 상태</th></tr></thead>
          <tbody>{(d.data?.items ?? []).map((x: any) => (
            <tr key={x.id}>
              <td><b>{x.vendor}</b><div className="muted small">{x.name}</div><div className="small">{x.models}</div></td>
              <td className="small">{x.protocols.join(", ")}</td>
              <td className="small">{x.codecs.join(", ") || "-"}</td>
              <td className="small">{x.auth_methods.join(", ")}</td>
              <td className="small">{[["live_view", "라이브"], ["ptz", "PTZ"], ["audio", "음성"], ["events", "이벤트"], ["device_recording", "장치 녹화"]].map(([k, l]) => `${l} ${x.features?.[k] ? "○" : "×"}`).join(" / ")}</td>
              <td className="small"><a href={x.doc_url} target="_blank" rel="noreferrer noopener">{x.doc_url}</a><div className="muted">{x.doc_checked_at} / {x.doc_access}</div></td>
              <td><span className={`badge ${STATUS[x.verification_status]?.[1] ?? ""}`}>{STATUS[x.verification_status]?.[0] ?? x.verification_status}</span><div className="muted small" style={{ maxWidth: 280 }}>{x.notes}</div></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>ONVIF 연동 구현은 ONVIF 공식 적합성(Conformance) 인증과 다릅니다. 확인되지 않은 제조사 RTSP 경로·API 주소는 제공하지 않습니다.</p>
    </div>
  );
}
