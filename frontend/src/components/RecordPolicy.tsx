import { useState } from "react";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];
const VALUES = ["0", "C", "E"] as const;
const LABEL: Record<string, string> = { "0": "녹화 안 함", C: "연속", E: "이벤트 시" };
const COLOR: Record<string, string> = { "0": "var(--panel-2)", C: "var(--ok)", E: "var(--rec)" };
export const TRIGGERS: Record<string, string> = {
  motion: "모션", tamper: "가림·훼손", input: "알람 입력", manual: "수동 이벤트", analytics: "분석 모듈",
};

export type Policy = {
  record_mode: string; schedule: string[]; event_pre_seconds: number; event_post_seconds: number;
  event_triggers: string[]; events_enabled: boolean;
};

export function defaultSchedule(): string[] {
  // 평일 08~18시 연속, 그 외 이벤트 시
  return DAYS.map((_, d) => Array.from({ length: 24 }, (_, h) => (d < 5 && h >= 8 && h < 18 ? "C" : "E")).join(""));
}

/** 주간 일정표: 칸을 누르거나 끌어서 칠한다. */
function ScheduleGrid({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [brush, setBrush] = useState<string>("C");
  const [painting, setPainting] = useState(false);
  const grid = value.length === 7 ? value : defaultSchedule();
  const paint = (d: number, h: number) => {
    const next = grid.map((row, i) => (i === d ? row.slice(0, h) + brush + row.slice(h + 1) : row));
    onChange(next);
  };
  return (
    <div onPointerUp={() => setPainting(false)} onPointerLeave={() => setPainting(false)}>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="small muted">칠할 값</span>
        {VALUES.map((v) => (
          <button key={v} type="button" className={brush === v ? "sel" : ""} onClick={() => setBrush(v)}>
            <i style={{ display: "inline-block", width: 10, height: 10, background: COLOR[v], border: "1px solid var(--line)" }} />{LABEL[v]}
          </button>
        ))}
        <button type="button" onClick={() => onChange(DAYS.map(() => brush.repeat(24)))}>전체 칠하기</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 1, width: "auto" }} className="num">
          <thead><tr><th />{Array.from({ length: 24 }, (_, h) => <th key={h} style={{ padding: "0 2px", fontSize: "0.7rem" }}>{h}</th>)}</tr></thead>
          <tbody>
            {DAYS.map((dname, d) => (
              <tr key={dname}>
                <th style={{ padding: "0 6px" }}>{dname}</th>
                {Array.from({ length: 24 }, (_, h) => (
                  <td key={h} style={{ padding: 0, border: 0 }}>
                    <div
                      role="button" tabIndex={0} aria-label={`${dname} ${h}시 ${LABEL[grid[d][h]]}`}
                      onPointerDown={(e) => { e.preventDefault(); setPainting(true); paint(d, h); }}
                      onPointerEnter={() => painting && paint(d, h)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && paint(d, h)}
                      style={{ width: 18, height: 18, background: COLOR[grid[d][h]], cursor: "pointer", border: "1px solid var(--line)" }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">시각은 현장 시간대 기준입니다.</p>
    </div>
  );
}

export default function RecordPolicy({ value, onChange, isOnvif, hasEvents }: {
  value: Policy; onChange: (p: Policy) => void; isOnvif: boolean; hasEvents?: boolean;
}) {
  const set = (k: keyof Policy, v: unknown) => onChange({ ...value, [k]: v });
  const usesEvents = value.record_mode === "event" || (value.record_mode === "schedule" && (value.schedule.length ? value.schedule : defaultSchedule()).some((r) => r.includes("E")));
  return (
    <div className="stack">
      <label className="field"><span>녹화 방식</span>
        <select value={value.record_mode} onChange={(e) => {
          const m = e.target.value;
          onChange({ ...value, record_mode: m, schedule: m === "schedule" && value.schedule.length !== 7 ? defaultSchedule() : value.schedule });
        }}>
          <option value="continuous">24시간 연속 녹화</option>
          <option value="schedule">요일·시간별 일정</option>
          <option value="event">이벤트 발생 시에만</option>
          <option value="off">녹화 안 함(시청만)</option>
        </select>
      </label>
      {value.record_mode === "schedule" && <ScheduleGrid value={value.schedule} onChange={(v) => set("schedule", v)} />}
      {usesEvents && (
        <div className="panel" style={{ background: "var(--panel-2)" }}>
          <h3>이벤트 녹화</h3>
          <div className="form">
            <label className="field"><span>이벤트 전 녹화(초)</span>
              <input type="number" min={0} max={120} value={value.event_pre_seconds} onChange={(e) => set("event_pre_seconds", Number(e.target.value))} /></label>
            <label className="field"><span>이벤트 후 녹화(초)</span>
              <input type="number" min={0} max={600} value={value.event_post_seconds} onChange={(e) => set("event_post_seconds", Number(e.target.value))} /></label>
          </div>
          <p className="small" style={{ marginTop: 8 }}>녹화를 시작할 이벤트(선택 안 하면 전체)</p>
          <div className="row">{Object.entries(TRIGGERS).map(([k, l]) => (
            <label key={k} className="check"><input type="checkbox" checked={value.event_triggers.includes(k)}
              onChange={(e) => set("event_triggers", e.target.checked ? [...value.event_triggers, k] : value.event_triggers.filter((x) => x !== k))} />{l}</label>
          ))}</div>
          <p className="muted small">이벤트를 기다리는 동안에도 영상을 짧게(최대 2분) 임시 저장해 두었다가, 이벤트가 생기면 앞뒤 구간을 녹화로 확정합니다.
            연속·일정 녹화 중에 생긴 이벤트는 같은 영상을 두 번 저장하지 않고 시간축에 표시만 합니다.</p>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={value.events_enabled} disabled={!isOnvif} onChange={(e) => set("events_enabled", e.target.checked)} />
        카메라 이벤트 받기(ONVIF 모션·가림·알람 입력)
        {!isOnvif && <span className="muted small">— ONVIF 로 등록한 카메라만 가능</span>}
        {isOnvif && hasEvents === false && <span className="muted small">— 등록 시 조회에서 이벤트 서비스가 확인되지 않았습니다</span>}
      </label>
    </div>
  );
}
