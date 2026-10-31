"""자재: 거래처·자재마스터·자재요청·견적비교·발주·입고/반품.

수량 구분 (발주 품목 단위)
- 발주수량 qty / 취소수량 cancelled_qty / 입고누계 received_qty / 반품누계 returned_qty
- 순입고 = 입고누계 − 반품누계,  미입고 = 발주 − 취소 − 순입고
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from ..models import (ApprovalDoc, FileObject, Material, MaterialRequest, MaterialRequestItem, Project,
                      PurchaseOrder, PurchaseOrderItem, Quote, QuoteItem, Receipt, ReceiptItem, User, Vendor)
from ..security import Ctx, get_ctx, perm
from ..services import approval as ap
from ..services.common import (audit, bump, check_version, company_settings, get_owned, jsonable, next_doc_no,
                               notify, row_dict)
from ..util import D, now_kst, q_price, q_qty, round_amount, s, today_kst

router = APIRouter(prefix="/api", tags=["materials"])

REQ_LABEL = {"draft": "작성중", "in_approval": "결재중", "approved": "승인", "rejected": "반려", "closed": "발주완료"}
PO_LABEL = {"draft": "작성중", "in_approval": "결재중", "rejected": "반려", "ordered": "발주확정",
            "partial": "부분입고", "received": "입고완료", "cancelled": "발주취소"}
ACTIVE_PO = ("draft", "in_approval", "rejected", "ordered", "partial", "received")


# ================================================================ 거래처
class VendorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str = Field("자재업체", pattern="^(발주처|원도급사|감리단|자재업체|외주업체|장비업체|기타)$")
    biz_no: str | None = None
    contact_name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    note: str | None = None


@router.get("/vendors")
def list_vendors(q: str | None = None, kind: str | None = None, ctx: Ctx = Depends(get_ctx)):
    st = select(Vendor).where(Vendor.company_id == ctx.company_id, Vendor.deleted_at.is_(None))
    if q:
        st = st.where(or_(Vendor.name.ilike(f"%{q}%"), Vendor.biz_no.ilike(f"%{q}%")))
    if kind:
        st = st.where(Vendor.kind == kind)
    return [row_dict(v, exclude=("company_id",)) for v in ctx.db.execute(st.order_by(Vendor.name)).scalars()]


@router.post("/vendors")
def add_vendor(body: VendorIn, ctx: Ctx = Depends(perm("material.master"))):
    v = Vendor(company_id=ctx.company_id, **body.model_dump())
    ctx.db.add(v)
    ctx.db.flush()
    audit(ctx, "create", "vendor", v.id, f"거래처 등록: {v.name}")
    ctx.db.commit()
    return row_dict(v)


@router.put("/vendors/{vid}")
def upd_vendor(vid: int, body: VendorIn, ctx: Ctx = Depends(perm("material.master"))):
    v = get_owned(ctx.db, Vendor, vid, ctx.company_id, "거래처")
    before = row_dict(v)
    for k, val in body.model_dump().items():
        setattr(v, k, val)
    audit(ctx, "update", "vendor", v.id, f"거래처 수정: {v.name}", before=before, after=row_dict(v))
    ctx.db.commit()
    return row_dict(v)


@router.delete("/vendors/{vid}")
def del_vendor(vid: int, ctx: Ctx = Depends(perm("material.master"))):
    v = get_owned(ctx.db, Vendor, vid, ctx.company_id, "거래처")
    v.deleted_at = now_kst()
    audit(ctx, "delete", "vendor", v.id, f"거래처 삭제(휴지통): {v.name}")
    ctx.db.commit()
    return {"ok": True}


# ================================================================ 자재마스터
class MaterialIn(BaseModel):
    code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=200)
    spec: str | None = None
    unit: str = Field(min_length=1, max_length=20)
    maker: str | None = None
    model: str | None = None
    default_vendor_id: int | None = None
    ref_price: str | None = "0"
    stock_managed: bool = False
    min_stock: str | None = "0"
    supply_type: str = Field("사급", pattern="^(관급|사급)$")


def material_out(ctx: Ctx, m: Material) -> dict:
    d = row_dict(m, exclude=("company_id",))
    if not ctx.has("amount.purchase"):
        d["ref_price"] = None
    return d


@router.get("/materials")
def list_materials(q: str | None = None, ctx: Ctx = Depends(get_ctx)):
    st = select(Material).where(Material.company_id == ctx.company_id, Material.deleted_at.is_(None))
    if q:
        st = st.where(or_(Material.name.ilike(f"%{q}%"), Material.code.ilike(f"%{q}%"), Material.spec.ilike(f"%{q}%")))
    return [material_out(ctx, m) for m in ctx.db.execute(st.order_by(Material.code)).scalars()]


def _apply_material(ctx: Ctx, m: Material, body: MaterialIn):
    if body.default_vendor_id:
        get_owned(ctx.db, Vendor, body.default_vendor_id, ctx.company_id, "거래처")
    for k in ("code", "name", "spec", "unit", "maker", "model", "default_vendor_id", "stock_managed", "supply_type"):
        setattr(m, k, getattr(body, k))
    m.min_stock = q_qty(body.min_stock or 0)
    if ctx.has("amount.purchase"):
        m.ref_price = q_price(body.ref_price or 0)


@router.post("/materials")
def add_material(body: MaterialIn, ctx: Ctx = Depends(perm("material.master"))):
    if ctx.db.execute(select(Material.id).where(Material.company_id == ctx.company_id, Material.code == body.code)).first():
        raise HTTPException(409, f"이미 등록된 자재코드입니다: {body.code}")
    m = Material(company_id=ctx.company_id)
    _apply_material(ctx, m, body)
    ctx.db.add(m)
    ctx.db.flush()
    audit(ctx, "create", "material", m.id, f"자재 등록: {m.code} {m.name}")
    ctx.db.commit()
    return material_out(ctx, m)


@router.put("/materials/{mid}")
def upd_material(mid: int, body: MaterialIn, ctx: Ctx = Depends(perm("material.master"))):
    m = get_owned(ctx.db, Material, mid, ctx.company_id, "자재")
    if body.code != m.code and ctx.db.execute(select(Material.id).where(
            Material.company_id == ctx.company_id, Material.code == body.code)).first():
        raise HTTPException(409, f"이미 등록된 자재코드입니다: {body.code}")
    before = row_dict(m)
    _apply_material(ctx, m, body)
    audit(ctx, "update", "material", m.id, f"자재 수정: {m.code}", before=before, after=row_dict(m))
    ctx.db.commit()
    return material_out(ctx, m)


@router.delete("/materials/{mid}")
def del_material(mid: int, ctx: Ctx = Depends(perm("material.master"))):
    m = get_owned(ctx.db, Material, mid, ctx.company_id, "자재")
    m.deleted_at = now_kst()
    audit(ctx, "delete", "material", m.id, f"자재 삭제(휴지통): {m.code}")
    ctx.db.commit()
    return {"ok": True}


# ================================================================ 자재요청
class ReqItemIn(BaseModel):
    material_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    spec: str | None = None
    unit: str = Field(min_length=1, max_length=20)
    qty: str
    boq_item_id: int | None = None
    use_location: str | None = None
    note: str | None = None


class ReqIn(BaseModel):
    project_id: int
    req_date: date | None = None
    need_date: date | None = None
    reason: str | None = None
    urgent: bool = False
    items: list[ReqItemIn] = Field(min_length=1)
    version: int | None = None


def ordered_by_request_item(ctx: Ctx, req_item_ids: list[int]) -> dict[int, dict]:
    """요청 품목별 발주수량 (확정/진행중 구분)."""
    rows = ctx.db.execute(
        select(PurchaseOrderItem.request_item_id, PurchaseOrder.status,
               func.sum(PurchaseOrderItem.qty - PurchaseOrderItem.cancelled_qty))
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.po_id)
        .where(PurchaseOrderItem.request_item_id.in_(req_item_ids or [0]), PurchaseOrder.deleted_at.is_(None),
               PurchaseOrder.status.in_(ACTIVE_PO))
        .group_by(PurchaseOrderItem.request_item_id, PurchaseOrder.status)).all()
    out: dict[int, dict] = {}
    for rid, st, q in rows:
        o = out.setdefault(rid, {"confirmed": Decimal(0), "pending": Decimal(0)})
        o["confirmed" if st in ("ordered", "partial", "received") else "pending"] += Decimal(q)
    return out


def req_out(ctx: Ctx, r: MaterialRequest, detail: bool = False) -> dict:
    d = row_dict(r, exclude=("company_id",))
    d["status_label"] = REQ_LABEL.get(r.status)
    p = ctx.db.get(Project, r.project_id)
    d["project_name"] = p.name if p else None
    u = ctx.db.get(User, r.requester_id)
    d["requester_name"] = u.name if u else None
    if detail:
        ordered = ordered_by_request_item(ctx, [i.id for i in r.items])
        d["items"] = []
        for i in r.items:
            o = ordered.get(i.id, {"confirmed": Decimal(0), "pending": Decimal(0)})
            x = row_dict(i)
            x["ordered_qty"] = s(o["confirmed"])
            x["ordering_qty"] = s(o["pending"])
            x["unordered_qty"] = s(Decimal(i.qty) - o["confirmed"] - o["pending"])
            d["items"].append(x)
        if r.approval_doc_id:
            doc = ctx.db.get(ApprovalDoc, r.approval_doc_id)
            d["approval"] = {"id": doc.id, "doc_no": doc.doc_no, "status": doc.status} if doc else None
    else:
        d["item_count"] = len(r.items)
        d["first_item"] = r.items[0].name if r.items else None
    return d


def _req(ctx: Ctx, rid: int, lock: bool = False) -> MaterialRequest:
    q = select(MaterialRequest).where(MaterialRequest.id == rid)
    if lock:
        q = q.with_for_update()
    r = ctx.db.execute(q).scalar_one_or_none()
    if not r or r.company_id != ctx.company_id or r.deleted_at:
        raise HTTPException(404, "자재요청을 찾을 수 없습니다.")
    ctx.project(r.project_id)
    return r


def _apply_req(ctx: Ctx, r: MaterialRequest, body: ReqIn):
    from ..models import BoqItem
    r.need_date, r.reason, r.urgent = body.need_date, body.reason, body.urgent
    r.items.clear()
    ctx.db.flush()
    for it in body.items:
        q = q_qty(it.qty)
        if q <= 0:
            raise HTTPException(400, f"[{it.name}] 요청수량은 0보다 커야 합니다.")
        if it.material_id:
            get_owned(ctx.db, Material, it.material_id, ctx.company_id, "자재")
        if it.boq_item_id:
            b = ctx.db.get(BoqItem, it.boq_item_id)
            if not b or b.project_id != r.project_id:
                raise HTTPException(400, "설계내역 연계 항목이 이 현장의 항목이 아닙니다.")
        r.items.append(MaterialRequestItem(material_id=it.material_id, name=it.name, spec=it.spec, unit=it.unit, qty=q,
                                           boq_item_id=it.boq_item_id, use_location=it.use_location, note=it.note))


@router.get("/material-requests")
def list_requests(project_id: int | None = None, status: str | None = None, ctx: Ctx = Depends(get_ctx)):
    q = select(MaterialRequest).where(MaterialRequest.company_id == ctx.company_id, MaterialRequest.deleted_at.is_(None))
    ids = ctx.project_ids()
    if ids is not None:
        q = q.where(MaterialRequest.project_id.in_(ids or [0]))
    if project_id:
        q = q.where(MaterialRequest.project_id == project_id)
    if status:
        q = q.where(MaterialRequest.status.in_(status.split(",")))
    return [req_out(ctx, r) for r in ctx.db.execute(q.order_by(MaterialRequest.id.desc()).limit(500)).scalars()]


@router.post("/material-requests")
def create_request(body: ReqIn, ctx: Ctx = Depends(perm("material.request"))):
    p = ctx.project(body.project_id)
    r = MaterialRequest(company_id=ctx.company_id, project_id=p.id, requester_id=ctx.user.id,
                        req_date=body.req_date or today_kst(), req_no=next_doc_no(ctx.db, ctx.company_id, "MR"))
    ctx.db.add(r)
    ctx.db.flush()
    _apply_req(ctx, r, body)
    ctx.db.flush()
    audit(ctx, "create", "material_request", r.id, f"자재요청 작성: {r.req_no}", project_id=p.id)
    ctx.db.commit()
    return req_out(ctx, r, True)


@router.get("/material-requests/{rid}")
def get_request(rid: int, ctx: Ctx = Depends(get_ctx)):
    r = _req(ctx, rid)
    d = req_out(ctx, r, True)
    d["quotes"] = quotes_out(ctx, r)
    d["purchase_orders"] = [po_out(ctx, po) for po in ctx.db.execute(select(PurchaseOrder).where(
        PurchaseOrder.request_id == r.id, PurchaseOrder.deleted_at.is_(None)).order_by(PurchaseOrder.id)).scalars()]
    return d


@router.put("/material-requests/{rid}")
def update_request(rid: int, body: ReqIn, ctx: Ctx = Depends(perm("material.request"))):
    r = _req(ctx, rid, lock=True)
    check_version(r, body.version)
    if r.status not in ("draft", "rejected"):
        raise HTTPException(409, "결재중·승인된 요청은 수정할 수 없습니다. 결재중이면 회수 후 수정하세요.")
    before = req_out(ctx, r, True)
    _apply_req(ctx, r, body)
    bump(r)
    ctx.db.flush()
    audit(ctx, "update", "material_request", r.id, f"자재요청 수정: {r.req_no}", before={"items": before["items"]},
          project_id=r.project_id)
    ctx.db.commit()
    return req_out(ctx, r, True)


@router.delete("/material-requests/{rid}")
def delete_request(rid: int, ctx: Ctx = Depends(perm("material.request"))):
    r = _req(ctx, rid, lock=True)
    if r.status != "draft":
        raise HTTPException(409, "작성중인 요청만 삭제할 수 있습니다.")
    r.deleted_at = now_kst()
    audit(ctx, "delete", "material_request", r.id, f"자재요청 삭제: {r.req_no}", project_id=r.project_id)
    ctx.db.commit()
    return {"ok": True}


class SubmitIn(BaseModel):
    steps: list[dict] | None = None
    version: int | None = None


@router.post("/material-requests/{rid}/submit")
def submit_request(rid: int, body: SubmitIn, ctx: Ctx = Depends(perm("material.request"))):
    r = _req(ctx, rid, lock=True)
    check_version(r, body.version)
    if r.status not in ("draft", "rejected"):
        raise HTTPException(409, "상신할 수 없는 상태입니다.")
    p = ctx.db.get(Project, r.project_id)
    snap = {"req_no": r.req_no, "project": p.name, "req_date": r.req_date, "need_date": r.need_date, "reason": r.reason,
            "urgent": r.urgent, "items": [row_dict(i) for i in r.items]}
    existing = ctx.db.get(ApprovalDoc, r.approval_doc_id) if r.approval_doc_id else None
    doc = ap.submit(ctx, doc_type="material_request", title=f"[자재요청] {p.name} {r.req_no}", snapshot=snap,
                    steps=body.steps, ref_id=r.id, project_id=p.id, existing=existing,
                    body=f"요청사유: {r.reason or '-'} / 희망납기: {r.need_date or '-'}")
    r.status, r.approval_doc_id = "in_approval", doc.id
    bump(r)
    ctx.db.commit()
    return req_out(ctx, r, True)


@ap.on_status("material_request")
def _req_cb(db, doc: ApprovalDoc, status: str):
    r = db.get(MaterialRequest, doc.ref_id)
    if r:
        r.status = {"approved": "approved", "rejected": "rejected", "withdrawn": "draft"}[status]
        r.version += 1


# ================================================================ 견적 비교
class QuoteItemIn(BaseModel):
    request_item_id: int
    unit_price: str


class QuoteIn(BaseModel):
    vendor_id: int
    quote_date: date | None = None
    delivery_date: date | None = None
    freight: str | None = "0"
    payment_terms: str | None = None
    note: str | None = None
    items: list[QuoteItemIn]


def quotes_out(ctx: Ctx, r: MaterialRequest) -> list[dict]:
    show = ctx.has("amount.purchase") or ctx.has("quote.manage")
    out = []
    for q in ctx.db.execute(select(Quote).where(Quote.request_id == r.id).order_by(Quote.id)).scalars():
        v = ctx.db.get(Vendor, q.vendor_id)
        total = sum((Decimal(i.amount) for i in q.items), Decimal(0)) + Decimal(q.freight or 0)
        files = ctx.db.execute(select(FileObject.id, FileObject.original_name).where(
            FileObject.owner_type == "quote", FileObject.owner_id == q.id, FileObject.deleted_at.is_(None))).all()
        out.append({
            "id": q.id, "vendor_id": q.vendor_id, "vendor_name": v.name if v else None, "quote_date": q.quote_date,
            "delivery_date": q.delivery_date, "payment_terms": q.payment_terms, "note": q.note,
            "selected": q.selected, "select_reason": q.select_reason,
            "freight": s(q.freight) if show else None, "total": s(total) if show else None,
            "items": [{"request_item_id": i.request_item_id, "unit_price": s(i.unit_price) if show else None,
                       "amount": s(i.amount) if show else None} for i in q.items],
            "files": [{"id": a, "name": b} for a, b in files],
        })
    return jsonable(out)


@router.post("/material-requests/{rid}/quotes")
def add_quote(rid: int, body: QuoteIn, ctx: Ctx = Depends(perm("quote.manage"))):
    r = _req(ctx, rid)
    if r.status not in ("approved", "closed"):
        raise HTTPException(409, "결재 승인된 자재요청에만 견적을 등록할 수 있습니다.")
    get_owned(ctx.db, Vendor, body.vendor_id, ctx.company_id, "거래처")
    rounding = company_settings(ctx.db, ctx.company_id)["amount_rounding"]
    items = {i.id: i for i in r.items}
    q = Quote(company_id=ctx.company_id, request_id=r.id, vendor_id=body.vendor_id, quote_date=body.quote_date,
              delivery_date=body.delivery_date, freight=round_amount(D(body.freight), rounding),
              payment_terms=body.payment_terms, note=body.note)
    for qi in body.items:
        ri = items.get(qi.request_item_id)
        if not ri:
            raise HTTPException(400, "요청 품목이 올바르지 않습니다.")
        up = q_price(qi.unit_price)
        q.items.append(QuoteItem(request_item_id=ri.id, unit_price=up, amount=round_amount(up * Decimal(ri.qty), rounding)))
    ctx.db.add(q)
    ctx.db.flush()
    audit(ctx, "create", "quote", q.id, f"견적 등록: {r.req_no}", project_id=r.project_id)
    ctx.db.commit()
    return {"id": q.id}


class SelectIn(BaseModel):
    reason: str = Field(min_length=1)


@router.post("/quotes/{qid}/select")
def select_quote(qid: int, body: SelectIn, ctx: Ctx = Depends(perm("quote.manage"))):
    q = get_owned(ctx.db, Quote, qid, ctx.company_id, "견적")
    r = _req(ctx, q.request_id)
    for other in ctx.db.execute(select(Quote).where(Quote.request_id == r.id)).scalars():
        other.selected = False
        other.select_reason = None
    q.selected, q.select_reason = True, body.reason
    audit(ctx, "select", "quote", q.id, f"견적 업체 선정: {body.reason}", project_id=r.project_id)
    ctx.db.commit()
    return {"ok": True}


@router.delete("/quotes/{qid}")
def delete_quote(qid: int, ctx: Ctx = Depends(perm("quote.manage"))):
    q = get_owned(ctx.db, Quote, qid, ctx.company_id, "견적")
    if ctx.db.execute(select(PurchaseOrder.id).where(PurchaseOrder.quote_id == q.id, PurchaseOrder.deleted_at.is_(None))).first():
        raise HTTPException(409, "발주서에 연결된 견적은 삭제할 수 없습니다.")
    ctx.db.delete(q)
    audit(ctx, "delete", "quote", qid, "견적 삭제")
    ctx.db.commit()
    return {"ok": True}


# ================================================================ 발주
class POItemIn(BaseModel):
    request_item_id: int | None = None
    material_id: int | None = None
    name: str = Field(min_length=1, max_length=200)
    spec: str | None = None
    unit: str = Field(min_length=1, max_length=20)
    qty: str
    unit_price: str = "0"


class POIn(BaseModel):
    project_id: int
    vendor_id: int
    request_id: int | None = None
    quote_id: int | None = None
    order_date: date | None = None
    delivery_date: date | None = None
    delivery_place: str | None = None
    receiver_name: str | None = None
    payment_terms: str | None = None
    remarks: str | None = None
    items: list[POItemIn] = Field(min_length=1)
    version: int | None = None


def po_item_out(i: PurchaseOrderItem, show: bool) -> dict:
    net = Decimal(i.received_qty) - Decimal(i.returned_qty)
    out = Decimal(i.qty) - Decimal(i.cancelled_qty) - net
    return {"id": i.id, "request_item_id": i.request_item_id, "material_id": i.material_id, "name": i.name, "spec": i.spec,
            "unit": i.unit, "qty": s(i.qty), "cancelled_qty": s(i.cancelled_qty), "received_qty": s(i.received_qty),
            "returned_qty": s(i.returned_qty), "net_received_qty": s(net), "outstanding_qty": s(out),
            "unit_price": s(i.unit_price) if show else None, "supply_amount": s(i.supply_amount) if show else None,
            "vat_amount": s(i.vat_amount) if show else None}


def po_out(ctx: Ctx, po: PurchaseOrder, detail: bool = False) -> dict:
    show = ctx.has("amount.purchase")
    d = row_dict(po, exclude=("company_id",))
    if not show:
        d["supply_amount"] = d["vat_amount"] = d["total_amount"] = None
    d["status_label"] = PO_LABEL.get(po.status)
    v = ctx.db.get(Vendor, po.vendor_id)
    d["vendor_name"] = v.name if v else None
    p = ctx.db.get(Project, po.project_id)
    d["project_name"] = p.name if p else None
    items = [po_item_out(i, show) for i in po.items]
    d["outstanding_total"] = s(sum((D(i["outstanding_qty"]) for i in items), Decimal(0)))
    d["delayed"] = bool(po.delivery_date and po.delivery_date < today_kst()
                        and po.status in ("ordered", "partial") and D(d["outstanding_total"]) > 0)
    if detail:
        d["items"] = items
        rc = ctx.db.execute(select(Receipt, User.name).join(User, User.id == Receipt.received_by)
                            .where(Receipt.po_id == po.id).order_by(Receipt.id)).all()
        names = {i.id: i.name for i in po.items}
        d["receipts"] = [{"id": x.id, "receipt_no": x.receipt_no, "kind": x.kind, "receipt_date": x.receipt_date.isoformat(),
                          "received_by": n, "note": x.note,
                          "items": [{"po_item_id": ri.po_item_id, "name": names.get(ri.po_item_id), "qty": s(ri.qty)} for ri in x.items]}
                         for x, n in rc]
        if po.approval_doc_id:
            doc = ctx.db.get(ApprovalDoc, po.approval_doc_id)
            d["approval"] = {"id": doc.id, "doc_no": doc.doc_no, "status": doc.status} if doc else None
    return d


def _po(ctx: Ctx, pid: int, lock: bool = False) -> PurchaseOrder:
    q = select(PurchaseOrder).where(PurchaseOrder.id == pid)
    if lock:
        q = q.with_for_update()
    po = ctx.db.execute(q).scalar_one_or_none()
    if not po or po.company_id != ctx.company_id or po.deleted_at:
        raise HTTPException(404, "발주서를 찾을 수 없습니다.")
    ctx.project(po.project_id)
    return po


def _apply_po(ctx: Ctx, po: PurchaseOrder, body: POIn):
    st = company_settings(ctx.db, ctx.company_id)
    rounding, vat_rate = st["amount_rounding"], D(st["vat_rate"])
    get_owned(ctx.db, Vendor, body.vendor_id, ctx.company_id, "거래처")
    req = None
    if body.request_id:
        req = ctx.db.execute(select(MaterialRequest).where(MaterialRequest.id == body.request_id).with_for_update()).scalar_one_or_none()
        if not req or req.company_id != ctx.company_id or req.project_id != body.project_id:
            raise HTTPException(400, "자재요청이 올바르지 않습니다.")
        if req.status not in ("approved", "closed"):
            raise HTTPException(409, "결재 승인된 자재요청만 발주할 수 있습니다.")
    if body.quote_id:
        qt = get_owned(ctx.db, Quote, body.quote_id, ctx.company_id, "견적")
        if req is None or qt.request_id != req.id:
            raise HTTPException(400, "견적이 자재요청과 맞지 않습니다.")
    for k in ("vendor_id", "request_id", "quote_id", "delivery_date", "delivery_place", "receiver_name", "payment_terms", "remarks"):
        setattr(po, k, getattr(body, k))
    po.order_date = body.order_date or today_kst()
    # 요청 대비 초과 발주 방지 (이 발주서 자신의 기존 품목은 제외하고 계산)
    req_items = {i.id: i for i in req.items} if req else {}
    po.items.clear()
    ctx.db.flush()
    already = ordered_by_request_item(ctx, list(req_items))
    add_by_ri: dict[int, Decimal] = {}
    total_supply = total_vat = Decimal(0)
    for it in body.items:
        q = q_qty(it.qty)
        if q <= 0:
            raise HTTPException(400, f"[{it.name}] 발주수량은 0보다 커야 합니다.")
        if it.request_item_id:
            if it.request_item_id not in req_items:
                raise HTTPException(400, "자재요청 품목이 올바르지 않습니다.")
            add_by_ri[it.request_item_id] = add_by_ri.get(it.request_item_id, Decimal(0)) + q
        if it.material_id:
            get_owned(ctx.db, Material, it.material_id, ctx.company_id, "자재")
        up = q_price(it.unit_price) if ctx.has("amount.purchase") else Decimal(0)
        sup = round_amount(q * up, rounding)
        vat = round_amount(sup * vat_rate, rounding)
        total_supply += sup
        total_vat += vat
        po.items.append(PurchaseOrderItem(request_item_id=it.request_item_id, material_id=it.material_id, name=it.name,
                                          spec=it.spec, unit=it.unit, qty=q, unit_price=up, supply_amount=sup, vat_amount=vat))
    for ri_id, q in add_by_ri.items():
        o = already.get(ri_id, {"confirmed": Decimal(0), "pending": Decimal(0)})
        remain = Decimal(req_items[ri_id].qty) - o["confirmed"] - o["pending"]
        if q > remain:
            raise HTTPException(400, f"[{req_items[ri_id].name}] 요청수량 대비 초과 발주입니다. 발주 가능 잔량: {s(remain)}")
    po.supply_amount, po.vat_amount, po.total_amount = total_supply, total_vat, total_supply + total_vat


@router.get("/purchase-orders")
def list_pos(project_id: int | None = None, status: str | None = None, vendor_id: int | None = None,
             delayed: bool = False, ctx: Ctx = Depends(get_ctx)):
    q = select(PurchaseOrder).where(PurchaseOrder.company_id == ctx.company_id, PurchaseOrder.deleted_at.is_(None))
    ids = ctx.project_ids()
    if ids is not None:
        q = q.where(PurchaseOrder.project_id.in_(ids or [0]))
    if project_id:
        q = q.where(PurchaseOrder.project_id == project_id)
    if status:
        q = q.where(PurchaseOrder.status.in_(status.split(",")))
    if vendor_id:
        q = q.where(PurchaseOrder.vendor_id == vendor_id)
    rows = [po_out(ctx, po) for po in ctx.db.execute(q.order_by(PurchaseOrder.id.desc()).limit(500)).scalars()]
    if delayed:
        rows = [r for r in rows if r["delayed"]]
    return rows


@router.post("/purchase-orders")
def create_po(body: POIn, ctx: Ctx = Depends(perm("po.manage"))):
    p = ctx.project(body.project_id)
    po = PurchaseOrder(company_id=ctx.company_id, project_id=p.id, po_no=next_doc_no(ctx.db, ctx.company_id, "PO"),
                       vendor_id=body.vendor_id, order_date=body.order_date or today_kst(), created_by=ctx.user.id)
    ctx.db.add(po)
    ctx.db.flush()
    _apply_po(ctx, po, body)
    ctx.db.flush()
    audit(ctx, "create", "purchase_order", po.id, f"발주서 작성: {po.po_no}", project_id=p.id)
    ctx.db.commit()
    return po_out(ctx, po, True)


@router.get("/purchase-orders/{poid}")
def get_po(poid: int, ctx: Ctx = Depends(get_ctx)):
    return po_out(ctx, _po(ctx, poid), True)


@router.put("/purchase-orders/{poid}")
def update_po(poid: int, body: POIn, ctx: Ctx = Depends(perm("po.manage"))):
    po = _po(ctx, poid, lock=True)
    check_version(po, body.version)
    if po.status not in ("draft", "rejected"):
        raise HTTPException(409, "작성중·반려 상태의 발주서만 수정할 수 있습니다.")
    if body.project_id != po.project_id:
        raise HTTPException(400, "발주서의 현장은 변경할 수 없습니다.")
    before = po_out(ctx, po, True)
    _apply_po(ctx, po, body)
    bump(po)
    ctx.db.flush()
    audit(ctx, "update", "purchase_order", po.id, f"발주서 수정: {po.po_no}", before={"items": before["items"]},
          project_id=po.project_id)
    ctx.db.commit()
    return po_out(ctx, po, True)


@router.delete("/purchase-orders/{poid}")
def delete_po(poid: int, ctx: Ctx = Depends(perm("po.manage"))):
    po = _po(ctx, poid, lock=True)
    if po.status != "draft":
        raise HTTPException(409, "작성중 발주서만 삭제할 수 있습니다. 확정된 발주는 '발주 취소'를 사용하세요.")
    po.deleted_at = now_kst()
    audit(ctx, "delete", "purchase_order", po.id, f"발주서 삭제: {po.po_no}", project_id=po.project_id)
    ctx.db.commit()
    return {"ok": True}


@router.post("/purchase-orders/{poid}/submit")
def submit_po(poid: int, body: SubmitIn, ctx: Ctx = Depends(perm("po.manage"))):
    po = _po(ctx, poid, lock=True)
    check_version(po, body.version)
    if po.status not in ("draft", "rejected"):
        raise HTTPException(409, "상신할 수 없는 상태입니다.")
    p = ctx.db.get(Project, po.project_id)
    v = ctx.db.get(Vendor, po.vendor_id)
    snap = {"po_no": po.po_no, "project": p.name, "vendor": v.name, "order_date": po.order_date,
            "delivery_date": po.delivery_date, "delivery_place": po.delivery_place, "payment_terms": po.payment_terms,
            "supply_amount": po.supply_amount, "vat_amount": po.vat_amount, "total_amount": po.total_amount,
            "items": [po_item_out(i, True) for i in po.items]}
    existing = ctx.db.get(ApprovalDoc, po.approval_doc_id) if po.approval_doc_id else None
    doc = ap.submit(ctx, doc_type="purchase_order", title=f"[발주품의] {p.name} {po.po_no} / {v.name}", snapshot=snap,
                    steps=body.steps, ref_id=po.id, project_id=p.id, amount=po.total_amount, existing=existing)
    po.status, po.approval_doc_id = "in_approval", doc.id
    bump(po)
    ctx.db.commit()
    return po_out(ctx, po, True)


@ap.on_status("purchase_order")
def _po_cb(db, doc: ApprovalDoc, status: str):
    po = db.get(PurchaseOrder, doc.ref_id)
    if not po:
        return
    po.status = {"approved": "ordered", "rejected": "rejected", "withdrawn": "draft"}[status]
    po.version += 1
    if status == "approved":
        recipients = [po.created_by]
        p = db.get(Project, po.project_id)
        if p:
            recipients += [p.site_manager_id]
        notify(db, po.company_id, recipients, "po", f"[발주확정] {po.po_no}", f"#/pos/{po.id}")
        if po.request_id:
            req = db.get(MaterialRequest, po.request_id)
            if req:
                db.flush()
                totals = {}
                for pi, st, q in db.execute(
                        select(PurchaseOrderItem.request_item_id, PurchaseOrder.status,
                               func.sum(PurchaseOrderItem.qty - PurchaseOrderItem.cancelled_qty))
                        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.po_id)
                        .where(PurchaseOrder.request_id == req.id, PurchaseOrder.status.in_(("ordered", "partial", "received")),
                               PurchaseOrder.deleted_at.is_(None))
                        .group_by(PurchaseOrderItem.request_item_id, PurchaseOrder.status)).all():
                    totals[pi] = totals.get(pi, Decimal(0)) + Decimal(q)
                if all(totals.get(i.id, Decimal(0)) >= Decimal(i.qty) for i in req.items):
                    req.status = "closed"


def _refresh_po_status(po: PurchaseOrder):
    if po.status in ("draft", "in_approval", "rejected", "cancelled"):
        return
    outstanding = sum((Decimal(i.qty) - Decimal(i.cancelled_qty) - Decimal(i.received_qty) + Decimal(i.returned_qty)
                       for i in po.items), Decimal(0))
    net = sum((Decimal(i.received_qty) - Decimal(i.returned_qty) for i in po.items), Decimal(0))
    if outstanding <= 0:
        po.status = "received"
    elif net > 0 or any(Decimal(i.cancelled_qty) > 0 for i in po.items):
        po.status = "partial"
    else:
        po.status = "ordered"


class CancelIn(BaseModel):
    mode: str = Field(pattern="^(all|remaining)$")  # all=전체취소(입고 없을 때), remaining=미입고 잔량취소
    reason: str = Field(min_length=1)


@router.post("/purchase-orders/{poid}/cancel")
def cancel_po(poid: int, body: CancelIn, ctx: Ctx = Depends(perm("po.manage"))):
    po = _po(ctx, poid, lock=True)
    if po.status == "in_approval":
        raise HTTPException(409, "결재 진행 중인 발주서는 결재문서를 회수한 뒤 취소하세요.")
    if po.status in ("cancelled", "received"):
        raise HTTPException(409, "취소할 수 없는 상태입니다.")
    net = sum((Decimal(i.received_qty) - Decimal(i.returned_qty) for i in po.items), Decimal(0))
    if body.mode == "all":
        if net > 0:
            raise HTTPException(409, "입고된 수량이 있어 전체 취소할 수 없습니다. 반품 처리하거나 '잔량 취소'를 사용하세요.")
        for i in po.items:
            i.cancelled_qty = Decimal(i.qty) - (Decimal(i.received_qty) - Decimal(i.returned_qty))
        po.status = "cancelled"
    else:
        if po.status not in ("ordered", "partial"):
            raise HTTPException(409, "확정된 발주서만 잔량 취소할 수 있습니다.")
        for i in po.items:
            outq = Decimal(i.qty) - Decimal(i.cancelled_qty) - Decimal(i.received_qty) + Decimal(i.returned_qty)
            if outq > 0:
                i.cancelled_qty = Decimal(i.cancelled_qty) + outq
        _refresh_po_status(po)
    bump(po)
    po.remarks = ((po.remarks or "") + f"\n[취소 {today_kst()}] {body.reason}").strip()
    audit(ctx, "cancel", "purchase_order", po.id, f"발주 {'전체' if body.mode == 'all' else '잔량'}취소: {body.reason}",
          project_id=po.project_id)
    ctx.db.commit()
    return po_out(ctx, po, True)


# ================================================================ 입고·반품
class RcItemIn(BaseModel):
    po_item_id: int
    qty: str


class ReceiptIn(BaseModel):
    kind: str = Field("입고", pattern="^(입고|반품)$")
    receipt_date: date | None = None
    note: str | None = None
    request_key: str = Field(min_length=8, max_length=64)  # 화면에서 생성한 중복 방지 키
    items: list[RcItemIn] = Field(min_length=1)


@router.post("/purchase-orders/{poid}/receipts")
def add_receipt(poid: int, body: ReceiptIn, ctx: Ctx = Depends(perm("po.receive"))):
    db = ctx.db
    dup = db.execute(select(Receipt).where(Receipt.request_key == body.request_key)).scalar_one_or_none()
    if dup:
        if dup.company_id != ctx.company_id or dup.po_id != poid:
            raise HTTPException(409, "중복 요청 키 충돌")
        return {**po_out(ctx, _po(ctx, poid), True), "duplicate": True}
    po = _po(ctx, poid, lock=True)  # 행 잠금: 동시 입고 처리 직렬화
    if po.status not in ("ordered", "partial") and not (body.kind == "반품" and po.status == "received"):
        raise HTTPException(409, f"'{PO_LABEL[po.status]}' 상태에서는 {body.kind} 처리할 수 없습니다.")
    rdate = body.receipt_date or today_kst()
    if rdate > today_kst():
        raise HTTPException(400, "미래 날짜로 입고 처리할 수 없습니다.")
    items = {i.id: i for i in po.items}
    rc = Receipt(company_id=ctx.company_id, project_id=po.project_id, po_id=po.id, kind=body.kind, receipt_date=rdate,
                 received_by=ctx.user.id, note=body.note, request_key=body.request_key,
                 receipt_no=next_doc_no(db, ctx.company_id, "RC"))
    seen = set()
    for ri in body.items:
        it = items.get(ri.po_item_id)
        if not it:
            raise HTTPException(400, "발주 품목이 올바르지 않습니다.")
        if it.id in seen:
            raise HTTPException(400, "같은 품목이 중복되었습니다.")
        seen.add(it.id)
        q = q_qty(ri.qty)
        if q == 0:
            continue
        if q < 0:
            raise HTTPException(400, "수량은 0보다 커야 합니다.")
        net = Decimal(it.received_qty) - Decimal(it.returned_qty)
        outq = Decimal(it.qty) - Decimal(it.cancelled_qty) - net
        if body.kind == "입고":
            if q > outq:
                raise HTTPException(400, f"[{it.name}] 미입고 수량({s(outq)})을 초과하여 입고할 수 없습니다.")
            it.received_qty = Decimal(it.received_qty) + q
        else:
            if q > net:
                raise HTTPException(400, f"[{it.name}] 반품 수량이 입고된 수량({s(net)})을 초과합니다.")
            it.returned_qty = Decimal(it.returned_qty) + q
        rc.items.append(ReceiptItem(po_item_id=it.id, qty=q))
    if not rc.items:
        raise HTTPException(400, "처리할 수량을 1개 이상 입력하세요.")
    db.add(rc)
    _refresh_po_status(po)
    bump(po)
    db.flush()
    audit(ctx, "receive" if body.kind == "입고" else "return", "purchase_order", po.id,
          f"{body.kind} {rc.receipt_no}: " + ", ".join(f"{items[x.po_item_id].name} {s(x.qty)}" for x in rc.items),
          project_id=po.project_id)
    db.commit()
    return po_out(ctx, po, True)


@router.post("/purchase-orders/{poid}/send")
def send_po(poid: int, ctx: Ctx = Depends(perm("po.manage"))):
    """외부 발송 연동 전: 실제 발송하지 않으며 '발송 완료'로 표시하지 않는다."""
    _po(ctx, poid)
    raise HTTPException(501, "이메일·문자 발송 서비스가 아직 연동되지 않았습니다. 발주서 PDF를 내려받아 직접 전달하세요.")
