import jwt from 'jsonwebtoken';
import { config } from './config.js';

const COOKIE = 'eum3d_session';

export function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, cid: user.company_id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: 7 * 864e5 });
}
export const clearSession = (res) => res.clearCookie(COOKIE);

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE] || (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const p = jwt.verify(token, config.jwtSecret);
    if (p.kind) throw new Error('세션 토큰이 아님');
    req.user = { id: p.uid, companyId: p.cid, role: p.role };
    next();
  } catch {
    res.status(401).json({ error: '로그인이 필요합니다' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: '권한이 없습니다' });
}

/** 렌더 워커 전용 단기 토큰 (해당 작업의 모델만 읽기 가능) */
export const signRenderToken = (job) =>
  jwt.sign({ kind: 'render', jid: job.id, cid: job.company_id, mid: job.payload.modelId }, config.jwtSecret, { expiresIn: '30m' });
export const verifyRenderToken = (t) => {
  const p = jwt.verify(t, config.jwtSecret);
  if (p.kind !== 'render') throw new Error('bad token');
  return p;
};
/** 비밀번호 보호 공유링크 통과 토큰 */
export const signShareToken = (shareId) => jwt.sign({ kind: 'share', sid: shareId }, config.jwtSecret, { expiresIn: '12h' });
export const verifyShareToken = (t) => {
  const p = jwt.verify(t, config.jwtSecret);
  if (p.kind !== 'share') throw new Error('bad token');
  return p;
};
