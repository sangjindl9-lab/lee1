import { useState } from "react";
import { del, get, post, put } from "../api";
import { fmtDateTime } from "../format";
import { Alert, Field, Modal, errMsg, useData } from "../ui";

const EVENT_TYPES: Record<string, string> = {
  camera_offline: "카메라 연결 끊김", storage_low: "저장공간 부족", storage_full: "저장공간 확보 불가", disk_write_error: "디스크 쓰기 실패",
  motion: "모션 감지", tamper: "가림·훼손", input: "알람 입력", analytics: "분석 이벤트", manual: "수동 이벤트",
  event_subscription: "이벤트 구독 실패", edge_offline: "현장 서버 연결 끊김",
};

export default function Notify() {
  const chans = useData(() => get("/api/notify/channels"), [], 15000);
  const keys = useData(() => get("/api/integrations/keys"), []);
  const [edit, setEdit] = useState<any>(null);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [newKey, setNewKey] = useState<string>("");
  const act = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      setMsg({ k: "ok", t: ok });
      chans.reload();
      keys.reload();
    } catch (e) {
      setMsg({ k: "err", t: errMsg(e) });
    }
  };
  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>알림·외부 연동</h1><p className="muted">장애·이벤트를 이메일이나 웹훅(사내 메신저 연동 등)으로 보냅니다. 웹 화면 안의 이벤트 센터는 항상 동작합니다.</p></div>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ type: "webhook", config: {}, min_severity: "warning", event_types: [], repeat_minutes: 0, suppress_minutes: 10, enabled: true })}>알림 채널 추가</button>
      </div>
      {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
      <div className="panel tablewrap">
        <table>
          <thead><tr><th>이름</th><th>종류</th><th>받을 이벤트</th><th>반복·억제</th><th>최근 전송</th><th /></tr></thead>
          <tbody>{(chans.data?.items ?? []).map((c: any) => (
            <tr key={c.id}>
              <td><b>{c.name}</b>{!c.enabled && <span className="tag" style={{ marginLeft: 6 }}>꺼짐</span>}</td>
              <td className="small">{c.type === "email" ? `이메일 → ${(c.config.to ?? []).join(", ")}` : `웹훅 → ${c.config.url}`}</td>
              <td className="small">{({ info: "정보 이상", warning: "경고 이상", critical: "심각만" } as any)[c.min_severity]} / {c.event_types.length ? c.event_types.map((t: string) => EVENT_TYPES[t] ?? t).join(", ") : "모든 종류"}</td>
              <td className="small">{c.repeat_minutes ? `미확인 시 ${c.repeat_minutes}분마다` : "반복 안 함"} / 같은 이벤트 {c.suppress_minutes}분 억제</td>
              <td className="small">{c.last ? <><span className={`badge ${c.last.ok ? "ok" : "warn"}`}>{c.last.ok ? "성공" : "실패"}</span> {fmtDateTime(c.last.at)}<div className="muted">{c.last.error}</div></> : "-"}</td>
              <td><div className="row">
                <button onClick={() => act(() => post(`/api/notify/channels/${c.id}/test`), "시험 메시지를 보냈습니다.")}>시험 전송</button>
                <button onClick={() => setEdit(c)}>수정</button>
                <button className="danger" onClick={() => window.confirm("채널을 삭제할까요?") && act(() => del(`/api/notify/channels/${c.id}`), "삭제했습니다.")}>삭제</button>
              </div></td>
            </tr>))}
          </tbody>
        </table>
        {chans.data?.items?.length === 0 && <div className="empty">알림 채널이 없습니다.</div>}
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="row"><h2 style={{ flex: 1 }}>분석 모듈 연동 키</h2>
          <button onClick={async () => { const name = window.prompt("연동 이름(예: 출입구 사람 감지 서버)"); if (!name) return; try { const r = await post("/api/integrations/keys", { name }); setNewKey(r.key); keys.reload(); } catch (e) { setMsg({ k: "err", t: errMsg(e) }); } }}>키 만들기</button></div>
        <p className="muted small">사람·차량·침입·선 넘기 등을 판단하는 외부 분석 서버가 이 키로 이벤트를 보내면, 출처 ‘분석 모듈’로 기록되고 이벤트 녹화를 일으킬 수 있습니다.
          이 NVR 자체에는 분석 모델이 없습니다.</p>
        {newKey && <Alert kind="info">새 키(지금 한 번만 표시): <code style={{ wordBreak: "break-all" }}>{newKey}</code>
          <div className="small">보내는 방법: POST /api/integrations/analytics/events, 헤더 X-API-Key, 본문 {"{"}"camera_id": 1, "label": "person", "state": "pulse", "duration_seconds": 10{"}"}</div></Alert>}
        <table><tbody>{(keys.data?.items ?? []).map((k: any) => (
          <tr key={k.id}><td><b>{k.name}</b></td><td className="small muted">최근 사용 {fmtDateTime(k.last_used_at)}</td>
            <td><button className="danger" onClick={() => window.confirm("키를 폐기할까요? 이 키를 쓰는 분석 서버는 더 이상 이벤트를 보낼 수 없습니다.") && act(() => del(`/api/integrations/keys/${k.id}`), "키를 폐기했습니다.")}>폐기</button></td></tr>))}
        </tbody></table>
      </section>
      {edit && <ChannelForm ch={edit} onClose={() => { setEdit(null); chans.reload(); }} />}
    </div>
  );
}

function ChannelForm({ ch, onClose }: { ch: any; onClose: () => void }) {
  const [f, setF] = useState({ ...ch, config: { ...ch.config, to: (ch.config.to ?? []).join(", "), password: "", secret: "" } });
  const [err, setErr] = useState("");
  const setC = (k: string, v: unknown) => setF({ ...f, config: { ...f.config, [k]: v } });
  const save = async () => {
    const config = { ...f.config, to: String(f.config.to ?? "").split(/[,\s]+/).filter(Boolean) };
    const body = { name: f.name, type: f.type, config, enabled: f.enabled, min_severity: f.min_severity, event_types: f.event_types,
      repeat_minutes: Number(f.repeat_minutes), suppress_minutes: Number(f.suppress_minutes) };
    try {
      if (ch.id) await put(`/api/notify/channels/${ch.id}`, body);
      else await post("/api/notify/channels", body);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Modal title={ch.id ? "알림 채널 수정" : "알림 채널 추가"} onClose={onClose}>
      <div className="form">
        <Field label="이름"><input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="종류"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="webhook">웹훅</option><option value="email">이메일(SMTP)</option></select></Field>
        {f.type === "webhook" ? <>
          <Field label="웹훅 주소" full><input value={f.config.url ?? ""} onChange={(e) => setC("url", e.target.value)} placeholder="https://…" /></Field>
          <Field label="서명 비밀키(선택)" hint={ch.config?.has_secret ? "비워 두면 기존 값 유지" : "X-NVR-Signature(HMAC-SHA256) 헤더로 검증"}><input type="password" value={f.config.secret} onChange={(e) => setC("secret", e.target.value)} /></Field>
        </> : <>
          <Field label="SMTP 서버"><input value={f.config.host ?? ""} onChange={(e) => setC("host", e.target.value)} /></Field>
          <Field label="포트"><input type="number" value={f.config.port ?? 587} onChange={(e) => setC("port", Number(e.target.value))} /></Field>
          <Field label="보안"><select value={f.config.security ?? "starttls"} onChange={(e) => setC("security", e.target.value)}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">없음</option></select></Field>
          <Field label="계정"><input value={f.config.username ?? ""} onChange={(e) => setC("username", e.target.value)} /></Field>
          <Field label="비밀번호" hint={ch.config?.has_secret ? "비워 두면 기존 값 유지" : ""}><input type="password" value={f.config.password} onChange={(e) => setC("password", e.target.value)} /></Field>
          <Field label="보내는 주소"><input value={f.config.from ?? ""} onChange={(e) => setC("from", e.target.value)} /></Field>
          <Field label="받는 사람" hint="쉼표로 구분" full><input value={f.config.to ?? ""} onChange={(e) => setC("to", e.target.value)} /></Field>
        </>}
        <Field label="보낼 중요도"><select value={f.min_severity} onChange={(e) => setF({ ...f, min_severity: e.target.value })}>
          <option value="info">정보 이상(모두)</option><option value="warning">경고 이상</option><option value="critical">심각만</option></select></Field>
        <Field label="미확인 반복(분)" hint="0 = 반복 안 함"><input type="number" min={0} value={f.repeat_minutes} onChange={(e) => setF({ ...f, repeat_minutes: e.target.value })} /></Field>
        <Field label="중복 억제(분)" hint="같은 이벤트 키는 이 시간 안에 다시 보내지 않음"><input type="number" min={0} value={f.suppress_minutes} onChange={(e) => setF({ ...f, suppress_minutes: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />사용</label>
      </div>
      <p className="small" style={{ marginTop: 8 }}>받을 이벤트 종류(선택 안 하면 전체)</p>
      <div className="row">{Object.entries(EVENT_TYPES).map(([k, l]) => (
        <label key={k} className="check"><input type="checkbox" checked={f.event_types.includes(k)}
          onChange={(e) => setF({ ...f, event_types: e.target.checked ? [...f.event_types, k] : f.event_types.filter((x: string) => x !== k) })} />{l}</label>))}
      </div>
      {err && <Alert kind="err">{err}</Alert>}
      <div className="row" style={{ marginTop: 12 }}><span style={{ flex: 1 }} /><button onClick={onClose}>취소</button><button className="primary" onClick={save}>저장</button></div>
    </Modal>
  );
}
