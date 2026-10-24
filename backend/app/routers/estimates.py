"""계약내역 버전 / 품목 조회·편집 / 원가 비목 / 일위대가."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import audit, get_current_user, get_project_for
from ..db import get_db
from ..config import settings
from ..models import ContractVersion, CostRateRule, DesignChange, EstimateItem, PriceTable, ProgressClaim, SourceFile, UnitPriceAnalysis, User, WorkbookSheet
from ..schemas import CostRuleIn, ItemAdd, ItemEdit
from ..services.calc import D, line_amounts, project_rounding, s

router = APIRouter(prefix="/api")


def item_out(it: EstimateItem) -> dict:
    return {
        "id": it.id, "uid": it.uid, "seq": it.seq, "row_type": it.row_type, "level": it.level, "section_path": it.section_path,
        "sheet": it.sheet, "source_row": it.source_row, "work_code": it.work_code, "item_code": it.item_code, "code": it.code,
        "name": it.name, "spec": it.spec, "unit": it.unit, "qty": s(it.qty),
        "mat_price": s(it.mat_price), "mat_amt": s(it.mat_amt), "lab_price": s(it.lab_price), "lab_amt": s(it.lab_amt),
        "exp_price": s(it.exp_price), "exp_amt": s(it.exp_amt), "tot_price": s(it.tot_price), "tot_amt": s(it.tot_amt),
        "note": it.note, "unit_price_ref": it.unit_price_ref, "price_source": it.price_source, "cost_region": it.cost_region,
        "is_new": it.is_new, "is_deleted": it.is_deleted, "issues": it.issues,
    }


def version_out(v: ContractVersion) -> dict:
    return {"id": v.id, "project_id": v.project_id, "version_no": v.version_no, "label": v.label, "status": v.status,
            "source_file_id": v.source_file_id, "design_change_id": v.design_change_id, "totals": v.totals,
            "approved_at": v.approved_at.isoformat() if v.approved_at else None, "created_at": v.created_at.isoformat(),
            "item_count": sum(1 for i in v.items if i.row_type == "item")}


def _version(db, vid, user, need="view") -> ContractVersion:
    v = db.get(ContractVersion, vid)
    if not v:
        raise HTTPException(404, "계약내역 버전을 찾을 수 없습니다.")
    get_project_for(db, v.project_id, user, need)
    return v


@router.get("/projects/{pid}/versions")
def list_versions(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    return [version_out(v) for v in db.query(ContractVersion).filter_by(project_id=pid).order_by(ContractVersion.version_no)]


@router.get("/versions/{vid}")
def get_version(vid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return version_out(_version(db, vid, user))


@router.get("/versions/{vid}/items")
def version_items(vid: int, q: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user)
    items = v.items
    if q:
        ql = q.lower()
        items = [i for i in items if i.row_type == "section" or ql in (i.name or "").lower() or ql in (i.spec or "").lower()]
    return {"version": version_out(v), "items": [item_out(i) for i in items]}


def _editable(db: Session, v: ContractVersion):
    """편집 가능 여부: 확정 기성이나 승인된 설계변경이 이 버전을 참조하면 직접 수정 금지(설계변경으로)."""
    if v.status == "draft":
        return
    if db.query(ProgressClaim).filter_by(contract_version_id=v.id, status="confirmed").count():
        raise HTTPException(400, "이 계약내역으로 확정된 기성 회차가 있어 직접 수정할 수 없습니다. 설계변경으로 처리하세요.")
    if db.query(DesignChange).filter_by(base_version_id=v.id, status="approved").count():
        raise HTTPException(400, "이 계약내역을 기준으로 승인된 설계변경이 있어 직접 수정할 수 없습니다. 최신 버전을 편집하거나 설계변경으로 처리하세요.")


@router.get("/versions/{vid}/editable")
def version_editable(vid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user)
    try:
        _editable(db, v)
        return {"editable": True, "reason": ""}
    except HTTPException as e:
        return {"editable": False, "reason": e.detail}


@router.put("/versions/{vid}/items/{uid}")
def edit_item(vid: int, uid: str, body: ItemEdit, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """품목 수정 (수량·단가·명칭). 금액은 현장 반올림 규칙으로 재계산. 확정 버전은 기성/설계변경 참조가 없을 때만."""
    v = _version(db, vid, user, "edit")
    _editable(db, v)
    p = get_project_for(db, v.project_id, user, "edit")
    it = db.query(EstimateItem).filter_by(version_id=vid, uid=uid).first()
    if not it:
        raise HTTPException(404, "품목이 없습니다.")
    before = item_out(it)
    for k in ("name", "spec", "unit", "note"):
        val = getattr(body, k)
        if val is not None:
            setattr(it, k, val)
    for k in ("qty", "mat_price", "lab_price", "exp_price"):
        val = getattr(body, k)
        if val is not None:
            setattr(it, k, Decimal(str(val)))
    if it.row_type == "item":
        am = line_amounts(D(it.qty), it.mat_price, it.lab_price, it.exp_price, project_rounding(p))
        it.mat_amt, it.lab_amt, it.exp_amt = am["mat_amt"], am["lab_amt"], am["exp_amt"]
        it.tot_price = D(it.mat_price) + D(it.lab_price) + D(it.exp_price)
        it.tot_amt = am["tot_amt"]
    _recalc_totals(v)
    audit(db, user, "item.edit", v.project_id, target=f"v{v.version_no}/{it.name}", before=before, after=item_out(it), reason=body.reason)
    db.commit()
    return item_out(it)


@router.post("/versions/{vid}/items")
def add_item(vid: int, body: ItemAdd, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """품목 추가: after_uid 다음(또는 해당 공종 끝)에 삽입."""
    import hashlib
    v = _version(db, vid, user, "edit")
    _editable(db, v)
    p = get_project_for(db, v.project_id, user, "edit")
    items = sorted(v.items, key=lambda i: i.seq)
    anchor = next((i for i in items if i.uid == body.after_uid), None) if body.after_uid else None
    if anchor is None:
        # 공종 경로의 마지막 품목 뒤
        sec = [i for i in items if i.section_path == body.section_path]
        anchor = sec[-1] if sec else None
    if anchor is None:
        raise HTTPException(400, "삽입 위치(공종)를 찾지 못했습니다.")
    path = anchor.section_path if anchor.row_type == "item" else (body.section_path or anchor.section_path)
    pos = anchor.seq
    for i in items:
        if i.seq > pos:
            i.seq += 1
    uid = hashlib.sha1(f"manual|{vid}|{pos}|{body.name}|{body.spec}|{datetime.utcnow().isoformat()}".encode()).hexdigest()[:16]
    am = line_amounts(D(body.qty), body.mat_price, body.lab_price, body.exp_price, project_rounding(p))
    it = EstimateItem(version_id=vid, uid=uid, seq=pos + 1, row_type="item", level=len(path) + 1, section_path=path,
                      sheet=anchor.sheet, name=body.name, spec=body.spec, unit=body.unit, qty=D(body.qty),
                      mat_price=D(body.mat_price), lab_price=D(body.lab_price), exp_price=D(body.exp_price),
                      mat_amt=am["mat_amt"], lab_amt=am["lab_amt"], exp_amt=am["exp_amt"],
                      tot_price=D(body.mat_price) + D(body.lab_price) + D(body.exp_price), tot_amt=am["tot_amt"], note=body.note,
                      price_source={"manual": True})
    v.items.append(it)
    _recalc_totals(v)
    audit(db, user, "item.add", v.project_id, target=f"v{v.version_no}/{it.name}", after=item_out(it), reason=body.reason)
    db.commit()
    return item_out(it)


@router.delete("/versions/{vid}/items/{uid}")
def delete_item(vid: int, uid: str, reason: str = "", db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user, "edit")
    _editable(db, v)
    it = db.query(EstimateItem).filter_by(version_id=vid, uid=uid).first()
    if not it:
        raise HTTPException(404, "품목이 없습니다.")
    before = item_out(it)
    if it.price_source.get("manual") or v.status == "draft" and not it.source_row:
        v.items.remove(it)
        db.delete(it)          # 수동 추가 행은 완전 삭제
    else:
        it.is_deleted = True   # 원본 행은 삭제 표시 (원본 양식 출력 시 수량 0 처리)
    _recalc_totals(v)
    audit(db, user, "item.delete", v.project_id, target=f"v{v.version_no}/{before['name']}", before=before, reason=reason)
    db.commit()
    return {"ok": True, "totals": v.totals}


@router.get("/versions/{vid}/export")
def export_version(vid: int, delete_mode: str = "zero", db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """계약내역 버전을 업로드한 원본 엑셀 양식 그대로 출력 (수정·추가·삭제된 셀만 반영, 나머지 시트·서식·수식 유지)."""
    from pathlib import Path
    from ..excel.analyzer import analyze_file
    from ..excel.export_version import write_version_original
    v = _version(db, vid, user)
    p = get_project_for(db, v.project_id, user)
    sf = db.get(SourceFile, v.source_file_id) if v.source_file_id else None
    if not sf:
        raise HTTPException(400, "이 버전은 원본 파일이 없어 원본 양식으로 출력할 수 없습니다.")
    sheet_maps = {ws.name: ws.column_map for ws in db.query(WorkbookSheet).filter_by(file_id=sf.id) if ws.column_map}
    # 원본 값(가져오기 시점) 재추출 → 바뀐 셀만 기록
    role_over = {ws.name: ws.user_role for ws in sf.sheets if ws.user_role}
    map_over = {ws.name: ws.user_column_map for ws in sf.sheets if ws.user_column_map}
    res = analyze_file(sf.stored_path, str(settings.storage_dir / "work"), role_over or None, map_over or None)
    original = {}
    for ps in res["_parsed"].values():
        for it in ps.items:
            original[it.uid] = {"name": it.name, "spec": it.spec, "unit": it.unit, "note": it.note, "qty": it.qty,
                                "mat_price": it.mat_price, "lab_price": it.lab_price, "exp_price": it.exp_price, "tot_price": it.tot_price}
    out_dir = settings.storage_dir / f"project_{p.id}" / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(sf.stored_path).suffix.lower()
    stem = Path(sf.original_name).stem
    out = out_dir / f"{stem}_v{v.version_no}_{v.label}_{datetime.now().strftime('%Y%m%d_%H%M')}{ext}"
    stats = write_version_original(Path(sf.stored_path), out, v, sheet_maps, original, delete_mode, title_suffix=f"v{v.version_no} {v.label}" if v.version_no else "")
    audit(db, user, "version.export", p.id, target=f"v{v.version_no}", after={"file": out.name, **{k: stats[k] for k in ("modified", "added", "deleted")}})
    db.commit()
    media = "application/vnd.ms-excel.sheet.macroEnabled.12" if ext == ".xlsm" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return FileResponse(out, filename=out.name, media_type=media, headers={"X-Export-Stats": f"modified={stats['modified']};added={stats['added']};deleted={stats['deleted']}"})


@router.post("/versions/{vid}/items/{uid}/restore")
def restore_item(vid: int, uid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user, "edit")
    _editable(db, v)
    it = db.query(EstimateItem).filter_by(version_id=vid, uid=uid).first()
    if not it:
        raise HTTPException(404)
    it.is_deleted = False
    _recalc_totals(v)
    audit(db, user, "item.restore", v.project_id, target=f"v{v.version_no}/{it.name}")
    db.commit()
    return item_out(it)


def _recalc_totals(v: ContractVersion):
    t = {k: Decimal(0) for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")}
    for i in v.items:
        if i.row_type == "item" and not i.is_deleted:
            for k in t:
                t[k] += D(getattr(i, k))
    v.totals = {k: str(x) for k, x in t.items()}


@router.post("/versions/{vid}/approve")
def approve_version(vid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user, "approve")
    v.status = "approved"
    v.approved_at = datetime.utcnow()
    audit(db, user, "version.approve", v.project_id, target=f"v{v.version_no} {v.label}")
    db.commit()
    return version_out(v)


@router.delete("/versions/{vid}")
def delete_version(vid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    v = _version(db, vid, user, "approve")
    if v.status != "draft":
        raise HTTPException(400, "승인된 버전은 삭제할 수 없습니다.")
    audit(db, user, "version.delete", v.project_id, target=f"v{v.version_no}")
    db.delete(v)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 원가 비목
def rule_out(r: CostRateRule) -> dict:
    return {"id": r.id, "version_id": r.version_id, "seq": r.seq, "name": r.name, "kind": r.kind, "rate": s(r.rate),
            "rate_base": r.rate_base, "base_text": r.base_text, "amount": s(r.amount), "fixed": r.fixed,
            "source": r.source, "effective_date": r.effective_date}


@router.get("/projects/{pid}/cost-rules")
def cost_rules(pid: int, version_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    q = db.query(CostRateRule).filter_by(project_id=pid)
    if version_id:
        q = q.filter_by(version_id=version_id)
    return [rule_out(r) for r in q.order_by(CostRateRule.version_id, CostRateRule.seq)]


@router.put("/cost-rules/{rid}")
def update_rule(rid: int, body: CostRuleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    r = db.get(CostRateRule, rid)
    if not r:
        raise HTTPException(404)
    get_project_for(db, r.project_id, user, "edit")
    before = rule_out(r)
    if body.rate is not None:
        r.rate = Decimal(str(body.rate))
    for k in ("rate_base", "fixed", "source", "effective_date"):
        if getattr(body, k) is not None:
            setattr(r, k, getattr(body, k))
    if body.amount is not None:
        r.amount = Decimal(str(body.amount))
    audit(db, user, "cost_rule.update", r.project_id, target=r.name, before=before, after=rule_out(r))
    db.commit()
    return rule_out(r)


@router.get("/projects/{pid}/unit-prices")
def unit_prices(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    return [{"id": u.id, "sheet": u.sheet, "no": u.no, "title": u.title, "components": u.components, "total": u.total, "is_new": u.is_new}
            for u in db.query(UnitPriceAnalysis).filter_by(project_id=pid).order_by(UnitPriceAnalysis.id)]


@router.post("/projects/{pid}/unit-prices")
def create_unit_price(pid: int, body: dict, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """신규 일위대가 작성: components [{name,spec,unit,qty,mat_price,lab_price,exp_price}] → 합계 자동."""
    p = get_project_for(db, pid, user, "edit")
    comps = body.get("components", [])
    rounding = {"amount": {"func": "trunc", "digits": 1}}
    tot = {"mat_amt": Decimal(0), "lab_amt": Decimal(0), "exp_amt": Decimal(0)}
    for c in comps:
        am = line_amounts(D(c.get("qty")), c.get("mat_price"), c.get("lab_price"), c.get("exp_price"), rounding)
        for k in tot:
            tot[k] += am[k]
            c[k] = s(am[k])
    total = {k: s(v.quantize(Decimal(1))) for k, v in tot.items()}
    total["tot_amt"] = s(sum(tot.values()).quantize(Decimal(1)))
    u = UnitPriceAnalysis(project_id=p.id, sheet="신규", no=body.get("no") or f"신규 {db.query(UnitPriceAnalysis).filter_by(project_id=pid, is_new=True).count() + 1}호",
                          title=body.get("title", ""), components=comps, total=total, is_new=True)
    db.add(u)
    audit(db, user, "unit_price.create", p.id, target=u.no, after=total)
    db.commit()
    return {"id": u.id, "no": u.no, "title": u.title, "components": u.components, "total": u.total, "is_new": True}


# ---------------------------------------------------------------- 자재단가 / 노임 표
def _tokens_match(q: str, text: str) -> bool:
    t = text.lower().replace(" ", "")
    return all(tok in t for tok in q.lower().split() if tok)


def _row_text(r: dict) -> str:
    return " ".join(str(v) for k, v in r.items() if not k.startswith("_")) + " " + (r.get("_name") or "")
@router.get("/projects/{pid}/price-tables")
def price_tables(pid: int, kind: str | None = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    q = db.query(PriceTable).filter_by(project_id=pid)
    if kind:
        q = q.filter_by(kind=kind)
    return [{"id": t.id, "sheet": t.sheet, "kind": t.kind, "title": t.title, "row_count": t.row_count, "source_file_id": t.source_file_id,
             "columns": t.columns} for t in q.order_by(PriceTable.kind, PriceTable.id)]


@router.get("/price-tables/{tid}")
def price_table(tid: int, q: str | None = None, limit: int = 3000, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.get(PriceTable, tid)
    if not t:
        raise HTTPException(404)
    get_project_for(db, t.project_id, user)
    rows = t.rows
    if q:
        rows = [r for r in rows if _tokens_match(q, _row_text(r))]
    return {"id": t.id, "sheet": t.sheet, "kind": t.kind, "title": t.title, "name_key": t.name_key, "columns": t.columns,
            "groups": t.groups, "rows": rows[:limit], "total": len(t.rows), "matched": len(rows)}


@router.get("/projects/{pid}/price-lookup")
def price_lookup(pid: int, q: str, limit: int = 30, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """품명/규격으로 자재단가·노임 표 통합 검색 (내역 편집·신규 품목 단가 참고용)."""
    get_project_for(db, pid, user)
    out = []
    for t in db.query(PriceTable).filter_by(project_id=pid).filter(PriceTable.kind.in_(["material", "labor"])):
        labels = {c["key"]: c["label"] for c in t.columns}
        for r in t.rows:
            if _tokens_match(q, _row_text(r)):
                nums = {labels[k]: v for k, v in r.items() if not k.startswith("_") and isinstance(v, (int, float)) and k in labels}
                out.append({"sheet": t.sheet, "kind": t.kind, "name": r.get("_name"), "row": r.get("_row"),
                            "text": {labels.get(k, k): v for k, v in r.items() if not k.startswith("_") and isinstance(v, str)}, "numbers": nums})
                if len(out) >= limit:
                    return out
    return out
