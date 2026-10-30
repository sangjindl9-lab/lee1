import { useState, type FormEvent } from "react";
import { post } from "../api";
import { useAuth } from "../auth";
import { Alert, errMsg } from "../ui";

export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { refresh, logout, me } = useAuth();
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [msg, setMsg] = useState<{ k: "err" | "ok"; t: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (n1 !== n2) return setMsg({ k: "err", t: "새 비밀번호가 서로 다릅니다." });
    try {
      await post("/api/auth/change-password", { current_password: cur, new_password: n1 });
      setMsg({ k: "ok", t: "비밀번호를 변경했습니다. 다른 기기의 로그인은 종료되었습니다." });
      setCur(""); setN1(""); setN2("");
      await refresh();
    } catch (ex) {
      setMsg({ k: "err", t: errMsg(ex) });
    }
  };
  const form = (
    <form className="panel stack" onSubmit={submit} style={{ maxWidth: 420 }}>
      {forced && <Alert kind="info">처음 로그인했거나 관리자가 비밀번호를 재설정했습니다. 계속하려면 비밀번호를 바꾸세요.</Alert>}
      <label className="field"><span>현재 비밀번호</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
      <label className="field"><span>새 비밀번호</span><input type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} required />
        <small>10자 이상, 영문 대·소문자·숫자·특수문자 중 3종류 이상</small></label>
      <label className="field"><span>새 비밀번호 확인</span><input type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} required /></label>
      {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
      <div className="row"><button className="primary">비밀번호 변경</button>{forced && <button type="button" onClick={logout}>로그아웃</button>}</div>
    </form>
  );
  if (forced) return <div className="login"><div className="box"><h1>비밀번호 변경</h1><p className="muted">{me?.username}</p>{form}</div></div>;
  return (
    <div className="page">
      <div className="pagehead"><div><h1>내 계정</h1><p className="muted">{me?.username} ({me?.role_label})</p></div></div>
      {form}
    </div>
  );
}
