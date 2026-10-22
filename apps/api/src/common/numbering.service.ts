import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, or, desc, sql } from 'drizzle-orm';
import { DB, DB_TOKEN, Tx } from '../db/db';
import { numberSequences, taxRateSettings } from '../db/schema';

@Injectable()
export class NumberingService {
  /**
   * 회사별 일련번호 발급. INSERT … ON CONFLICT DO UPDATE 는 행 잠금으로 원자적이므로
   * 여러 사용자가 동시에 등록해도 같은 번호가 나오지 않는다. 트랜잭션이 취소되면 번호도 반환된다.
   */
  async next(tx: Tx, companyId: string, key: string): Promise<number> {
    const [row] = await tx
      .insert(numberSequences)
      .values({ companyId, key, lastValue: 1 })
      .onConflictDoUpdate({ target: [numberSequences.companyId, numberSequences.key], set: { lastValue: sql`${numberSequences.lastValue} + 1` } })
      .returning({ v: numberSequences.lastValue });
    return row.v;
  }

  /** 공사관리번호: P26-0001 (연도별 일련번호) */
  async projectCode(tx: Tx, companyId: string) {
    const year = todayKST().slice(0, 4);
    const yy = year.slice(2);
    const n = await this.next(tx, companyId, `PROJECT-${year}`);
    return `P${yy}-${String(n).padStart(4, '0')}`;
  }

  /** 연도별 문서번호: PO26-0001 (발주), GR26-0001 (검수) */
  async yearly(tx: Tx, companyId: string, prefix: string, onDate?: string, pad = 4) {
    const year = (onDate ?? todayKST()).slice(0, 4);
    const n = await this.next(tx, companyId, `${prefix}-${year}`);
    return `${prefix}${year.slice(2)}-${String(n).padStart(pad, '0')}`;
  }

  async materialCode(tx: Tx, companyId: string) {
    const n = await this.next(tx, companyId, 'MATERIAL');
    return `M${String(n).padStart(5, '0')}`;
  }

  async vendorCode(tx: Tx, companyId: string) {
    const n = await this.next(tx, companyId, 'VENDOR');
    return `V${String(n).padStart(5, '0')}`;
  }
}

@Injectable()
export class TaxRateService {
  constructor(@Inject(DB_TOKEN) private readonly db: DB) {}

  /** 기준일에 적용되는 세율. 설정이 없으면 계산하지 않고 오류 — 세율을 코드에 임의로 고정하지 않는다 */
  async rateAt(key: string, onDate: string): Promise<string> {
    const [row] = await this.db
      .select({ rate: taxRateSettings.rate })
      .from(taxRateSettings)
      .where(and(eq(taxRateSettings.key, key), lte(taxRateSettings.effectiveFrom, onDate), or(isNull(taxRateSettings.effectiveTo), gte(taxRateSettings.effectiveTo, onDate))))
      .orderBy(desc(taxRateSettings.effectiveFrom))
      .limit(1);
    if (!row) throw new BadRequestException({ code: 'TAX_RATE_MISSING', message: `${onDate} 기준 ${key} 세율 설정이 없습니다. 관리 > 세율 설정에서 등록해 주세요` });
    return row.rate;
  }

  list() {
    return this.db.select().from(taxRateSettings).orderBy(taxRateSettings.key, desc(taxRateSettings.effectiveFrom));
  }
}

export const todayKST = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
