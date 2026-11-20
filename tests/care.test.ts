import { beforeAll, describe, expect, it } from "vitest";
import {
  CareError,
  createFeedingRecord,
  createSleepRecord,
  endSleepRecord,
  listCareRecords,
  validateSleepInput,
} from "@/lib/care";
import { makeFamily, resetDb } from "./helpers";
import { kstDateKey } from "@/lib/date";

let ctx: Awaited<ReturnType<typeof makeFamily>>;
const NOW = new Date("2026-11-21T02:00:00+09:00");
const YESTERDAY = kstDateKey(new Date("2026-11-20T12:00:00+09:00"));
const TODAY = kstDateKey(NOW);

describe("4) 자정을 넘기는 수면 기록", () => {
  beforeAll(async () => {
    await resetDb();
    ctx = await makeFamily();
  });

  it("어제 23:40 → 오늘 01:10 을 90분으로 계산한다", () => {
    const result = validateSleepInput({
      startDate: YESTERDAY,
      startTime: "23:40",
      endDate: TODAY,
      endTime: "01:10",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.durationMinutes).toBe(90);
      expect(result.startAt.toISOString()).toBe(new Date(`${YESTERDAY}T23:40:00+09:00`).toISOString());
      expect(result.endAt?.toISOString()).toBe(new Date(`${TODAY}T01:10:00+09:00`).toISOString());
    }
  });

  it("저장하면 '1시간 30분'으로 표시된다", async () => {
    const record = await createSleepRecord({
      familyId: ctx.family.id,
      childId: ctx.second.id,
      userId: ctx.mom.id,
      startDate: YESTERDAY,
      startTime: "23:40",
      endDate: TODAY,
      endTime: "01:10",
      now: NOW,
    });
    expect(record.durationMinutes).toBe(90);
    expect(record.durationLabel).toBe("1시간 30분");
    expect(record.overnight).toBe(true);
    expect(record.status).toBe("DONE");
  });

  it("수면 시작만 저장하고, 깬 뒤 종료 시각을 입력해 마감한다", async () => {
    const ongoing = await createSleepRecord({
      familyId: ctx.family.id,
      childId: ctx.second.id,
      userId: ctx.mom.id,
      startDate: TODAY,
      startTime: "00:20",
      ongoing: true,
      now: new Date("2026-11-21T00:30:00+09:00"),
    });
    expect(ongoing.status).toBe("ONGOING");
    expect(ongoing.endAt).toBeNull();
    expect(ongoing.durationLabel).toContain("수면 중");

    const ended = await endSleepRecord({
      recordId: ongoing.id,
      familyId: ctx.family.id,
      endDate: TODAY,
      endTime: "01:50",
      now: new Date("2026-11-21T02:00:00+09:00"),
    });
    expect(ended.status).toBe("DONE");
    expect(ended.durationMinutes).toBe(90);
    expect(ended.durationLabel).toBe("1시간 30분");
  });

  it("오류는 해당 입력칸에 붙는다 — 기상 시각이 취침 시각보다 이른 경우", () => {
    const result = validateSleepInput({
      startDate: TODAY,
      startTime: "23:40",
      endDate: TODAY,
      endTime: "01:10",
      now: new Date("2026-11-22T05:00:00+09:00"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.endTime).toContain("취침 시각보다 늦어야");
      expect(result.fieldErrors.startTime).toBeUndefined();
    }
  });

  it("기상 날짜가 취침 날짜보다 빠르면 날짜 칸에 오류가 붙는다", () => {
    const result = validateSleepInput({
      startDate: TODAY,
      startTime: "23:40",
      endDate: YESTERDAY,
      endTime: "01:10",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.endDate).toContain("빠릅니다");
      expect(result.fieldErrors.endTime).toBeUndefined();
    }
  });

  it("형식 오류·누락도 칸별로 안내한다", () => {
    const badTime = validateSleepInput({ startDate: TODAY, startTime: "25:99", endDate: TODAY, endTime: "", now: NOW });
    expect(badTime.ok).toBe(false);
    if (!badTime.ok) {
      expect(badTime.fieldErrors.startTime).toContain("형식");
      expect(badTime.fieldErrors.endTime).toContain("입력해 주세요");
    }
    const missing = validateSleepInput({ startDate: "", startTime: "", endDate: "", endTime: "", now: NOW });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(Object.keys(missing.fieldErrors).sort()).toEqual(["endDate", "endTime", "startDate", "startTime"]);
    }
    const future = validateSleepInput({ startDate: TODAY, startTime: "23:00", endDate: TODAY, endTime: "23:30", now: new Date("2026-11-21T02:00:00+09:00") });
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.fieldErrors.startDate).toContain("미래");
  });

  it("잘못된 입력을 저장하려 하면 필드 오류를 담은 CareError 가 난다 (기존 기록은 남는다)", async () => {
    const before = await listCareRecords({ familyId: ctx.family.id, childId: ctx.second.id });
    await expect(
      createSleepRecord({
        familyId: ctx.family.id,
        childId: ctx.second.id,
        userId: ctx.mom.id,
        startDate: TODAY,
        startTime: "01:00",
        endDate: TODAY,
        endTime: "00:30",
        now: new Date("2026-11-21T05:00:00+09:00"),
      }),
    ).rejects.toBeInstanceOf(CareError);
    const after = await listCareRecords({ familyId: ctx.family.id, childId: ctx.second.id });
    expect(after.length).toBe(before.length);
  });

  it("종료 시각이 시작보다 이르면 종료 입력칸에 오류가 난다", async () => {
    const ongoing = await createSleepRecord({
      familyId: ctx.family.id,
      childId: ctx.second.id,
      userId: ctx.mom.id,
      startDate: TODAY,
      startTime: "00:20",
      ongoing: true,
      now: new Date("2026-11-21T00:30:00+09:00"),
    });
    await expect(
      endSleepRecord({
        recordId: ongoing.id,
        familyId: ctx.family.id,
        endDate: TODAY,
        endTime: "00:10",
        now: new Date("2026-11-21T02:00:00+09:00"),
      }),
    ).rejects.toMatchObject({ fieldErrors: { endTime: expect.any(String) } });
  });

  it("수유 기록도 검증·저장되고 수유량 오류는 해당 칸에 붙는다", async () => {
    const feeding = await createFeedingRecord({
      familyId: ctx.family.id,
      childId: ctx.second.id,
      userId: ctx.mom.id,
      startDate: TODAY,
      startTime: "08:30",
      amountMl: 180,
      now: NOW,
    });
    expect(feeding.amountMl).toBe(180);
    expect(feeding.durationLabel).toBe("-");

    await expect(
      createFeedingRecord({
        familyId: ctx.family.id,
        childId: ctx.second.id,
        userId: ctx.mom.id,
        startDate: TODAY,
        startTime: "08:30",
        amountMl: "많이",
        now: NOW,
      }),
    ).rejects.toMatchObject({ fieldErrors: { amountMl: expect.any(String) } });
  });
});
