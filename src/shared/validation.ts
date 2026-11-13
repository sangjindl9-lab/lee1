// 서버와 클라이언트가 함께 쓰는 입력 검증 규칙입니다.
// 각 함수는 { 필드 이름: 한국어 오류 메시지 } 객체를 반환하고, 오류가 없으면 빈 객체를 반환합니다.
// 입력은 폼이나 JSON 본문에서 온 값이므로 타입을 믿지 않고 직접 확인합니다.

import { isValidDate } from './dates';
import type { WeightBasis } from './types';

/** 필드 이름별 오류 메시지. 오류가 없으면 빈 객체입니다. */
export type FieldErrors = Record<string, string>;

export const NAME_MAX_LENGTH = 100;

export const MESSAGES = {
  invalidInput: '입력값이 올바르지 않습니다.',
  projectNameRequired: '프로젝트 이름을 입력하세요.',
  projectNameTooLong: '프로젝트 이름은 100자 이하로 입력하세요.',
  taskNameRequired: '공종명을 입력하세요.',
  taskNameTooLong: '공종명은 100자 이하로 입력하세요.',
  descriptionInvalid: '설명은 문자로 입력하세요.',
  categoryInvalid: '구분은 문자로 입력하세요.',
  startDateRequired: '시작일을 입력하세요.',
  endDateRequired: '종료일을 입력하세요.',
  dateRequired: '날짜를 입력하세요.',
  startDateInvalid: '시작일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
  endDateInvalid: '종료일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
  dateInvalid: '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.',
  endBeforeStart: '종료일은 시작일보다 빠를 수 없습니다.',
  weightBasisInvalid: '보할 기준은 금액 또는 가중치 중에서 선택하세요.',
  projectPeriodExcludesTasks: '프로젝트 기간은 등록된 공종의 기간을 모두 포함해야 합니다.',
  amountInvalid: '금액은 0보다 큰 숫자로 입력하세요.',
  manualWeightInvalid: '가중치는 0보다 큰 숫자로 입력하세요.',
  taskOutsideProject: '공종 기간은 프로젝트 기간 안에 있어야 합니다.',
  percentInvalid: '진척률은 0부터 100 사이의 숫자로 입력하세요.',
  percentBelowEarlier: '진척률은 이전 기록보다 작을 수 없습니다.',
  percentAboveLater: '진척률은 이후 기록보다 클 수 없습니다.',
} as const;

/** 검증에 필요한 최소한의 기간 정보 */
export interface DateRange {
  startDate: string;
  endDate: string;
}

/** 공종 검증에 필요한 프로젝트 정보. weightBasis는 오류 문구(금액/가중치)를 고르는 데만 씁니다. */
export interface TaskValidationProject extends DateRange {
  weightBasis?: WeightBasis;
}

/** 실적 검증에 필요한 기존 기록 정보 */
export interface ProgressPoint {
  date: string;
  percent: number;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** 앞뒤 공백을 뺀 글자 수가 1~100자인지 확인합니다. 글자 수는 유니코드 문자 단위로 셉니다. */
function checkName(value: unknown, required: string, tooLong: string): string | null {
  if (typeof value !== 'string') return required;
  const length = Array.from(value.trim()).length;
  if (length === 0) return required;
  if (length > NAME_MAX_LENGTH) return tooLong;
  return null;
}

function checkDate(value: unknown, required: string, invalid: string): string | null {
  if (isBlank(value)) return required;
  if (!isValidDate(value)) return invalid;
  return null;
}

/** 시작일·종료일의 형식과 순서를 확인하고, 둘 다 올바르면 기간을 돌려줍니다. */
function checkDateRange(data: Record<string, unknown>, errors: FieldErrors): DateRange | null {
  const startError = checkDate(data.startDate, MESSAGES.startDateRequired, MESSAGES.startDateInvalid);
  const endError = checkDate(data.endDate, MESSAGES.endDateRequired, MESSAGES.endDateInvalid);
  if (startError) errors.startDate = startError;
  if (endError) errors.endDate = endError;
  if (startError || endError) return null;

  const startDate = data.startDate as string;
  const endDate = data.endDate as string;
  // YYYY-MM-DD 문자열은 사전순 비교가 날짜순 비교와 같습니다.
  if (endDate < startDate) {
    errors.endDate = MESSAGES.endBeforeStart;
    return null;
  }
  return { startDate, endDate };
}

/**
 * 프로젝트 입력을 검증합니다.
 * @param input 이름, 설명, 시작일, 종료일, 보할 기준
 * @param existingTasks 수정할 때 그 프로젝트에 이미 등록된 공종들. 새 기간이 이 공종들을 모두 포함해야 합니다.
 */
export function validateProject(input: unknown, existingTasks: readonly DateRange[] = []): FieldErrors {
  const data = asRecord(input);
  if (!data) return { name: MESSAGES.invalidInput };

  const errors: FieldErrors = {};

  const nameError = checkName(data.name, MESSAGES.projectNameRequired, MESSAGES.projectNameTooLong);
  if (nameError) errors.name = nameError;

  if (data.description !== undefined && data.description !== null && typeof data.description !== 'string') {
    errors.description = MESSAGES.descriptionInvalid;
  }

  // 보할 기준을 보내지 않으면 저장할 때 기본값(amount)을 씁니다.
  if (
    data.weightBasis !== undefined &&
    data.weightBasis !== null &&
    data.weightBasis !== 'amount' &&
    data.weightBasis !== 'manual'
  ) {
    errors.weightBasis = MESSAGES.weightBasisInvalid;
  }

  const range = checkDateRange(data, errors);
  if (range) {
    if (existingTasks.some((task) => task.startDate < range.startDate)) {
      errors.startDate = MESSAGES.projectPeriodExcludesTasks;
    }
    if (existingTasks.some((task) => task.endDate > range.endDate)) {
      errors.endDate = MESSAGES.projectPeriodExcludesTasks;
    }
  }

  return errors;
}

/**
 * 공종 입력을 검증합니다.
 * @param input 구분, 공종명, 금액 또는 가중치, 시작일, 종료일
 * @param project 공종이 속한 프로젝트의 기간(과 보할 기준)
 */
export function validateTask(input: unknown, project: TaskValidationProject): FieldErrors {
  const data = asRecord(input);
  if (!data) return { name: MESSAGES.invalidInput };

  const errors: FieldErrors = {};

  const nameError = checkName(data.name, MESSAGES.taskNameRequired, MESSAGES.taskNameTooLong);
  if (nameError) errors.name = nameError;

  if (data.category !== undefined && data.category !== null && typeof data.category !== 'string') {
    errors.category = MESSAGES.categoryInvalid;
  }

  const weight = data.weightValue;
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
    errors.weightValue =
      project.weightBasis === 'manual' ? MESSAGES.manualWeightInvalid : MESSAGES.amountInvalid;
  }

  const range = checkDateRange(data, errors);
  if (range) {
    if (range.startDate < project.startDate || range.startDate > project.endDate) {
      errors.startDate = MESSAGES.taskOutsideProject;
    }
    if (range.endDate > project.endDate || range.endDate < project.startDate) {
      errors.endDate = MESSAGES.taskOutsideProject;
    }
  }

  return errors;
}

/**
 * 실적 기록 입력을 검증합니다.
 * @param input 날짜와 누계 진척률(0~100)
 * @param existingRecords 같은 공종에 이미 등록된 기록들. 같은 날짜의 기록은 덮어쓰기 대상이므로 비교하지 않습니다.
 */
export function validateProgress(input: unknown, existingRecords: readonly ProgressPoint[] = []): FieldErrors {
  const data = asRecord(input);
  if (!data) return { date: MESSAGES.invalidInput };

  const errors: FieldErrors = {};

  const dateError = checkDate(data.date, MESSAGES.dateRequired, MESSAGES.dateInvalid);
  if (dateError) errors.date = dateError;

  const percent = data.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    errors.percent = MESSAGES.percentInvalid;
    return errors;
  }
  if (dateError) return errors;

  const date = data.date as string;
  if (existingRecords.some((record) => record.date < date && record.percent > percent)) {
    errors.percent = MESSAGES.percentBelowEarlier;
  } else if (existingRecords.some((record) => record.date > date && record.percent < percent)) {
    errors.percent = MESSAGES.percentAboveLater;
  }

  return errors;
}
