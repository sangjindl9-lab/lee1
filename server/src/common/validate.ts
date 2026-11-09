import { ZodTypeAny, z } from 'zod';
import { ApiError } from '../auth/auth.types';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const msg = r.error.issues.map(i => `${i.path.join('.') || '값'}: ${i.message}`).join(', ');
    throw new ApiError(400, 'VALIDATION', `입력값이 올바르지 않습니다 — ${msg}`);
  }
  return r.data;
}

export const uuid = z.string().uuid();
