import { useEffect, useRef, useState } from "react";
import { get, post, qs } from "../api";
import { fmtDateTime, todayIn, zonedToDate } from "../format";
import { Alert, useData } from "../ui";

type Seg = { id: number; start: string; end: string };
const TZ = "Asia/Seoul";
const SPEEDS = [1, 2, 4];

/**
 * 다중 카메라 동기 재생: 하나의 기준 시계를 두고 각 칸이 그 시각의 구간 파일을 재생한다.
 * 칸마다 0.7초 넘게 어긋나면 위치를 다시 맞춘다(브라우저 디코더별 미세 차이 보정). 녹화가 없는 칸은 '녹화 없음'.
 */
export default function SyncPlayback() {
  const cams = useData(() => get("/api/cameras?include_deleted=true"), []);
  const [sel, setSel] = useState<number[]>([]);
  const [date, setDate] = useState(todayIn(TZ));
  const [time, setTime] = useState("09:00:00");
  const [clock, setClock] = useState<Date | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [segs, setSegs] = useState<Record<number, Seg[]>>({});
  const last = useRef<number>(0);

  const toggle = (id: number) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));

  const start = async () => {
    const t = zonedToDate(date, time, TZ);
    const from = new Date(t.getTime() - 60e3).toISOString();
    const to = new Date(t.getTime() + 6 * 3600e3).toISOString();
    const out: Record<number, Seg[]> = {};
    for (const id of sel) {
      const r = await get(`/api/recordings/timeline?${qs({ camera_id: id, start: from, end: to })}`);
      out[id] = r.segments;
      post("/api/recordings/playback-sessions", { camera_id: id, at: t.toISOString() }).catch(() => {});
    }
    setSegs(out);
    setClock(t);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - last.current) * speed;
      last.current = now;
      setClock((c) => (c ? new Date(c.getTime() + dt) : c));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const camById = Object.fromEntries((cams.data?.items ?? []).map((c: any) => [c.id, c]));
  return (
    <div className="page wide">
      <div className="pagehead"><div><h1>여러 카메라 동기 재생</h1><p className="muted">최대 4대를 같은 시각으로 맞춰 재생합니다. 시각은 현장 시간 기준입니다.</p></div></div>
      <div className="panel">
        <div className="row">
          {(cams.data?.items ?? []).map((c: any) => (
            <label key={c.id} className="check"><input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />{c.name}</label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="날짜" />
          <input type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} aria-label="시각" />
          <button className="primary" disabled={!sel.length} onClick={start}>이 시각부터 재생</button>
          {clock && <>
            <button onClick={() => setPlaying((p) => !p)}>{playing ? "일시정지" : "재생"}</button>
            {SPEEDS.map((s) => <button key={s} className={speed === s ? "sel" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}
            <button onClick={() => { setClock((c) => c && new Date(c.getTime() - 30e3)); }}>30초 뒤로</button>
            <button onClick={() => { setClock((c) => c && new Date(c.getTime() + 30e3)); }}>30초 앞으로</button>
            <b className="num" style={{ marginLeft: 8 }}>{fmtDateTime(clock.toISOString(), TZ)}</b>
          </>}
        </div>
      </div>
      {clock && (
        <div style={{ display: "grid", gridTemplateColumns: sel.length > 1 ? "1fr 1fr" : "1fr", gap: 4, marginTop: 12 }}>
          {sel.map((id) => <SyncTile key={id} name={camById[id]?.name} segs={segs[id] ?? []} clock={clock} playing={playing} speed={speed} />)}
        </div>
      )}
      {!clock && <Alert kind="info">카메라를 고르고 시작 시각을 정한 뒤 “이 시각부터 재생”을 누르세요. 시작 시각부터 6시간 범위를 이어서 재생합니다.</Alert>}
    </div>
  );
}

function SyncTile({ name, segs, clock, playing, speed }: { name: string; segs: Seg[]; clock: Date; playing: boolean; speed: number }) {
  const v = useRef<HTMLVideoElement>(null);
  const cur = useRef<number | null>(null);
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const seg = segs.find((s) => new Date(s.start) <= clock && new Date(s.end) > clock);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    if (!seg) {
      if (cur.current !== null) {
        el.removeAttribute("src");
        el.load();
        cur.current = null;
      }
      return;
    }
    const want = (clock.getTime() - new Date(seg.start).getTime()) / 1000;
    if (cur.current !== seg.id) {
      cur.current = seg.id;
      el.src = `/api/recordings/segments/${seg.id}/media`;
      el.onloadedmetadata = () => { el.currentTime = (clockRef.current.getTime() - new Date(seg.start).getTime()) / 1000; if (playing) el.play().catch(() => {}); };
      return;
    }
    if (el.readyState >= 1 && Math.abs(el.currentTime - want) > 0.7) el.currentTime = want;
    el.playbackRate = speed;
    if (playing && el.paused) el.play().catch(() => {});
    if (!playing && !el.paused) el.pause();
  });
  return (
    <div className="player" style={{ maxHeight: "40vh" }}>
      <video ref={v} muted playsInline />
      <span className="ts">{name}</span>
      {!seg && <div className="muted" style={{ position: "absolute" }}>이 시각 녹화 없음</div>}
    </div>
  );
}
