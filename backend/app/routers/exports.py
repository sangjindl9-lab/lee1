"""PDF·엑셀 출력. 금액 노출 규칙은 화면 API 와 동일하게 적용."""
from datetime import date
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select

from ..models import ApprovalDoc, BoqGroup, DailyReport, FileObject, MaterialRequest, PurchaseOrder, User, Vendor
from ..security import Ctx, get_ctx, perm
from ..services import approval as ap
from ..services.common import audit
from ..services.excel import add_sheet, to_bytes, workbook
from ..services.pdf import approval_signs, company_ctx, image_data_uri, render_pdf
from ..services.progress import compute_project_progress
from ..util import now_kst, today_kst
from .approvals import _names, doc_out
from .boq import get_boq
from .daily_reports import _get as get_report_obj, report_detail
from .files import resolve_owner
from .materials import _po, _req, po_out, req_out

router = APIRouter(prefix="/api/export", tags=["export"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _resp(data: bytes, filename: str, media: str, inline: bool) -> Response:
    disp = "inline" if inline else "attachment"
    return Response(data, media_type=media,
                    headers={"Content-Disposition": f"{disp}; filename*=UTF-8''{quote(filename)}", "Cache-Control": "no-store"})


def _pdf(data, name, inline):
    return _resp(data, name, "application/pdf", inline)


# ---------------------------------------------------------------- 작업일보
@router.get("/daily-reports/{rid}.pdf")
def daily_report_pdf(rid: int, inline: bool = False, ctx: Ctx = Depends(perm("export.data"))):
    r, p = get_report_obj(ctx, rid)
    d = report_detail(ctx, r, p)
    photos = []
    for f in ctx.db.execute(select(FileObject).where(FileObject.owner_type == "daily_report", FileObject.owner_id == r.id,
                                                     FileObject.deleted_at.is_(None), FileObject.category == "사진")
                            .order_by(FileObject.id)).scalars():
        src = image_data_uri(f, 900)
        if src:
            photos.append({"src": src, "phase": f.phase, "location": f.location, "title": f.title, "name": f.original_name})
    signs = [{"label": "작성", "name": d["author_name"], "at": (d["submitted_at"] or "")[5:10]},
             {"label": "검토·승인", "name": d["reviewer_name"] if r.status == "approved" else "",
              "status": "승인" if r.status == "approved" else d["status_label"],
              "at": (d["reviewed_at"] or "")[5:10] if r.status == "approved" else ""}]
    pdf = render_pdf("daily_report.html", r=d, photos=photos, signs=signs, doc_no=r.report_no, **company_ctx(ctx.db, ctx.company_id))
    audit(ctx, "export", "daily_report", r.id, "작업일보 PDF 출력", project_id=p.id)
    ctx.db.commit()
    return _pdf(pdf, f"작업일보_{p.name}_{r.report_date}.pdf", inline)


@router.get("/daily-reports.xlsx")
def daily_reports_xlsx(project_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
                       ctx: Ctx = Depends(perm("export.data"))):
    q = select(DailyReport).where(DailyReport.company_id == ctx.company_id, DailyReport.deleted_at.is_(None))
    ids = ctx.project_ids()
    if ids is not None:
        q = q.where(DailyReport.project_id.in_(ids or [0]))
    if project_id:
        ctx.project(project_id)
        q = q.where(DailyReport.project_id == project_id)
    if date_from:
        q = q.where(DailyReport.report_date >= date_from)
    if date_to:
        q = q.where(DailyReport.report_date <= date_to)
    reps = ctx.db.execute(q.order_by(DailyReport.report_date, DailyReport.project_id).limit(3000)).scalars().all()
    rows, items, labor = [], [], []
    for r in reps:
        p = ctx.project(r.project_id)
        d = report_detail(ctx, r, p)
        rows.append([d["report_no"], p.name, d["report_date"], d["author_name"], d["status_label"], d["weather"],
                     f"{d['temp_low'] or ''}~{d['temp_high'] or ''}", d["work_summary"], d["labor_total"], d["tomorrow_plan"]])
        for i in d["items"]:
            items.append([p.name, d["report_date"], d["status_label"], i["name"], i["spec"], i["unit"], i["design_qty"],
                          i["prev_cum"], i["qty_today"], i["cum"], i["remaining"], i["rate"] or "계산불가", i["location"]])
        for l in d["labor"]:
            labor.append([p.name, d["report_date"], l["trade"], l["affiliation"], l["headcount"]])
    wb = workbook()
    add_sheet(wb, "작업일보", ["문서번호", "현장", "작업일", "작성자", "상태", "날씨", "기온", "작업내용", "투입인원", "명일계획"], rows,
              widths=[22, 24, 12, 10, 8, 8, 10, 50, 10, 40], number_cols={8})
    add_sheet(wb, "시공수량", ["현장", "작업일", "상태", "품명", "규격", "단위", "설계수량", "전일누계", "금일", "누계", "잔량", "공정률(%)", "위치"],
              items, widths=[24, 12, 8, 24, 14, 6, 12, 12, 10, 12, 12, 10, 16], number_cols={6, 7, 8, 9, 10})
    add_sheet(wb, "투입인원", ["현장", "작업일", "직종", "소속", "인원"], labor, number_cols={4})
    return _resp(to_bytes(wb), f"작업일보_{date_from or ''}_{date_to or ''}.xlsx", XLSX, False)


# ---------------------------------------------------------------- 공정
@router.get("/projects/{pid}/progress.pdf")
def progress_pdf(pid: int, basis: date | None = None, inline: bool = False, ctx: Ctx = Depends(perm("export.data"))):
    p = ctx.project(pid)
    pr = compute_project_progress(ctx.db, p, basis or today_kst())
    groups = {g.id: g.name for g in ctx.db.execute(select(BoqGroup).where(BoqGroup.project_id == p.id)).scalars()}
    pdf = render_pdf("progress.html", landscape=True, pr=pr, project=p, groups=groups,
                     doc_no=f"{p.code}-PR-{pr['basis_date']}", **company_ctx(ctx.db, ctx.company_id))
    return _pdf(pdf, f"공정현황_{p.name}_{pr['basis_date']}.pdf", inline)


@router.get("/projects/{pid}/boq.xlsx")
def boq_xlsx(pid: int, basis: date | None = None, ctx: Ctx = Depends(perm("export.data"))):
    p = ctx.project(pid)
    b = get_boq(pid, ctx)
    pr = compute_project_progress(ctx.db, p, basis or today_kst())
    prmap = {i["id"]: i for i in pr["items"]}
    gmap = {g["id"]: g for g in b["groups"]}

    def path(gid):
        g = gmap.get(gid)
        if not g:
            return "", ""
        if g["level"] == 2:
            return gmap.get(g["parent_id"], {}).get("name", ""), g["name"]
        return g["name"], ""
    show = b["show_amounts"]
    rows = []
    for i in b["items"]:
        g1, g2 = path(i["group_id"])
        x = prmap.get(i["id"], {})
        row = [g1, g2, i["name"], i["spec"], i["unit"], i["design_qty"]]
        if show:
            row += [i["mat_unit_price"], i["labor_unit_price"], i["exp_unit_price"], i["amount"]]
        row += [i["plan_start"], i["plan_end"], x.get("cum_qty"), x.get("remaining_qty"), x.get("plan_rate"),
                x.get("rate") if x.get("rate") is not None else "계산불가", x.get("weight_share"), x.get("excluded_reason")]
        rows.append(row)
    heads = ["대공종", "중공종", "품명", "규격", "단위", "설계수량"]
    ncols = {5}
    if show:
        heads += ["재료비단가", "노무비단가", "경비단가", "설계금액"]
        ncols |= {6, 7, 8, 9}
    off = len(heads)
    heads += ["계획시작", "계획종료", "실적누계", "잔량", "계획(%)", "실적(%)", "반영비율(%)", "비고"]
    ncols |= {off + 2, off + 3}
    wb = workbook()
    add_sheet(wb, "설계내역·공정", heads, rows, number_cols=ncols,
              caption=f"{p.name} 설계내역·공정현황 (기준일 {pr['basis_date']}, 실적 {pr['actual_rate'] or '-'}% / 계획 {pr['plan_rate'] or '-'}%)")
    return _resp(to_bytes(wb), f"설계내역_공정_{p.name}.xlsx", XLSX, False)


# ---------------------------------------------------------------- 발주·자재요청
@router.get("/purchase-orders/{poid}.pdf")
def po_pdf(poid: int, inline: bool = False, ctx: Ctx = Depends(perm("export.data"))):
    po = _po(ctx, poid)
    d = po_out(ctx, po, True)
    doc = ctx.db.get(ApprovalDoc, po.approval_doc_id) if po.approval_doc_id else None
    pdf = render_pdf("po.html", po=d, vendor=ctx.db.get(Vendor, po.vendor_id), signs=approval_signs(ctx.db, doc),
                     show_amount=ctx.has("amount.purchase"), doc_no=po.po_no, **company_ctx(ctx.db, ctx.company_id))
    audit(ctx, "export", "purchase_order", po.id, "발주서 PDF 출력", project_id=po.project_id)
    ctx.db.commit()
    return _pdf(pdf, f"발주서_{po.po_no}.pdf", inline)


@router.get("/purchase-orders/{poid}.xlsx")
def po_xlsx(poid: int, ctx: Ctx = Depends(perm("export.data"))):
    po = _po(ctx, poid)
    d = po_out(ctx, po, True)
    show = ctx.has("amount.purchase")
    heads = ["No", "품명", "규격", "단위", "발주수량", "취소수량", "입고누계", "반품누계", "미입고"]
    if show:
        heads += ["단가", "공급가액", "부가세"]
    rows = []
    for n, i in enumerate(d["items"], 1):
        r = [n, i["name"], i["spec"], i["unit"], i["qty"], i["cancelled_qty"], i["received_qty"], i["returned_qty"], i["outstanding_qty"]]
        if show:
            r += [i["unit_price"], i["supply_amount"], i["vat_amount"]]
        rows.append(r)
    if show:
        rows.append(["", "합계", "", "", "", "", "", "", "", "", d["supply_amount"], d["vat_amount"]])
        rows.append(["", "총액(VAT포함)", "", "", "", "", "", "", "", "", d["total_amount"], ""])
    wb = workbook()
    add_sheet(wb, "발주서", heads, rows, number_cols=set(range(4, 12)),
              caption=f"발주서 {d['po_no']} / {d['vendor_name']} / {d['project_name']} / 발주일 {d['order_date']} / 상태 {d['status_label']}")
    return _resp(to_bytes(wb), f"발주서_{po.po_no}.xlsx", XLSX, False)


@router.get("/purchase-orders.xlsx")
def pos_xlsx(project_id: int | None = None, ctx: Ctx = Depends(perm("export.data"))):
    q = select(PurchaseOrder).where(PurchaseOrder.company_id == ctx.company_id, PurchaseOrder.deleted_at.is_(None))
    ids = ctx.project_ids()
    if ids is not None:
        q = q.where(PurchaseOrder.project_id.in_(ids or [0]))
    if project_id:
        q = q.where(PurchaseOrder.project_id == project_id)
    show = ctx.has("amount.purchase")
    rows = []
    for po in ctx.db.execute(q.order_by(PurchaseOrder.id)).scalars():
        d = po_out(ctx, po, True)
        for i in d["items"]:
            r = [d["po_no"], d["project_name"], d["vendor_name"], d["order_date"], d["delivery_date"], d["status_label"],
                 i["name"], i["spec"], i["unit"], i["qty"], i["cancelled_qty"], i["net_received_qty"], i["outstanding_qty"]]
            if show:
                r += [i["unit_price"], i["supply_amount"], i["vat_amount"]]
            rows.append(r)
    heads = ["발주번호", "현장", "거래처", "발주일", "납기", "상태", "품명", "규격", "단위", "발주", "취소", "순입고", "미입고"]
    if show:
        heads += ["단가", "공급가액", "부가세"]
    wb = workbook()
    add_sheet(wb, "발주현황", heads, rows, number_cols=set(range(9, 16)))
    return _resp(to_bytes(wb), "발주현황.xlsx", XLSX, False)


@router.get("/material-requests/{rid}.pdf")
def mr_pdf(rid: int, inline: bool = False, ctx: Ctx = Depends(perm("export.data"))):
    r = _req(ctx, rid)
    d = req_out(ctx, r, True)
    doc = ctx.db.get(ApprovalDoc, r.approval_doc_id) if r.approval_doc_id else None
    pdf = render_pdf("material_request.html", r=d, signs=approval_signs(ctx.db, doc), doc_no=r.req_no,
                     **company_ctx(ctx.db, ctx.company_id))
    return _pdf(pdf, f"자재요청서_{r.req_no}.pdf", inline)


# ---------------------------------------------------------------- 결재문서
@router.get("/approvals/{did}.pdf")
def approval_pdf(did: int, inline: bool = False, ctx: Ctx = Depends(perm("export.data"))):
    doc = ctx.db.get(ApprovalDoc, did)
    if not doc or not ap.can_view(ctx, doc):
        raise HTTPException(404, "결재문서를 찾을 수 없습니다.")
    d = doc_out(ctx, doc, _names(ctx), True)
    pdf = render_pdf("approval.html", d=d, signs=approval_signs(ctx.db, doc), doc_no=doc.doc_no, **company_ctx(ctx.db, ctx.company_id))
    return _pdf(pdf, f"결재_{doc.doc_no}.pdf", inline)


# ---------------------------------------------------------------- 사진대장
LAYOUTS = {2: (1, 95), 4: (2, 72), 6: (2, 44)}  # 페이지당 사진 수: (열, 이미지 높이 mm)


@router.get("/projects/{pid}/photo-ledger.pdf")
def photo_ledger(pid: int, per_page: int = 4, date_from: date | None = None, date_to: date | None = None,
                 phase: str | None = None, ids: str | None = Query(None, description="쉼표로 구분한 파일 id"),
                 inline: bool = False, ctx: Ctx = Depends(perm("export.data"))):
    p = ctx.project(pid)
    if per_page not in LAYOUTS:
        raise HTTPException(400, "페이지당 사진 수는 2, 4, 6 중에서 선택하세요.")
    q = select(FileObject).where(FileObject.project_id == p.id, FileObject.company_id == ctx.company_id,
                                 FileObject.deleted_at.is_(None), FileObject.category == "사진")
    if ids:
        q = q.where(FileObject.id.in_([int(x) for x in ids.split(",") if x.strip().isdigit()]))
    if date_from:
        q = q.where(FileObject.taken_date >= date_from)
    if date_to:
        q = q.where(FileObject.taken_date <= date_to)
    if phase:
        q = q.where(FileObject.phase == phase)
    files = ctx.db.execute(q.order_by(FileObject.taken_date.nulls_last(), FileObject.id)).scalars().all()
    if not files:
        raise HTTPException(404, "조건에 맞는 사진이 없습니다.")
    if len(files) > 300:
        raise HTTPException(400, "한 번에 300장까지 출력할 수 있습니다. 기간을 나누어 출력하세요.")
    for f in files:
        resolve_owner(ctx, f.owner_type, f.owner_id)
    photos = []
    for f in files:
        src = image_data_uri(f, 1200)
        if src:
            photos.append({"src": src, "title": f.title, "name": f.original_name, "taken_date": f.taken_date,
                           "phase": f.phase, "location": f.location, "work_type": f.work_type, "description": f.description})
    cols, img_h = LAYOUTS[per_page]
    pages = [photos[i:i + per_page] for i in range(0, len(photos), per_page)]
    period = f"{date_from or '처음'} ~ {date_to or '현재'}"
    pdf = render_pdf("photo_ledger.html", pages=pages, cols=cols, img_h=img_h, project=p, period=period,
                     doc_no=f"{p.code} 사진대장", **company_ctx(ctx.db, ctx.company_id))
    return _pdf(pdf, f"사진대장_{p.name}.pdf", inline)
