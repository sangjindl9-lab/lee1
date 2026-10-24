"""분석 결과 → DB(계약내역 버전/품목/원가 비목/일위대가) 저장."""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from ..excel.analyzer import analyze_file, strip_internal
from ..excel.parser import ROW_ITEM, ROW_SECTION, ROW_SUBTOTAL
from ..models import (ContractVersion, CostRateRule, EstimateItem, PriceTable, Project, SourceFile, UnitPriceAnalysis, WorkbookSheet)
from .calc import D


def run_analysis(db: Session, sf: SourceFile, work_dir: str | None = None) -> dict:
    sf.status = "analyzing"
    db.commit()
    role_over = {ws.name: ws.user_role for ws in sf.sheets if ws.user_role}
    map_over = {ws.name: ws.user_column_map for ws in sf.sheets if ws.user_column_map}
    try:
        result = analyze_file(sf.stored_path, work_dir, role_overrides=role_over or None, mapping_overrides=map_over or None)
    except Exception as e:  # noqa: BLE001
        sf.status = "error"
        sf.error = str(e)
        db.commit()
        raise
    sf.analysis = strip_internal(result)
    sf.status = "analyzed"
    sf.error = ""
    # 시트 레코드 갱신
    existing = {ws.name: ws for ws in sf.sheets}
    for r in result["roles"]:
        ws = existing.get(r["sheet"])
        if not ws:
            ws = WorkbookSheet(file_id=sf.id, name=r["sheet"])
            db.add(ws)
        ws.index = next((s["index"] for s in result["file"]["sheets"] if s["name"] == r["sheet"]), 0)
        ws.role = r["role"]
        ws.role_confidence = r["confidence"]
        ws.hidden = next((s["hidden"] for s in result["file"]["sheets"] if s["name"] == r["sheet"]), False)
        ws.column_map = result["column_maps"].get(r["sheet"], {})
        ws.stats = result["validations"].get(r["sheet"], {})
    db.commit()
    return result


def import_contract(db: Session, project: Project, sf: SourceFile, result: dict, label: str = "최초계약",
                    include_sheets: list[str] | None = None, version_no: int | None = None) -> ContractVersion:
    """분석된 내역서를 계약내역 버전으로 저장. 기존 draft 버전(동일 파일)은 교체."""
    sheets = include_sheets or result["estimate_sheets"]
    parsed = result["_parsed"]
    if version_no is None:
        last = db.query(ContractVersion).filter_by(project_id=project.id).order_by(ContractVersion.version_no.desc()).first()
        version_no = 0 if last is None else (last.version_no if last.status == "draft" and last.version_no == 0 else last.version_no + 1)
    # 동일 version_no draft 가 있으면 교체
    old = db.query(ContractVersion).filter_by(project_id=project.id, version_no=version_no).first()
    if old and old.status == "draft":
        db.delete(old)
        db.flush()
    elif old:
        raise ValueError(f"버전 {version_no}은 이미 확정되어 교체할 수 없습니다.")
    cv = ContractVersion(project_id=project.id, version_no=version_no, label=label, source_file_id=sf.id, status="draft")
    db.add(cv)
    db.flush()
    seq = 0
    totals = {k: Decimal(0) for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")}
    for sname in sheets:
        ps = parsed[sname]
        # 시트가 여러 개면 시트명을 최상위 공종으로 붙인다 (경로 충돌 방지)
        prefix = [] if len(sheets) == 1 else [sname]
        for it in ps.items:
            if it.row_type not in (ROW_ITEM, ROW_SECTION, ROW_SUBTOTAL):
                continue
            if it.row_type == ROW_SUBTOTAL:
                continue   # 소계는 계산으로 재생성
            seq += 1
            ref = ""
            for v in (it.note, *it.price_source.values()):
                if v and ("호" in v or "일대" in v or "일위" in v):
                    ref = it.note if ("호" in it.note) else v
                    break
            ei = EstimateItem(
                version_id=cv.id, uid=it.uid, seq=seq, row_type=it.row_type, level=it.level + len(prefix),
                section_path=prefix + it.section_path, sheet=sname, source_row=it.row,
                work_code=it.work_code, item_code=it.item_code, code=it.code, name=it.name, spec=it.spec, unit=it.unit,
                qty=it.qty, mat_price=it.mat_price, mat_amt=it.mat_amt, lab_price=it.lab_price, lab_amt=it.lab_amt,
                exp_price=it.exp_price, exp_amt=it.exp_amt, tot_price=it.tot_price, tot_amt=it.tot_amt,
                note=it.note, unit_price_ref=ref, price_source=it.price_source, cost_region=it.cost_region, issues=it.issues,
            )
            db.add(ei)
            if it.row_type == ROW_ITEM:
                for k in totals:
                    v = getattr(it, k)
                    if v is not None:
                        totals[k] += v
    cv.totals = {k: str(v) for k, v in totals.items()}
    if project.contract_amount in (None, 0):
        project.contract_amount = totals["tot_amt"]
    # 반올림 규칙: 원본에서 감지한 값을 현장 기본값으로
    if not project.rounding:
        rr = parsed[sheets[0]].rounding
        amt_rule = rr.get("mat_amt") or rr.get("tot_amt")
        project.rounding = {"amount": amt_rule.as_dict() if amt_rule else {"func": "trunc", "digits": 0}, "qty_digits": 4}
    # 원가 비목
    cost = result["cost_sheets"].get(result["primary_cost_sheet"]) if result.get("primary_cost_sheet") else None
    if cost:
        from .costcalc import ALWAYS_FIXED_WORDS as FIXED_WORDS
        any_formula = any(l["formula"] for l in cost["lines"])
        for i, line in enumerate(cost["lines"]):
            n = line["name"].replace(" ", "")
            fixed = False
            if line["rate"] is not None and line["amount"] is not None and line["kind"] == "line":
                # 고정(정산) 비목은 국민연금·노인장기요양·퇴직공제·안전관리비만. 나머지 요율 비목은 직접비 변동에 따라 재계산
                fixed = any(w in n for w in FIXED_WORDS)
            db.add(CostRateRule(project_id=project.id, version_id=cv.id, seq=i, name=line["name"], kind=line["kind"], fixed=fixed,
                                round_digits=line.get("round_digits", 0),
                                rate=D(line["rate"]) if line["rate"] is not None else None, rate_base=line["rate_base"],
                                base_text=line["base_text"], amount=D(line["amount"]) if line["amount"] is not None else None,
                                source=f"원본 {cost['sheet']} 시트", sheet=cost["sheet"], source_row=line["row"], amount_col=cost["amount_col"]))
    # 자재단가 / 노임 / 참조 표 (같은 파일 것은 교체)
    db.query(PriceTable).filter_by(project_id=project.id, source_file_id=sf.id).delete()
    for sname, t in result.get("_price_tables", {}).items():
        db.add(PriceTable(project_id=project.id, source_file_id=sf.id, sheet=sname, kind=t["kind"], title=t.get("title", ""),
                          name_key=t.get("name_key", ""), columns=t["columns"], rows=t["rows"], groups=t["groups"], row_count=len(t["rows"])))
    # 일위대가
    for sname, groups in result.get("_unit_prices", {}).items():
        for g in groups:
            db.add(UnitPriceAnalysis(project_id=project.id, source_file_id=sf.id, sheet=sname, no=g["no"], title=g["title"],
                                     components=g["components"], total=g["total"]))
    db.commit()
    return cv
