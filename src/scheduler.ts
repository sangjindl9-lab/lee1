import type { AppConfig } from './config.ts';
import type { Store } from './db.ts';
import { checkRanks, generateScheduledDrafts, parseChannels } from './service.ts';
import type { Channel } from './content/templates.ts';
import { kstDateString, kstDateTimeString, kstTimeToUtc, sleep } from './util.ts';

export interface SchedulerHandle {
  stop: () => void;
  nextRuns: () => { rank: string | null; content: string | null };
}

/** 매일 HH:MM (KST) 다음 실행 시각 */
export function nextDailyRun(hhmm: string, from: Date = new Date()): Date {
  const today = kstTimeToUtc(from, hhmm);
  if (today.getTime() > from.getTime() + 1000) return today;
  return new Date(today.getTime() + 24 * 3_600_000);
}

/** 매주 weekday(1=월 … 7=일) HH:MM (KST) 다음 실행 시각 */
export function nextWeeklyRun(hhmm: string, weekday: number, from: Date = new Date()): Date {
  const target = Math.min(7, Math.max(1, weekday));
  const shifted = new Date(from.getTime() + 9 * 3_600_000);
  const currentWeekday = shifted.getUTCDay() === 0 ? 7 : shifted.getUTCDay();
  let deltaDays = (target - currentWeekday + 7) % 7;
  let candidate = new Date(kstTimeToUtc(new Date(from.getTime() + deltaDays * 86_400_000), hhmm).getTime());
  if (deltaDays === 0 && candidate.getTime() <= from.getTime() + 1000) {
    deltaDays = 7;
    candidate = new Date(kstTimeToUtc(new Date(from.getTime() + deltaDays * 86_400_000), hhmm).getTime());
  }
  return candidate;
}

export function computeNextRankRun(store: Store, from: Date = new Date()): Date | null {
  if (store.getSetting('rank_schedule_enabled') !== 'true') return null;
  try {
    return nextDailyRun(store.getSetting('rank_schedule_time') || '09:00', from);
  } catch {
    return null;
  }
}

export function computeNextContentRun(store: Store, from: Date = new Date()): Date | null {
  if (store.getSetting('content_schedule_enabled') !== 'true') return null;
  const hhmm = store.getSetting('content_schedule_time') || '10:00';
  const frequency = store.getSetting('content_schedule_frequency') || 'daily';
  try {
    if (frequency === 'weekly') {
      return nextWeeklyRun(hhmm, Number.parseInt(store.getSetting('content_schedule_weekday') || '1', 10), from);
    }
    return nextDailyRun(hhmm, from);
  } catch {
    return null;
  }
}

export async function runRankJob(store: Store, config: AppConfig): Promise<{ ok: boolean; message: string }> {
  const jobId = store.startJob('rank_check', { date: kstDateString() });
  try {
    const outcomes = await checkRanks(store, config);
    const total = outcomes.reduce((sum, o) => sum + o.items.length, 0);
    const errors = outcomes.reduce((sum, o) => sum + o.errors.length, 0);
    const message = `키워드 ${total}개 점검 완료${errors ? ` · 오류 ${errors}개` : ''}`;
    store.finishJob(jobId, errors > 0 && total === errors ? 'failed' : 'success', message);
    return { ok: true, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.finishJob(jobId, 'failed', message);
    return { ok: false, message };
  }
}

export async function runContentJob(store: Store, config: AppConfig): Promise<{ ok: boolean; message: string }> {
  const jobId = store.startJob('content_generation', { channels: store.getSetting('content_schedule_channels') });
  try {
    const channels = parseChannels(store.getSetting('content_schedule_channels'));
    const targetChannels: Channel[] = channels.length ? channels : ['naver_blog', 'community', 'shorts'];
    const drafts = await generateScheduledDrafts(store, config, targetChannels);
    const okCount = drafts.filter((d) => d.draftId > 0).length;
    const message = `홍보 초안 ${okCount}개 생성${drafts.length - okCount ? ` · 실패 ${drafts.length - okCount}개` : ''}`;
    store.finishJob(jobId, okCount > 0 ? 'success' : 'failed', message);
    return { ok: okCount > 0, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.finishJob(jobId, 'failed', message);
    return { ok: false, message };
  }
}

/**
 * 서버 내장 스케줄러. 매 30초 확인해 설정 시각이 지나면 점검을 실행합니다.
 * (별도 크론 없이 동작하며, 같은 날 중복 실행을 막습니다.)
 */
export function startScheduler(store: Store, config: AppConfig, log: (msg: string) => void = () => {}): SchedulerHandle {
  let stopped = false;
  let runningRank = false;
  let runningContent = false;
  let lastRankDate: string | null = null;
  let lastContentKey: string | null = null;

  const tick = async () => {
    if (stopped) return;
    const now = new Date();
    const rankNext = computeNextRankRun(store, now);
    if (rankNext && rankNext.getTime() <= now.getTime() && !runningRank) {
      const dateKey = kstDateString(now);
      if (lastRankDate !== dateKey) {
        runningRank = true;
        lastRankDate = dateKey;
        log(`[스케줄러] 순위 자동 점검 시작 (${kstDateTimeString(now)})`);
        try {
          const result = await runRankJob(store, config);
          log(`[스케줄러] 순위 점검 결과: ${result.message}`);
        } finally {
          runningRank = false;
        }
      }
    }

    const contentNext = computeNextContentRun(store, now);
    if (contentNext && contentNext.getTime() <= now.getTime() && !runningContent) {
      const key = `${kstDateString(now)}:${store.getSetting('content_schedule_time')}`;
      if (lastContentKey !== key) {
        runningContent = true;
        lastContentKey = key;
        log(`[스케줄러] 홍보 초안 자동 생성 시작 (${kstDateTimeString(now)})`);
        try {
          const result = await runContentJob(store, config);
          log(`[스케줄러] 초안 생성 결과: ${result.message}`);
        } finally {
          runningContent = false;
        }
      }
    }
  };

  const loop = (async () => {
    // 시작 직후 한 번 확인(설정 시각이 이미 지났고 오늘 실행 기록이 없으면 바로 실행)
    await sleep(5_000);
    while (!stopped) {
      try {
        await tick();
      } catch (err) {
        log(`[스케줄러] 오류: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(30_000);
    }
  })();

  void loop;

  return {
    stop: () => {
      stopped = true;
    },
    nextRuns: () => {
      const rank = computeNextRankRun(store);
      const content = computeNextContentRun(store);
      return {
        rank: rank ? rank.toISOString() : null,
        content: content ? content.toISOString() : null,
      };
    },
  };
}
