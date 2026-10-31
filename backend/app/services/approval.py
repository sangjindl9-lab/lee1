"""전자결재 엔진.

- 순차 결재: 결재/합의 단계를 seq 순서대로 처리, 참조는 열람만
- 상신 시 원문 스냅샷+해시 보존. 결재 진행 중 원본 수정은 각 업무 API에서 차단(회수 후 재상신)
- 상태 전환은 반드시 이 모듈을 거치며 행 잠금 후 서버에서 검증
"""
import hashlib
import json
from collections.abc import Callable
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ApprovalDoc, ApprovalHistory, ApprovalLineTemplate, ApprovalStep, User
from ..permissions import DOC_TYPES
from ..security import Ctx
from ..util import now_kst
from .common import audit, jsonable, next_doc_no, notify

# doc_type -> fn(db, doc, new_status)
_callbacks: dict[str, Callable] = {}


def on_status(doc_type: str):
    def deco(fn):
        _callbacks[doc_type] = fn
        return fn
    return deco


def default_line(db: Session, company_id: int, doc_type: str, amount: Decimal | None) -> list[dict]:
    tpls = db.execute(select(ApprovalLineTemplate).where(
        ApprovalLineTemplate.company_id == company_id, ApprovalLineTemplate.doc_type == doc_type,
        ApprovalLineTemplate.is_active.is_(True)).order_by(ApprovalLineTemplate.min_amount.nulls_first())).scalars().all()
    amt = Decimal(amount or 0)
    chosen = None
    for t in tpls:
        lo = Decimal(t.min_amount) if t.min_amount is not None else None
        hi = Decimal(t.max_amount) if t.max_amount is not None else None
        if (lo is None or amt >= lo) and (hi is None or amt < hi):
            chosen = t  # 가장 높은 하한을 가진 템플릿이 마지막에 선택됨
    return list(chosen.steps) if chosen else []


def _validate_steps(db: Session, ctx: Ctx, steps: list[dict]) -> list[dict]:
    if not steps:
        raise HTTPException(400, "결재선을 지정하세요.")
    clean = []
    for st in steps:
        kind = st.get("kind", "결재")
        if kind not in ("결재", "합의", "참조"):
            raise HTTPException(400, f"알 수 없는 결재 구분: {kind}")
        u = db.get(User, int(st["user_id"]))
        if not u or u.company_id != ctx.company_id or not u.is_active:
            raise HTTPException(400, "결재선에 사용할 수 없는 사용자가 있습니다.")
        clean.append({"user_id": u.id, "kind": kind})
    if not any(c["kind"] != "참조" for c in clean):
        raise HTTPException(400, "결재 또는 합의 단계가 최소 1명 필요합니다.")
    return clean


def content_hash(snapshot: dict) -> str:
    return hashlib.sha256(json.dumps(jsonable(snapshot), sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def submit(ctx: Ctx, *, doc_type: str, title: str, snapshot: dict, steps: list[dict] | None,
           ref_id: int | None = None, project_id: int | None = None, amount: Decimal | None = None,
           body: str | None = None, existing: ApprovalDoc | None = None) -> ApprovalDoc:
    db = ctx.db
    if doc_type not in DOC_TYPES:
        raise HTTPException(400, "알 수 없는 문서 종류")
    steps = steps or default_line(db, ctx.company_id, doc_type, amount)
    steps = _validate_steps(db, ctx, steps)
    if existing is not None:
        doc = existing
        if doc.status not in ("draft", "rejected", "withdrawn"):
            raise HTTPException(409, "상신할 수 없는 상태입니다.")
        doc.round = (doc.round or 0) + (0 if doc.status == "draft" else 1)
        doc.steps.clear()
        db.flush()
    else:
        doc = ApprovalDoc(company_id=ctx.company_id, doc_type=doc_type,
                          doc_no=next_doc_no(db, ctx.company_id, "AP"), drafter_id=ctx.user.id, round=1)
        db.add(doc)
    doc.title, doc.body, doc.amount = title, body, amount
    doc.ref_id, doc.project_id = ref_id, project_id
    doc.content_snapshot = jsonable(snapshot)
    doc.content_hash = content_hash(snapshot)
    doc.status = "in_progress"
    doc.submitted_at = now_kst()
    doc.completed_at = None
    first = True
    for i, st in enumerate(steps, start=1):
        if st["kind"] == "참조":
            status = "reference"
        elif first:
            status, first = "pending", False
        else:
            status = "waiting"
        doc.steps.append(ApprovalStep(seq=i, kind=st["kind"], approver_id=st["user_id"], status=status))
    db.flush()
    db.add(ApprovalHistory(doc_id=doc.id, user_id=ctx.user.id, action="상신", round=doc.round))
    pend = [s_.approver_id for s_ in doc.steps if s_.status == "pending"]
    notify(db, ctx.company_id, pend, "approval", f"[결재요청] {title}", f"#/approvals/{doc.id}")
    notify(db, ctx.company_id, [s_.approver_id for s_ in doc.steps if s_.status == "reference"],
           "approval_ref", f"[참조] {title}", f"#/approvals/{doc.id}")
    audit(ctx, "submit", "approval", doc.id, f"상신: {title}", project_id=project_id)
    return doc


def _lock_doc(ctx: Ctx, doc_id: int) -> ApprovalDoc:
    doc = ctx.db.execute(select(ApprovalDoc).where(ApprovalDoc.id == doc_id).with_for_update()).scalar_one_or_none()
    if not doc or doc.company_id != ctx.company_id:
        raise HTTPException(404, "결재문서를 찾을 수 없습니다.")
    return doc


def act(ctx: Ctx, doc_id: int, action: str, comment: str | None) -> ApprovalDoc:
    db = ctx.db
    doc = _lock_doc(ctx, doc_id)
    if doc.status != "in_progress":
        raise HTTPException(409, "결재 진행 중인 문서가 아닙니다.")
    cur = next((st for st in doc.steps if st.status == "pending"), None)
    if not cur or cur.approver_id != ctx.user.id:
        raise HTTPException(403, "현재 결재 차례가 아닙니다.")
    if action == "reject" and not (comment or "").strip():
        raise HTTPException(400, "반려 사유를 입력하세요.")
    cur.comment, cur.acted_at = comment, now_kst()
    if action == "approve":
        cur.status = "approved"
        nxt = next((st for st in doc.steps if st.status == "waiting"), None)
        if nxt:
            nxt.status = "pending"
            notify(db, ctx.company_id, [nxt.approver_id], "approval", f"[결재요청] {doc.title}", f"#/approvals/{doc.id}")
        else:
            doc.status, doc.completed_at = "approved", now_kst()
            notify(db, ctx.company_id, [doc.drafter_id], "approval_done", f"[결재완료] {doc.title}", f"#/approvals/{doc.id}")
    elif action == "reject":
        cur.status = "rejected"
        doc.status, doc.completed_at = "rejected", now_kst()
        notify(db, ctx.company_id, [doc.drafter_id], "approval_rejected", f"[반려] {doc.title}", f"#/approvals/{doc.id}")
    else:
        raise HTTPException(400, "알 수 없는 결재 처리")
    db.add(ApprovalHistory(doc_id=doc.id, user_id=ctx.user.id, action="승인" if action == "approve" else "반려",
                           comment=comment, round=doc.round))
    audit(ctx, action, "approval", doc.id, f"{'승인' if action == 'approve' else '반려'}: {doc.title}",
          project_id=doc.project_id)
    if doc.status in ("approved", "rejected") and doc.doc_type in _callbacks:
        _callbacks[doc.doc_type](db, doc, doc.status)
    return doc


def withdraw(ctx: Ctx, doc_id: int) -> ApprovalDoc:
    doc = _lock_doc(ctx, doc_id)
    if doc.drafter_id != ctx.user.id:
        raise HTTPException(403, "기안자만 회수할 수 있습니다.")
    if doc.status != "in_progress":
        raise HTTPException(409, "결재 진행 중인 문서만 회수할 수 있습니다.")
    if any(st.status in ("approved", "rejected") for st in doc.steps):
        raise HTTPException(409, "이미 결재가 진행되어 회수할 수 없습니다. 결재자에게 반려를 요청하세요.")
    doc.status = "withdrawn"
    for st in doc.steps:
        if st.status in ("pending", "waiting"):
            st.status = "waiting"
    ctx.db.add(ApprovalHistory(doc_id=doc.id, user_id=ctx.user.id, action="회수", round=doc.round))
    audit(ctx, "withdraw", "approval", doc.id, f"회수: {doc.title}", project_id=doc.project_id)
    if doc.doc_type in _callbacks:
        _callbacks[doc.doc_type](ctx.db, doc, "withdrawn")
    return doc


def can_view(ctx: Ctx, doc: ApprovalDoc) -> bool:
    if doc.company_id != ctx.company_id:
        return False
    if doc.drafter_id == ctx.user.id or any(st.approver_id == ctx.user.id for st in doc.steps):
        return True
    if doc.project_id:
        ids = ctx.project_ids()
        return ids is None or doc.project_id in ids
    return ctx.has("project.view_all")
