import type { CareRecord } from "@prisma/client";
import prisma from "./db";
import {
  diffMinutes,
  formatDuration,
  formatKstDate,
  formatKstTime,
  isValidDateString,
  isValidTimeString,
  kstDateKey,
  parseKstDateTime,
} from "./date";

export type FieldErrors = Record<string, string>;

export type SleepValidation =
  | { ok: true; startAt: Date; endAt: Date | null; durationMinutes: number | null }
  | { ok: false; fieldErrors: FieldErrors };

function parseDateField(value: string | null | undefined, field: string, label: string, errors: FieldErrors): Date | null {
  if (!value) {
    errors[field] = `${label}를 입력해 주세요.`;
    return null;
  }
  if (!isValidDateString(value)) {
    errors[field] = "날짜 형식이 올바르지 않습니다. (예: 2026-11-20)";
    return null;
  }
  return new Date(`${value}T00:00:00+09:00`);
}

/**
 * 수면 기록 검증 — 어제 23:40 → 오늘 01:10 처럼 자정을 넘기는 기록을 정상 처리한다.
 * 오류는 "시간이 잘못되었습니다" 하나로 뭉개지 않고, 고쳐야 할 입력칸에 붙인다.
 */
export function validateSleepInput(input: {
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  ongoing?: boolean;
  now?: Date;
}): SleepValidation {
  const errors: FieldErrors = {};
  const now = input.now ?? new Date();

  const startDay = parseDateField(input.startDate, "startDate", "취침 날짜", errors);
  let startAt: Date | null = null;
  if (input.startTime == null || input.startTime === "") {
    errors.startTime = "취침 시각을 입력해 주세요.";
  } else if (!isValidTimeString(input.startTime)) {
    errors.startTime = "시각 형식이 올바르지 않습니다. (예: 23:40)";
  }
  if (startDay && !errors.startTime) {
    startAt = parseKstDateTime(input.startDate as string, input.startTime as string);
    if (startAt.getTime() > now.getTime() + 5 * 60 * 1000) {
      errors.startDate = "미래 날짜·시각은 기록할 수 없습니다.";
    }
  }

  let endAt: Date | null = null;
  const hasEndDate = Boolean(input.endDate);
  const hasEndTime = Boolean(input.endTime);

  if (!input.ongoing) {
    if (!hasEndDate) errors.endDate = "기상 날짜를 입력해 주세요.";
    else if (!isValidDateString(input.endDate as string)) errors.endDate = "날짜 형식이 올바르지 않습니다. (예: 2026-11-21)";

    if (!hasEndTime) errors.endTime = "기상 시각을 입력해 주세요.";
    else if (!isValidTimeString(input.endTime as string)) errors.endTime = "시각 형식은 HH:MM 입니다. (예: 01:10)";

    if (!errors.endDate && !errors.endTime && startDay && startAt) {
      endAt = parseKstDateTime(input.endDate as string, input.endTime as string);
      const startKey = input.startDate as string;
      const endKey = input.endDate as string;
      if (endKey < startKey) {
        errors.endDate = "기상 날짜가 취침 날짜보다 빠릅니다.";
      } else if (endKey === startKey && endAt.getTime() <= startAt.getTime()) {
        errors.endTime = "기상 시각은 취침 시각보다 늦어야 합니다.";
      } else if (diffMinutes(startAt, endAt) > 24 * 60) {
        errors.endDate = "한 번의 수면 기록은 24시간을 넘을 수 없습니다.";
      }
    }
  } else if (hasEndDate || hasEndTime) {
    // 수면 중 저장인데 종료 시각이 일부만 들어온 경우
    if (!hasEndDate) errors.endDate = "기상 날짜를 함께 입력해 주세요.";
    if (!hasEndTime) errors.endTime = "기상 시각을 함께 입력해 주세요.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  if (!startAt) return { ok: false, fieldErrors: { startTime: "취침 시각을 확인해 주세요." } };
  return {
    ok: true,
    startAt,
    endAt,
    durationMinutes: endAt ? diffMinutes(startAt, endAt) : null,
  };
}

export class CareError extends Error {
  code: string;
  status: number;
  fieldErrors?: FieldErrors;
  constructor(code: string, message: string, status = 400, fieldErrors?: FieldErrors) {
    super(message);
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export async function assertChild(childId: string, familyId: string) {
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child) throw new CareError("CHILD_NOT_FOUND", "아이를 찾을 수 없습니다.", 404);
  return child;
}

export function serializeCare(record: CareRecord & { child?: { name: string; nickname: string } | null }) {
  const ongoing = record.status === "ONGOING";
  const elapsed = ongoing ? diffMinutes(record.startAt, new Date()) : null;
  return {
    id: record.id,
    type: record.type,
    childId: record.childId,
    childName: record.child?.name ?? null,
    childNickname: record.child?.nickname ?? null,
    startAt: record.startAt.toISOString(),
    endAt: record.endAt ? record.endAt.toISOString() : null,
    startDateLabel: formatKstDate(record.startAt),
    startTimeLabel: formatKstTime(record.startAt),
    endDateLabel: record.endAt ? formatKstDate(record.endAt) : null,
    endTimeLabel: record.endAt ? formatKstTime(record.endAt) : null,
    durationMinutes: record.durationMinutes,
    durationLabel: ongoing
      ? `수면 중 · ${formatDuration(elapsed ?? 0)} 경과`
      : formatDuration(record.durationMinutes),
    status: record.status,
    amountMl: record.amountMl,
    note: record.note,
    overnight: Boolean(record.endAt && kstDateKey(record.startAt) !== kstDateKey(record.endAt)),
    createdAt: record.createdAt.toISOString(),
  };
}

export async function createSleepRecord(input: {
  familyId: string;
  childId: string;
  userId: string;
  startDate?: string | null;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  ongoing?: boolean;
  note?: string | null;
  now?: Date;
}) {
  await assertChild(input.childId, input.familyId);
  const result = validateSleepInput(input);
  if (!result.ok) throw new CareError("INVALID_SLEEP_INPUT", "수면 기록 입력값을 확인해 주세요.", 422, result.fieldErrors);
  const record = await prisma.careRecord.create({
    data: {
      familyId: input.familyId,
      childId: input.childId,
      type: "SLEEP",
      startAt: result.startAt,
      endAt: result.endAt,
      durationMinutes: result.durationMinutes,
      status: result.endAt ? "DONE" : "ONGOING",
      note: input.note?.trim() || null,
      createdById: input.userId,
    },
    include: { child: { select: { name: true, nickname: true } } },
  });
  return serializeCare(record);
}

/** 수면 중인 기록에 기상 시각을 입력해 종료한다. */
export async function endSleepRecord(input: {
  recordId: string;
  familyId: string;
  endDate?: string | null;
  endTime?: string | null;
  now?: Date;
}) {
  const record = await prisma.careRecord.findFirst({ where: { id: input.recordId, familyId: input.familyId } });
  if (!record) throw new CareError("RECORD_NOT_FOUND", "수면 기록을 찾을 수 없습니다.", 404);
  if (record.type !== "SLEEP") throw new CareError("NOT_SLEEP", "수면 기록이 아닙니다.");
  if (record.status === "DONE") throw new CareError("ALREADY_ENDED", "이미 종료된 수면 기록입니다.", 409);

  const startKey = kstDateKey(record.startAt);
  const startTimeStr = formatKstTime(record.startAt);
  const result = validateSleepInput({
    startDate: startKey,
    startTime: startTimeStr,
    endDate: input.endDate,
    endTime: input.endTime,
    now: input.now,
  });
  if (!result.ok || !result.endAt) {
    throw new CareError(
      "INVALID_SLEEP_INPUT",
      "종료 시각을 확인해 주세요.",
      422,
      result.ok ? { endTime: "기상 시각을 확인해 주세요." } : result.fieldErrors,
    );
  }
  const updated = await prisma.careRecord.update({
    where: { id: record.id },
    data: { endAt: result.endAt, durationMinutes: result.durationMinutes, status: "DONE" },
    include: { child: { select: { name: true, nickname: true } } },
  });
  return serializeCare(updated);
}

export async function createFeedingRecord(input: {
  familyId: string;
  childId: string;
  userId: string;
  startDate?: string | null;
  startTime?: string | null;
  amountMl?: number | string | null;
  note?: string | null;
  now?: Date;
}) {
  await assertChild(input.childId, input.familyId);
  const errors: FieldErrors = {};
  if (!input.startDate) errors.startDate = "수유 날짜를 입력해 주세요.";
  else if (!isValidDateString(input.startDate)) errors.startDate = "날짜 형식이 올바르지 않습니다. (예: 2026-11-21)";
  if (!input.startTime) errors.startTime = "수유 시각을 입력해 주세요.";
  else if (!isValidTimeString(input.startTime)) errors.startTime = "시각 형식이 올바르지 않습니다. (예: 08:30)";
  const amount = Number(input.amountMl);
  if (input.amountMl == null || input.amountMl === "" || Number.isNaN(amount)) errors.amountMl = "수유량(mL)을 숫자로 입력해 주세요.";
  else if (amount <= 0 || amount > 2000) errors.amountMl = "수유량은 1~2000mL 사이로 입력해 주세요.";
  if (Object.keys(errors).length > 0) throw new CareError("INVALID_FEEDING_INPUT", "수유 기록 입력값을 확인해 주세요.", 422, errors);

  const startAt = parseKstDateTime(input.startDate as string, input.startTime as string);
  const record = await prisma.careRecord.create({
    data: {
      familyId: input.familyId,
      childId: input.childId,
      type: "FEEDING",
      startAt,
      amountMl: Math.round(amount),
      status: "DONE",
      note: input.note?.trim() || null,
      createdById: input.userId,
    },
    include: { child: { select: { name: true, nickname: true } } },
  });
  return serializeCare(record);
}

export async function listCareRecords(opts: { familyId: string; childId?: string; days?: number }) {
  const since = new Date(Date.now() - (opts.days ?? 14) * 24 * 3600 * 1000);
  const rows = await prisma.careRecord.findMany({
    where: {
      familyId: opts.familyId,
      ...(opts.childId ? { childId: opts.childId } : {}),
      OR: [{ startAt: { gte: since } }, { status: "ONGOING" }],
    },
    include: { child: { select: { name: true, nickname: true } } },
    orderBy: { startAt: "desc" },
    take: 200,
  });
  return rows.map(serializeCare);
}

export async function careSummary(familyId: string, childId?: string) {
  const ongoing = await prisma.careRecord.findMany({
    where: { familyId, status: "ONGOING", ...(childId ? { childId } : {}) },
    include: { child: { select: { name: true, nickname: true } } },
  });
  const todayKey = kstDateKey(new Date());
  const today = await prisma.careRecord.findMany({
    where: {
      familyId,
      ...(childId ? { childId } : {}),
      startAt: { gte: new Date(`${todayKey}T00:00:00+09:00`), lt: new Date(`${todayKey}T23:59:59+09:00`) },
    },
  });
  const sleepMinutes = today
    .filter((r) => r.type === "SLEEP" && r.durationMinutes != null)
    .reduce((sum, r) => sum + (r.durationMinutes ?? 0), 0);
  const feedMl = today.filter((r) => r.type === "FEEDING").reduce((sum, r) => sum + (r.amountMl ?? 0), 0);
  return {
    ongoing: ongoing.map(serializeCare),
    todaySleepMinutes: sleepMinutes,
    todaySleepLabel: formatDuration(sleepMinutes),
    todayFeedMl: feedMl,
  };
}
