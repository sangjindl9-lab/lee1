import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { Alert, errMsg } from "../ui";

export default function Login() {
  const { login } = useAuth();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(u, p);
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="box panel stack" onSubmit={submit}>
        <div>
          <h1>현장 영상관제</h1>
          <p className="muted">카메라 실시간 감시와 녹화 영상 조회</p>
        </div>
        <label className="field"><span>사용자 ID</span>
          <input autoFocus autoComplete="username" value={u} onChange={(e) => setU(e.target.value)} required /></label>
        <label className="field"><span>비밀번호</span>
          <input type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} required /></label>
        {err && <Alert kind="err">{err}</Alert>}
        <button className="primary" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>{busy ? "확인 중…" : "로그인"}</button>
        <p className="muted small">초기 관리자 계정은 설치 설명서의 “초기 관리자 생성” 절차로 만듭니다.</p>
      </form>
    </div>
  );
}
