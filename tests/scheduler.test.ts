import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextDailyRun, nextWeeklyRun } from '../src/scheduler.ts';

const iso = (date: Date) => date.toISOString();

test('nextDailyRun: 오늘 실행 시각이 남았으면 오늘', () => {
  const from = new Date('2026-11-24T20:00:00Z'); // KST 11-25 05:00
  assert.equal(iso(nextDailyRun('09:00', from)), '2026-11-25T00:00:00.000Z');
});

test('nextDailyRun: 시각이 지났으면 내일', () => {
  const from = new Date('2026-11-25T01:00:00Z'); // KST 10:00
  assert.equal(iso(nextDailyRun('09:00', from)), '2026-11-26T00:00:00.000Z');
});

test('nextDailyRun: 정각과 같으면 다음 날', () => {
  const from = new Date('2026-11-25T00:00:00Z'); // KST 09:00:00
  assert.equal(iso(nextDailyRun('09:00', from)), '2026-11-26T00:00:00.000Z');
});

test('nextDailyRun: 자정 직후 실행 시각', () => {
  const from = new Date('2026-11-24T15:30:00Z'); // KST 11-25 00:30
  assert.equal(iso(nextDailyRun('00:10', from)), '2026-11-25T15:10:00.000Z');
});

test('nextWeeklyRun: 월요일 09:00 (수요일 기준)', () => {
  const from = new Date('2026-11-25T00:00:00Z'); // KST 수 09:00
  assert.equal(iso(nextWeeklyRun('09:00', 1, from)), '2026-11-30T00:00:00.000Z');
});

test('nextWeeklyRun: 같은 요일이고 시각 전이면 오늘', () => {
  const from = new Date('2026-11-24T23:00:00Z'); // KST 수 08:00
  assert.equal(iso(nextWeeklyRun('09:00', 3, from)), '2026-11-25T00:00:00.000Z');
});

test('nextWeeklyRun: 일요일(7) 처리', () => {
  const from = new Date('2026-11-25T00:00:00Z');
  assert.equal(iso(nextWeeklyRun('18:00', 7, from)), '2026-11-29T09:00:00.000Z');
});
