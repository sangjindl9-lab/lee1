import { useState } from "react";
import { get, patch, post } from "../api";
import { fmtDateTime } from "../format";
import { Alert, Field, Modal, errMsg, useData } from "../ui";

export default function Users() {
  const users = useData(() => get("/api/users"), []);
  const cams = useData(() => get("/api/cameras"), []);
  const sites = useData(() => get("/api/sites"), []);
  const [edit, setEdit] = useState<any>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const roles = users.data?.roles ?? {};
  const perms = users.data?.permissions ?? {};
  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>사용자·권한</h1><p className="muted">역할로 기본 권한을 정하고, 사용자별로 권한을 더하거나 뺄 수 있습니다. 최고관리자 외에는 지정한 현장만 볼 수 있습니다.</p></div>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ role: "viewer", site_ids: [], permissions_override: {} })}>사용자 추가</button>
      </div>
      {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
      {users.error && <Alert kind="err">{users.error}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>사용자</th><th>역할</th><th>현장</th><th>적용 권한</th><th>최근 로그인</th><th /></tr></thead>
          <tbody>{(users.data?.items ?? []).map((u: any) => (
            <tr key={u.id}>
              <td><b>{u.username}</b> {!u.is_active && <span className="tag">비활성</span>}<div className="muted small">{u.display_name}</div></td>
              <td>{u.role_label}</td>
              <td className="small">{u.camera_ids?.length ? <div className="muted">카메라 {u.camera_ids.length}대로 제한</div> : null}{u.role === "superadmin" ? "전체" : (sites.data?.items ?? []).filter((s: any) => u.site_ids.includes(s.id)).map((s: any) => s.name).join(", ") || <span style={{ color: "var(--warn)" }}>지정 없음</span>}</td>
              <td className="small">{u.effective_permissions.map((p: string) => perms[p]).join(", ")}</td>
              <td className="small">{fmtDateTime(u.last_login_at)}</td>
              <td><div className="row" style={{ justifyContent: "flex-end" }}>
                <button onClick={() => setEdit(u)}>수정</button>
                <button onClick={async () => { try { const r = await post(`/api/users/${u.id}/revoke-sessions`); setMsg({ k: "ok", t: `${u.username}: 로그인 ${r.revoked}건을 종료했습니다. 이미 열린 실시간 영상은 최대 토큰 만료(10분)까지 이어질 수 있습니다.` }); } catch (e) { setMsg({ k: "err", t: errMsg(e) }); } }}>강제 로그아웃</button>
              </div></td>
            </tr>))}
          </tbody>
        </table>
      </div>
      {edit && <UserForm user={edit} roles={roles} perms={perms} sites={sites.data?.items ?? []} cameras={cams.data?.items ?? []} onClose={() => { setEdit(null); users.reload(); }} />}
    </div>
  );
}

function UserForm({ user, roles, perms, sites, cameras, onClose }: { user: any; roles: Record<string, string>; perms: Record<string, string>; sites: any[]; cameras: any[]; onClose: () => void }) {
  const [camIds, setCamIds] = useState<number[]>(user.camera_ids ?? []);
  const [f, setF] = useState({ username: user.username ?? "", display_name: user.display_name ?? "", role: user.role, password: "", site_ids: user.site_ids ?? [], override: user.permissions_override ?? {}, is_active: user.is_active ?? true });
  const [err, setErr] = useState("");
  const toggleSite = (id: number) => setF({ ...f, site_ids: f.site_ids.includes(id) ? f.site_ids.filter((x: number) => x !== id) : [...f.site_ids, id] });
  const setOv = (k: string, v: string) => {
    const o = { ...f.override };
    if (v === "") delete o[k];
    else o[k] = v === "1";
    setF({ ...f, override: o });
  };
  const save = async () => {
    try {
      if (user.id) await patch(`/api/users/${user.id}`, { display_name: f.display_name, role: f.role, site_ids: f.site_ids, camera_ids: camIds, permissions_override: f.override, is_active: f.is_active, ...(f.password ? { new_password: f.password } : {}) });
      else await post("/api/users", { username: f.username, display_name: f.display_name, role: f.role, password: f.password, site_ids: f.site_ids, camera_ids: camIds, permissions_override: f.override });
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Modal title={user.id ? `사용자 수정: ${user.username}` : "사용자 추가"} onClose={onClose}>
      <div className="form">
        <Field label="사용자 ID"><input value={f.username} disabled={!!user.id} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="이름"><input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></Field>
        <Field label="역할"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label={user.id ? "비밀번호 재설정(선택)" : "초기 비밀번호"} hint="사용자는 첫 로그인 때 변경해야 합니다."><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        {user.id && <label className="check"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} />계정 사용</label>}
      </div>
      {f.role !== "superadmin" && <>
        <h3 style={{ marginTop: 16 }}>접근 현장</h3>
        <div className="row">{sites.map((s) => <label key={s.id} className="check"><input type="checkbox" checked={f.site_ids.includes(s.id)} onChange={() => toggleSite(s.id)} />{s.name}</label>)}</div>
        <h3 style={{ marginTop: 16 }}>볼 수 있는 카메라</h3>
        <p className="muted small">아무것도 고르지 않으면 접근 현장의 모든 카메라를 볼 수 있습니다. 고르면 그 카메라만 볼 수 있습니다(실시간·녹화·다운로드·PTZ 모두 적용).</p>
        <div className="row">{cameras.filter((c) => f.site_ids.includes(c.site_id)).map((c) => (
          <label key={c.id} className="check"><input type="checkbox" checked={camIds.includes(c.id)}
            onChange={(e) => setCamIds(e.target.checked ? [...camIds, c.id] : camIds.filter((x) => x !== c.id))} />{c.name}</label>))}
        </div>
        <h3 style={{ marginTop: 16 }}>권한 조정</h3>
        <div className="form">{Object.entries(perms).map(([k, v]) => (
          <Field key={k} label={v}><select value={k in f.override ? (f.override[k] ? "1" : "0") : ""} onChange={(e) => setOv(k, e.target.value)}>
            <option value="">역할 기본값</option><option value="1">허용</option><option value="0">금지</option></select></Field>))}
        </div>
        <p className="muted small">음성 권한이 없으면 실시간 화면에 소리 듣기 버튼이 나타나지 않고 WebRTC 음성 트랙을 요청하지 않습니다.</p>
      </>}
      {err && <Alert kind="err">{err}</Alert>}
      <div className="row" style={{ marginTop: 12 }}><span style={{ flex: 1 }} /><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장</button></div>
    </Modal>
  );
}
