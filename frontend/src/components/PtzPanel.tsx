import { useEffect, useRef, useState } from "react";
import { get, post } from "../api";
import { errMsg } from "../ui";

/** PTZ: 누르고 있는 동안 이동(0.5초마다 이동 명령 갱신), 떼면 정지. 프리셋 이동·저장. */
export default function PtzPanel({ cameraId }: { cameraId: number }) {
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState("");
  const [speed, setSpeed] = useState(0.5);
  const [name, setName] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const load = async () => {
    try {
      setInfo(await get(`/api/cameras/${cameraId}/ptz`));
      setErr("");
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  useEffect(() => {
    setInfo(null);
    load();
    return () => window.clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId]);

  const send = async (body: Record<string, unknown>) => {
    try {
      const r = await post(`/api/cameras/${cameraId}/ptz`, body);
      if (r.status) setInfo((i: any) => ({ ...i, status: r.status }));
      setErr("");
      return r;
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const start = (pan: number, tilt: number, zoom: number) => {
    const m = { action: "move", pan: pan * speed, tilt: tilt * speed, zoom: zoom * speed, seconds: 1 };
    send(m);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => send(m), 500);
  };
  const stop = () => {
    window.clearInterval(timer.current);
    send({ action: "stop" });
  };

  if (err && !info) return <p className="small" style={{ color: "var(--warn)", padding: "0 12px" }}>{err}</p>;
  if (!info) return <p className="muted small" style={{ padding: "0 12px" }}>PTZ 확인 중…</p>;
  if (!info.supported) return <p className="muted small" style={{ padding: "0 12px" }}>{info.reason}</p>;

  const btn = (label: string, p: number, t: number, z: number) => (
    <button
      onPointerDown={() => start(p, t, z)} onPointerUp={stop} onPointerLeave={(e) => e.buttons && stop()}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && start(p, t, z)} onKeyUp={stop}
      style={{ justifyContent: "center", touchAction: "none" }} aria-label={label}
    >{label}</button>
  );
  return (
    <div style={{ padding: "0 12px 12px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
        <span />{btn("위", 0, 1, 0)}<span />
        {btn("왼쪽", -1, 0, 0)}<button onClick={stop} style={{ justifyContent: "center" }}>정지</button>{btn("오른쪽", 1, 0, 0)}
        {btn("줌 −", 0, 0, -1)}{btn("아래", 0, -1, 0)}{btn("줌 +", 0, 0, 1)}
      </div>
      <label className="field" style={{ marginTop: 8 }}><span>속도 {Math.round(speed * 100)}%</span>
        <input type="range" min={0.1} max={1} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></label>
      {info.status && <p className="muted small num">위치 팬 {info.status.pan ?? "-"} / 틸트 {info.status.tilt ?? "-"} / 줌 {info.status.zoom ?? "-"}</p>}
      <div className="row">
        <select aria-label="프리셋" defaultValue="" onChange={(e) => e.target.value && send({ action: "goto", preset: e.target.value })} style={{ flex: 1 }}>
          <option value="">프리셋 이동…</option>
          {info.presets.map((p: any) => <option key={p.token} value={p.token}>{p.name}</option>)}
        </select>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input placeholder="현재 위치를 프리셋으로" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} aria-label="프리셋 이름" />
        <button onClick={async () => { if (await send({ action: "set_preset", name })) { setName(""); load(); } }} disabled={!name.trim()}>저장</button>
      </div>
      {err && <p className="small" style={{ color: "var(--warn)" }}>{err}</p>}
    </div>
  );
}
