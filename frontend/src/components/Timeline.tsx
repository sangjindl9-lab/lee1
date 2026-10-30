import { useRef, useState, type PointerEvent } from "react";
import { fmtTime } from "../format";

export type Seg = { id: number; start: string; end: string; kind: string; protected: boolean };
export type Gap = { start: string; end: string };
export type Ev = { id: number; start: string; type: string; message: string };
export type Bm = { id: number; at: string; title: string; note: string };

/** 시간축: 클릭=그 시각부터 재생, 드래그=구간 선택(내보내기·보호). 녹화 누락은 안전띠 빗금으로 표시. */
export default function Timeline({ from, to, segments, gaps, events, cursor, selection, tz, onSeek, onSelect, bookmarks = [], gapsExpected = false }: {
  from: Date; to: Date; segments: Seg[]; gaps: Gap[]; events: Ev[]; cursor: Date | null; bookmarks?: Bm[]; gapsExpected?: boolean;
  selection: [Date, Date] | null; tz: string; onSeek: (t: Date) => void; onSelect: (r: [Date, Date] | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; t0: Date } | null>(null);
  const span = to.getTime() - from.getTime();
  const pct = (t: number) => ((t - from.getTime()) / span) * 100;
  const clampPct = (t: number) => Math.max(0, Math.min(100, pct(t)));
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return new Date(from.getTime() + f * span);
  };
  const tickStep = span <= 20 * 60e3 ? 60e3 : span <= 2 * 3600e3 ? 10 * 60e3 : span <= 7 * 3600e3 ? 30 * 60e3 : 2 * 3600e3;
  const ticks: number[] = [];
  for (let t = Math.ceil(from.getTime() / tickStep) * tickStep; t < to.getTime(); t += tickStep) ticks.push(t);

  const down = (e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ x0: e.clientX, t0: timeAt(e.clientX) });
  };
  const move = (e: PointerEvent) => {
    if (!drag || Math.abs(e.clientX - drag.x0) < 5) return;
    const t = timeAt(e.clientX);
    onSelect(t > drag.t0 ? [drag.t0, t] : [t, drag.t0]);
  };
  const up = (e: PointerEvent) => {
    if (drag && Math.abs(e.clientX - drag.x0) < 5) onSeek(timeAt(e.clientX));
    setDrag(null);
  };

  return (
    <div>
      <div
        ref={ref}
        className="timeline"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        role="slider"
        aria-label="녹화 시간축"
        aria-valuetext={cursor ? fmtTime(cursor, tz) : "재생 위치 없음"}
        tabIndex={0}
        onKeyDown={(e) => {
          if (!cursor) return;
          const d = e.key === "ArrowRight" ? 10e3 : e.key === "ArrowLeft" ? -10e3 : 0;
          if (d) onSeek(new Date(cursor.getTime() + d * (e.shiftKey ? 6 : 1)));
        }}
      >
        {ticks.map((t) => (
          <div key={t} className="tick" style={{ left: `${pct(t)}%` }}>{fmtTime(new Date(t), tz, false)}</div>
        ))}
        {segments.map((s) => {
          const a = clampPct(new Date(s.start).getTime());
          const b = clampPct(new Date(s.end).getTime());
          return <div key={s.id} className={`seg ${s.kind}${s.protected ? " protected" : ""}`} style={{ left: `${a}%`, width: `${Math.max(0.15, b - a)}%` }} />;
        })}
        {gaps.map((g, i) => {
          const a = clampPct(new Date(g.start).getTime());
          const b = clampPct(new Date(g.end).getTime());
          return b > a ? <div key={i} className={`gap${gapsExpected ? " soft" : ""}`} title={`녹화 없음 ${fmtTime(g.start, tz)} ~ ${fmtTime(g.end, tz)}`} style={{ left: `${a}%`, width: `${b - a}%` }} /> : null;
        })}
        {events.map((ev) => <div key={ev.id} className="ev" title={ev.message} style={{ left: `${clampPct(new Date(ev.start).getTime())}%` }} />)}
        {bookmarks.map((b) => <div key={`b${b.id}`} className="bm" title={`북마크: ${b.title}${b.note ? " — " + b.note : ""}`} style={{ left: `${clampPct(new Date(b.at).getTime())}%` }} />)}
        {selection && (
          <div className="sel" style={{ left: `${clampPct(selection[0].getTime())}%`, width: `${clampPct(selection[1].getTime()) - clampPct(selection[0].getTime())}%` }} />
        )}
        {cursor && cursor >= from && cursor <= to && <div className="head" style={{ left: `${pct(cursor.getTime())}%` }} />}
      </div>
      <div className="legend" style={{ marginTop: 6 }}>
        <span><i style={{ background: "var(--ok)" }} />연속 녹화</span>
        <span><i style={{ background: "#7fb069" }} />일정 녹화</span>
        <span><i style={{ background: "var(--warn)" }} />이벤트 녹화</span>
        <span><i style={{ background: "var(--info)" }} />수동 녹화</span>
        <span><i style={{ background: "var(--signal)", width: 8, clipPath: "polygon(0 0,100% 0,50% 100%)" }} />북마크</span>
        {gapsExpected
          ? <span><i style={{ background: "repeating-linear-gradient(-45deg, #3a4652 0 4px, transparent 4px 8px)" }} />녹화 없음(이벤트 대기·일정 외 시간 또는 단절 — 이벤트 센터에서 확인)</span>
          : <span><i style={{ background: "repeating-linear-gradient(-45deg, var(--signal) 0 4px, #1b1a12 4px 8px)" }} />녹화 없음(누락·꺼짐)</span>}
        <span><i style={{ background: "var(--ok)", boxShadow: "inset 0 -3px 0 var(--signal)" }} />보호 구간</span>
        <span><i style={{ background: "var(--rec)", width: 3 }} />이벤트</span>
        <span>클릭: 재생 / 끌기: 구간 선택 / ←→: 10초 이동</span>
      </div>
    </div>
  );
}
