import { useState } from "react";
import { del, get, patch, post } from "../api";
import { useAuth } from "../auth";
import { Alert, Field, Modal, errMsg, useData } from "../ui";

export default function Sites() {
  const { isSuper, can } = useAuth();
  const sites = useData(() => get("/api/sites"), []);
  const [edit, setEdit] = useState<any>(null);
  const [msg, setMsg] = useState("");
  return (
    <div className="page">
      <div className="pagehead">
        <div><h1>현장 관리</h1><p className="muted">허용 네트워크는 이 현장에서 NVR이 접속할 수 있는 카메라 주소 범위입니다. 범위 밖 주소로는 연결하지 않습니다.</p></div>
        <span className="spacer" />
        {isSuper && <button className="primary" onClick={() => setEdit({ name: "", code: "", timezone: "Asia/Seoul", allowed_networks: [], description: "" })}>현장 추가</button>}
      </div>
      {msg && <Alert kind="err">{msg}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>현장</th><th>코드</th><th>시간대</th><th>허용 네트워크</th><th>카메라</th><th /></tr></thead>
          <tbody>{(sites.data?.items ?? []).map((s: any) => (
            <tr key={s.id}>
              <td><b>{s.name}</b><div className="muted small">{s.description}</div></td>
              <td>{s.code}</td><td>{s.timezone}</td>
              <td className="num small">{s.allowed_networks.join(", ") || <span style={{ color: "var(--warn)" }}>없음 — 카메라 연결 불가</span>}</td>
              <td className="num">{s.camera_count}</td>
              <td>{can("settings") && <div className="row" style={{ justifyContent: "flex-end" }}>
                <button onClick={() => setEdit(s)}>수정</button>
                {isSuper && <button className="danger" onClick={async () => { if (!window.confirm(`“${s.name}” 현장을 삭제할까요?`)) return; try { await del(`/api/sites/${s.id}`); sites.reload(); } catch (e) { setMsg(errMsg(e)); } }}>삭제</button>}
              </div>}</td>
            </tr>))}
          </tbody>
        </table>
        {sites.data?.items?.length === 0 && <div className="empty">현장을 먼저 추가하세요. 카메라는 현장 단위로 등록합니다.</div>}
      </div>
      <div className="panel">
        <h2>여러 현장 통합(3단계 예정)</h2>
        <p className="muted">현재 버전은 이 서버가 직접 접근할 수 있는 현장망의 카메라만 연결합니다. 다른 현장의 사설망 카메라는 현장별 Edge Agent 또는 VPN 연결이 필요하며 3단계에서 제공합니다.</p>
      </div>
      {edit && <SiteForm site={edit} onClose={() => { setEdit(null); sites.reload(); }} />}
    </div>
  );
}

function SiteForm({ site, onClose }: { site: any; onClose: () => void }) {
  const { isSuper } = useAuth();
  const [f, setF] = useState({ ...site, nets: (site.allowed_networks ?? []).join("\n") });
  const [err, setErr] = useState("");
  const save = async () => {
    const nets = f.nets.split(/[\s,]+/).map((x: string) => x.trim()).filter(Boolean);
    try {
      if (site.id) await patch(`/api/sites/${site.id}`, { name: f.name, timezone: f.timezone, description: f.description, ...(isSuper ? { allowed_networks: nets } : {}) });
      else await post("/api/sites", { name: f.name, code: f.code, timezone: f.timezone, description: f.description, allowed_networks: nets });
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Modal title={site.id ? "현장 수정" : "현장 추가"} onClose={onClose}>
      <div className="form">
        <Field label="현장 이름"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="현장 코드" hint="영문·숫자, CSV 일괄 등록에 사용"><input value={f.code} disabled={!!site.id} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field label="시간대"><input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        <Field label="허용 네트워크(CIDR)" hint="한 줄에 하나. 예: 192.168.10.0/24 — 최고관리자만 변경" full>
          <textarea value={f.nets} disabled={!isSuper} onChange={(e) => setF({ ...f, nets: e.target.value })} placeholder={"192.168.10.0/24\n10.20.0.0/16"} /></Field>
        <Field label="설명" full><textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      </div>
      <p className="muted small">루프백·링크로컬(169.254.x.x)·멀티캐스트 대역과 NVR 내부 망은 허용할 수 없습니다.</p>
      {err && <Alert kind="err">{err}</Alert>}
      <div className="row"><span style={{ flex: 1 }} /><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장</button></div>
    </Modal>
  );
}
