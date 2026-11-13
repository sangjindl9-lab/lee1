import { describe, expect, it } from 'vitest';
import {
  MESSAGES,
  validateProgress,
  validateProject,
  validateTask,
} from '../../src/shared/validation';

const validProject = {
  name: '예제 프로젝트',
  description: '설명',
  startDate: '2026-01-01',
  endDate: '2026-03-31',
  weightBasis: 'amount',
};

const projectRange = { startDate: '2026-01-01', endDate: '2026-03-31' };

const validTask = {
  category: '토목',
  name: '터파기',
  weightValue: 6000,
  startDate: '2026-01-01',
  endDate: '2026-01-31',
};

describe('validateProject', () => {
  it('정상 입력이면 빈 객체를 반환한다', () => {
    expect(validateProject(validProject)).toEqual({});
  });

  it('설명과 보할 기준이 없어도 통과한다 (AC-F1-4: 기본값은 저장 단계에서 amount)', () => {
    expect(
      validateProject({ name: '이름', startDate: '2026-01-01', endDate: '2026-01-01' }),
    ).toEqual({});
    expect(validateProject({ ...validProject, weightBasis: 'manual' })).toEqual({});
  });

  it('AC-F1-2: 이름이 비어 있으면 "프로젝트 이름을 입력하세요."를 반환한다', () => {
    expect(validateProject({ ...validProject, name: '' })).toEqual({
      name: '프로젝트 이름을 입력하세요.',
    });
    expect(validateProject({ ...validProject, name: '   ' }).name).toBe('프로젝트 이름을 입력하세요.');
    expect(validateProject({ ...validProject, name: undefined }).name).toBe(
      '프로젝트 이름을 입력하세요.',
    );
    expect(validateProject({ ...validProject, name: 123 }).name).toBe('프로젝트 이름을 입력하세요.');
  });

  it('이름은 100자까지 허용하고 101자는 거부한다', () => {
    expect(validateProject({ ...validProject, name: '가'.repeat(100) })).toEqual({});
    expect(validateProject({ ...validProject, name: '가'.repeat(101) })).toEqual({
      name: '프로젝트 이름은 100자 이하로 입력하세요.',
    });
  });

  it('날짜가 비었거나 형식이 틀리거나 실재하지 않으면 해당 필드에 오류를 반환한다', () => {
    expect(validateProject({ ...validProject, startDate: '' })).toEqual({
      startDate: '시작일을 입력하세요.',
    });
    expect(validateProject({ ...validProject, endDate: undefined })).toEqual({
      endDate: '종료일을 입력하세요.',
    });
    expect(validateProject({ ...validProject, startDate: '2026/01/01' })).toEqual({
      startDate: '시작일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
    });
    expect(validateProject({ ...validProject, endDate: '2026-02-30' })).toEqual({
      endDate: '종료일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
    });
  });

  it('AC-F1-3: 종료일이 시작일보다 이르면 endDate 오류를 반환하고, 같은 날은 허용한다', () => {
    expect(
      validateProject({ ...validProject, startDate: '2026-03-01', endDate: '2026-02-28' }),
    ).toEqual({ endDate: '종료일은 시작일보다 빠를 수 없습니다.' });
    expect(
      validateProject({ ...validProject, startDate: '2026-03-01', endDate: '2026-03-01' }),
    ).toEqual({});
  });

  it('weightBasis가 amount, manual이 아니면 거부한다', () => {
    expect(validateProject({ ...validProject, weightBasis: 'cost' })).toEqual({
      weightBasis: '보할 기준은 금액 또는 가중치 중에서 선택하세요.',
    });
  });

  it('설명이 문자가 아니면 거부한다', () => {
    expect(validateProject({ ...validProject, description: 1 })).toEqual({
      description: '설명은 문자로 입력하세요.',
    });
  });

  it('AC-F1-6: 기간을 줄여 기존 공종이 벗어나면 벗어난 쪽 필드에 오류를 반환한다', () => {
    const tasks = [
      { startDate: '2026-01-01', endDate: '2026-01-31' },
      { startDate: '2026-02-01', endDate: '2026-03-31' },
    ];
    const message = '프로젝트 기간은 등록된 공종의 기간을 모두 포함해야 합니다.';

    expect(validateProject(validProject, tasks)).toEqual({});
    expect(validateProject({ ...validProject, endDate: '2026-03-30' }, tasks)).toEqual({
      endDate: message,
    });
    expect(validateProject({ ...validProject, startDate: '2026-01-02' }, tasks)).toEqual({
      startDate: message,
    });
    expect(
      validateProject({ ...validProject, startDate: '2026-01-15', endDate: '2026-03-15' }, tasks),
    ).toEqual({ startDate: message, endDate: message });
    // 기간을 늘리는 수정은 허용한다.
    expect(
      validateProject({ ...validProject, startDate: '2025-12-01', endDate: '2026-04-30' }, tasks),
    ).toEqual({});
  });

  it('여러 필드가 틀리면 필드마다 오류를 반환한다', () => {
    expect(validateProject({ name: '', startDate: 'x', endDate: '', weightBasis: 1 })).toEqual({
      name: MESSAGES.projectNameRequired,
      startDate: MESSAGES.startDateInvalid,
      endDate: MESSAGES.endDateRequired,
      weightBasis: MESSAGES.weightBasisInvalid,
    });
  });

  it('객체가 아닌 입력은 거부한다', () => {
    expect(validateProject(null)).toEqual({ name: '입력값이 올바르지 않습니다.' });
    expect(validateProject('문자열')).toEqual({ name: '입력값이 올바르지 않습니다.' });
    expect(validateProject([])).toEqual({ name: '입력값이 올바르지 않습니다.' });
  });
});

describe('validateTask', () => {
  it('정상 입력이면 빈 객체를 반환한다', () => {
    expect(validateTask(validTask, projectRange)).toEqual({});
  });

  it('구분이 없거나 빈 문자열이어도 통과한다', () => {
    expect(validateTask({ ...validTask, category: '' }, projectRange)).toEqual({});
    expect(validateTask({ ...validTask, category: undefined }, projectRange)).toEqual({});
  });

  it('공종명이 비었거나 100자를 넘으면 거부한다', () => {
    expect(validateTask({ ...validTask, name: ' ' }, projectRange)).toEqual({
      name: '공종명을 입력하세요.',
    });
    expect(validateTask({ ...validTask, name: '가'.repeat(100) }, projectRange)).toEqual({});
    expect(validateTask({ ...validTask, name: '가'.repeat(101) }, projectRange)).toEqual({
      name: '공종명은 100자 이하로 입력하세요.',
    });
  });

  it('AC-F2-2: 금액이 0 이하이거나 숫자가 아니면 weightValue 오류를 반환한다', () => {
    const message = '금액은 0보다 큰 숫자로 입력하세요.';
    for (const weightValue of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1000', null, undefined]) {
      expect(validateTask({ ...validTask, weightValue }, projectRange)).toEqual({
        weightValue: message,
      });
    }
    expect(validateTask({ ...validTask, weightValue: 0.5 }, projectRange)).toEqual({});
  });

  it('보할 기준이 가중치인 프로젝트에서는 가중치 문구로 안내한다', () => {
    expect(
      validateTask({ ...validTask, weightValue: 0 }, { ...projectRange, weightBasis: 'manual' }),
    ).toEqual({ weightValue: '가중치는 0보다 큰 숫자로 입력하세요.' });
  });

  it('AC-F2-3: 종료일이 시작일보다 이르면 거부하고, 같은 날이면 통과한다', () => {
    expect(
      validateTask({ ...validTask, startDate: '2026-02-10', endDate: '2026-02-09' }, projectRange),
    ).toEqual({ endDate: '종료일은 시작일보다 빠를 수 없습니다.' });
    expect(
      validateTask({ ...validTask, startDate: '2026-02-10', endDate: '2026-02-10' }, projectRange),
    ).toEqual({});
  });

  it('날짜가 비었거나 실재하지 않으면 거부한다', () => {
    expect(validateTask({ ...validTask, startDate: '' }, projectRange)).toEqual({
      startDate: '시작일을 입력하세요.',
    });
    expect(validateTask({ ...validTask, endDate: '2026-02-29' }, projectRange)).toEqual({
      endDate: '종료일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
    });
  });

  it('AC-F2-4: 공종 기간이 프로젝트 기간을 벗어나면 벗어난 쪽 필드에 안내 메시지를 반환한다', () => {
    const message = '공종 기간은 프로젝트 기간 안에 있어야 합니다.';

    expect(
      validateTask({ ...validTask, startDate: '2025-12-31', endDate: '2026-01-31' }, projectRange),
    ).toEqual({ startDate: message });
    expect(
      validateTask({ ...validTask, startDate: '2026-03-01', endDate: '2026-04-01' }, projectRange),
    ).toEqual({ endDate: message });
    expect(
      validateTask({ ...validTask, startDate: '2025-12-01', endDate: '2026-04-30' }, projectRange),
    ).toEqual({ startDate: message, endDate: message });
    // 프로젝트 기간 전체가 밖인 경우
    expect(
      validateTask({ ...validTask, startDate: '2026-05-01', endDate: '2026-05-31' }, projectRange),
    ).toEqual({ startDate: message, endDate: message });
    // 경계와 정확히 같은 기간은 허용한다.
    expect(
      validateTask({ ...validTask, startDate: '2026-01-01', endDate: '2026-03-31' }, projectRange),
    ).toEqual({});
  });

  it('객체가 아닌 입력은 거부한다', () => {
    expect(validateTask(undefined, projectRange)).toEqual({ name: '입력값이 올바르지 않습니다.' });
  });
});

describe('validateProgress', () => {
  const existing = [{ date: '2026-01-15', percent: 50 }];

  it('정상 입력이면 빈 객체를 반환한다', () => {
    expect(validateProgress({ date: '2026-01-15', percent: 30 })).toEqual({});
    expect(validateProgress({ date: '2026-01-20', percent: 50 }, existing)).toEqual({});
    expect(validateProgress({ date: '2026-01-20', percent: 80 }, existing)).toEqual({});
    expect(validateProgress({ date: '2026-01-10', percent: 50 }, existing)).toEqual({});
    expect(validateProgress({ date: '2026-01-10', percent: 20 }, existing)).toEqual({});
  });

  it('0과 100은 허용한다', () => {
    expect(validateProgress({ date: '2026-01-15', percent: 0 })).toEqual({});
    expect(validateProgress({ date: '2026-01-15', percent: 100 })).toEqual({});
  });

  it('AC-F5-3: 진척률이 0 미만이거나 100 초과이거나 숫자가 아니면 거부한다', () => {
    const message = '진척률은 0부터 100 사이의 숫자로 입력하세요.';
    for (const percent of [-0.01, 100.01, -5, 150, Number.NaN, Number.POSITIVE_INFINITY, '50', null, undefined]) {
      expect(validateProgress({ date: '2026-01-15', percent })).toEqual({ percent: message });
    }
  });

  it('날짜가 비었거나 실재하지 않으면 거부한다', () => {
    expect(validateProgress({ date: '', percent: 10 })).toEqual({ date: '날짜를 입력하세요.' });
    expect(validateProgress({ date: '2026-02-30', percent: 10 })).toEqual({
      date: '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
    });
    expect(validateProgress({ date: '20260115', percent: 10 })).toEqual({
      date: '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
    });
  });

  it('AC-F5-4: 01-15 50% 뒤에 01-20 40%를 입력하면 "진척률은 이전 기록보다 작을 수 없습니다."', () => {
    expect(validateProgress({ date: '2026-01-20', percent: 40 }, existing)).toEqual({
      percent: '진척률은 이전 기록보다 작을 수 없습니다.',
    });
  });

  it('AC-F5-5: 01-15 50% 앞에 01-10 60%를 입력하면 거부한다', () => {
    expect(validateProgress({ date: '2026-01-10', percent: 60 }, existing)).toEqual({
      percent: '진척률은 이후 기록보다 클 수 없습니다.',
    });
  });

  it('같은 날짜의 기존 기록은 덮어쓰기 대상이므로 값을 낮추거나 높여도 통과한다', () => {
    expect(validateProgress({ date: '2026-01-15', percent: 10 }, existing)).toEqual({});
    expect(validateProgress({ date: '2026-01-15', percent: 90 }, existing)).toEqual({});
  });

  it('같은 날짜를 덮어쓸 때도 앞뒤 기록과의 순서는 지켜야 한다', () => {
    const records = [
      { date: '2026-01-10', percent: 30 },
      { date: '2026-01-15', percent: 50 },
      { date: '2026-01-20', percent: 70 },
    ];
    expect(validateProgress({ date: '2026-01-15', percent: 30 }, records)).toEqual({});
    expect(validateProgress({ date: '2026-01-15', percent: 70 }, records)).toEqual({});
    expect(validateProgress({ date: '2026-01-15', percent: 29 }, records)).toEqual({
      percent: MESSAGES.percentBelowEarlier,
    });
    expect(validateProgress({ date: '2026-01-15', percent: 71 }, records)).toEqual({
      percent: MESSAGES.percentAboveLater,
    });
  });

  it('기존 기록이 날짜순으로 정렬되어 있지 않아도 올바르게 판정한다', () => {
    const records = [
      { date: '2026-02-01', percent: 80 },
      { date: '2026-01-05', percent: 20 },
    ];
    expect(validateProgress({ date: '2026-01-20', percent: 50 }, records)).toEqual({});
    expect(validateProgress({ date: '2026-01-20', percent: 10 }, records)).toEqual({
      percent: MESSAGES.percentBelowEarlier,
    });
    expect(validateProgress({ date: '2026-01-20', percent: 90 }, records)).toEqual({
      percent: MESSAGES.percentAboveLater,
    });
  });

  it('객체가 아닌 입력은 거부한다', () => {
    expect(validateProgress(null)).toEqual({ date: '입력값이 올바르지 않습니다.' });
  });
});
