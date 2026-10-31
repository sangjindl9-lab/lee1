from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from ..models import (ApprovalDoc, ApprovalStep, BoqItem, DailyReport, MaterialRequest, Notice, Notification, Project,
                      PurchaseOrder, User)
from ..security import Ctx, get_ctx, perm
from ..services.common import audit
from ..services.progress import compute_project_progress
from ..util import now_kst, s, today_kst
from .materials import ordered_by_request_item, po_out

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(project_id: int | None = None, ctx: Ctx = Depends(get_ctx)):
    db = ctx.db
    today = today_kst()
    pq = select(Project).where(Project.company_id == ctx.company_id, Project.deleted_at.is_(None))
    ids = ctx.project_ids()
    if ids is not None:
        pq = pq.where(Project.id.in_(ids or [0]))
    if project_id:
        ctx.project(project_id)
        pq = pq.where(Project.id == project_id)
    projects = db.execute(pq).scalars().all()
    pids = [p.id for p in projects]
    active = [p for p in projects if p.status == "진행"]

    # 공정률
    prog = []
    for p in active:
        r = compute_project_progress(db, p, today)
        prog.append({"id": p.id, "name": p.name, "code": p.code, "plan_rate": r["plan_rate"], "actual_rate": r["actual_rate"],
                     "deviation": r["deviation"], "planned_end_date": p.planned_end_date.isoformat() if p.planned_end_date else None})
    ending = [{"id": p.id, "name": p.name, "planned_end_date": p.planned_end_date.isoformat()}
              for p in projects if p.status in ("진행", "중지") and p.planned_end_date and today <= p.planned_end_date <= today + timedelta(days=30)]
    overdue = [{"id": p.id, "name": p.name, "planned_end_date": p.planned_end_date.isoformat()}
               for p in projects if p.status in ("진행", "중지") and p.planned_end_date and p.planned_end_date < today]

    # 미작성 작업일보 (진행 현장, 최근 7일 중 일요일 제외)
    missing = []
    if active:
        have = {(a, b) for a, b in db.execute(select(DailyReport.project_id, DailyReport.report_date).where(
            DailyReport.project_id.in_([p.id for p in active]), DailyReport.deleted_at.is_(None),
            DailyReport.report_date >= today - timedelta(days=7))).all()}
        for p in active:
            for k in range(0, 7):
                d = today - timedelta(days=k)
                if d.weekday() == 6 or (p.start_date and d < p.start_date):
                    continue
                if (p.id, d) not in have:
                    missing.append({"project_id": p.id, "project_name": p.name, "date": d.isoformat()})
    # 결재
    pending_docs = db.execute(select(ApprovalDoc).join(ApprovalStep).where(
        ApprovalDoc.company_id == ctx.company_id, ApprovalDoc.status == "in_progress",
        ApprovalStep.approver_id == ctx.user.id, ApprovalStep.status == "pending").order_by(ApprovalDoc.id.desc())).scalars().all()
    my_drafts = db.execute(select(func.count()).select_from(ApprovalDoc).where(
        ApprovalDoc.drafter_id == ctx.user.id, ApprovalDoc.status == "in_progress")).scalar()
    # 일보 검토 대기
    review = []
    if ctx.has("report.approve") and pids:
        review = [{"id": r.id, "project_id": r.project_id, "date": r.report_date.isoformat()} for r in db.execute(
            select(DailyReport).where(DailyReport.project_id.in_(pids), DailyReport.status == "submitted",
                                      DailyReport.deleted_at.is_(None)).order_by(DailyReport.report_date)).scalars()]
    # 자재: 발주 대기(승인된 요청 중 미발주 잔량)
    waiting_req = []
    if pids:
        reqs = db.execute(select(MaterialRequest).where(MaterialRequest.project_id.in_(pids), MaterialRequest.status == "approved",
                                                        MaterialRequest.deleted_at.is_(None))).scalars().all()
        for r in reqs:
            o = ordered_by_request_item(ctx, [i.id for i in r.items])
            rest = sum((Decimal(i.qty) - o.get(i.id, {}).get("confirmed", 0) - o.get(i.id, {}).get("pending", 0) for i in r.items), Decimal(0))
            if rest > 0:
                waiting_req.append({"id": r.id, "req_no": r.req_no, "project_id": r.project_id, "urgent": r.urgent,
                                    "need_date": r.need_date.isoformat() if r.need_date else None})
    pos = db.execute(select(PurchaseOrder).where(PurchaseOrder.project_id.in_(pids or [0]), PurchaseOrder.deleted_at.is_(None),
                                                 PurchaseOrder.status.in_(("ordered", "partial")))).scalars().all()
    po_rows = [po_out(ctx, po) for po in pos]
    delayed = [r for r in po_rows if r["delayed"]]
    partial = [r for r in po_rows if r["status"] == "partial"]
    not_received = [r for r in po_rows if r["status"] == "ordered"]
    # 이번 주 일정: 계획 시작/종료 공종, 납기
    wk_start = today - timedelta(days=today.weekday())
    wk_end = wk_start + timedelta(days=6)
    sched = []
    if pids:
        for it, pname in db.execute(select(BoqItem, Project.name).join(Project, Project.id == BoqItem.project_id).where(
                BoqItem.project_id.in_(pids), BoqItem.deleted_at.is_(None),
                ((BoqItem.plan_start >= wk_start) & (BoqItem.plan_start <= wk_end)) |
                ((BoqItem.plan_end >= wk_start) & (BoqItem.plan_end <= wk_end)))).all():
            if it.plan_start and wk_start <= it.plan_start <= wk_end:
                sched.append({"date": it.plan_start.isoformat(), "kind": "작업 시작", "title": f"{it.name}", "project": pname,
                              "link": f"#/projects/{it.project_id}/progress"})
            if it.plan_end and wk_start <= it.plan_end <= wk_end:
                sched.append({"date": it.plan_end.isoformat(), "kind": "작업 완료예정", "title": f"{it.name}", "project": pname,
                              "link": f"#/projects/{it.project_id}/progress"})
        for po in pos:
            if po.delivery_date and wk_start <= po.delivery_date <= wk_end:
                sched.append({"date": po.delivery_date.isoformat(), "kind": "자재 납기", "title": po.po_no,
                              "project": next((p.name for p in projects if p.id == po.project_id), ""), "link": f"#/pos/{po.id}"})
    sched.sort(key=lambda x: x["date"])
    money = None
    if ctx.has("amount.contract"):
        live = [p for p in projects if p.status in ("준비", "진행", "중지")]
        money = {"active_contract_total": s(sum((Decimal(p.total_amount) for p in live), Decimal(0))),
                 "active_supply_total": s(sum((Decimal(p.supply_amount) for p in live), Decimal(0))),
                 "note": "기성·수금·원가 집계는 2차 개발 범위입니다."}
    notices = db.execute(select(Notice, User.name).join(User, User.id == Notice.author_id).where(
        Notice.company_id == ctx.company_id, Notice.deleted_at.is_(None),
        (Notice.project_id.is_(None)) | (Notice.project_id.in_(pids or [0])))
        .order_by(Notice.pinned.desc(), Notice.id.desc()).limit(5)).all()
    unread = db.execute(select(func.count()).select_from(Notification).where(
        Notification.user_id == ctx.user.id, Notification.read_at.is_(None))).scalar()
    return {
        "today": today.isoformat(),
        "counts": {"projects": len(projects), "active": len(active), "ending_soon": len(ending), "overdue": len(overdue),
                   "missing_reports": len(missing), "pending_approvals": len(pending_docs), "my_drafts_in_progress": my_drafts,
                   "reports_to_review": len(review), "requests_waiting_po": len(waiting_req), "delayed_po": len(delayed),
                   "partial_po": len(partial), "not_received_po": len(not_received), "unread_notifications": unread},
        "progress": prog, "ending_soon": ending, "overdue": overdue, "missing_reports": missing[:50],
        "pending_approvals": [{"id": d.id, "title": d.title, "doc_no": d.doc_no} for d in pending_docs[:10]],
        "reports_to_review": review[:20], "requests_waiting_po": waiting_req[:20],
        "delayed_po": delayed[:20], "partial_po": partial[:20], "schedule": sched[:30], "money": money,
        "notices": [{"id": n.id, "title": n.title, "author": a, "pinned": n.pinned, "created_at": n.created_at.isoformat()} for n, a in notices],
    }


# ---------------------------------------------------------------- 공지
class NoticeIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)
    project_id: int | None = None
    pinned: bool = False


@router.get("/notices")
def list_notices(ctx: Ctx = Depends(get_ctx)):
    ids = ctx.project_ids()
    q = select(Notice, User.name).join(User, User.id == Notice.author_id).where(
        Notice.company_id == ctx.company_id, Notice.deleted_at.is_(None))
    if ids is not None:
        q = q.where(Notice.project_id.is_(None) | Notice.project_id.in_(ids or [0]))
    rows = ctx.db.execute(q.order_by(Notice.pinned.desc(), Notice.id.desc()).limit(200)).all()
    pn = {p.id: p.name for p in ctx.db.execute(select(Project).where(Project.company_id == ctx.company_id)).scalars()}
    return [{"id": n.id, "title": n.title, "body": n.body, "pinned": n.pinned, "author": a, "project_id": n.project_id,
             "project_name": pn.get(n.project_id), "created_at": n.created_at.isoformat()} for n, a in rows]


@router.post("/notices")
def add_notice(body: NoticeIn, ctx: Ctx = Depends(perm("notice.write"))):
    if body.project_id:
        ctx.project(body.project_id)
    n = Notice(company_id=ctx.company_id, author_id=ctx.user.id, **body.model_dump())
    ctx.db.add(n)
    ctx.db.flush()
    audit(ctx, "create", "notice", n.id, f"공지 등록: {n.title}", project_id=n.project_id)
    ctx.db.commit()
    return {"id": n.id}


@router.delete("/notices/{nid}")
def del_notice(nid: int, ctx: Ctx = Depends(perm("notice.write"))):
    n = ctx.db.get(Notice, nid)
    if not n or n.company_id != ctx.company_id:
        raise HTTPException(404, "공지를 찾을 수 없습니다.")
    n.deleted_at = now_kst()
    audit(ctx, "delete", "notice", n.id, f"공지 삭제: {n.title}")
    ctx.db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 알림센터
@router.get("/notifications")
def list_notifications(ctx: Ctx = Depends(get_ctx)):
    rows = ctx.db.execute(select(Notification).where(Notification.user_id == ctx.user.id)
                          .order_by(Notification.id.desc()).limit(100)).scalars()
    return [{"id": n.id, "kind": n.kind, "title": n.title, "link": n.link, "read": bool(n.read_at),
             "created_at": n.created_at.isoformat()} for n in rows]


@router.post("/notifications/read")
def read_notifications(ids: list[int] | None = Body(default=None), ctx: Ctx = Depends(get_ctx)):
    q = ctx.db.query(Notification).filter(Notification.user_id == ctx.user.id, Notification.read_at.is_(None))
    if ids:
        q = q.filter(Notification.id.in_(ids))
    q.update({Notification.read_at: now_kst()}, synchronize_session=False)
    ctx.db.commit()
    return {"ok": True}
