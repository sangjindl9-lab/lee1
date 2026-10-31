"""엑셀 업로드: 미리보기 → 열 매핑·검증 → 정상 행 선택 반영."""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select

from ..models import BoqGroup, BoqItem, ImportJob, Material
from ..security import Ctx, get_ctx, perm
from ..services.common import audit, company_settings
from ..services.excel import COMMON_UNITS, auto_mapping, fields_for, read_sheet, template_bytes
from ..util import D, q_price, q_qty, round_amount

router = APIRouter(prefix="/api/import", tags=["import"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/template/{kind}.xlsx")
def template(kind: str, ctx: Ctx = Depends(get_ctx)):
    name = {"boq": "설계내역_업로드양식.xlsx", "material": "자재마스터_업로드양식.xlsx"}.get(kind)
    if not name:
        raise HTTPException(404, "양식 없음")
    from urllib.parse import quote
    return Response(template_bytes(kind), media_type=XLSX,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


def _need_perm(ctx: Ctx, kind: str, project_id: int | None):
    if kind == "boq":
        ctx.require("boq.edit")
        if not project_id:
            raise HTTPException(400, "현장을 지정하세요.")
        ctx.project(project_id)
    else:
        ctx.require("material.master")


def _validate(ctx: Ctx, job: ImportJob, mapping: dict[str, int | None]) -> list[dict]:
    fields = fields_for(job.kind)
    for key, label, req in fields:
        if req and mapping.get(key) is None:
            raise HTTPException(400, f"필수 열 '{label}'을(를) 매핑하세요.")
    existing = set()
    if job.kind == "boq":
        groups = {g.id: g for g in ctx.db.execute(select(BoqGroup).where(BoqGroup.project_id == job.project_id,
                                                                          BoqGroup.deleted_at.is_(None))).scalars()}
        for it in ctx.db.execute(select(BoqItem).where(BoqItem.project_id == job.project_id, BoqItem.deleted_at.is_(None))).scalars():
            g = groups.get(it.group_id)
            if g is None:
                continue
            if g.level == 2:
                path = (groups[g.parent_id].name if g.parent_id in groups else "", g.name)
            else:
                path = (g.name, "")
            existing.add((*path, it.name, it.spec or ""))
    else:
        existing = {c for (c,) in ctx.db.execute(select(Material.code).where(Material.company_id == ctx.company_id,
                                                                              Material.deleted_at.is_(None))).all()}
    seen = set()
    out = []
    for idx, row in enumerate(job.rows):
        val = {}
        for key, label, req in fields:
            ci = mapping.get(key)
            raw = row[ci] if ci is not None and 0 <= ci < len(row) else ""
            val[key] = raw.strip() if isinstance(raw, str) else raw
        errs, warns = [], []
        for key, label, req in fields:
            if req and not val.get(key):
                errs.append(f"{label} 누락")
        def num(key, label, allow_neg=False):
            v = val.get(key)
            if v in (None, ""):
                return None
            try:
                d = D(v)
            except ValueError:
                errs.append(f"{label} 숫자 아님({v})")
                return None
            if d < 0 and not allow_neg:
                errs.append(f"{label} 음수")
            return d
        def dt(key, label):
            v = val.get(key)
            if not v:
                return None
            try:
                return date.fromisoformat(str(v)[:10])
            except ValueError:
                errs.append(f"{label} 날짜형식 오류({v}) — YYYY-MM-DD")
                return None
        if val.get("unit") and val["unit"] not in COMMON_UNITS:
            warns.append(f"일반적이지 않은 단위 '{val['unit']}' — 확인 필요")
        if val.get("unit") and len(val["unit"]) > 20:
            errs.append("단위가 너무 깁니다(20자 이내)")
        if job.kind == "boq":
            num("design_qty", "설계수량")
            for k, lab in (("mat_unit_price", "재료비단가"), ("labor_unit_price", "노무비단가"), ("exp_unit_price", "경비단가"),
                           ("custom_weight", "가중치")):
                num(k, lab)
            ps, pe = dt("plan_start", "계획시작일"), dt("plan_end", "계획종료일")
            if ps and pe and pe < ps:
                errs.append("계획종료일이 시작일보다 빠름")
            if val.get("design_qty") not in (None, "") and not errs and D(val["design_qty"]) == 0:
                warns.append("설계수량 0 — 공정률 계산 불가 항목이 됩니다")
            key = (val.get("group1") or "", val.get("group2") or "", val.get("name") or "", val.get("spec") or "")
            if key in existing:
                errs.append("이미 등록된 항목과 중복(공종·품명·규격)")
            elif key in seen:
                errs.append("파일 내 중복 행")
            seen.add(key)
        else:
            num("ref_price", "참고단가")
            num("min_stock", "최소재고")
            if val.get("supply_type") and val["supply_type"] not in ("관급", "사급"):
                errs.append("관급/사급 값 오류")
            if val.get("stock_managed") and str(val["stock_managed"]).upper() not in ("Y", "N", "예", "아니오"):
                errs.append("재고관리 값은 Y/N")
            c = val.get("code")
            if c in existing:
                errs.append("이미 등록된 자재코드")
            elif c in seen:
                errs.append("파일 내 자재코드 중복")
            seen.add(c)
        out.append({"index": idx, "values": val, "errors": errs, "warnings": warns, "valid": not errs})
    return out


@router.post("/preview")
def preview(kind: str = Form(...), project_id: int | None = Form(None), file: UploadFile = File(...),
            ctx: Ctx = Depends(get_ctx)):
    _need_perm(ctx, kind, project_id)
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(400, ".xlsx 파일만 업로드할 수 있습니다.")
    data = file.file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "엑셀 파일은 10MB 이하만 가능합니다.")
    headers, rows = read_sheet(data)
    job = ImportJob(company_id=ctx.company_id, user_id=ctx.user.id, kind=kind, project_id=project_id, headers=headers, rows=rows)
    ctx.db.add(job)
    ctx.db.flush()
    mapping = auto_mapping(kind, headers)
    try:
        result = _validate(ctx, job, mapping)
        map_error = None
    except HTTPException as e:
        result, map_error = [], e.detail
    ctx.db.commit()
    return {"job_id": job.id, "headers": headers, "mapping": mapping, "fields": [{"key": k, "label": l, "required": r} for k, l, r in fields_for(kind)],
            "rows": result, "mapping_error": map_error, "total": len(rows)}


class MapIn(BaseModel):
    mapping: dict[str, int | None]
    selected: list[int] | None = None


def _job(ctx: Ctx, jid: int) -> ImportJob:
    j = ctx.db.get(ImportJob, jid)
    if not j or j.company_id != ctx.company_id or j.user_id != ctx.user.id:
        raise HTTPException(404, "업로드 작업을 찾을 수 없습니다.")
    if j.status != "preview":
        raise HTTPException(409, "이미 반영된 업로드입니다. 파일을 다시 올려주세요.")
    _need_perm(ctx, j.kind, j.project_id)
    return j


@router.post("/{jid}/validate")
def validate(jid: int, body: MapIn, ctx: Ctx = Depends(get_ctx)):
    j = _job(ctx, jid)
    return {"rows": _validate(ctx, j, body.mapping)}


@router.post("/{jid}/commit")
def commit(jid: int, body: MapIn, ctx: Ctx = Depends(get_ctx)):
    j = ctx.db.execute(select(ImportJob).where(ImportJob.id == jid).with_for_update()).scalar_one_or_none()
    if not j:
        raise HTTPException(404, "업로드 작업을 찾을 수 없습니다.")
    j = _job(ctx, jid)
    if not body.selected:
        raise HTTPException(400, "반영할 행을 선택하세요.")
    rows = {r["index"]: r for r in _validate(ctx, j, body.mapping)}
    bad = [i + 2 for i in body.selected if i not in rows or not rows[i]["valid"]]
    if bad:
        raise HTTPException(400, f"오류가 있는 행은 반영할 수 없습니다 (엑셀 행번호: {bad[:20]}).")
    st = company_settings(ctx.db, ctx.company_id)
    count = 0
    if j.kind == "boq":
        gcache: dict[tuple, BoqGroup] = {}
        for g in ctx.db.execute(select(BoqGroup).where(BoqGroup.project_id == j.project_id, BoqGroup.deleted_at.is_(None))).scalars():
            gcache[(g.level, g.parent_id, g.name)] = g

        def group(level, parent_id, name):
            k = (level, parent_id, name)
            if k not in gcache:
                g = BoqGroup(company_id=ctx.company_id, project_id=j.project_id, level=level, parent_id=parent_id, name=name,
                             sort=(len(gcache) + 1) * 10)
                ctx.db.add(g)
                ctx.db.flush()
                gcache[k] = g
            return gcache[k]
        show_amt = ctx.has("amount.contract")
        for n, i in enumerate(body.selected):
            v = rows[i]["values"]
            g1 = group(1, None, v["group1"])
            g = group(2, g1.id, v["group2"]) if v.get("group2") else g1
            qty = q_qty(v["design_qty"])
            prices = [q_price(v.get(k) or 0) if show_amt else Decimal(0)
                      for k in ("mat_unit_price", "labor_unit_price", "exp_unit_price")]
            it = BoqItem(company_id=ctx.company_id, project_id=j.project_id, group_id=g.id, name=v["name"], spec=v.get("spec") or None,
                         unit=v["unit"], design_qty=qty, mat_unit_price=prices[0], labor_unit_price=prices[1],
                         exp_unit_price=prices[2], amount=round_amount(qty * sum(prices), st["amount_rounding"]),
                         plan_start=date.fromisoformat(v["plan_start"][:10]) if v.get("plan_start") else None,
                         plan_end=date.fromisoformat(v["plan_end"][:10]) if v.get("plan_end") else None,
                         custom_weight=D(v["custom_weight"]) if v.get("custom_weight") else None, sort=(n + 1) * 10)
            ctx.db.add(it)
            count += 1
    else:
        for i in body.selected:
            v = rows[i]["values"]
            ctx.db.add(Material(company_id=ctx.company_id, code=v["code"], name=v["name"], spec=v.get("spec") or None, unit=v["unit"],
                                maker=v.get("maker") or None, model=v.get("model") or None,
                                ref_price=q_price(v.get("ref_price") or 0) if ctx.has("amount.purchase") else 0,
                                stock_managed=str(v.get("stock_managed") or "N").upper() in ("Y", "예"),
                                min_stock=q_qty(v.get("min_stock") or 0), supply_type=v.get("supply_type") or "사급"))
            count += 1
    j.status = "committed"
    audit(ctx, "import", j.kind, j.id, f"엑셀 업로드 반영: {count}행", project_id=j.project_id)
    ctx.db.commit()
    return {"inserted": count, "skipped": len(j.rows) - count}
