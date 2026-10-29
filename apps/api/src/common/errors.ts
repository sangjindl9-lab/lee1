import {
  ArgumentsHost, Catch, ConflictException, ExceptionFilter, HttpException, HttpStatus, Logger, NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';

export const notFound = (what = '자료') => new NotFoundException({ code: 'NOT_FOUND', message: `${what}를 찾을 수 없습니다` });
export const staleVersion = () =>
  new ConflictException({ code: 'STALE_VERSION', message: '다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요' });

const PG_MESSAGES: Record<string, { status: number; code: string; message: string }> = {
  '23505': { status: 409, code: 'DUPLICATE', message: '이미 등록된 값입니다' },
  '23514': { status: 400, code: 'CHECK_FAILED', message: '데이터 규칙에 맞지 않는 값입니다' },
  '23503': { status: 409, code: 'IN_USE', message: '다른 자료와 연결되어 있어 처리할 수 없습니다' },
  '22P02': { status: 400, code: 'BAD_FORMAT', message: '입력 형식이 올바르지 않습니다' },
  '22008': { status: 400, code: 'BAD_DATE', message: '날짜가 올바르지 않습니다' },
  '22007': { status: 400, code: 'BAD_DATE', message: '날짜가 올바르지 않습니다' },
  '22003': { status: 400, code: 'NUMBER_RANGE', message: '숫자가 너무 크거나 작습니다' },
  '22001': { status: 400, code: 'TOO_LONG', message: '입력한 글자가 너무 깁니다' },
};

/** 모든 오류를 { code, message, fields? } 형태로 통일. 내부 오류 세부는 노출하지 않는다 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const body = err.getResponse();
      const payload =
        typeof body === 'string'
          ? { code: 'ERROR', message: body }
          : { code: (body as any).code ?? HttpStatus[status], message: (body as any).message ?? '요청을 처리할 수 없습니다', ...(body as any) };
      if (Array.isArray(payload.message)) payload.message = payload.message.join(', ');
      delete (payload as any).statusCode;
      delete (payload as any).error;
      return res.status(status).json(payload);
    }
    const pgCode = (err as any)?.cause?.code ?? (err as any)?.code;
    // DB 트리거가 막은 업무 규칙 위반 — 트리거 메시지를 그대로 보여 준다
    if (pgCode === 'P0001') {
      const msg = String((err as any)?.cause?.message ?? (err as any)?.message ?? '업무 규칙에 맞지 않습니다');
      return res.status(409).json({ code: 'RULE_VIOLATION', message: msg });
    }
    if (pgCode && PG_MESSAGES[pgCode]) {
      const m = PG_MESSAGES[pgCode];
      return res.status(m.status).json({ code: m.code, message: m.message });
    }
    this.log.error(err instanceof Error ? err.stack : String(err));
    return res.status(500).json({ code: 'INTERNAL', message: '서버 오류가 발생했습니다. 관리자에게 문의해 주세요' });
  }
}
