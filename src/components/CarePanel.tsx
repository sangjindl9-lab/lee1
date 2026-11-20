"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CareRecord = {
  id: string;
  type: "SLEEP" | "FEEDING";
  childId: string;
  childName: string | null;
  childNickname: string | null;
  startDateLabel: string;
  startTimeLabel: string;
  endDateLabel: string | null;
  endTimeLabel: string | null;
  durationLabel: string;
  durationMinutes: number | null;
  status: "DONE" | "ONGOING";
  amountMl: number | null;
  note: string | null;
  overnight: boolean;
};

type CareSummary = { ongoing: CareRecord[]; todaySleepLabel: string; todayFeedMl: number };
type ChildInfo = { id: string; name: string; nickname: string };

function kstToday(offsetDays = 0): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

function minutesBetween(startDate: string, startTime: string, endDate: string, endTime: string): number | null {
  if (!startDate || !startTime || !endDate || !endTime) return null;
  const start = new Date(`${startDate}T${startTime}:00+09:00`).getTime();
  const end = new Date(`${endDate}T${endTime}:00+09:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const diff = Math.round((end - start) / 60000);
  return diff > 0 ? diff : null;
}

function formatMinutes(min: number | null): string {
  if (min == null) return "-";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export default function CarePanel({ children }: { children: ChildInfo[] }) {
  const [childId, setChildId] = useState(children[0]?.id ?? "");
  const [records, setRecords] = useState<CareRecord[]>([]);
  const [summary, setSummary] = useState<CareSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 수면 입력 (기본값: 어제 23:40 → 오늘 01:10 · 자정을 넘기는 기록 예시)
  const [sleep, setSleep] = useState({
    startDate: kstToday(-1),
    startTime: "23:40",
    endDate: kstToday(0),
    endTime: "01:10",
    note: "",
  });
  const [sleepErrors, setSleepErrors] = useState<Record<string, string>>({});

  const [feeding, setFeeding] = useState({ startDate: kstToday(0), startTime: "08:30", amountMl: "180", note: "" });
  const [feedErrors, setFeedErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/care?childId=${childId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { records: CareRecord[]; summary: CareSummary };
    setRecords(data.records);
    setSummary(data.summary);
  }, [childId]);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = useMemo(
    () => minutesBetween(sleep.startDate, sleep.startTime, sleep.endDate, sleep.endTime),
    [sleep.startDate, sleep.startTime, sleep.endDate, sleep.endTime],
  );

  async function saveSleep(ongoing = false) {
    setBusy(true);
    setNotice(null);
    setSleepErrors({});
    try {
      const res = await fetch("/api/care/sleep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId, ...sleep, ongoing }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSleepErrors(data.fieldErrors ?? {});
        setNotice(data?.error?.message ?? "수면 기록을 저장하지 못했습니다.");
        return;
      }
      setNotice(ongoing ? "수면 시작을 저장했습니다. 깨면 종료 시각을 입력해 주세요." : `수면 기록 저장 완료 · ${data.record.durationLabel}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function saveFeeding() {
    setBusy(true);
    setNotice(null);
    setFeedErrors({});
    try {
      const res = await fetch("/api/care/feeding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId, ...feeding }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedErrors(data.fieldErrors ?? {});
        setNotice(data?.error?.message ?? "수유 기록을 저장하지 못했습니다.");
        return;
      }
      setNotice(`수유 기록 저장 완료 · ${data.record.amountMl}mL`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <label className="text-xs font-semibold text-slate-500" htmlFor="care-child">
          아이
        </label>
        <select id="care-child" className="input w-auto py-1.5" value={childId} onChange={(e) => setChildId(e.target.value)}>
          {children.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.nickname})
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-500">오늘 수면 {summary?.todaySleepLabel ?? "-"} · 수유 {summary?.todayFeedMl ?? 0}mL</span>
      </div>

      {notice && <div className="rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700">{notice}</div>}

      {summary && summary.ongoing.length > 0 && (
        <section className="space-y-2">
          {summary.ongoing.map((record) => (
            <OngoingSleep key={record.id} record={record} onDone={load} />
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="section-title mb-1">🌙 수면 기록</h2>
          <p className="mb-3 text-xs text-slate-500">
            자정을 넘겨도 그대로 저장됩니다. (어제 23:40 → 오늘 01:10 = 1시간 30분)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="sleep-start-date">취침 날짜</label>
              <input
                id="sleep-start-date"
                type="date"
                className={`input ${sleepErrors.startDate ? "input-error" : ""}`}
                value={sleep.startDate}
                onChange={(e) => setSleep({ ...sleep, startDate: e.target.value })}
              />
              {sleepErrors.startDate && <p className="field-error">{sleepErrors.startDate}</p>}
            </div>
            <div>
              <label className="label" htmlFor="sleep-start-time">취침 시각</label>
              <input
                id="sleep-start-time"
                type="time"
                className={`input ${sleepErrors.startTime ? "input-error" : ""}`}
                value={sleep.startTime}
                onChange={(e) => setSleep({ ...sleep, startTime: e.target.value })}
              />
              {sleepErrors.startTime && <p className="field-error">{sleepErrors.startTime}</p>}
            </div>
            <div>
              <label className="label" htmlFor="sleep-end-date">기상 날짜</label>
              <input
                id="sleep-end-date"
                type="date"
                className={`input ${sleepErrors.endDate ? "input-error" : ""}`}
                value={sleep.endDate}
                onChange={(e) => setSleep({ ...sleep, endDate: e.target.value })}
              />
              {sleepErrors.endDate && <p className="field-error">{sleepErrors.endDate}</p>}
            </div>
            <div>
              <label className="label" htmlFor="sleep-end-time">기상 시각</label>
              <input
                id="sleep-end-time"
                type="time"
                className={`input ${sleepErrors.endTime ? "input-error" : ""}`}
                value={sleep.endTime}
                onChange={(e) => setSleep({ ...sleep, endTime: e.target.value })}
              />
              {sleepErrors.endTime && <p className="field-error">{sleepErrors.endTime}</p>}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl bg-indigo-50 px-3 py-2 text-xs">
            <span className="font-semibold text-indigo-500">총 수면 시간</span>
            <span className="font-black text-indigo-700">{preview ? formatMinutes(preview) : "종료 시각을 확인해 주세요"}</span>
          </div>
          <input
            className="input mt-3"
            placeholder="메모 (선택)"
            value={sleep.note}
            onChange={(e) => setSleep({ ...sleep, note: e.target.value })}
          />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button className="btn-primary flex-1" onClick={() => saveSleep(false)} disabled={busy}>
              수면 기록 저장
            </button>
            <button className="btn-soft flex-1" onClick={() => saveSleep(true)} disabled={busy}>
              수면 시작만 저장 (수면 중)
            </button>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="section-title mb-1">🍼 수유 기록</h2>
          <p className="mb-3 text-xs text-slate-500">날짜·시각과 수유량을 남겨 주세요.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="feed-date">수유 날짜</label>
              <input
                id="feed-date"
                type="date"
                className={`input ${feedErrors.startDate ? "input-error" : ""}`}
                value={feeding.startDate}
                onChange={(e) => setFeeding({ ...feeding, startDate: e.target.value })}
              />
              {feedErrors.startDate && <p className="field-error">{feedErrors.startDate}</p>}
            </div>
            <div>
              <label className="label" htmlFor="feed-time">수유 시각</label>
              <input
                id="feed-time"
                type="time"
                className={`input ${feedErrors.startTime ? "input-error" : ""}`}
                value={feeding.startTime}
                onChange={(e) => setFeeding({ ...feeding, startTime: e.target.value })}
              />
              {feedErrors.startTime && <p className="field-error">{feedErrors.startTime}</p>}
            </div>
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="feed-amount">수유량 (mL)</label>
            <input
              id="feed-amount"
              className={`input ${feedErrors.amountMl ? "input-error" : ""}`}
              value={feeding.amountMl}
              onChange={(e) => setFeeding({ ...feeding, amountMl: e.target.value })}
            />
            {feedErrors.amountMl && <p className="field-error">{feedErrors.amountMl}</p>}
          </div>
          <input
            className="input mt-3"
            placeholder="메모 (선택)"
            value={feeding.note}
            onChange={(e) => setFeeding({ ...feeding, note: e.target.value })}
          />
          <button className="btn-primary mt-3 w-full" onClick={saveFeeding} disabled={busy}>
            수유 기록 저장
          </button>
        </section>
      </div>

      <section className="card p-5">
        <h2 className="section-title mb-3">최근 기록</h2>
        {records.length === 0 ? (
          <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400">기록이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {records.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${r.type === "SLEEP" ? "bg-indigo-100 text-indigo-600" : "bg-amber-100 text-amber-700"}`}>
                  {r.type === "SLEEP" ? "수면" : "수유"}
                </span>
                <span className="font-semibold text-slate-700">{r.childNickname}</span>
                <span className="text-slate-500">
                  {r.startDateLabel} {r.startTimeLabel}
                  {r.type === "SLEEP" && r.status === "DONE" && ` → ${r.endDateLabel} ${r.endTimeLabel}`}
                </span>
                {r.overnight && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-500">자정 넘김</span>}
                <span className="ml-auto font-bold text-slate-800">
                  {r.type === "SLEEP" ? r.durationLabel : `${r.amountMl}mL`}
                </span>
                {r.note && <span className="w-full text-[11px] text-slate-400">{r.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OngoingSleep({ record, onDone }: { record: CareRecord; onDone: () => Promise<void> }) {
  const [endDate, setEndDate] = useState(kstToday(0));
  const [endTime, setEndTime] = useState(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(11, 16));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(`/api/care/sleep/${record.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate, endTime }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(data.fieldErrors ?? {});
        return;
      }
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-end gap-2 border-indigo-100 bg-indigo-50/50 p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-indigo-800">
          🌙 {record.childNickname} {record.durationLabel}
        </p>
        <p className="text-[11px] text-indigo-500">
          {record.startDateLabel} {record.startTimeLabel} 시작
        </p>
      </div>
      <div>
        <input type="date" className={`input w-auto py-1.5 ${errors.endDate ? "input-error" : ""}`} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        {errors.endDate && <p className="field-error">{errors.endDate}</p>}
      </div>
      <div>
        <input type="time" className={`input w-auto py-1.5 ${errors.endTime ? "input-error" : ""}`} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        {errors.endTime && <p className="field-error">{errors.endTime}</p>}
      </div>
      <button className="btn-primary ml-auto" onClick={finish} disabled={busy}>
        기상 · 수면 종료
      </button>
    </div>
  );
}
