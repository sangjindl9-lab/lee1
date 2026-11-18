export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "STATE_NOT_ALLOWED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_STATE_MISMATCH"
  | "FILES_UNSAFE"
  | "FILE_INTEGRITY"
  | "CONSENT_REQUIRED"
  | "PROVIDER_UNAVAILABLE"
  | "REFUND_UNSUPPORTED"
  | "RATE_LIMITED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

/** 서버 액션에서 사용자에게 보여줄 메시지를 안전하게 뽑는다. */
export function toUserMessage(e: unknown): string {
  if (isDomainError(e)) return e.message;
  if (e instanceof Error) return "처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  return "알 수 없는 오류가 발생했습니다.";
}
