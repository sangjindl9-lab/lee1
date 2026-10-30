import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { get, post, qs } from "../api";
import { useAuth } from "../auth";
import Timeline, { type Seg } from "../components/Timeline";
import { fmtDateTime, timeIn, todayIn, zonedToDate } from "../format";
import { Alert, errMsg, useData } from "../ui";

const SPANS = [
  { label: "24시간", ms: 24 * 3600e3 },
  { label: "6시간", ms: 6 * 3600e3 },
  { label: "1시간", ms: 3600e3 },
  { label: "15분", ms: 15 * 60e3 },
];
const SPEEDS = [0.5, 1, 2, 4, 8];

export default function Playback() {
  const { can } = useAuth();
  const cams = useData(() => get("/api/cameras?include_deleted=true"), []);
  const [camId, setCamId] = useState<number | null>(null);
  const cam = (cams.data?.items ?? []).find((c: any) => c.id === camId);
  const tz = "Asia/Seoul";
  const [date, setDate] = useState(todayIn(tz));
  const [month, setMonth] = useState(todayIn(tz).slice(0, 7));
  const [spanIdx, setSpanIdx] = useState(0);
  const [center, setCenter] = useState<Date>(() => new Date());
  const [cursor, setCursor] = useState<Date | null>(null);
  const [selection, setSelection] = useState<[Date, Date] | null>(null);
  const [speed, setSpeed] = useState(1);
  const [notice, setNotice] = useState("");
  const [current, setCurrent] = useState<Seg | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pendingOffset = useRef(0);
  const audited = useRef(false);

  useEffect(() => {
    if (!camId && cams.data?.items?.length) setCamId(cams.data.items.find((c: any) => !c.deleted)?.id ?? cams.data.items[0].id);
  }, [cams.data, camId]);

  const days = useData(() => (camId ? get(`/api/recordings/days?${qs({ camera_id: camId, month })}`) : Promise.resolve({ days: [] })), [camId, month]);

  const span = SPANS[spanIdx].ms;
  const dayStart = zonedToDate(date, "00:00:00", tz);
  const viewFrom = spanIdx === 0 ? dayStart : new Date(center.getTime() - span / 2);
  const viewTo = new Date(viewFrom.getTime() + span);
  const tl = useData(
    () => (camId ? get(`/api/recordings/timeline?${qs({ camera_id: camId, start: viewFrom.toISOString(), end: viewTo.toISOString() })}`) : Promise.resolve(null)),
    [camId, viewFrom.getTime(), viewTo.getTime()],
    30000,
  );
  const segments: Seg[] = tl.data?.segments ?? [];

  // 재생 대상 구간 목록(앞뒤 구간까지 이어서 재생하기 위해 하루 범위 사용)
  const dayTl = useData(
    () => (camId ? get(`/api/recordings/timeline?${qs({ camera_id: camId, start: new Date(dayStart.getTime() - 3600e3).toISOString(), end: new Date(dayStart.getTime() + 25 * 3600e3).toISOString() })}`) : Promise.resolve(null)),
    [camId, date],
  );
  const allSegs: Seg[] = useMemo(() => dayTl.data?.segments ?? [], [dayTl.data]);

  // 재생 위치가 없으면 그날 마지막 녹화 시각(오늘이면 지금) 주변을 보여준다
  const defaultCenter = (ms: number) => {
    const last = allSegs[allSegs.length - 1];
    if (last) return new Date(Math.min(new Date(last.end).getTime(), Date.now()) - ms / 4);
    return date === todayIn(tz) ? new Date(Date.now() - ms / 4) : new Date(dayStart.getTime() + 12 * 3600e3);
  };

  const playAt = (t: Date) => {
    setCursor(t);
    if (spanIdx !== 0) setCenter(t);
    let seg = allSegs.find((s) => new Date(s.start) <= t && new Date(s.end) > t);
    let offset = seg ? (t.getTime() - new Date(seg.start).getTime()) / 1000 : 0;
    if (!seg) {
      seg = allSegs.find((s) => new Date(s.start) > t);
      offset = 0;
      if (seg) setNotice(`선택한 시각에는 녹화가 없어 다음 녹화(${fmtDateTime(seg.start, tz)})부터 재생합니다.`);
      else return setNotice("선택한 시각 이후의 녹화가 없습니다.");
    } else setNotice("");
    load(seg, offset);
    if (!audited.current && camId) {
      audited.current = true;
      post("/api/recordings/playback-sessions", { camera_id: camId, at: t.toISOString() }).catch(() => {});
    }
  };

  const load = (seg: Seg, offset: number) => {
    const v = video.current!;
    pendingOffset.current = offset;
    setCurrent(seg);
    v.src = `/api/recordings/segments/${seg.id}/media`;
    v.playbackRate = speed;
    v.play().catch(() => {});
  };

  const onEnded = () => {
    if (!current) return;
    const idx = allSegs.findIndex((s) => s.id === current.id);
    const next = allSegs[idx + 1];
    if (!next) return setNotice("이 날짜의 마지막 녹화입니다.");
    const gap = (new Date(next.start).getTime() - new Date(current.end).getTime()) / 1000;
    if (gap > 3) setNotice(`녹화 누락 ${Math.round(gap)}초를 건너뛰었습니다.`);
    load(next, 0);
  };

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    audited.current = false;
    setCurrent(null);
    setCursor(null);
    setSelection(null);
    if (video.current) video.current.removeAttribute("src");
  }, [camId]);

  const onTime = () => {
    const v = video.current;
    if (v && current) setCursor(new Date(new Date(current.start).getTime() + v.currentTime * 1000));
  };

  const shiftView = (dir: number) => {
    if (spanIdx === 0) {
      const d = new Date(dayStart.getTime() + dir * 86400e3 + 12 * 3600e3);
      const ds = new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(d);
      setDate(ds);
      setMonth(ds.slice(0, 7));
    } else setCenter(new Date(center.getTime() + (dir * span) / 2));
  };

  return (
    <div className="page wide">
      <div className="pagehead">
        <div><h1>녹화 검색·재생</h1><p className="muted">시각은 현장 시간(Asia/Seoul) 기준입니다.</p></div>
        <span className="spacer" />
        <select value={camId ?? ""} onChange={(e) => setCamId(Number(e.target.value))} aria-label="카메라">
          {(cams.data?.items ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.deleted ? " (삭제된 카메라)" : ""} / {c.site_name}</option>)}
        </select>
      </div>
      {cam?.is_test_source && <Alert kind="info">시험용 합성 스트림의 녹화입니다. 실제 현장 영상이 아닙니다.</Alert>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 16 }} className="pb-grid">
        <div className="stack">
          <div className="player">
            <video ref={video} controls playsInline onLoadedMetadata={() => { const v = video.current!; v.currentTime = pendingOffset.current; v.playbackRate = speed; }}
              onTimeUpdate={onTime} onEnded={onEnded} onError={() => setNotice("이 구간 파일을 재생하지 못했습니다(삭제되었거나 브라우저가 코덱을 지원하지 않음).")} />
            {cursor && current && <span className="ts">{fmtDateTime(cursor.toISOString(), tz)}</span>}
            {!current && <div className="muted" style={{ position: "absolute" }}>시간축을 클릭하면 그 시각부터 재생합니다.</div>}
          </div>
          <div className="row">
            <span className="muted small">배속</span>
            {SPEEDS.map((s) => <button key={s} className={speed === s ? "sel" : ""} onClick={() => setSpeed(s)}>{s}×</button>)}
            <span className="spacer" style={{ flex: 1 }} />
            <button onClick={() => cursor && playAt(new Date(cursor.getTime() - 30e3))} disabled={!cursor}>30초 뒤로</button>
            <button onClick={() => cursor && playAt(new Date(cursor.getTime() + 30e3))} disabled={!cursor}>30초 앞으로</button>
          </div>
          {notice && <Alert kind="info">{notice}</Alert>}
          <div className="panel">
            <div className="row" style={{ marginBottom: 8 }}>
              <b className="num">{fmtDateTime(viewFrom.toISOString(), tz)} ~ {fmtDateTime(viewTo.toISOString(), tz).slice(-8)}</b>
              <span style={{ flex: 1 }} />
              <button onClick={() => shiftView(-1)} aria-label="이전 구간">이전</button>
              {SPANS.map((s, i) => <button key={s.label} className={i === spanIdx ? "sel" : ""} onClick={() => { setSpanIdx(i); if (i) setCenter(cursor ?? defaultCenter(s.ms)); }}>{s.label}</button>)}
              <button onClick={() => shiftView(1)} aria-label="다음 구간">다음</button>
            </div>
            {tl.error ? <Alert kind="err">{tl.error}</Alert> : (
              <Timeline from={viewFrom} to={viewTo} segments={segments} gaps={tl.data?.gaps ?? []} events={tl.data?.events ?? []}
                cursor={cursor} selection={selection} tz={tz} onSeek={playAt} onSelect={setSelection} />
            )}
          </div>
          {camId && (can("download") || can("delete_recordings")) && (
            <RangeActions camId={camId} tz={tz} date={date} selection={selection} cursor={cursor}
              onDone={() => { tl.reload(); dayTl.reload(); }} />
          )}
        </div>
        <aside className="panel">
          <Calendar month={month} setMonth={setMonth} days={days.data?.days ?? []} date={date}
            onPick={(d) => { setDate(d); setSpanIdx(0); setSelection(null); }} />
          <p className="muted small" style={{ marginTop: 10 }}>굵게 표시된 날짜에 녹화가 있습니다.</p>
          <p className="muted small">다중 카메라 동기 재생은 3단계, 북마크·메모 검색은 2단계에서 제공합니다.</p>
        </aside>
      </div>
      <style>{`@media (max-width: 860px){ .pb-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Calendar({ month, setMonth, days, date, onPick }: { month: string; setMonth: (m: string) => void; days: string[]; date: string; onPick: (d: string) => void }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const has = new Set(days);
  const mv = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    setMonth(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="ghost" onClick={() => mv(-1)} aria-label="이전 달">이전</button>
        <b style={{ flex: 1, textAlign: "center" }}>{y}년 {m}월</b>
        <button className="ghost" onClick={() => mv(1)} aria-label="다음 달">다음</button>
      </div>
      <div className="calendar">
        {"일월화수목금토".split("").map((d) => <div key={d} className="dow">{d}</div>)}
        {Array.from({ length: first }, (_, i) => <span key={`e${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const ds = `${month}-${String(i + 1).padStart(2, "0")}`;
          return <button key={ds} className={`${has.has(ds) ? "has" : ""}${ds === date ? " cur" : ""}`} onClick={() => onPick(ds)} aria-pressed={ds === date}>{i + 1}</button>;
        })}
      </div>
    </div>
  );
}

function RangeActions({ camId, tz, date, selection, cursor, onDone }: { camId: number; tz: string; date: string; selection: [Date, Date] | null; cursor: Date | null; onDone: () => void }) {
  const { can } = useAuth();
  const [d0, setD0] = useState(date);
  const [t0, setT0] = useState("00:00:00");
  const [t1, setT1] = useState("00:05:00");
  const [mode, setMode] = useState("copy");
  const [wm, setWm] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: ReactNode } | null>(null);
  useEffect(() => {
    if (selection) {
      setD0(new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(selection[0]));
      setT0(timeIn(selection[0], tz));
      setT1(timeIn(selection[1], tz));
    }
  }, [selection, tz]);
  const fromCursor = () => {
    if (!cursor) return;
    setD0(new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(cursor));
    setT0(timeIn(cursor, tz));
    setT1(timeIn(new Date(cursor.getTime() + 5 * 60e3), tz));
  };
  const range = () => {
    const a = zonedToDate(d0, t0, tz);
    let b = zonedToDate(d0, t1, tz);
    if (b <= a) b = new Date(b.getTime() + 86400e3); // 자정 넘김
    return [a, b] as const;
  };
  const doExport = async () => {
    const [a, b] = range();
    try {
      const j = await post("/api/exports", { camera_id: camId, start: a.toISOString(), end: b.toISOString(), mode, watermark: mode === "exact" && wm });
      setMsg({ k: "ok", t: <>내보내기 #{j.id}를 요청했습니다. <Link to="/exports">내보내기 작업</Link>에서 진행 상황을 확인하세요.</> });
    } catch (e) {
      setMsg({ k: "err", t: errMsg(e) });
    }
  };
  const doProtect = async (flag: boolean) => {
    const [a, b] = range();
    try {
      const r = await post("/api/recordings/protect", { camera_id: camId, start: a.toISOString(), end: b.toISOString(), protected: flag });
      setMsg({ k: "ok", t: `${r.updated}개 구간을 ${flag ? "보호" : "보호 해제"}했습니다.` });
      onDone();
    } catch (e) {
      setMsg({ k: "err", t: errMsg(e) });
    }
  };
  const doDelete = async () => {
    const [a, b] = range();
    if (!window.confirm(`${d0} ${t0} ~ ${t1} 녹화를 삭제합니다. 보호 구간은 남습니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
    try {
      const r = await post("/api/recordings/delete", { camera_id: camId, start: a.toISOString(), end: b.toISOString() });
      setMsg({ k: "ok", t: `${r.deleted}개 구간 삭제, 보호 구간 ${r.skipped_protected}개는 남겼습니다.` });
      onDone();
    } catch (e) {
      setMsg({ k: "err", t: errMsg(e) });
    }
  };
  return (
    <div className="panel">
      <h3>구간 지정</h3>
      <div className="row">
        <input type="date" value={d0} onChange={(e) => setD0(e.target.value)} aria-label="날짜" />
        <input type="time" step={1} value={t0} onChange={(e) => setT0(e.target.value)} aria-label="시작 시각" />
        <span>~</span>
        <input type="time" step={1} value={t1} onChange={(e) => setT1(e.target.value)} aria-label="종료 시각" />
        <button onClick={fromCursor} disabled={!cursor}>재생 위치부터 5분</button>
      </div>
      <p className="muted small" style={{ marginTop: 6 }}>시간축을 끌어서 구간을 지정할 수도 있습니다.</p>
      {can("download") && (
        <div className="row" style={{ marginTop: 8 }}>
          <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="내보내기 방식">
            <option value="copy">원본 복사(빠름, 키프레임 단위로 앞당겨 시작)</option>
            <option value="exact">정확한 구간(재인코딩, 느림)</option>
          </select>
          <label className="check"><input type="checkbox" checked={wm} disabled={mode !== "exact"} onChange={(e) => setWm(e.target.checked)} />표시용 워터마크</label>
          <button className="primary" onClick={doExport}>MP4 내보내기</button>
        </div>
      )}
      {can("delete_recordings") && (
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => doProtect(true)}>구간 보호</button>
          <button onClick={() => doProtect(false)}>보호 해제</button>
          <button className="danger" onClick={doDelete}>구간 녹화 삭제</button>
        </div>
      )}
      {msg && <Alert kind={msg.k}>{msg.t}</Alert>}
    </div>
  );
}
