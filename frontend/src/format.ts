export const TZ_DEFAULT = "Asia/Seoul";

export function fmtDateTime(iso: string | null | undefined, tz = TZ_DEFAULT) {
  if (!iso) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(iso));
}

export function fmtTime(d: Date | string, tz = TZ_DEFAULT, seconds = true) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined, hour12: false,
  }).format(typeof d === "string" ? new Date(d) : d);
}

export function fmtBytes(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export function ago(iso: string | null | undefined) {
  if (!iso) return "-";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

// 현장 시간대 기준 날짜/시각 → 절대 시각
export function zonedToDate(dateStr: string, timeStr: string, tz = TZ_DEFAULT): Date {
  // dateStr YYYY-MM-DD, timeStr HH:MM[:SS]
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm, ss = 0] = timeStr.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}

export function tzOffsetMs(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

export function todayIn(tz = TZ_DEFAULT) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(new Date());
}

export function timeIn(d: Date, tz = TZ_DEFAULT) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
}
