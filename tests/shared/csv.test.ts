import { describe, expect, it } from 'vitest';
import { buildSchedule } from '../../src/shared/bohal';
import { CSV_BOM, escapeCsvValue, formatCsvPercent, scheduleToCsv } from '../../src/shared/csv';
import type { ProgressRecord, Project, Task } from '../../src/shared/types';

const project: Project = {
  id: 'p1',
  name: '예제 프로젝트',
  description: '',
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  weightBasis: 'amount',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function task(id: string, order: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: 'p1',
    category: '',
    name: id,
    weightValue: 1,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    order,
    ...overrides,
  };
}

const taskA = task('a', 0, { category: '토목', name: '공종 A', weightValue: 60_000_000 });
const taskB = task('b', 1, {
  category: '건축',
  name: '공종 B',
  weightValue: 40_000_000,
  startDate: '2026-02-01',
  endDate: '2026-03-31',
});

const progress: ProgressRecord[] = [
  { id: 'r1', taskId: 'a', date: '2026-01-31', percent: 100 },
  { id: 'r2', taskId: 'b', date: '2026-02-28', percent: 50 },
];

/** 큰따옴표 규칙을 따르는 CSV 본문을 행·열로 나눕니다(검증용 최소 파서). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function exampleCsv(): string {
  return scheduleToCsv(buildSchedule(project, [taskA, taskB], progress, 'month', '2026-02-28'));
}

describe('scheduleToCsv', () => {
  it('AC-F8-2: UTF-8 BOM으로 시작하고 BOM은 한 번만 들어간다', () => {
    const csv = exampleCsv();

    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.indexOf(CSV_BOM, 1)).toBe(-1);
    expect([...Buffer.from(csv, 'utf8').subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('AC-F8-2: 첫 행은 고정 열 이름과 기간 이름이다', () => {
    const rows = parseCsv(exampleCsv().slice(1));

    expect(rows[0]).toEqual([
      '구분',
      '공종명',
      '금액',
      '보할(%)',
      '시작일',
      '종료일',
      '진척률(%)',
      '2026년 1월',
      '2026년 2월',
      '2026년 3월',
    ]);
  });

  it('AC-F8-2, AC-F8-4: 공종 행 수는 공종 수와 같고 값은 소수 둘째 자리이며 null은 빈 값이다', () => {
    const rows = parseCsv(exampleCsv().slice(1));

    expect(rows).toHaveLength(1 + 2 + 4);
    expect(rows[1]).toEqual(['토목', '공종 A', '60000000', '60.00', '2026-01-01', '2026-01-31', '100.00', '60.00', '', '']);
    expect(rows[2]).toEqual(['건축', '공종 B', '40000000', '40.00', '2026-02-01', '2026-03-31', '50.00', '', '18.98', '21.02']);
  });

  it('AC-F8-2, AC-F8-4: 마지막 4행은 기간 계획·누계 계획·기간 실적·누계 실적이다', () => {
    const rows = parseCsv(exampleCsv().slice(1));

    expect(rows.slice(-4)).toEqual([
      ['기간 계획(%)', '', '', '', '', '', '', '60.00', '18.98', '21.02'],
      ['누계 계획(%)', '', '', '', '', '', '', '60.00', '78.98', '100.00'],
      ['기간 실적(%)', '', '', '', '', '', '', '60.00', '20.00', ''],
      ['누계 실적(%)', '', '', '', '', '', '', '60.00', '80.00', ''],
    ]);
  });

  it('모든 행은 CRLF로 끝나고 열 수가 같다', () => {
    const csv = exampleCsv();
    const rows = parseCsv(csv.slice(1));

    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(new Set(rows.map((row) => row.length))).toEqual(new Set([10]));
  });

  it('AC-F8-3: 쉼표·큰따옴표·줄바꿈이 있는 값은 큰따옴표로 감싸 열이 어긋나지 않는다', () => {
    const tricky = [
      task('t1', 0, { category: '토목, 기초', name: '터파기 "1차"' }),
      task('t2', 1, { category: '건축', name: '골조\n(지상)' }),
    ];
    const csv = scheduleToCsv(buildSchedule(project, tricky, [], 'month', '2026-01-15'));

    expect(csv).toContain('"토목, 기초","터파기 ""1차""",1,50.00,');
    expect(csv).toContain('건축,"골조\n(지상)",1,50.00,');
    const rows = parseCsv(csv.slice(1));
    expect(rows).toHaveLength(1 + 2 + 4);
    expect(rows[1].slice(0, 2)).toEqual(['토목, 기초', '터파기 "1차"']);
    expect(rows[2].slice(0, 2)).toEqual(['건축', '골조\n(지상)']);
    expect(new Set(rows.map((row) => row.length))).toEqual(new Set([10]));
  });

  it('가중치 기준 프로젝트는 세 번째 열 이름이 "가중치"이다', () => {
    const manual: Project = { ...project, weightBasis: 'manual' };
    const tasks = [task('t1', 0, { weightValue: 2 }), task('t2', 1, { weightValue: 6 })];
    const rows = parseCsv(scheduleToCsv(buildSchedule(manual, tasks, [], 'month', '2026-01-15')).slice(1));

    expect(rows[0][2]).toBe('가중치');
    expect(rows[1].slice(2, 4)).toEqual(['2', '25.00']);
    expect(rows[2].slice(2, 4)).toEqual(['6', '75.00']);
  });

  it('공종이 없으면 머리글과 하단 4행만 있고 계획은 0.00이다', () => {
    const rows = parseCsv(scheduleToCsv(buildSchedule(project, [], [], 'month', '2026-02-28')).slice(1));

    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual(['기간 계획(%)', '', '', '', '', '', '', '0.00', '0.00', '0.00']);
    expect(rows[4]).toEqual(['누계 실적(%)', '', '', '', '', '', '', '0.00', '0.00', '']);
  });

  it('주 단위 공정표는 주 기간 이름을 열로 쓴다', () => {
    const short: Project = { ...project, endDate: '2026-01-14' };
    const tasks = [task('t1', 0, { endDate: '2026-01-14' })];
    const schedule = buildSchedule(short, tasks, [], 'week', '2026-01-05');
    const rows = parseCsv(scheduleToCsv(schedule).slice(1));

    expect(rows[0].slice(7)).toEqual(schedule.periods.map((period) => period.label));
    expect(rows[2].slice(7)).toEqual(['28.57', '50.00', '21.43']);
  });
});

describe('formatCsvPercent', () => {
  it('AC-F8-4: 소수 둘째 자리로 반올림한다', () => {
    expect(formatCsvPercent(18.983050847457626)).toBe('18.98');
    expect(formatCsvPercent(21.016949152542374)).toBe('21.02');
    expect(formatCsvPercent(28.571428571428573)).toBe('28.57');
    expect(formatCsvPercent(100)).toBe('100.00');
    expect(formatCsvPercent(0)).toBe('0.00');
    expect(formatCsvPercent(1.005)).toBe('1.01');
    expect(formatCsvPercent(99.995)).toBe('100.00');
  });

  it('null은 빈 값이고 -0은 0.00이다', () => {
    expect(formatCsvPercent(null)).toBe('');
    expect(formatCsvPercent(-0.001)).toBe('0.00');
    expect(formatCsvPercent(-1.024)).toBe('-1.02');
  });
});

describe('escapeCsvValue', () => {
  it('특수문자가 없으면 그대로 둔다', () => {
    expect(escapeCsvValue('공종 A')).toBe('공종 A');
    expect(escapeCsvValue('')).toBe('');
  });

  it('쉼표, 큰따옴표, 줄바꿈이 있으면 감싸고 큰따옴표는 두 번 쓴다', () => {
    expect(escapeCsvValue('a,b')).toBe('"a,b"');
    expect(escapeCsvValue('"인용"')).toBe('"""인용"""');
    expect(escapeCsvValue('a\nb')).toBe('"a\nb"');
    expect(escapeCsvValue('a\r\nb')).toBe('"a\r\nb"');
  });
});
