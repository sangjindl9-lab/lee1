// 고객사(회사) 브랜드·공개 쇼룸 주소 설정 — 관리자만 수정
import { Router } from 'express';
import { audit } from '../db/index.js';
import { requireRole } from '../auth.js';
import { baseUrl } from './models.js';

const r = Router();
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['app', 'api', 'admin', 'login', 'signup', 'render', 'static', 'assets', 'www']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO = /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/;

/** 회사 → 쇼룸 주소 (slug 가 없으면 id 앞 8자리 기본값) */
export const slugOf = (co) => co.slug || `c-${co.id.slice(0, 8)}`;

r.get('/company', async (req, res) => {
  const co = await req.db(async (c) => (await c.query('SELECT id,name,slug,brand FROM companies WHERE id=$1', [req.user.companyId])).rows[0]);
  res.json({ ...co, slug: slugOf(co), showroomUrl: `${baseUrl(req)}/c/${slugOf(co)}` });
});

r.put('/company', requireRole('admin'), async (req, res) => {
  const b = req.body || {};
  const brand = {};
  const str = (k, max) => { if (b.brand?.[k] != null) brand[k] = String(b.brand[k]).trim().slice(0, max); };
  str('programName', 60); str('tagline', 140); str('website', 200); str('phone', 40); str('email', 120); str('address', 200); str('intro', 2000);
  if (b.brand?.color != null) { if (b.brand.color && !HEX.test(b.brand.color)) return res.status(400).json({ error: '대표 색상은 #RRGGBB 형식' }); brand.color = b.brand.color || ''; }
  if (b.brand?.logo != null) {
    if (b.brand.logo && (!LOGO.test(b.brand.logo) || b.brand.logo.length > 400_000)) return res.status(400).json({ error: '로고는 300KB 이하 PNG·JPG·SVG·WEBP 이미지' });
    brand.logo = b.brand.logo || '';
  }
  if (brand.website && !/^https?:\/\//.test(brand.website)) brand.website = 'https://' + brand.website;
  let slug;
  if (b.slug != null) {
    slug = String(b.slug).trim().toLowerCase();
    if (!SLUG_RE.test(slug) || RESERVED.has(slug) || /^c-[0-9a-f]{8}$/.test(slug)) return res.status(400).json({ error: '쇼룸 주소는 영문 소문자·숫자·하이픈 3~40자' });
  }
  const name = b.name != null ? String(b.name).trim().slice(0, 100) : null;
  try {
    const co = await req.db(async (c) => {
      const { rows: [co] } = await c.query(
        `UPDATE companies SET brand = brand || $2::jsonb, slug = COALESCE($3, slug), name = COALESCE(NULLIF($4,''), name) WHERE id=$1 RETURNING id,name,slug,brand`,
        [req.user.companyId, JSON.stringify(brand), slug ?? null, name]);
      await audit(c, { companyId: req.user.companyId, userId: req.user.id, action: 'company.brand', target: co.id, meta: { fields: Object.keys(brand), slug } });
      return co;
    });
    res.json({ ...co, slug: slugOf(co), showroomUrl: `${baseUrl(req)}/c/${slugOf(co)}` });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: '이미 다른 회사가 쓰는 쇼룸 주소입니다' });
    throw e;
  }
});

export default r;
