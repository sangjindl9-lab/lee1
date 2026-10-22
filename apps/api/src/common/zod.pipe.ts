import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodType } from 'zod';

/** 요청 본문 검증. 실패 시 필드별 한국어 오류 목록을 돌려준다 */
export class ZodPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: '입력값을 확인해 주세요',
        fields: r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}
