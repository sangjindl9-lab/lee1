"""기성 회차 API."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import audit, get_current_user, get_project_for
from ..config import settings
from ..db import get_db
from ..excel.export_progress import write_original_format, write_standard
from ..excel.loader import cell_text
from ..excel.parser import to_decimal
from ..models import ContractVersion, CostRateRule, ProgressClaim, SourceFile, User, WorkbookSheet
from ..schemas import ClaimIn, ClaimInputs
from ..services.progress import compute_claim, confirm_claim, save_inputs

router = APIRouter(prefix="/api")


def claim_out(c: ProgressClaim) -> dict:
    return {"id": c.id, "project_id": c.project_id, "claim_no": c.claim_no, "title": c.title or (f"제 {c.claim_no} 회 기성" if not c.is_final else "준공 정산"),
            "base_date": c.base_date, "contract_version_id": c.contract_version_id, "is_final": c.is_final,
            "is_adjustment": c.is_adjustment, "status": c.status, "input_mode": c.input_mode, "totals": c.totals, "memo": c.memo,
            "confirmed_at": c.confirmed_at.isoformat() if c.confirmed_at else None, "created_at": c.created_at.isoformat()}


def _claim(db, cid, user, need="view") -> ProgressClaim:
    c = db.get(ProgressClaim, cid)
    if not c:
        raise HTTPException(404, "기성 회차를 찾을 수 없습니다.")
    get_project_for(db, c.project_id, user, need)
    return c


@router.get("/projects/{pid}/claims")
def list_claims(pid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    get_project_for(db, pid, user)
    return [claim_out(c) for c in db.query(ProgressClaim).filter_by(project_id=pid).order_by(ProgressClaim.claim_no)]


@router.post("/projects/{pid}/claims")
def create_claim(pid: int, body: ClaimIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    p = get_project_for(db, pid, user, "edit")
    versions = db.query(ContractVersion).filter_by(project_id=pid).order_by(ContractVersion.version_no).all()
    if not versions:
        raise HTTPException(400, "먼저 계약내역서를 업로드하고 가져오기 하세요.")
    if body.contract_version_id:
        cv = db.get(ContractVersion, body.contract_version_id)
    else:
        approved = [v for v in versions if v.status == "approved"]
        cv = approved[-1] if approved else versions[-1]
    last = db.query(ProgressClaim).filter_by(project_id=pid).order_by(ProgressClaim.claim_no.desc()).first()
    no = body.claim_no or ((last.claim_no + 1) if last else 1)
    if db.query(ProgressClaim).filter_by(project_id=pid, claim_no=no).first():
        raise HTTPException(400, f"{no}회차가 이미 존재합니다.")
    c = ProgressClaim(project_id=pid, claim_no=no, title=body.title, base_date=body.base_date, contract_version_id=cv.id,
                      is_final=body.is_final, is_adjustment=body.is_adjustment, input_mode=body.input_mode, memo=body.memo)
    db.add(c)
    audit(db, user, "claim.create", pid, target=f"{no}회차", after={"version": cv.version_no})
    db.commit()
    # 전회 누계 스냅샷 계산을 위해 1회 계산
    save_inputs(db, p, c, {})
    return claim_out(c)


@router.get("/claims/{cid}")
def get_claim(cid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _claim(db, cid, user)
    p = get_project_for(db, c.project_id, user)
    lines, summary = compute_claim(db, p, c)
    return {"claim": claim_out(c), "summary": summary, "lines": [pl.as_dict() for pl in lines]}


@router.put("/claims/{cid}")
def update_claim(cid: int, body: ClaimIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _claim(db, cid, user, "edit")
    if c.status == "confirmed":
        raise HTTPException(400, "확정된 회차입니다.")
    for k in ("title", "base_date", "is_final", "is_adjustment", "input_mode", "memo"):
        setattr(c, k, getattr(body, k))
    if body.contract_version_id:
        c.contract_version_id = body.contract_version_id
    db.commit()
    return claim_out(c)


@router.put("/claims/{cid}/inputs")
def put_inputs(cid: int, body: ClaimInputs, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """금회 입력 저장. inputs[uid] = {this_qty | cum_qty | rate | this_rate, memo, override_approved}"""
    c = _claim(db, cid, user, "edit")
    p = get_project_for(db, c.project_id, user, "edit")
    try:
        summary = save_inputs(db, p, c, body.inputs)
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit(db, user, "claim.inputs", p.id, target=f"{c.claim_no}회차", after={"count": len(body.inputs), "this_amt": summary.get("this_amt")})
    db.commit()
    lines, summary = compute_claim(db, p, c)
    return {"claim": claim_out(c), "summary": summary, "lines": [pl.as_dict() for pl in lines]}


@router.post("/claims/{cid}/upload-qty")
async def upload_qty(cid: int, file: UploadFile = File(...), mode: str = "this_qty",
                     db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """엑셀 일괄 업로드: 품명/규격/단위 + 수량 열(금회수량 또는 누계수량). 헤더 자동 탐색, 품명+규격+단위로 매칭."""
    c = _claim(db, cid, user, "edit")
    p = get_project_for(db, c.project_id, user, "edit")
    tmp = settings.storage_dir / "work" / f"qty_{cid}_{datetime.utcnow().timestamp()}.xlsx"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(await file.read())
    wb = openpyxl.load_workbook(tmp, data_only=True, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    tmp.unlink(missing_ok=True)
    # 헤더 탐색
    hdr_idx = None
    cols = {}
    for i, row in enumerate(rows[:20]):
        texts = [cell_text(v).replace(" ", "") for v in row]
        for j, t in enumerate(texts):
            if t in ("품명", "명칭", "품목"):
                cols["name"] = j
            elif t == "규격":
                cols["spec"] = j
            elif t == "단위":
                cols["unit"] = j
            elif t in ("금회수량", "금회", "시공수량") and mode == "this_qty":
                cols["qty"] = j
            elif t in ("누계수량", "누계") and mode == "cum_qty":
                cols["qty"] = j
            elif t in ("수량", "기성수량") and "qty" not in cols:
                cols["qty"] = j
            elif t == "uid":
                cols["uid"] = j
        if "name" in cols and "qty" in cols:
            hdr_idx = i
            break
    if hdr_idx is None:
        raise HTTPException(400, "헤더(품명/규격/단위/수량)를 찾지 못했습니다.")
    cv = db.get(ContractVersion, c.contract_version_id)
    key_map = {}
    for it in cv.items:
        if it.row_type == "item":
            key_map.setdefault((it.name.replace(" ", ""), (it.spec or "").replace(" ", ""), (it.unit or "").replace(" ", "")), []).append(it.uid)
    uid_set = {it.uid for it in cv.items}
    inputs = {}
    unmatched = []
    ambiguous = []
    for row in rows[hdr_idx + 1:]:
        name = cell_text(row[cols["name"]]) if cols["name"] < len(row) else ""
        if not name:
            continue
        q = to_decimal(row[cols["qty"]]) if cols["qty"] < len(row) else None
        if q is None:
            continue
        uid = cell_text(row[cols["uid"]]) if "uid" in cols and cols["uid"] < len(row) else ""
        if uid and uid in uid_set:
            inputs[uid] = {mode: str(q)}
            continue
        key = (name.replace(" ", ""), cell_text(row[cols.get("spec", -1)]).replace(" ", "") if "spec" in cols else "",
               cell_text(row[cols.get("unit", -1)]).replace(" ", "") if "unit" in cols else "")
        cands = key_map.get(key) or [u for k, us in key_map.items() if k[0] == key[0] and k[1] == key[1] for u in us]
        if not cands:
            unmatched.append(name)
        elif len(cands) > 1:
            ambiguous.append(name)
            inputs[cands[0]] = {mode: str(q)}   # 첫 번째에 적용하고 경고
        else:
            inputs[cands[0]] = {mode: str(q)}
    summary = save_inputs(db, p, c, inputs)
    audit(db, user, "claim.upload_qty", p.id, target=f"{c.claim_no}회차", after={"matched": len(inputs), "unmatched": len(unmatched)})
    db.commit()
    return {"matched": len(inputs), "unmatched": unmatched[:100], "ambiguous": ambiguous[:100], "summary": summary}


@router.post("/claims/{cid}/confirm")
def confirm(cid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _claim(db, cid, user, "approve")
    p = get_project_for(db, c.project_id, user, "approve")
    try:
        summary = confirm_claim(db, p, c)
    except ValueError as e:
        raise HTTPException(400, str(e))
    c.confirmed_by = user.id
    audit(db, user, "claim.confirm", p.id, target=f"{c.claim_no}회차", after={"this_amt": summary.get("this_amt"), "cum_amt": summary.get("cum_amt")})
    db.commit()
    return claim_out(c)


@router.post("/claims/{cid}/reopen")
def reopen(cid: int, reason: str = "", db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """확정 취소: 이후 회차가 없을 때만, 승인 권한 필요. 이력에 사유 기록."""
    c = _claim(db, cid, user, "approve")
    later = db.query(ProgressClaim).filter(ProgressClaim.project_id == c.project_id, ProgressClaim.claim_no > c.claim_no).count()
    if later:
        raise HTTPException(400, "이후 회차가 존재하여 확정을 취소할 수 없습니다. 정산 회차를 사용하세요.")
    if not reason:
        raise HTTPException(400, "확정 취소 사유를 입력하세요.")
    c.status = "draft"
    c.confirmed_at = None
    audit(db, user, "claim.reopen", c.project_id, target=f"{c.claim_no}회차", reason=reason)
    db.commit()
    return claim_out(c)


@router.delete("/claims/{cid}")
def delete_claim(cid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _claim(db, cid, user, "approve")
    if c.status == "confirmed":
        raise HTTPException(400, "확정된 회차는 삭제할 수 없습니다.")
    audit(db, user, "claim.delete", c.project_id, target=f"{c.claim_no}회차")
    db.delete(c)
    db.commit()
    return {"ok": True}


@router.get("/claims/{cid}/export")
def export_claim(cid: int, mode: str = "standard", keep_sheets: bool = True,
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """mode=standard: 표준양식 / original: 원본 서식 기반"""
    c = _claim(db, cid, user)
    p = get_project_for(db, c.project_id, user)
    lines, summary = compute_claim(db, p, c)
    out_dir = settings.storage_dir / f"project_{p.id}" / "exports"
    out_dir.mkdir(parents=True, exist_ok=True)
    label = "준공정산" if c.is_final else f"{c.claim_no}회기성"
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    cv = db.get(ContractVersion, c.contract_version_id)
    if mode == "original":
        sf = db.get(SourceFile, cv.source_file_id) if cv.source_file_id else None
        if not sf:
            raise HTTPException(400, "원본 파일이 없어 원본 서식 출력을 할 수 없습니다. 표준양식을 사용하세요.")
        sheet_names = sorted({i.sheet for i in cv.items if i.sheet})
        sheet = sheet_names[0]
        ws = db.query(WorkbookSheet).filter_by(file_id=sf.id, name=sheet).first()
        cm = ws.column_map if ws else {}
        if not cm:
            raise HTTPException(400, "원본 시트의 열 매핑 정보가 없습니다.")
        out = out_dir / f"{p.name[:20]}_{label}_원본서식_{stamp}.xlsx"
        sheet_lines = [pl for pl in lines if pl.item.sheet == sheet]
        info = write_original_format(Path(sf.stored_path), out, sheet, cm, cm.get("data_start_row", 1), sheet_lines, label, keep_sheets)
        if len(sheet_names) > 1:
            info["notes"].append(f"내역서 시트가 {len(sheet_names)}개이며 첫 시트({sheet})만 원본서식으로 출력했습니다. 표준양식은 전체를 포함합니다.")
    else:
        cost_lines = db.query(CostRateRule).filter_by(project_id=p.id, version_id=cv.id).order_by(CostRateRule.seq).all()
        out = out_dir / f"{p.name[:20]}_{label}_{stamp}.xlsx"
        write_standard(out, p, c, lines, summary, cost_lines)
    audit(db, user, "claim.export", p.id, target=f"{c.claim_no}회차/{mode}", after={"file": out.name})
    db.commit()
    return FileResponse(out, filename=out.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
