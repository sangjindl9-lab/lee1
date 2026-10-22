import * as argon2 from 'argon2';

/** Argon2id — 메모리 64MB, 반복 3, 병렬 1 */
const OPTS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, OPTS) as Promise<string>;
export const verifyPassword = async (hash: string, pw: string) => {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
};

// 존재하지 않는 계정에도 같은 시간이 걸리도록 하는 더미 해시 (계정 존재 여부 시간차 노출 방지)
let dummy: string | null = null;
export async function dummyVerify(pw: string) {
  dummy ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummy, pw);
}

/** 비밀번호 정책: 10자 이상, 영문 대/소문자·숫자·특수문자 중 3종 이상, 아이디 포함 금지, 반복문자 금지 */
export function checkPasswordPolicy(pw: string, loginId?: string): string | null {
  if (pw.length < 10) return '비밀번호는 10자 이상이어야 합니다';
  if (pw.length > 128) return '비밀번호는 128자 이하여야 합니다';
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds < 3) return '영문 대문자·소문자·숫자·특수문자 중 3종류 이상을 섞어 주세요';
  if (loginId && loginId.length >= 3 && pw.toLowerCase().includes(loginId.toLowerCase())) return '비밀번호에 아이디를 포함할 수 없습니다';
  if (/(.)\1\1\1/.test(pw)) return '같은 문자를 4번 이상 연속으로 쓸 수 없습니다';
  return null;
}
