import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Db } from './db.js';
import { tx } from './db.js';
import { httpError, requireUser } from './auth.js';
import { randomUUID } from 'node:crypto';

/**
 * 동기화 프로토콜 v1 (상태 기반 + 작업 ID 멱등)
 *
 * PUSH  POST /v1/sync/push  { ops: [{ opId, entityType, entityId, opType, baseRev, data }] }
 *   - opId 가 이미 있으면 'duplicate'(재전송 안전, 중복 노트 없음)
 *   - baseRev 가 서버 rev 와 같으면 반영 후 rev+1 → 'applied'
 *   - 다르면 'conflict': 데이터를 버리지 않는다.
 *       stroke  → 클라이언트 쪽을 새 ID 사본으로 추가(양쪽 보존)
 *       page/notebook/folder → 클라이언트 값으로 반영하되 서버의 이전 값을 sync_conflicts.detail 에 보관
 *       삭제 vs 수정 → 삭제하지 않음(수정본 보존)
 * PULL  GET /v1/sync/pull?since=<seq>&limit=<n>
 *   - since 이후의 다른 기기 작업 + 이 기기 충돌 사본을, 대상의 "현재 상태"와 함께 돌려준다(증분).
 */

type Op = { opId: string; entityType: string; entityId: string; opType: string; baseRev: number | null; data: any; createdAt?: number };
export type OpResult = { opId: string; status: 'applied' | 'duplicate' | 'conflict' | 'rejected'; rev?: number; copyId?: string; reason?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const ORDER: Record<string, number> = { folder: 0, notebook: 1, attachment: 2, page: 3, stroke: 4 };
const MAX_OPS = 500;

async function ownsNotebook(c: pg.PoolClient, userId: string, nbId: string) {
  const r = await c.query('SELECT user_id FROM notebooks WHERE id=$1', [nbId]);
  if (!r.rows.length) return null; // 아직 없음
  return r.rows[0].user_id === userId;
}

async function current(c: pg.PoolClient, type: string, id: string): Promise<any | null> {
  const t = { folder: 'notebook_folders', notebook: 'notebooks', attachment: 'attachments', page: 'pages', stroke: 'pen_strokes' }[type];
  if (!t) return null;
  const r = await c.query(`SELECT * FROM ${t} WHERE id=$1 FOR UPDATE`, [id]);
  return r.rows[0] ?? null;
}

function bool(v: any) { return v === true || v === 1 || v === '1'; }
function num(v: any, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function str(v: any, max = 500) { return v == null ? null : String(v).slice(0, max); }

/** 소유권 검사 후 엔터티 상태를 반영. 반환: 새 rev */
async function write(c: pg.PoolClient, userId: string, type: string, id: string, d: any, existing: any | null, forceNewId?: string): Promise<number> {
  const rid = forceNewId ?? id;
  const deleted = bool(d.deleted);
  const rev = forceNewId ? 1 : (existing ? Number(existing.rev) + 1 : 1);
  switch (type) {
    case 'folder': {
      if (existing && existing.user_id !== userId) throw httpError(403, 'not_owner');
      await c.query(`INSERT INTO notebook_folders(id,user_id,parent_id,name,rev,deleted_at) VALUES($1,$2,$3,$4,$5, CASE WHEN $6 THEN now() END)
        ON CONFLICT (id) DO UPDATE SET parent_id=EXCLUDED.parent_id, name=EXCLUDED.name, rev=EXCLUDED.rev, deleted_at=EXCLUDED.deleted_at, updated_at=now()`,
        [rid, userId, d.parentId && UUID.test(d.parentId) ? d.parentId : null, str(d.name, 200) ?? '', rev, deleted]);
      return rev;
    }
    case 'notebook': {
      if (existing && existing.user_id !== userId) throw httpError(403, 'not_owner');
      let folder = d.folderId && UUID.test(d.folderId) ? d.folderId : null;
      if (folder && !(await c.query('SELECT 1 FROM notebook_folders WHERE id=$1 AND user_id=$2', [folder, userId])).rows.length) folder = null;
      await c.query(`INSERT INTO notebooks(id,user_id,folder_id,title,description,cover_color,favorite,locked,is_infinite,rev,deleted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN now() END)
        ON CONFLICT (id) DO UPDATE SET folder_id=EXCLUDED.folder_id,title=EXCLUDED.title,description=EXCLUDED.description,cover_color=EXCLUDED.cover_color,
        favorite=EXCLUDED.favorite,locked=EXCLUDED.locked,is_infinite=EXCLUDED.is_infinite,rev=EXCLUDED.rev,deleted_at=EXCLUDED.deleted_at,updated_at=now()`,
        [rid, userId, folder, str(d.title, 300) ?? '', str(d.description, 5000) ?? '', num(d.coverColor) | 0, bool(d.favorite), bool(d.locked), bool(d.infinite), rev, deleted]);
      if (Array.isArray(d.tags)) {
        await c.query('DELETE FROM note_tags WHERE notebook_id=$1', [rid]);
        for (const name of d.tags.slice(0, 50).map((t: any) => String(t).trim().slice(0, 60)).filter(Boolean)) {
          const t = await c.query(`INSERT INTO tags(id,user_id,name) VALUES($1,$2,$3) ON CONFLICT (user_id,name) DO UPDATE SET updated_at=now() RETURNING id`, [randomUUID(), userId, name]);
          await c.query('INSERT INTO note_tags(notebook_id,tag_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [rid, t.rows[0].id]);
        }
      }
      return rev;
    }
    case 'attachment': {
      if (await ownsNotebook(c, userId, d.notebookId) !== true) throw httpError(403, 'not_owner');
      if (existing && existing.user_id !== userId) throw httpError(403, 'not_owner');
      if (!/^[0-9a-f]{64}$/.test(String(d.sha256))) throw httpError(400, 'bad_sha');
      const f = await c.query('SELECT object_key FROM stored_files WHERE user_id=$1 AND sha256=$2', [userId, d.sha256]);
      await c.query(`INSERT INTO attachments(id,user_id,notebook_id,kind,file_name,mime,size,sha256,object_key,upload_state,deleted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN now() END)
        ON CONFLICT (id) DO UPDATE SET file_name=EXCLUDED.file_name, object_key=EXCLUDED.object_key, upload_state=EXCLUDED.upload_state, deleted_at=EXCLUDED.deleted_at, updated_at=now()`,
        [rid, userId, d.notebookId, str(d.kind, 20) ?? 'pdf', str(d.fileName, 255) ?? 'file', str(d.mime, 100) ?? 'application/octet-stream', num(d.size), d.sha256,
          f.rows[0]?.object_key ?? null, f.rows.length ? 'complete' : 'pending', deleted]);
      return rev;
    }
    case 'page': {
      if (await ownsNotebook(c, userId, d.notebookId) !== true) throw httpError(403, 'not_owner');
      if (existing && existing.notebook_id !== d.notebookId) throw httpError(400, 'page_notebook_mismatch');
      const att = d.attachmentId && UUID.test(d.attachmentId) && (await c.query('SELECT 1 FROM attachments WHERE id=$1 AND user_id=$2', [d.attachmentId, userId])).rows.length ? d.attachmentId : null;
      await c.query(`INSERT INTO pages(id,notebook_id,page_index,width,height,paper,template,bg_type,attachment_id,pdf_page,rev,deleted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $12 THEN now() END)
        ON CONFLICT (id) DO UPDATE SET page_index=EXCLUDED.page_index,width=EXCLUDED.width,height=EXCLUDED.height,paper=EXCLUDED.paper,template=EXCLUDED.template,
        bg_type=EXCLUDED.bg_type,attachment_id=EXCLUDED.attachment_id,pdf_page=EXCLUDED.pdf_page,rev=EXCLUDED.rev,deleted_at=EXCLUDED.deleted_at,updated_at=now()`,
        [rid, d.notebookId, num(d.index) | 0, num(d.width, 595), num(d.height, 842), str(d.paper, 20) ?? 'blank', str(d.template, 20) ?? 'none', num(d.bgType) | 0, att, num(d.pdfPage, -1) | 0, rev, deleted]);
      return rev;
    }
    case 'stroke': {
      if (await ownsNotebook(c, userId, d.notebookId) !== true) throw httpError(403, 'not_owner');
      const pg = await c.query('SELECT notebook_id FROM pages WHERE id=$1', [d.pageId]);
      if (!pg.rows.length || pg.rows[0].notebook_id !== d.notebookId) throw httpError(400, 'unknown_page');
      const pts = Buffer.from(String(d.points ?? ''), 'base64');
      if (pts.length < 12 || pts.length > 16 * 1024 * 1024 || pts.toString('latin1', 0, 4) !== 'NPS1') throw httpError(400, 'bad_points');
      await c.query(`INSERT INTO pen_strokes(id,page_id,notebook_id,pen,color,width,opacity,shape,points,rev,deleted_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN now() END)
        ON CONFLICT (id) DO UPDATE SET page_id=EXCLUDED.page_id,pen=EXCLUDED.pen,color=EXCLUDED.color,width=EXCLUDED.width,opacity=EXCLUDED.opacity,
        shape=EXCLUDED.shape,points=EXCLUDED.points,rev=EXCLUDED.rev,deleted_at=EXCLUDED.deleted_at,updated_at=now()`,
        [rid, d.pageId, d.notebookId, num(d.pen) | 0, num(d.color) | 0, num(d.width, 2), num(d.opacity, 1), num(d.shape) | 0, pts, rev, deleted]);
      return rev;
    }
  }
  throw httpError(400, 'unknown_entity');
}

export async function pushOps(db: Db, userId: string, deviceId: string, ops: Op[]): Promise<OpResult[]> {
  const sorted = [...ops].sort((a, b) => (ORDER[a.entityType] ?? 9) - (ORDER[b.entityType] ?? 9) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const results: OpResult[] = [];
  for (const op of sorted) {
    if (!UUID.test(op.opId ?? '') || !UUID.test(op.entityId ?? '') || !(op.entityType in ORDER)) {
      results.push({ opId: String(op.opId), status: 'rejected', reason: 'bad_op' }); continue;
    }
    try {
      // 작업 하나 = 트랜잭션 하나 → 한 작업이 실패해도 나머지는 반영, 실패한 것만 재전송
      const r = await tx(db, async (c) => {
        const dup = await c.query('SELECT new_rev FROM sync_operations WHERE op_id=$1', [op.opId]);
        if (dup.rows.length) return { opId: op.opId, status: 'duplicate', rev: Number(dup.rows[0].new_rev) } as OpResult;
        const ex = await current(c, op.entityType, op.entityId);
        const base = op.baseRev ?? 0;
        const serverRev = ex ? Number(ex.rev ?? 1) : 0;
        const data = { ...op.data, deleted: op.opType === 'delete' ? true : op.data?.deleted };
        let res: OpResult;
        if (!ex || serverRev === base) {
          const rev = await write(c, userId, op.entityType, op.entityId, data, ex);
          res = { opId: op.opId, status: 'applied', rev };
        } else {
          // 충돌
          const serverDeleted = !!ex.deleted_at;
          let copyId: string | undefined;
          let rev: number;
          if (data.deleted && !serverDeleted) {
            rev = serverRev; // 다른 기기가 수정한 것을 지우지 않는다
          } else if (op.entityType === 'stroke') {
            copyId = randomUUID();
            rev = await write(c, userId, 'stroke', op.entityId, { ...data, deleted: false }, null, copyId);
          } else {
            rev = await write(c, userId, op.entityType, op.entityId, data, ex);
          }
          await c.query(`INSERT INTO sync_conflicts(user_id, entity_type, entity_id, kept_copy_entity_id, detail) VALUES($1,$2,$3,$4,$5)`,
            [userId, op.entityType, op.entityId, copyId ?? null, JSON.stringify({ serverRev, baseRev: base, previous: stripBinary(ex), deviceId })]);
          res = { opId: op.opId, status: 'conflict', rev, copyId };
        }
        await c.query(`INSERT INTO sync_operations(op_id,user_id,device_id,notebook_id,page_id,entity_type,entity_id,op_type,base_rev,new_rev,client_created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, to_timestamp($11/1000.0))`,
          [op.opId, userId, deviceId, notebookOf(op), op.data?.pageId ?? null, op.entityType, res.copyId ?? op.entityId, op.opType, base, res.rev ?? null, op.createdAt ?? Date.now()]);
        return res;
      });
      results.push(r);
    } catch (e: any) {
      results.push({ opId: op.opId, status: 'rejected', reason: e?.message ?? 'error' });
    }
  }
  return results;
}

function notebookOf(op: Op) { return op.entityType === 'notebook' ? op.entityId : (op.data?.notebookId && UUID.test(op.data.notebookId) ? op.data.notebookId : null); }
function stripBinary(row: any) { const { points, ...rest } = row ?? {}; return rest; }

function toClient(type: string, r: any) {
  const del = !!r.deleted_at;
  switch (type) {
    case 'folder': return { id: r.id, parentId: r.parent_id, name: r.name, deleted: del };
    case 'notebook': return { id: r.id, folderId: r.folder_id, title: r.title, description: r.description, coverColor: r.cover_color, favorite: r.favorite, locked: r.locked, infinite: r.is_infinite, deleted: del, createdAt: +new Date(r.created_at), tags: r.tags ?? [] };
    case 'attachment': return { id: r.id, notebookId: r.notebook_id, kind: r.kind, fileName: r.file_name, mime: r.mime, size: Number(r.size), sha256: r.sha256, deleted: del };
    case 'page': return { id: r.id, notebookId: r.notebook_id, index: r.page_index, width: r.width, height: r.height, paper: r.paper, template: r.template, bgType: r.bg_type, attachmentId: r.attachment_id, pdfPage: r.pdf_page, deleted: del };
    case 'stroke': return { id: r.id, pageId: r.page_id, notebookId: r.notebook_id, pen: r.pen, color: r.color, width: r.width, opacity: r.opacity, shape: r.shape, points: Buffer.from(r.points).toString('base64'), deleted: del, createdAt: +new Date(r.created_at) };
  }
  return null;
}

export async function pullOps(db: Db, userId: string, deviceId: string, since: number, limit: number) {
  const ops = await db.query(`SELECT seq, op_id, device_id, entity_type, entity_id, op_type FROM sync_operations
     WHERE user_id=$1 AND seq>$2 AND (device_id<>$3 OR op_id IN (SELECT local_op_id FROM sync_conflicts WHERE user_id=$1) OR entity_id IN (SELECT kept_copy_entity_id FROM sync_conflicts WHERE user_id=$1 AND kept_copy_entity_id IS NOT NULL))
     ORDER BY seq LIMIT $4`, [userId, since, deviceId, limit]);
  const out: any[] = [];
  const seen = new Set<string>();
  const table: Record<string, string> = { folder: 'notebook_folders', notebook: 'notebooks', attachment: 'attachments', page: 'pages', stroke: 'pen_strokes' };
  for (const o of ops.rows) {
    const key = o.entity_type + ':' + o.entity_id;
    if (seen.has(key)) continue; // 같은 대상은 현재 상태 한 번만
    seen.add(key);
    const q = o.entity_type === 'notebook'
      ? `SELECT n.*, COALESCE((SELECT array_agg(t.name) FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.notebook_id=n.id), '{}') AS tags FROM notebooks n WHERE n.id=$1`
      : `SELECT * FROM ${table[o.entity_type]} WHERE id=$1`;
    const r = (await db.query(q, [o.entity_id])).rows[0];
    if (!r) continue;
    const owner = o.entity_type === 'folder' || o.entity_type === 'notebook' || o.entity_type === 'attachment' ? r.user_id
      : (await db.query('SELECT user_id FROM notebooks WHERE id=$1', [r.notebook_id])).rows[0]?.user_id;
    if (owner !== userId) continue;
    out.push({ seq: Number(o.seq), entityType: o.entity_type, rev: Number(r.rev ?? 1), data: toClient(o.entity_type, r) });
  }
  const last = ops.rows.length ? Number(ops.rows[ops.rows.length - 1].seq) : since;
  out.sort((a, b) => (ORDER[a.entityType] - ORDER[b.entityType]) || a.seq - b.seq);
  return { changes: out, nextSince: last, hasMore: ops.rows.length === limit };
}

export function syncRoutes(app: FastifyInstance, db: Db) {
  app.post('/v1/sync/push', { bodyLimit: 64 * 1024 * 1024 }, async (req) => {
    const u = await requireUser(req);
    const ops = (req.body as any)?.ops;
    if (!Array.isArray(ops) || ops.length > MAX_OPS) throw httpError(400, 'bad_batch');
    const results = await pushOps(db, u.userId, u.deviceId, ops);
    await db.query('UPDATE user_devices SET last_seen_at=now() WHERE id=$1', [u.deviceId]);
    return { results };
  });

  app.get('/v1/sync/pull', async (req) => {
    const u = await requireUser(req);
    const q = req.query as any;
    const since = Math.max(0, Number(q.since ?? 0) | 0);
    const limit = Math.min(1000, Math.max(1, Number(q.limit ?? 500) | 0));
    const r = await pullOps(db, u.userId, u.deviceId, since, limit);
    await db.query('UPDATE user_devices SET last_sync_seq=GREATEST(last_sync_seq,$2), last_seen_at=now() WHERE id=$1', [u.deviceId, r.nextSince]);
    return r;
  });

  /** 충돌 후 원본(다른 기기 버전) 다시 받기 */
  app.get('/v1/sync/entity/:type/:id', async (req) => {
    const u = await requireUser(req);
    const { type, id } = req.params as any;
    const table: Record<string, string> = { folder: 'notebook_folders', notebook: 'notebooks', attachment: 'attachments', page: 'pages', stroke: 'pen_strokes' };
    if (!table[type] || !UUID.test(id)) throw httpError(400, 'bad_request');
    const q = type === 'notebook'
      ? `SELECT n.*, COALESCE((SELECT array_agg(t.name) FROM note_tags nt JOIN tags t ON t.id=nt.tag_id WHERE nt.notebook_id=n.id), '{}') AS tags FROM notebooks n WHERE n.id=$1`
      : `SELECT * FROM ${table[type]} WHERE id=$1`;
    const r = (await db.query(q, [id])).rows[0];
    if (!r) throw httpError(404, 'not_found');
    const owner = r.user_id ?? (await db.query('SELECT user_id FROM notebooks WHERE id=$1', [r.notebook_id])).rows[0]?.user_id;
    if (owner !== u.userId) throw httpError(404, 'not_found');
    return { entityType: type, rev: Number(r.rev ?? 1), data: toClient(type, r) };
  });

  app.get('/v1/sync/status', async (req) => {
    const u = await requireUser(req);
    const head = (await db.query('SELECT COALESCE(max(seq),0) AS s FROM sync_operations WHERE user_id=$1', [u.userId])).rows[0].s;
    const conflicts = (await db.query(`SELECT count(*)::int AS n FROM sync_conflicts WHERE user_id=$1 AND created_at > now() - interval '30 days'`, [u.userId])).rows[0].n;
    return { headSeq: Number(head), recentConflicts: conflicts };
  });
}
