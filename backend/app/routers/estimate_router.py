"""5단계 — 적산·원가계산. 기준정보(표준품셈·노임·자재단가·제비율)는 사용자가 적법하게 확보한 자료만 등록.
확보되지 않은 항목은 '미산정'으로 표시하고 임의 값을 만들지 않는다."""
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import settings

from ..auth import EDIT_ROLES, audit, current_user, get_project_or_403, require_role
from ..db import get_db
from ..models import (Approval, CostEstimate, LaborRate, MaterialCatalog, QuantityItem, QuantityStatus, StandardNorm,
                      UnitPrice, User)

router = APIRouter(prefix="/api", tags=["estimate"])


class NormIn(BaseModel):
    code: str
    title: str
    unit: str
    labor: dict        # {"내선전공": 0.12, "보통인부": 0.05}
    publisher: str
    year: int
    effective_date: str | None = None
    source: str | None = None
    version: str | None = None
    conditions: dict = {}


class LaborIn(BaseModel):
    trade: str
    daily_rate: float
    publisher: str
    effective_date: str
    version: str | None = None


class MaterialIn(BaseModel):
    code: str | None = None
    item_name: str
    spec: str | None = None
    unit: str | None = None
    discipline: str | None = None
    supply_type: str = "private"
    price: float | None = None
    price_source: str | None = None
    effective_date: str | None = None


class RatesIn(BaseModel):
    """제경비 비율(%). 각 항목에 근거(source) 필수. 미입력 항목은 미산정."""
    rates: dict   # {"간접노무비": {"pct": 10.5, "base": "직접노무비", "source": "..."} ...}
    vat_pct: float = 10.0
    mapping: dict = {}   # {quantity_item_id: {"norm_code": "...", "material_id": 1}}


@router.post("/norms")
def add_norm(body: NormIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    n = StandardNorm(company_id=user.company_id, **body.model_dump())
    db.add(n)
    db.commit()
    return {"id": n.id}


def ensure_standard_norms(db: Session, company_id: int) -> int:
    """사용자가 올린 2026 표준품셈(전기·정보통신)에서 추출한 품 항목(app/data/norms_2026.json)을
    회사 기준정보에 한 번 넣는다. 이미 같은 코드가 있으면 넣지 않는다(사용자 수정 보존)."""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "data" / "norms_2026.json"
    if not path.exists():
        return 0
    have = {c for (c,) in db.query(StandardNorm.code).filter_by(company_id=company_id).all()}
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = []
    for it in data["items"]:
        if it["code"] in have:
            continue
        rows.append(StandardNorm(company_id=company_id, code=it["code"][:50], title=it["title"][:300], unit=(it["unit"] or "식")[:20],
                                 labor=it["labor"], publisher=it["publisher"][:100], year=2026, effective_date="2026-01-01",
                                 source=f"{it['source']} p.{it['page']}"[:300], version="2026",
                                 conditions={"section": it.get("section"), "page": it["page"]}))
    if rows:
        db.add_all(rows)
        db.commit()
    return len(rows)


@router.get("/norms")
def list_norms(q: str | None = None, limit: int = 0, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """표준품셈 목록. q: 검색어(공백 구분, 모두 포함), limit: 최대 개수(0=전체)."""
    ensure_standard_norms(db, user.company_id)
    qry = db.query(StandardNorm).filter_by(company_id=user.company_id)
    for tok in (q or "").split():
        like = f"%{tok}%"
        qry = qry.filter((StandardNorm.title.like(like)) | (StandardNorm.code.like(like)))
    qry = qry.order_by(StandardNorm.id)
    if limit:
        qry = qry.limit(limit)
    return [{"id": n.id, "code": n.code, "title": n.title, "unit": n.unit, "labor": n.labor, "publisher": n.publisher, "year": n.year,
             "version": n.version, "source": n.source} for n in qry.all()]


@router.post("/labor-rates")
def add_labor(body: LaborIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    r = LaborRate(company_id=user.company_id, **body.model_dump())
    db.add(r)
    db.commit()
    return {"id": r.id}


def ensure_standard_labor(db: Session, company_id: int) -> int:
    """기본 제공 노임단가(출처 확인된 값만, app/data/labor_rates.json)를 회사 기준정보에 한 번 넣는다.
    같은 직종·적용일·버전이 이미 있으면 넣지 않는다 (사용자 수정값 보존)."""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "data" / "labor_rates.json"
    if not path.exists():
        return 0
    data = json.loads(path.read_text(encoding="utf-8"))
    have = {(r.trade, r.effective_date) for r in db.query(LaborRate).filter_by(company_id=company_id).all()}
    n = 0
    for st in data.get("sets", []):
        for r in st["rates"]:
            if (r["trade"], st["effective_date"]) in have:
                continue
            db.add(LaborRate(company_id=company_id, trade=r["trade"], daily_rate=float(r["daily_rate"]), publisher=st["publisher"],
                             effective_date=st["effective_date"], version=st.get("version")))
            n += 1
    if n:
        db.commit()
    return n


@router.get("/labor-rates")
def list_labor(user: User = Depends(current_user), db: Session = Depends(get_db)):
    ensure_standard_labor(db, user.company_id)
    rows = db.query(LaborRate).filter_by(company_id=user.company_id).order_by(LaborRate.trade, LaborRate.effective_date.desc()).all()
    return [{"id": r.id, "trade": r.trade, "daily_rate": r.daily_rate, "publisher": r.publisher, "effective_date": r.effective_date,
             "version": r.version} for r in rows]


@router.get("/labor-rates/standard-info")
def labor_standard_info(user: User = Depends(current_user)):
    """기본 제공 노임 세트의 출처와, 확인하지 못해 비워 둔 직종 안내."""
    import json
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "data" / "labor_rates.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    return {"sets": [{k: v for k, v in st.items() if k != "rates"} | {"count": len(st["rates"])} for st in data.get("sets", [])],
            "missing": data.get("missing", [])}


@router.post("/materials")
def add_material(body: MaterialIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    m = MaterialCatalog(company_id=user.company_id, code=body.code, item_name=body.item_name, spec=body.spec, unit=body.unit,
                        discipline=body.discipline, supply_type=body.supply_type)
    db.add(m)
    db.flush()
    if body.price is not None:
        if not body.price_source or not body.effective_date:
            raise HTTPException(400, "단가에는 출처와 적용일자가 필요합니다.")
        db.add(UnitPrice(material_id=m.id, price=body.price, source=body.price_source, effective_date=body.effective_date))
    db.commit()
    return {"id": m.id}


@router.get("/materials")
def list_materials(user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = []
    for m in db.query(MaterialCatalog).filter_by(company_id=user.company_id).all():
        up = db.query(UnitPrice).filter_by(material_id=m.id).order_by(UnitPrice.effective_date.desc()).first()
        out.append({"id": m.id, "code": m.code, "item_name": m.item_name, "spec": m.spec, "unit": m.unit, "supply_type": m.supply_type,
                    "price": up.price if up else None, "price_source": up.source if up else None, "effective_date": up.effective_date if up else None})
    return out


@router.post("/projects/{pid}/estimate")
def compute_estimate(pid: int, body: RatesIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """물량 → 품목 매핑 → 재료비·노무비 → 일위대가 → 원가계산서. 승인 전 물량은 확정 불가(finalized=False)."""
    get_project_or_403(db, user, pid)
    items = db.query(QuantityItem).filter_by(project_id=pid).all()
    norms = {n.code: n for n in db.query(StandardNorm).filter_by(company_id=user.company_id).all()}
    # 같은 직종이 여러 적용일로 있으면 가장 최근 적용일 단가를 쓴다
    labor = {}
    for r in db.query(LaborRate).filter_by(company_id=user.company_id).order_by(LaborRate.effective_date).all():
        labor[r.trade] = r
    lines, direct_mat, direct_lab, gov_mat = [], 0.0, 0.0, 0.0
    all_verified = True
    for q in items:
        mp = body.mapping.get(str(q.id), {})
        line = {"item_id": q.id, "item_name": q.item_name, "spec": q.spec, "unit": q.unit, "qty": q.qty_total, "status": q.status.value,
                "material_unit": None, "labor_unit": None, "material_cost": None, "labor_cost": None, "expense": None, "notes": []}
        if q.status not in (QuantityStatus.verified, QuantityStatus.edited):
            all_verified = False
        if q.qty_total is None:
            line["notes"].append("수량 미산출")
        m = db.get(MaterialCatalog, mp.get("material_id")) if mp.get("material_id") else None
        if m:
            up = db.query(UnitPrice).filter_by(material_id=m.id).order_by(UnitPrice.effective_date.desc()).first()
            if up and q.qty_total is not None:
                line["material_unit"] = up.price
                line["material_cost"] = round(up.price * q.qty_total)
                line["material_source"] = f"{up.source} ({up.effective_date})"
                if m.supply_type == "gov":
                    gov_mat += line["material_cost"]
                    line["notes"].append("관급자재")
                else:
                    direct_mat += line["material_cost"]
            else:
                line["notes"].append("자재단가 미등록 → 재료비 미산정")
        else:
            line["notes"].append("자재 매핑 없음 → 재료비 미산정")
        n = norms.get(mp.get("norm_code"))
        if n and q.qty_total is not None:
            unit_lab, detail, missing = 0.0, {}, []
            for trade, manday in n.labor.items():
                if trade in labor:
                    unit_lab += manday * labor[trade].daily_rate
                    detail[trade] = {"manday": manday, "rate": labor[trade].daily_rate}
                else:
                    missing.append(trade)
            if missing:
                line["notes"].append(f"노임단가 미등록: {', '.join(missing)} → 노무비 미산정")
            else:
                line["labor_unit"] = round(unit_lab)
                line["labor_cost"] = round(unit_lab * q.qty_total)
                line["labor_detail"] = detail
                line["norm"] = f"{n.publisher} {n.year} {n.code}"
                direct_lab += line["labor_cost"]
        else:
            line["notes"].append("품셈 매핑 없음 → 노무비 미산정")
        lines.append(line)

    bases = {"재료비": direct_mat, "직접노무비": direct_lab, "직접공사비": direct_mat + direct_lab}
    overhead = {}
    for name, cfg in body.rates.items():
        if not cfg.get("source"):
            overhead[name] = {"amount": None, "note": "적용 근거 없음 → 미산정"}
            continue
        base = bases.get(cfg.get("base", "직접공사비"))
        if base is None:
            base = sum(v["amount"] or 0 for v in overhead.values()) if cfg.get("base") == "간접비합계" else 0
        amt = round(base * cfg["pct"] / 100)
        overhead[name] = {"amount": amt, "pct": cfg["pct"], "base": cfg.get("base"), "source": cfg["source"]}
        bases[name] = amt
    supply = direct_mat + direct_lab + sum(v["amount"] or 0 for v in overhead.values())
    vat = round(supply * body.vat_pct / 100)
    result = {"lines": lines, "direct_material": direct_mat, "direct_labor": direct_lab, "gov_material": gov_mat,
              "overhead": overhead, "supply": supply, "vat": vat, "total": supply + vat,
              "finalizable": all_verified, "note": None if all_verified else "사용자 검증이 끝나지 않은 물량이 있어 원가내역서를 확정할 수 없습니다."}
    n = db.query(CostEstimate).filter_by(project_id=pid).count() + 1
    est = CostEstimate(project_id=pid, revision_no=n, rates={"overhead": body.rates, "vat_pct": body.vat_pct, "mapping": body.mapping, "result": {k: v for k, v in result.items() if k != "lines"}},
                       lines=lines, finalized=False)
    db.add(est)
    audit(db, user, "estimate", pid)
    db.commit()
    return {"id": est.id, "revision_no": n, **result}


def _est_out(est: CostEstimate) -> dict:
    return {"id": est.id, "revision_no": est.revision_no, "finalized": est.finalized, "created_at": est.created_at.isoformat(),
            "rates": est.rates.get("overhead", {}), "vat_pct": est.rates.get("vat_pct", 10), "mapping": est.rates.get("mapping", {}),
            "lines": est.lines, **est.rates.get("result", {})}


@router.get("/projects/{pid}/estimate")
def latest_estimate(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    est = db.query(CostEstimate).filter_by(project_id=pid).order_by(CostEstimate.id.desc()).first()
    return _est_out(est) if est else None


@router.get("/projects/{pid}/estimate/{eid}/xlsx")
def estimate_xlsx(pid: int, eid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """원가계산서 + 일위대가(품목별 재료비·노무비) + 관급/사급 집계 Excel."""
    from ..engine.export_xlsx import build_estimate_workbook
    p = get_project_or_403(db, user, pid)
    est = db.get(CostEstimate, eid)
    if not est or est.project_id != pid:
        raise HTTPException(404)
    out = settings.processed_dir / str(pid) / "export" / f"원가계산서_{p.name}_rev{est.revision_no}_{date.today().isoformat()}.xlsx"
    build_estimate_workbook({"name": p.name, "client": p.client or "", "author": p.author or "", "reviewer": p.reviewer or "", "date": date.today().isoformat(), "rev": str(est.revision_no)},
                            _est_out(est), out)
    return FileResponse(out, filename=out.name)


# ---- 기준정보 Excel 일괄 등록 ----
HEAD_MAP = {
    "norms": {"code": ["품셈번호", "코드", "CODE"], "title": ["항목", "항목명", "명칭", "TITLE"], "unit": ["단위", "UNIT"], "publisher": ["발행기관", "기관"], "year": ["연도", "적용연도", "YEAR"], "source": ["출처", "SOURCE"], "version": ["버전", "VERSION"]},
    "labor": {"trade": ["직종", "TRADE"], "daily_rate": ["일당", "노임", "단가", "RATE"], "publisher": ["발행기관", "기관"], "effective_date": ["적용일", "적용일자", "DATE"], "version": ["버전"]},
    "materials": {"code": ["코드", "CODE"], "item_name": ["품명", "NAME"], "spec": ["규격", "SPEC"], "unit": ["단위", "UNIT"], "discipline": ["공종"], "supply_type": ["관급/사급", "구분"], "price": ["단가", "PRICE"], "price_source": ["출처", "SOURCE"], "effective_date": ["적용일", "적용일자", "DATE"]},
}


@router.post("/refdata/{kind}/import")
async def import_refdata(kind: str, file: UploadFile = File(...), user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """표준품셈(labor 열: 직종명 헤더가 그대로 노무량 열이 됨) / 노임 / 자재단가 Excel 일괄 등록."""
    import openpyxl
    if kind not in HEAD_MAP:
        raise HTTPException(400, "kind 는 norms|labor|materials")
    tmp = settings.processed_dir / "refdata_import.xlsx"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(await file.read())
    wb = openpyxl.load_workbook(tmp, data_only=True)
    ws = wb.active
    rows = [[str(c).strip() if c is not None else "" for c in r] for r in ws.iter_rows(values_only=True)]
    if not rows:
        raise HTTPException(400, "빈 파일")
    header = rows[0]
    col = {}
    for field, names in HEAD_MAP[kind].items():
        for i, h in enumerate(header):
            if h.upper() in [n.upper() for n in names]:
                col[field] = i
                break
    if kind == "norms":
        known = set(col.values())
        labor_cols = {i: h for i, h in enumerate(header) if i not in known and h}
    n = 0
    for r in rows[1:]:
        if not any(r):
            continue
        g = lambda f: (r[col[f]] if f in col and col[f] < len(r) else "")  # noqa: E731
        try:
            if kind == "norms":
                if not g("code") or not g("title"):
                    continue
                labor = {h: float(r[i]) for i, h in labor_cols.items() if i < len(r) and r[i] not in ("", None)}
                db.add(StandardNorm(company_id=user.company_id, code=g("code"), title=g("title"), unit=g("unit") or "", labor=labor,
                                    publisher=g("publisher") or "미기재", year=int(float(g("year") or 0)) or date.today().year, source=g("source") or None, version=g("version") or None))
            elif kind == "labor":
                if not g("trade"):
                    continue
                db.add(LaborRate(company_id=user.company_id, trade=g("trade"), daily_rate=float(g("daily_rate") or 0), publisher=g("publisher") or "미기재",
                                 effective_date=(g("effective_date") or date.today().isoformat())[:10], version=g("version") or None))
            else:
                if not g("item_name"):
                    continue
                m = MaterialCatalog(company_id=user.company_id, code=g("code") or None, item_name=g("item_name"), spec=g("spec") or None, unit=g("unit") or None,
                                    discipline=g("discipline") or None, supply_type="gov" if "관급" in g("supply_type") else "private")
                db.add(m)
                db.flush()
                if g("price"):
                    db.add(UnitPrice(material_id=m.id, price=float(g("price")), source=g("price_source") or "엑셀 등록", effective_date=(g("effective_date") or date.today().isoformat())[:10]))
            n += 1
        except (ValueError, TypeError) as ex:
            raise HTTPException(400, f"행 {rows.index(r) + 1} 형식 오류: {ex}")
    audit(db, user, "refdata_import", kind=kind, rows=n)
    db.commit()
    return {"imported": n, "columns": col}


@router.post("/projects/{pid}/estimate/{eid}/finalize")
def finalize(pid: int, eid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    est = db.get(CostEstimate, eid)
    if not est or est.project_id != pid:
        raise HTTPException(404)
    pending = db.query(QuantityItem).filter(QuantityItem.project_id == pid, QuantityItem.status.notin_([QuantityStatus.verified, QuantityStatus.edited])).count()
    if pending:
        raise HTTPException(400, f"검증되지 않은 물량 {pending}건이 있어 확정할 수 없습니다.")
    est.finalized = True
    db.add(Approval(project_id=pid, target_type="estimate", target_id=eid, user_id=user.id, decision="finalized"))
    db.commit()
    return {"ok": True}
