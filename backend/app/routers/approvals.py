from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..models import ApprovalDoc, ApprovalHistory, ApprovalStep, FileObject, Project, User
from ..permissions import DOC_TYPES
from ..security import Ctx, get_ctx, perm
from ..services import approval as ap
from ..services.approval import default_line
from ..util import D, s

router = APIRouter(prefix="/api/approvals", tags=["approvals"])
LABEL = {"draft": "임시저장", "in_progress": "결재중", "approved": "승인완료", "rejected": "반려", "withdrawn": "회수"}
STEP_LABEL = {"waiting": "대기", "pending": "결재차례", "approved": "승인", "rejected": "반려", "reference": "참조"}


def _names(ctx: Ctx) -> dict[int, User]:
    return {u.id: u for u in ctx.db.execute(select(User).where(User.company_id == ctx.company_id)).scalars()}


def doc_out(ctx: Ctx, d: ApprovalDoc, users: dict, detail: bool = False) -> dict:
    show_amt = ctx.has("amount.purchase") or ctx.has("amount.contract") or d.drafter_id == ctx.user.id \
        or any(st.approver_id == ctx.user.id for st in d.steps)
    cur = next((st for st in d.steps if st.status == "pending"), None)
    p = ctx.db.get(Project, d.project_id) if d.project_id else None
    out = {
        "id": d.id, "doc_no": d.doc_no, "doc_type": d.doc_type, "doc_type_label": DOC_TYPES.get(d.doc_type),
        "ref_id": d.ref_id, "title": d.title, "status": d.status, "status_label": LABEL.get(d.status),
        "drafter_id": d.drafter_id, "drafter_name": users[d.drafter_id].name if d.drafter_id in users else None,
        "project_id": d.project_id, "project_name": p.name if p else None,
        "amount": s(d.amount) if show_amt else None, "submitted_at": d.submitted_at.isoformat() if d.submitted_at else None,
        "completed_at": d.completed_at.isoformat() if d.completed_at else None, "round": d.round,
        "current_approver": users[cur.approver_id].name if cur and cur.approver_id in users else None,
        "my_turn": bool(cur and cur.approver_id == ctx.user.id and d.status == "in_progress"),
    }
    if detail:
        out["body"] = d.body
        snap = d.content_snapshot or {}
        if not show_amt and isinstance(snap, dict):
            snap = {k: v for k, v in snap.items() if "amount" not in k}
            if "items" in snap:
                snap["items"] = [{k: v for k, v in i.items() if "price" not in k and "amount" not in k} for i in snap["items"]]
        out["content_snapshot"] = snap
        out["content_hash"] = d.content_hash
        out["steps"] = [{"seq": st.seq, "kind": st.kind, "approver_id": st.approver_id,
                         "approver_name": users[st.approver_id].name if st.approver_id in users else None,
                         "position": users[st.approver_id].position.name if st.approver_id in users and users[st.approver_id].position else None,
                         "status": st.status, "status_label": STEP_LABEL.get(st.status), "comment": st.comment,
                         "acted_at": st.acted_at.isoformat() if st.acted_at else None} for st in d.steps]
        hist = ctx.db.execute(select(ApprovalHistory).where(ApprovalHistory.doc_id == d.id).order_by(ApprovalHistory.id)).scalars()
        out["history"] = [{"user": users[h.user_id].name if h.user_id in users else None, "action": h.action,
                           "comment": h.comment, "round": h.round, "at": h.created_at.isoformat()} for h in hist]
        files = ctx.db.execute(select(FileObject).where(FileObject.owner_type == "approval", FileObject.owner_id == d.id,
                                                        FileObject.deleted_at.is_(None))).scalars()
        out["files"] = [{"id": f.id, "name": f.original_name, "size": f.size} for f in files]
        out["can_withdraw"] = d.drafter_id == ctx.user.id and d.status == "in_progress" and \
            not any(st.status in ("approved", "rejected") for st in d.steps)
        out["link"] = {"material_request": f"#/material-requests/{d.ref_id}", "purchase_order": f"#/pos/{d.ref_id}"}.get(d.doc_type)
    return out


@router.get("")
def list_docs(box: str = "pending", ctx: Ctx = Depends(get_ctx)):
    """box: pending(내 결재차례) / drafted(내 기안) / done(내가 처리) / reference(참조) / all(접근 가능 전체)"""
    q = select(ApprovalDoc).where(ApprovalDoc.company_id == ctx.company_id)
    me = ctx.user.id
    if box == "pending":
        q = q.join(ApprovalStep).where(ApprovalStep.approver_id == me, ApprovalStep.status == "pending",
                                       ApprovalDoc.status == "in_progress")
    elif box == "drafted":
        q = q.where(ApprovalDoc.drafter_id == me)
    elif box == "done":
        q = q.join(ApprovalStep).where(ApprovalStep.approver_id == me, ApprovalStep.status.in_(("approved", "rejected")))
    elif box == "reference":
        q = q.join(ApprovalStep).where(ApprovalStep.approver_id == me, ApprovalStep.status == "reference")
    elif box != "all":
        raise HTTPException(400, "알 수 없는 문서함")
    docs = ctx.db.execute(q.order_by(ApprovalDoc.id.desc()).limit(500)).scalars().unique().all()
    users = _names(ctx)
    return [doc_out(ctx, d, users) for d in docs if ap.can_view(ctx, d)]


@router.get("/default-line")
def get_default_line(doc_type: str, amount: str | None = None, ctx: Ctx = Depends(get_ctx)):
    steps = default_line(ctx.db, ctx.company_id, doc_type, D(amount) if amount else None)
    users = _names(ctx)
    return [{**st, "name": users[st["user_id"]].name if st["user_id"] in users else None} for st in steps]


@router.get("/{did}")
def get_doc(did: int, ctx: Ctx = Depends(get_ctx)):
    d = ctx.db.get(ApprovalDoc, did)
    if not d or not ap.can_view(ctx, d):
        raise HTTPException(404, "결재문서를 찾을 수 없습니다.")
    return doc_out(ctx, d, _names(ctx), True)


class ActIn(BaseModel):
    action: str = Field(pattern="^(approve|reject)$")
    comment: str | None = None


@router.post("/{did}/act")
def act(did: int, body: ActIn, ctx: Ctx = Depends(get_ctx)):
    d = ap.act(ctx, did, body.action, body.comment)
    ctx.db.commit()
    return doc_out(ctx, d, _names(ctx), True)


@router.post("/{did}/withdraw")
def withdraw(did: int, ctx: Ctx = Depends(get_ctx)):
    d = ap.withdraw(ctx, did)
    ctx.db.commit()
    return doc_out(ctx, d, _names(ctx), True)


# ---------------------------------------------------------------- 일반 품의서
class GeneralIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    body: str = Field(min_length=1)
    project_id: int | None = None
    amount: str | None = None
    steps: list[dict] | None = None


@router.post("/general")
def create_general(body: GeneralIn, ctx: Ctx = Depends(perm("approval.draft"))):
    if body.project_id:
        ctx.project(body.project_id)
    amt = D(body.amount) if body.amount not in (None, "") else None
    d = ap.submit(ctx, doc_type="general", title=body.title, body=body.body, project_id=body.project_id, amount=amt,
                  snapshot={"title": body.title, "body": body.body, "amount": amt}, steps=body.steps)
    ctx.db.commit()
    return doc_out(ctx, d, _names(ctx), True)


@router.post("/{did}/resubmit")
def resubmit_general(did: int, body: GeneralIn, ctx: Ctx = Depends(perm("approval.draft"))):
    d = ctx.db.execute(select(ApprovalDoc).where(ApprovalDoc.id == did).with_for_update()).scalar_one_or_none()
    if not d or d.company_id != ctx.company_id or d.drafter_id != ctx.user.id:
        raise HTTPException(404, "결재문서를 찾을 수 없습니다.")
    if d.doc_type != "general":
        raise HTTPException(400, "업무 연동 문서는 원본 화면에서 재상신하세요.")
    amt = D(body.amount) if body.amount not in (None, "") else None
    d = ap.submit(ctx, doc_type="general", title=body.title, body=body.body, project_id=body.project_id, amount=amt,
                  snapshot={"title": body.title, "body": body.body, "amount": amt}, steps=body.steps, existing=d)
    ctx.db.commit()
    return doc_out(ctx, d, _names(ctx), True)
