import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { FieldErrors } from '../shared/validation';

// API 오류 응답 형식: { error: { code, message(한국어), fields? } }

export type ErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: FieldErrors;
  };
}

export const ERROR_MESSAGES = {
  validation: '입력값을 확인하세요.',
  invalidJson: '요청 본문이 올바른 JSON 형식이 아닙니다.',
  invalidBody: '요청 본문을 읽을 수 없습니다.',
  apiNotFound: '요청한 API 경로를 찾을 수 없습니다.',
  internal: '서버에서 오류가 발생했습니다. 잠시 후 다시 시도하세요.',
} as const;

/** 상태 코드와 오류 코드를 가진 오류. 라우트에서 던지면 오류 미들웨어가 JSON으로 응답합니다. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: FieldErrors;

  constructor(status: number, code: ErrorCode, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** 400 VALIDATION_ERROR. message는 첫 번째 필드의 오류 문구입니다. */
export function validationError(fields: FieldErrors): HttpError {
  const first = Object.values(fields)[0];
  return new HttpError(400, 'VALIDATION_ERROR', first ?? ERROR_MESSAGES.validation, fields);
}

/** 404 NOT_FOUND */
export function notFound(message: string): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}

/** 검증 결과에 오류가 하나라도 있으면 400 오류를 던집니다. */
export function assertValid(fields: FieldErrors): void {
  if (Object.keys(fields).length > 0) throw validationError(fields);
}

/** async 라우트 핸들러에서 난 오류를 오류 미들웨어로 넘깁니다(Express 4는 Promise 거부를 직접 처리하지 않음). */
export function asyncHandler<P = ParamsDictionary>(
  handler: (req: Request<P>, res: Response) => Promise<void>,
): RequestHandler<P> {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}

/** 정의되지 않은 /api 경로 */
export const apiNotFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound(ERROR_MESSAGES.apiNotFound));
};

function toBody(code: ErrorCode, message: string, fields?: FieldErrors): ErrorBody {
  return { error: fields ? { code, message, fields } : { code, message } };
}

/** 오류 응답 미들웨어. 반드시 모든 라우트 뒤에 등록합니다. */
export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json(toBody(error.code, error.message, error.fields));
    return;
  }

  // express.json()이 본문을 읽다가 낸 오류(JSON 형식 오류, 크기 초과 등)
  const parserError = error as { type?: unknown; status?: unknown } | null;
  if (parserError && typeof parserError.type === 'string' && parserError.type.startsWith('entity.')) {
    const message =
      parserError.type === 'entity.parse.failed' ? ERROR_MESSAGES.invalidJson : ERROR_MESSAGES.invalidBody;
    res.status(400).json(toBody('VALIDATION_ERROR', message));
    return;
  }

  console.error('처리하지 못한 서버 오류:', error);
  res.status(500).json(toBody('INTERNAL_ERROR', ERROR_MESSAGES.internal));
};
