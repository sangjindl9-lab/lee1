"""작업일보. 승인 시에만 progress_entries 에 실적이 기록된다(재저장·재승인 시 교체되어 중복 없음)."""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..models import (BoqItem, DailyReport, DailyReportEquipment, DailyReportItem, DailyReportLabor,
                      DailyReportMaterial, DailyReportRevision, FileObject, Material, Project, ProgressEntry, User)
from ..security import Ctx, get_ctx, perm
from ..services.common import audit, bump, check_version, jsonable, next_doc_no, notify, row_dict
from ..services.progress import actual_cum_by_item, item_rate
from ..util import D, now_kst, q_qty, q_rate, s, today_kst

router = APIRouter(prefix="/api/daily-reports", tags=["daily_reports"])

STATUS_LABEL = {"draft": "작성중", "submitted": "제출", "rejected": "반려", "approved": "승인", "correcting": "정정중"}
EDITABLE = ("draft", "rejected", "correcting")
TEXT_FIELDS = ("weather", "temp_low", "temp_high", "work_summary", "work_location", "safety_education", "hazards",
               "safety_actions", "delay_reason", "remarks", "tomorrow_plan")


class ItemIn(BaseModel):
    boq_item_id: int
    qty_today: str = "0"
    location: str | None = None
    note: str | None = None


class LaborIn(BaseModel):
    trade: str = Field(min_length=1, max_length=50)
    affiliation: str | None = None
    headcount: str = "0"
    note: str | None = None


class EquipIn(BaseModel):
    kind: str = Field(min_length=1, max_length=100)
    spec: str | None = None
    count: str = "0"
    hours: str = "0"
    note: str | None = None


class MatIn(BaseModel):
    material_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    spec: str | None = None
    unit: str | None = None
    qty: str = "0"
    note: str | None = None


class ReportIn(BaseModel):
    project_id: int | None = None
    report_date: date | None = None
    weather: str | None = None
    temp_low: str | None = Field(None, max_length=10)
    temp_high: str | None = Field(None, max_length=10)
    work_summary: str | None = None
    work_location: str | None = None
    safety_education: str | None = None
    hazards: str | None = None
    safety_actions: str | None = None
    delay_reason: str | None = None
    remarks: str | None = None
    tomorrow_plan: str | None = None
    items: list[ItemIn] = []
    labor: list[LaborIn] = []
    equipment: list[EquipIn] = []
    materials: list[MatIn] = []
    confirmed_sections: list[str] = []   # 복사된 항목 중 사용자가 확인한 섹션
    version: int | None = None


def _get(ctx: Ctx, rid: int, lock: bool = False) -> tuple[DailyReport, Project]:
    q = select(DailyReport).where(DailyReport.id == rid)
    if lock:
        q = q.with_for_update()
    r = ctx.db.execute(q).scalar_one_or_none()
    if not r or r.company_id != ctx.company_id or r.deleted_at:
        raise HTTPException(404, "작업일보를 찾을 수 없습니다.")
    p = ctx.project(r.project_id)
    return r, p


def _apply(ctx: Ctx, r: DailyReport, body: ReportIn):
    for k in TEXT_FIELDS:
        setattr(r, k, getattr(body, k))
    valid_items = {i.id for i in ctx.db.execute(select(BoqItem).where(
        BoqItem.project_id == r.project_id, BoqItem.deleted_at.is_(None))).scalars()}
    seen = set()
    r.items.clear()
    r.labor.clear()
    r.equipment.clear()
    r.materials.clear()
    ctx.db.flush()
    for it in body.items:
        if it.boq_item_id not in valid_items:
            raise HTTPException(400, "이 현장의 설계내역 항목이 아닙니다.")
        if it.boq_item_id in seen:
            raise HTTPException(400, "같은 내역항목이 중복 입력되었습니다. 한 줄로 합쳐 입력하세요.")
        seen.add(it.boq_item_id)
        q = q_qty(it.qty_today)
        if q < 0:
            raise HTTPException(400, "금일 시공수량은 0 이상이어야 합니다. 과거 수량 수정은 해당 일보 정정으로 처리하세요.")
        r.items.append(DailyReportItem(boq_item_id=it.boq_item_id, qty_today=q, location=it.location, note=it.note))
    for lb in body.labor:
        hc = D(lb.headcount)
        if hc < 0:
            raise HTTPException(400, "인원은 0 이상이어야 합니다.")
        r.labor.append(DailyReportLabor(trade=lb.trade, affiliation=lb.affiliation, headcount=hc, note=lb.note))
    for eq in body.equipment:
        r.equipment.append(DailyReportEquipment(kind=eq.kind, spec=eq.spec, count=D(eq.count), hours=D(eq.hours), note=eq.note))
    for m in body.materials:
        if m.material_id:
            mm = ctx.db.get(Material, m.material_id)
            if not mm or mm.company_id != ctx.company_id:
                raise HTTPException(400, "자재가 올바르지 않습니다.")
        r.materials.append(DailyReportMaterial(material_id=m.material_id, name=m.name, spec=m.spec, unit=m.unit,
                                               qty=q_qty(m.qty), note=m.note))
    r.needs_confirm = [x for x in (r.needs_confirm or []) if x not in body.confirmed_sections]


def report_detail(ctx: Ctx, r: DailyReport, p: Project) -> dict:
    db = ctx.db
    d = row_dict(r, exclude=("company_id",))
    d["status_label"] = STATUS_LABEL.get(r.status, r.status)
    d["project_name"], d["project_code"] = p.name, p.code
    au = db.get(User, r.author_id)
    d["author_name"] = au.name if au else None
    rv = db.get(User, r.reviewed_by) if r.reviewed_by else None
    d["reviewer_name"] = rv.name if rv else None
    boq = {i.id: i for i in db.execute(select(BoqItem).where(BoqItem.project_id == p.id)).scalars()}
    entries = {e.boq_item_id: e for e in db.execute(select(ProgressEntry).where(ProgressEntry.report_id == r.id)).scalars()}
    prev_live = actual_cum_by_item(db, p.id, r.report_date, exclude_report_id=r.id, strictly_before=True)
    use_snapshot = r.status == "approved"
    items = []
    for it in r.items:
        b = boq.get(it.boq_item_id)
        e = entries.get(it.boq_item_id)
        if use_snapshot and e:
            design, prev = Decimal(e.design_qty_at_approval), Decimal(e.prev_cum_at_approval)
        else:
            design, prev = Decimal(b.design_qty) if b else Decimal(0), prev_live.get(it.boq_item_id, Decimal(0))
        today = Decimal(it.qty_today)
        cum = prev + today
        rate = item_rate(cum, design)
        items.append({
            "boq_item_id": it.boq_item_id, "name": b.name if b else "(삭제된 항목)", "spec": b.spec if b else None,
            "unit": b.unit if b else None, "location": it.location, "note": it.note,
            "design_qty": s(design), "prev_cum": s(prev), "qty_today": s(today), "cum": s(cum),
            "remaining": s(design - cum), "rate": s(q_rate(rate)) if rate is not None else None,
            "over": cum > design and design > 0, "snapshot": bool(use_snapshot and e),
        })
    d["items"] = items
    d["labor"] = [{"trade": x.trade, "affiliation": x.affiliation, "headcount": s(x.headcount), "note": x.note} for x in r.labor]
    d["labor_total"] = s(sum((Decimal(x.headcount) for x in r.labor), Decimal(0)))
    d["equipment"] = [{"kind": x.kind, "spec": x.spec, "count": s(x.count), "hours": s(x.hours), "note": x.note} for x in r.equipment]
    d["materials"] = [{"material_id": x.material_id, "name": x.name, "spec": x.spec, "unit": x.unit, "qty": s(x.qty), "note": x.note}
                      for x in r.materials]
    files = db.execute(select(FileObject).where(FileObject.owner_type == "daily_report", FileObject.owner_id == r.id,
                                                FileObject.deleted_at.is_(None)).order_by(FileObject.id)).scalars()
    d["files"] = [{"id": f.id, "name": f.original_name, "category": f.category, "has_thumb": bool(f.thumb_path),
                   "phase": f.phase, "location": f.location, "title": f.title, "size": f.size} for f in files]
    revs = db.execute(select(DailyReportRevision, User.name).outerjoin(User, User.id == DailyReportRevision.created_by)
                      .where(DailyReportRevision.report_id == r.id).order_by(DailyReportRevision.revision)).all()
    d["revisions"] = [{"revision": v.revision, "reason": v.reason, "by": n, "at": v.created_at.isoformat()} for v, n in revs]
    d["editable"] = r.status in EDITABLE and ctx.has("report.write")
    return d


@router.get("")
def list_reports(project_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
                 status: str | None = None, ctx: Ctx = Depends(get_ctx)):
    q = select(DailyReport, Project.name, User.name).join(Project, Project.id == DailyReport.project_id) \
        .join(User, User.id == DailyReport.author_id) \
        .where(DailyReport.company_id == ctx.company_id, DailyReport.deleted_at.is_(None), Project.deleted_at.is_(None))
    ids = ctx.project_ids()
    if ids is not None:
        q = q.where(DailyReport.project_id.in_(ids or [0]))
    if project_id:
        q = q.where(DailyReport.project_id == project_id)
    if date_from:
        q = q.where(DailyReport.report_date >= date_from)
    if date_to:
        q = q.where(DailyReport.report_date <= date_to)
    if status:
        q = q.where(DailyReport.status.in_(status.split(",")))
    rows = ctx.db.execute(q.order_by(DailyReport.report_date.desc(), DailyReport.id.desc()).limit(1000)).all()
    return [{"id": r.id, "report_no": r.report_no, "project_id": r.project_id, "project_name": pn, "report_date": r.report_date.isoformat(),
             "author_name": an, "weather": r.weather, "work_summary": (r.work_summary or "")[:80], "status": r.status,
             "status_label": STATUS_LABEL.get(r.status), "revision": r.revision} for r, pn, an in rows]


@router.post("")
def create_report(body: ReportIn, ctx: Ctx = Depends(perm("report.write"))):
    if not body.project_id or not body.report_date:
        raise HTTPException(400, "현장과 작성일을 입력하세요.")
    p = ctx.project(body.project_id)
    if body.report_date > today_kst():
        raise HTTPException(400, "미래 날짜의 작업일보는 작성할 수 없습니다.")
    if ctx.db.execute(select(DailyReport.id).where(DailyReport.project_id == p.id, DailyReport.report_date == body.report_date,
                                                    DailyReport.deleted_at.is_(None))).first():
        raise HTTPException(409, "해당 날짜의 작업일보가 이미 있습니다. 기존 일보를 수정하세요.")
    r = DailyReport(company_id=ctx.company_id, project_id=p.id, report_date=body.report_date, author_id=ctx.user.id,
                    report_no=next_doc_no(ctx.db, ctx.company_id, "DR", p.code, body.report_date), needs_confirm=[])
    ctx.db.add(r)
    ctx.db.flush()
    _apply(ctx, r, body)
    ctx.db.flush()
    audit(ctx, "create", "daily_report", r.id, f"작업일보 작성: {p.name} {r.report_date}", project_id=p.id)
    ctx.db.commit()
    return report_detail(ctx, r, p)


class CopyIn(BaseModel):
    project_id: int
    report_date: date


@router.post("/copy-previous")
def copy_previous(body: CopyIn, ctx: Ctx = Depends(perm("report.write"))):
    """직전 일보를 복사해 새 일보 작성. 수량·인원은 '확인 필요'로 표시되고 확인 전에는 제출 불가. 사진은 복사하지 않음."""
    p = ctx.project(body.project_id)
    src = ctx.db.execute(select(DailyReport).where(DailyReport.project_id == p.id, DailyReport.report_date < body.report_date,
                                                    DailyReport.deleted_at.is_(None))
                         .order_by(DailyReport.report_date.desc())).scalars().first()
    if not src:
        raise HTTPException(404, "복사할 이전 일보가 없습니다.")
    data = ReportIn(project_id=p.id, report_date=body.report_date,
                    **{k: getattr(src, k) for k in TEXT_FIELDS},
                    items=[ItemIn(boq_item_id=i.boq_item_id, qty_today=s(i.qty_today), location=i.location, note=i.note) for i in src.items],
                    labor=[LaborIn(trade=x.trade, affiliation=x.affiliation, headcount=s(x.headcount), note=x.note) for x in src.labor],
                    equipment=[EquipIn(kind=x.kind, spec=x.spec, count=s(x.count), hours=s(x.hours), note=x.note) for x in src.equipment],
                    materials=[MatIn(material_id=x.material_id, name=x.name, spec=x.spec, unit=x.unit, qty=s(x.qty), note=x.note) for x in src.materials])
    data.work_summary = src.tomorrow_plan or src.work_summary
    data.tomorrow_plan = None
    out = create_report(data, ctx)
    r = ctx.db.get(DailyReport, out["id"])
    r.copied_from_id = src.id
    r.needs_confirm = [x for x in ("items", "labor", "equipment", "materials") if getattr(src, x)]
    ctx.db.commit()
    return report_detail(ctx, r, p)


@router.get("/{rid}")
def get_report(rid: int, ctx: Ctx = Depends(get_ctx)):
    r, p = _get(ctx, rid)
    return report_detail(ctx, r, p)


@router.put("/{rid}")
def update_report(rid: int, body: ReportIn, ctx: Ctx = Depends(perm("report.write"))):
    r, p = _get(ctx, rid, lock=True)
    check_version(r, body.version)
    if r.status not in EDITABLE:
        raise HTTPException(409, f"'{STATUS_LABEL[r.status]}' 상태의 일보는 수정할 수 없습니다." +
                            (" 승인된 일보는 '정정 요청' 후 수정하세요." if r.status == "approved" else ""))
    before = report_detail(ctx, r, p)
    _apply(ctx, r, body)
    bump(r)
    ctx.db.flush()
    audit(ctx, "update", "daily_report", r.id, f"작업일보 저장: {p.name} {r.report_date}",
          before={"items": before["items"]}, project_id=p.id)
    ctx.db.commit()
    return report_detail(ctx, r, p)


@router.delete("/{rid}")
def delete_report(rid: int, ctx: Ctx = Depends(perm("report.write"))):
    r, p = _get(ctx, rid, lock=True)
    if r.status not in ("draft", "rejected") or r.revision > 0:
        raise HTTPException(409, "작성중·반려 상태(승인 이력 없음)의 일보만 삭제할 수 있습니다.")
    r.deleted_at = now_kst()
    audit(ctx, "delete", "daily_report", r.id, f"작업일보 삭제(휴지통): {p.name} {r.report_date}", project_id=p.id)
    ctx.db.commit()
    return {"ok": True}


class ReasonIn(BaseModel):
    reason: str | None = None
    version: int | None = None


@router.post("/{rid}/submit")
def submit(rid: int, body: ReasonIn | None = None, ctx: Ctx = Depends(perm("report.write"))):
    r, p = _get(ctx, rid, lock=True)
    if body:
        check_version(r, body.version)
    if r.status not in EDITABLE:
        raise HTTPException(409, "제출할 수 없는 상태입니다.")
    if r.needs_confirm:
        names = {"items": "시공수량", "labor": "투입인원", "equipment": "장비", "materials": "사용자재"}
        raise HTTPException(400, "이전 일보에서 복사한 항목을 확인해야 제출할 수 있습니다: " +
                            ", ".join(names.get(x, x) for x in r.needs_confirm))
    if not (r.work_summary or "").strip():
        raise HTTPException(400, "금일 작업내용을 입력하세요.")
    r.status, r.submitted_at, r.reject_reason = "submitted", now_kst(), None
    bump(r)
    approvers = [p.site_manager_id] if p.site_manager_id and p.site_manager_id != ctx.user.id else []
    notify(ctx.db, ctx.company_id, approvers, "daily_report", f"[일보 검토요청] {p.name} {r.report_date}", f"#/reports/{r.id}")
    audit(ctx, "submit", "daily_report", r.id, f"작업일보 제출: {p.name} {r.report_date}", project_id=p.id)
    ctx.db.commit()
    return report_detail(ctx, r, p)


@router.post("/{rid}/approve")
def approve(rid: int, body: ReasonIn | None = None, ctx: Ctx = Depends(perm("report.approve"))):
    db = ctx.db
    # 같은 현장 승인 처리를 직렬화하여 누계 스냅샷 일관성 확보
    r0 = db.get(DailyReport, rid)
    if not r0 or r0.company_id != ctx.company_id:
        raise HTTPException(404, "작업일보를 찾을 수 없습니다.")
    db.execute(select(Project.id).where(Project.id == r0.project_id).with_for_update())
    r, p = _get(ctx, rid, lock=True)
    if body:
        check_version(r, body.version)
    if r.status != "submitted":
        raise HTTPException(409, "제출된 일보만 승인할 수 있습니다.")
    boq = {i.id: i for i in db.execute(select(BoqItem).where(BoqItem.project_id == p.id, BoqItem.deleted_at.is_(None))).scalars()}
    prev = actual_cum_by_item(db, p.id, r.report_date, exclude_report_id=r.id, strictly_before=True)
    db.query(ProgressEntry).filter(ProgressEntry.report_id == r.id).delete()
    for it in r.items:
        b = boq.get(it.boq_item_id)
        if not b:
            raise HTTPException(409, "삭제된 내역항목이 포함되어 있습니다. 반려 후 수정하세요.")
        db.add(ProgressEntry(company_id=ctx.company_id, project_id=p.id, boq_item_id=b.id, report_id=r.id,
                             work_date=r.report_date, qty=it.qty_today, design_qty_at_approval=b.design_qty,
                             prev_cum_at_approval=prev.get(b.id, Decimal(0))))
    r.revision = (r.revision or 0) + 1
    r.status, r.reviewed_by, r.reviewed_at = "approved", ctx.user.id, now_kst()
    bump(r)
    db.flush()
    snap = report_detail(ctx, r, p)
    db.add(DailyReportRevision(report_id=r.id, revision=r.revision, snapshot=jsonable(snap),
                               reason=r.correction_reason if r.revision > 1 else "최초 승인", created_by=ctx.user.id))
    r.correction_reason = None
    notify(db, ctx.company_id, [r.author_id], "daily_report", f"[일보 승인] {p.name} {r.report_date}", f"#/reports/{r.id}")
    audit(ctx, "approve", "daily_report", r.id, f"작업일보 승인(rev{r.revision}): {p.name} {r.report_date}", project_id=p.id)
    db.commit()
    return report_detail(ctx, r, p)


@router.post("/{rid}/reject")
def reject(rid: int, body: ReasonIn, ctx: Ctx = Depends(perm("report.approve"))):
    r, p = _get(ctx, rid, lock=True)
    if r.status != "submitted":
        raise HTTPException(409, "제출된 일보만 반려할 수 있습니다.")
    if not (body.reason or "").strip():
        raise HTTPException(400, "반려 사유를 입력하세요.")
    # 정정본 반려 시 이전 승인 실적은 유지되고 상태는 '정정중'으로 복귀
    r.status = "correcting" if r.revision > 0 else "rejected"
    r.reject_reason, r.reviewed_by, r.reviewed_at = body.reason, ctx.user.id, now_kst()
    bump(r)
    notify(ctx.db, ctx.company_id, [r.author_id], "daily_report", f"[일보 반려] {p.name} {r.report_date}", f"#/reports/{r.id}")
    audit(ctx, "reject", "daily_report", r.id, f"작업일보 반려: {body.reason}", project_id=p.id)
    ctx.db.commit()
    return report_detail(ctx, r, p)


@router.post("/{rid}/request-correction")
def request_correction(rid: int, body: ReasonIn, ctx: Ctx = Depends(perm("report.write"))):
    """승인된 일보 정정 시작. 정정본이 다시 승인되기 전까지 기존 승인 실적은 유지."""
    r, p = _get(ctx, rid, lock=True)
    if r.status != "approved":
        raise HTTPException(409, "승인된 일보만 정정할 수 있습니다.")
    if not (body.reason or "").strip():
        raise HTTPException(400, "정정 사유를 입력하세요.")
    r.status, r.correction_reason = "correcting", body.reason
    bump(r)
    audit(ctx, "correction", "daily_report", r.id, f"작업일보 정정 시작: {body.reason}", project_id=p.id)
    ctx.db.commit()
    return report_detail(ctx, r, p)


@router.post("/{rid}/unapprove")
def unapprove(rid: int, body: ReasonIn, ctx: Ctx = Depends(perm("report.unapprove"))):
    """승인 취소: 해당 일보의 실적을 공정률에서 제거하고 반려 상태로 되돌린다."""
    db = ctx.db
    r0 = db.get(DailyReport, rid)
    if not r0 or r0.company_id != ctx.company_id:
        raise HTTPException(404, "작업일보를 찾을 수 없습니다.")
    db.execute(select(Project.id).where(Project.id == r0.project_id).with_for_update())
    r, p = _get(ctx, rid, lock=True)
    if r.status not in ("approved", "correcting"):
        raise HTTPException(409, "승인된 일보만 승인취소할 수 있습니다.")
    if not (body.reason or "").strip():
        raise HTTPException(400, "승인취소 사유를 입력하세요.")
    removed = db.query(ProgressEntry).filter(ProgressEntry.report_id == r.id).delete()
    r.status, r.reject_reason = "rejected", f"승인취소: {body.reason}"
    bump(r)
    notify(db, ctx.company_id, [r.author_id], "daily_report", f"[일보 승인취소] {p.name} {r.report_date}", f"#/reports/{r.id}")
    audit(ctx, "unapprove", "daily_report", r.id, f"작업일보 승인취소(실적 {removed}건 제거): {body.reason}", project_id=p.id)
    db.commit()
    return report_detail(ctx, r, p)


@router.get("/{rid}/revisions/{rev}")
def get_revision(rid: int, rev: int, ctx: Ctx = Depends(get_ctx)):
    r, p = _get(ctx, rid)
    v = ctx.db.execute(select(DailyReportRevision).where(DailyReportRevision.report_id == r.id,
                                                         DailyReportRevision.revision == rev)).scalar_one_or_none()
    if not v:
        raise HTTPException(404, "해당 차수의 승인본이 없습니다.")
    return v.snapshot
