import type { Schedule } from './types';

// 보할 공정표(Schedule)를 엑셀에서 바로 열 수 있는 CSV 문자열로 바꿉니다.

/** UTF-8 BOM. 엑셀이 한글을 UTF-8로 읽게 합니다. */
export const CSV_BOM = '﻿';
/** 줄 구분(엑셀 호환) */
export const CSV_LINE_BREAK = '\r\n';

/** 하단 4행의 이름(순서 고정) */
export const CSV_TOTAL_LABELS = ['기간 계획(%)', '누계 계획(%)', '기간 실적(%)', '누계 실적(%)'] as const;

/** 기간 열 앞에 오는 고정 열 이름. 세 번째 열은 보할 기준에 따라 금액 또는 가중치입니다. */
export function csvFixedHeaders(weightBasis: Schedule['project']['weightBasis']): string[] {
  return ['구분', '공종명', weightBasis === 'manual' ? '가중치' : '금액', '보할(%)', '시작일', '종료일', '진척률(%)'];
}

/** 비율을 소수 둘째 자리로 반올림한 문자열로 바꿉니다. null은 빈 값입니다. */
export function formatCsvPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  // 18.985처럼 이진 표현 때문에 내림되는 값을 보정한 뒤 반올림합니다.
  const rounded = Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
  // -0은 0으로 씁니다.
  return (rounded === 0 ? 0 : rounded).toFixed(2);
}

/** 쉼표, 큰따옴표, 줄바꿈이 있는 값은 큰따옴표로 감싸고 내부 큰따옴표는 두 번 씁니다. */
export function escapeCsvValue(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function toLine(values: readonly string[]): string {
  return values.map(escapeCsvValue).join(',');
}

/**
 * 공정표를 CSV 문자열로 바꿉니다.
 * - 첫 행: 고정 열 이름 + 기간 이름
 * - 이어서 공종마다 한 행
 * - 마지막 4행: 기간 계획, 누계 계획, 기간 실적, 누계 실적
 * 문자열은 UTF-8 BOM으로 시작하고 각 행은 CRLF로 끝납니다.
 */
export function scheduleToCsv(schedule: Schedule): string {
  const fixedHeaders = csvFixedHeaders(schedule.project.weightBasis);
  const lines: string[] = [toLine([...fixedHeaders, ...schedule.periods.map((period) => period.label)])];

  for (const row of schedule.rows) {
    lines.push(
      toLine([
        row.category,
        row.name,
        String(row.weightValue),
        formatCsvPercent(row.bohal),
        row.startDate,
        row.endDate,
        formatCsvPercent(row.currentPercent),
        ...row.planned.map(formatCsvPercent),
      ]),
    );
  }

  const { totals } = schedule;
  const totalRows: (number | null)[][] = [
    totals.periodPlanned,
    totals.cumulativePlanned,
    totals.periodActual,
    totals.cumulativeActual,
  ];
  // 이름은 첫 열에 쓰고 나머지 고정 열은 비워 기간 열 위치를 공종 행과 맞춥니다.
  const padding = new Array<string>(fixedHeaders.length - 1).fill('');
  totalRows.forEach((values, index) => {
    lines.push(toLine([CSV_TOTAL_LABELS[index], ...padding, ...values.map(formatCsvPercent)]));
  });

  return CSV_BOM + lines.map((line) => line + CSV_LINE_BREAK).join('');
}
