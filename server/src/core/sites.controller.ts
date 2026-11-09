import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../common/db.service';
import { AuditService } from '../common/audit.service';
import { parse, uuid } from '../common/validate';
import { ApiError, AuthUser, CurrentUser, Perm, canSeeOrg, orgFilter } from '../auth/auth.types';

const siteSchema = z.object({
  name: z.string().min(1).max(100), code: z.string().min(1).max(40),
  address: z.string().max(200).nullish(), admin_area: z.string().max(100).nullish(),
  lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
  org_id: uuid.optional(),
});
const cabinetSchema = z.object({
  site_id: uuid, code: z.string().min(1).max(40), name: z.string().min(1).max(100),
  facility_no: z.string().max(60).nullish(), address: z.string().max(200).nullish(),
  lat: z.number().min(-90).max(90).nullish(), lng: z.number().min(-180).max(180).nullish(),
  install_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), note: z.string().max(1000).nullish(),
});

function dup(e: any): never {
  if (e.code === '23505') throw new ApiError(409, 'DUPLICATE', '같은 코드가 이미 있습니다');
  throw e;
}

@Controller()
export class SitesController {
  constructor(private readonly db: DbService, private readonly audit: AuditService) {}

  @Get('sites') @Perm('site.read')
  list(@CurrentUser() u: AuthUser) {
    const p: any[] = [];
    return this.db.query(`SELECT * FROM sites WHERE ${orgFilter(u, 'org_id', p)} ORDER BY name`, p);
  }

  @Post('sites') @Perm('site.write')
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    const d = parse(siteSchema, b);
    const orgId = d.org_id ?? u.org_id;
    if (!canSeeOrg(u, orgId)) throw new ApiError(403, 'FORBIDDEN', '다른 기관에 등록할 수 없습니다');
    const s = await this.db.one(`INSERT INTO sites(org_id, code, name, address, admin_area, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [orgId, d.code, d.name, d.address ?? null, d.admin_area ?? null, d.lat ?? null, d.lng ?? null]).catch(dup);
    await this.audit.log(u, 'site.create', 'site', s!.id, d);
    return s;
  }

  @Patch('sites/:id') @Perm('site.write')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    parse(uuid, id);
    const d = parse(siteSchema.omit({ org_id: true }).partial(), b);
    const cur = await this.db.one('SELECT * FROM sites WHERE id=$1', [id]);
    if (!cur || !canSeeOrg(u, cur.org_id)) throw new ApiError(404, 'NOT_FOUND', '현장을 찾을 수 없습니다');
    const m = { ...cur, ...d };
    const s = await this.db.one(`UPDATE sites SET code=$2, name=$3, address=$4, admin_area=$5, lat=$6, lng=$7 WHERE id=$1 RETURNING *`,
      [id, m.code, m.name, m.address, m.admin_area, m.lat, m.lng]).catch(dup);
    await this.audit.log(u, 'site.update', 'site', id, d);
    return s;
  }

  @Get('cabinets') @Perm('site.read')
  cabinets(@CurrentUser() u: AuthUser, @Query('site_id') siteId?: string) {
    const p: any[] = [];
    let w = orgFilter(u, 'c.org_id', p);
    if (siteId) { parse(uuid, siteId); p.push(siteId); w += ` AND c.site_id=$${p.length}`; }
    return this.db.query(`SELECT c.*, s.name AS site_name,
        (SELECT count(*)::int FROM smartboxes b WHERE b.cabinet_id=c.id AND NOT b.decommissioned) AS smartbox_count
      FROM cabinets c JOIN sites s ON s.id=c.site_id WHERE ${w} ORDER BY s.name, c.code`, p);
  }

  @Post('cabinets') @Perm('site.write')
  async createCabinet(@CurrentUser() u: AuthUser, @Body() b: any) {
    const d = parse(cabinetSchema, b);
    const site = await this.db.one('SELECT id, org_id FROM sites WHERE id=$1', [d.site_id]);
    if (!site || !canSeeOrg(u, site.org_id)) throw new ApiError(404, 'NOT_FOUND', '현장을 찾을 수 없습니다');
    const c = await this.db.one(`INSERT INTO cabinets(org_id, site_id, code, name, facility_no, address, lat, lng, install_date, note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [site.org_id, d.site_id, d.code, d.name, d.facility_no ?? null, d.address ?? null, d.lat ?? null, d.lng ?? null, d.install_date ?? null, d.note ?? null]).catch(dup);
    await this.audit.log(u, 'cabinet.create', 'cabinet', c!.id, d);
    return c;
  }

  @Patch('cabinets/:id') @Perm('site.write')
  async updateCabinet(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() b: any) {
    parse(uuid, id);
    const d = parse(cabinetSchema.omit({ site_id: true }).partial(), b);
    const cur = await this.db.one('SELECT * FROM cabinets WHERE id=$1', [id]);
    if (!cur || !canSeeOrg(u, cur.org_id)) throw new ApiError(404, 'NOT_FOUND', '함체를 찾을 수 없습니다');
    const m = { ...cur, ...d };
    const c = await this.db.one(`UPDATE cabinets SET code=$2, name=$3, facility_no=$4, address=$5, lat=$6, lng=$7, install_date=$8, note=$9 WHERE id=$1 RETURNING *`,
      [id, m.code, m.name, m.facility_no, m.address, m.lat, m.lng, m.install_date, m.note]).catch(dup);
    await this.audit.log(u, 'cabinet.update', 'cabinet', id, d);
    return c;
  }
}
