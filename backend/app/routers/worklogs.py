"""본사 업무일지: 임시저장 → 제출 → 승인/반려 → 재제출."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from ..models import Project, User, WorkLog
from ..security import Ctx, get_ctx, perm
from ..services.common import audit, bump, check_version, row_dict
from ..util import now_kst

router = APIRouter(prefix="/api/worklogs", tags=["worklogs"])
LABEL = {"draft": "작성중", "submitted": "제출", "rejected": "반려", "approved": "승인"}


class LogIn(BaseModel):
    log_date: date
    project_id: int | None = None
    task: str = Field(min_length=1, max_length=300)
    detail: str | None = None
    progress_status: str = Field("진행중", pattern="^(예정|진행중|완료|보류)$")
    due_date: date | None = None
    follow_up: str | None = None
    cooperation: str | None = None
    version: int | None = None


def _out(ctx: Ctx, w: WorkLog) -> dict:
    d = row_dict(w, exclude=("company_id",))
    d["status_label"] = LABEL.get(w.status)
    u = ctx.db.get(User, w.author_id)
    d["author_name"] = u.name if u else None
    if w.project_id:
        p = ctx.db.get(Project, w.project_id)
        d["project_name"] = p.name if p else None
    return d


def _get(ctx: Ctx, wid: int) -> WorkLog:
    w = ctx.db.get(WorkLog, wid)
    if not w or w.company_id != ctx.company_id or w.deleted_at:
        raise HTTPException(404, "업무일지를 찾을 수 없습니다.")
    if w.author_id != ctx.user.id and not ctx.has("worklog.review"):
        raise HTTPException(403, "본인 업무일지만 볼 수 있습니다.")
    return w


@router.get("")
def list_logs(date_from: date | None = None, date_to: date | None = None, mine: bool = False, ctx: Ctx = Depends(get_ctx)):
    q = select(WorkLog).where(WorkLog.company_id == ctx.company_id, WorkLog.deleted_at.is_(None))
    if mine or not ctx.has("worklog.review"):
        q = q.where(WorkLog.author_id == ctx.user.id)
    else:
        q = q.where(or_(WorkLog.status != "draft", WorkLog.author_id == ctx.user.id))
    if date_from:
        q = q.where(WorkLog.log_date >= date_from)
    if date_to:
        q = q.where(WorkLog.log_date <= date_to)
    return [_out(ctx, w) for w in ctx.db.execute(q.order_by(WorkLog.log_date.desc(), WorkLog.id.desc()).limit(500)).scalars()]


@router.post("")
def create(body: LogIn, ctx: Ctx = Depends(perm("worklog.write"))):
    if body.project_id:
        ctx.project(body.project_id)
    w = WorkLog(company_id=ctx.company_id, author_id=ctx.user.id, **body.model_dump(exclude={"version"}))
    ctx.db.add(w)
    ctx.db.flush()
    audit(ctx, "create", "worklog", w.id, f"업무일지 작성: {w.task}")
    ctx.db.commit()
    return _out(ctx, w)


@router.put("/{wid}")
def update(wid: int, body: LogIn, ctx: Ctx = Depends(perm("worklog.write"))):
    w = _get(ctx, wid)
    check_version(w, body.version)
    if w.author_id != ctx.user.id:
        raise HTTPException(403, "작성자만 수정할 수 있습니다.")
    if w.status not in ("draft", "rejected"):
        raise HTTPException(409, "작성중·반려 상태에서만 수정할 수 있습니다.")
    if body.project_id:
        ctx.project(body.project_id)
    for k, v in body.model_dump(exclude={"version"}).items():
        setattr(w, k, v)
    bump(w)
    audit(ctx, "update", "worklog", w.id, f"업무일지 수정: {w.task}")
    ctx.db.commit()
    return _out(ctx, w)


class ActIn(BaseModel):
    action: str = Field(pattern="^(submit|approve|reject)$")
    reason: str | None = None


@router.post("/{wid}/action")
def action(wid: int, body: ActIn, ctx: Ctx = Depends(get_ctx)):
    w = _get(ctx, wid)
    if body.action == "submit":
        if w.author_id != ctx.user.id or w.status not in ("draft", "rejected"):
            raise HTTPException(409, "제출할 수 없습니다.")
        w.status, w.reject_reason = "submitted", None
    else:
        ctx.require("worklog.review")
        if w.status != "submitted":
            raise HTTPException(409, "제출된 업무일지만 처리할 수 있습니다.")
        if body.action == "reject" and not (body.reason or "").strip():
            raise HTTPException(400, "반려 사유를 입력하세요.")
        w.status = "approved" if body.action == "approve" else "rejected"
        w.reject_reason = body.reason if body.action == "reject" else None
        w.reviewed_by, w.reviewed_at = ctx.user.id, now_kst()
    bump(w)
    audit(ctx, body.action, "worklog", w.id, f"업무일지 {body.action}: {w.task}")
    ctx.db.commit()
    return _out(ctx, w)
