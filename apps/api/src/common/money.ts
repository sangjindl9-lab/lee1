/**
 * 금액 계산 유틸 — 모든 금액은 문자열/Decimal 로만 다룬다. JS number 금지.
 * 원 단위 절사 규칙: 부가세는 공급가액 × 세율 후 원 미만 절사(ROUND_DOWN)가 실무 기본값.
 * 회사 정책에 따라 바꿀 수 있도록 rounding 파라미터로 둔다.
 */
import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Rounding = 'DOWN' | 'HALF_UP' | 'UP';
const R: Record<Rounding, Decimal.Rounding> = {
  DOWN: Decimal.ROUND_DOWN,
  HALF_UP: Decimal.ROUND_HALF_UP,
  UP: Decimal.ROUND_UP,
};

export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);

/** 원 단위 정수로 맞춘다 */
export function toWon(v: Decimal.Value, rounding: Rounding = 'DOWN'): Decimal {
  return D(v).toDecimalPlaces(0, R[rounding]);
}

/** DB 저장용 문자열 (소수 2자리 고정) */
export function moneyStr(v: Decimal.Value): string {
  return D(v).toFixed(2);
}

export interface VatSplit {
  supply: string;
  vat: string;
  total: string;
}

/** 공급가액 기준으로 부가세·합계 계산 */
export function vatFromSupply(supply: Decimal.Value, vatRate: Decimal.Value, rounding: Rounding = 'DOWN'): VatSplit {
  const s = toWon(supply, 'HALF_UP');
  const v = toWon(s.mul(vatRate), rounding);
  return { supply: moneyStr(s), vat: moneyStr(v), total: moneyStr(s.plus(v)) };
}

/** 합계(부가세 포함) 기준으로 공급가액·부가세 역산. 공급가액 = 합계 − 부가세 로 맞춰 합이 항상 일치 */
export function vatFromTotal(total: Decimal.Value, vatRate: Decimal.Value, rounding: Rounding = 'DOWN'): VatSplit {
  const t = toWon(total, 'HALF_UP');
  const supplyRaw = t.div(D(1).plus(vatRate));
  const v = toWon(t.minus(supplyRaw), rounding === 'DOWN' ? 'HALF_UP' : rounding);
  const s = t.minus(v);
  return { supply: moneyStr(s), vat: moneyStr(v), total: moneyStr(t) };
}

/**
 * 사용자가 입력한 공급가액·부가세·합계 세 값이 서로 맞는지 검증.
 * 부가세는 계산값과 ±tolerance 원 이내 허용(세금계산서 단수차이), 합계는 정확히 일치해야 한다.
 */
export function checkVatTriple(
  input: { supply: Decimal.Value; vat: Decimal.Value; total: Decimal.Value },
  vatRate: Decimal.Value,
  toleranceWon = 0,
): { ok: boolean; expectedVat: string; reason?: string } {
  const s = D(input.supply);
  const v = D(input.vat);
  const t = D(input.total);
  const expected = vatFromSupply(s, vatRate).vat;
  if (!s.plus(v).eq(t)) {
    return { ok: false, expectedVat: expected, reason: `합계(${t.toFixed(0)})가 공급가액+부가세(${s.plus(v).toFixed(0)})와 다릅니다` };
  }
  if (v.minus(expected).abs().gt(toleranceWon)) {
    return { ok: false, expectedVat: expected, reason: `부가세가 계산값(${D(expected).toFixed(0)})과 다릅니다` };
  }
  return { ok: true, expectedVat: expected };
}

export function sumMoney(values: Decimal.Value[]): string {
  return moneyStr(values.reduce<Decimal>((a, b) => a.plus(D(b)), D(0)));
}
