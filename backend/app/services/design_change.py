"""설계변경: 당초·변경·증감 계산, 승인 시 새 계약내역 버전 생성."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..models import ContractVersion, CostRateRule, DesignChange, DesignChangeItem, EstimateItem, Project, ProgressClaim
from .calc import D, ZERO, line_amounts, project_rounding, s

PRICE_TYPES = {
    "contract": "기존 계약단가", "estimate": "예정가격단가", "current": "설계변경 당시 산정단가",
    "bid_rate": "낙찰률 적용단가", "negotiated": "협의단가", "new_unit_price": "신규 일위대가 단가", "user": "사용자 승인단가",
}


@dataclass
class ChangeLine:
    uid: str
    item: EstimateItem | None
    action: str                       # keep / modify / add / delete
    section_path: list[str]
    name: str
    spec: str
    unit: str
    orig: dict[str, Decimal] = field(default_factory=dict)
    chg: dict[str, Decimal] = field(default_factory=dict)
    price_type: str = "contract"
    price_basis: str = ""
    reason: str = ""
    warnings: list[str] = field(default_factory=list)
    seq: int = 0
    row_type: str = "item"
    progress_qty: Decimal = ZERO       # 기존 인정 기성수량

    @property
    def diff(self) -> dict[str, Decimal]:
        return {k: self.chg.get(k, ZERO) - self.orig.get(k, ZERO) for k in ("qty", "mat_price", "lab_price", "exp_price", "tot_price", "mat_amt", "lab_amt", "exp_amt", "tot_amt")}

    def as_dict(self) -> dict[str, Any]:
        return {"uid": self.uid, "seq": self.seq, "row_type": self.row_type, "action": self.action, "section_path": self.section_path,
                "name": self.name, "spec": self.spec, "unit": self.unit,
                "orig": {k: s(v) for k, v in self.orig.items()}, "chg": {k: s(v) for k, v in self.chg.items()},
                "diff": {k: s(v) for k, v in self.diff.items()}, "price_type": self.price_type, "price_type_label": PRICE_TYPES.get(self.price_type, self.price_type),
                "price_basis": self.price_basis, "reason": self.reason, "warnings": self.warnings,
                "progress_qty": s(self.progress_qty), "remaining_after": s(self.chg.get("qty", ZERO) - self.progress_qty)}


def _amounts(it_like: dict, rounding) -> dict[str, Decimal]:
    qty = D(it_like.get("qty"))
    am = line_amounts(qty, it_like.get("mat_price"), it_like.get("lab_price"), it_like.get("exp_price"), rounding)
    return {"qty": qty, "mat_price": D(it_like.get("mat_price")), "lab_price": D(it_like.get("lab_price")), "exp_price": D(it_like.get("exp_price")),
            "tot_price": D(it_like.get("mat_price")) + D(it_like.get("lab_price")) + D(it_like.get("exp_price")), **am}


def _orig_dict(it: EstimateItem, rounding) -> dict[str, Decimal]:
    d = {"qty": D(it.qty), "mat_price": D(it.mat_price), "lab_price": D(it.lab_price), "exp_price": D(it.exp_price),
         "tot_price": D(it.tot_price) if it.tot_price is not None else D(it.mat_price) + D(it.lab_price) + D(it.exp_price),
         "mat_amt": D(it.mat_amt), "lab_amt": D(it.lab_amt), "exp_amt": D(it.exp_amt), "tot_amt": D(it.tot_amt)}
    if it.tot_amt is None:
        am = line_amounts(d["qty"], it.mat_price, it.lab_price, it.exp_price, rounding)
        d.update(am)
    return d


def _progress_by_uid(db: Session, project_id: int) -> dict[str, Decimal]:
    acc: dict[str, Decimal] = {}
    for c in db.query(ProgressClaim).filter_by(project_id=project_id, status="confirmed"):
        for pi in c.items:
            acc[pi.uid] = acc.get(pi.uid, ZERO) + D(pi.this_qty)
    return acc


def compute_change(db: Session, project: Project, dc: DesignChange) -> tuple[list[ChangeLine], dict[str, Any]]:
    rounding = project_rounding(project)
    base: ContractVersion = db.get(ContractVersion, dc.base_version_id)
    ops: dict[str, list[DesignChangeItem]] = {}
    adds: list[DesignChangeItem] = []
    for ci in dc.items:
        if ci.action == "add":
            adds.append(ci)
        else:
            ops.setdefault(ci.uid, []).append(ci)
    progress = _progress_by_uid(db, project.id)
    lines: list[ChangeLine] = []
    seq = 0
    # 신규 품목 삽입 위치: after_uid 또는 섹션 끝
    adds_after: dict[str, list[DesignChangeItem]] = {}
    adds_section_end: dict[str, list[DesignChangeItem]] = {}
    for a in adds:
        ni = a.new_item or {}
        if ni.get("after_uid"):
            adds_after.setdefault(ni["after_uid"], []).append(a)
        else:
            adds_section_end.setdefault(" > ".join(ni.get("section_path") or []), []).append(a)

    def add_line(a: DesignChangeItem):
        nonlocal seq
        seq += 1
        ni = a.new_item or {}
        chg = _amounts({"qty": a.new_qty, "mat_price": a.new_mat_price, "lab_price": a.new_lab_price, "exp_price": a.new_exp_price}, rounding)
        cl = ChangeLine(uid=a.uid or f"new{a.id}", item=None, action="add", section_path=ni.get("section_path") or [],
                        name=ni.get("name", ""), spec=ni.get("spec", ""), unit=ni.get("unit", ""),
                        orig={k: ZERO for k in chg}, chg=chg, price_type=a.price_type, price_basis=a.price_basis, reason=a.reason, seq=seq)
        if not a.price_basis and a.price_type != "contract":
            cl.warnings.append("신규 단가 산정 근거가 없습니다")
        if a.price_type == "contract":
            cl.warnings.append("신규 품목은 기존 계약단가를 가질 수 없습니다 - 단가 유형을 지정하세요")
        lines.append(cl)

    cur_section_key = ""
    for it in base.items:
        if it.row_type == "section":
            # 이전 섹션 끝에 신규 삽입
            for a in adds_section_end.pop(cur_section_key, []):
                add_line(a)
            cur_section_key = " > ".join(it.section_path)
            seq += 1
            lines.append(ChangeLine(uid=it.uid, item=it, action="keep", section_path=it.section_path, name=it.name, spec="", unit="",
                                    seq=seq, row_type="section"))
            continue
        if it.row_type != "item":
            continue
        seq += 1
        orig = _orig_dict(it, rounding)
        cl = ChangeLine(uid=it.uid, item=it, action="keep", section_path=it.section_path, name=it.name, spec=it.spec, unit=it.unit,
                        orig=orig, chg=dict(orig), seq=seq, progress_qty=progress.get(it.uid, ZERO))
        if it.is_deleted:
            cl.action = "delete"
            cl.orig = {k: ZERO for k in orig}
            cl.chg = {k: ZERO for k in orig}
        for op in ops.get(it.uid, []):
            cl.price_type, cl.price_basis, cl.reason = op.price_type, op.price_basis, op.reason
            if op.action == "delete":
                cl.action = "delete"
                cl.chg = _amounts({"qty": 0, "mat_price": orig["mat_price"], "lab_price": orig["lab_price"], "exp_price": orig["exp_price"]}, rounding)
                if cl.progress_qty > 0:
                    cl.warnings.append(f"이미 기성 인정된 수량 {cl.progress_qty} 이 있어 삭제할 수 없습니다 (수량을 기성수량으로 변경하세요)")
            else:
                new = {"qty": op.new_qty if op.new_qty is not None else orig["qty"],
                       "mat_price": op.new_mat_price if op.new_mat_price is not None else orig["mat_price"],
                       "lab_price": op.new_lab_price if op.new_lab_price is not None else orig["lab_price"],
                       "exp_price": op.new_exp_price if op.new_exp_price is not None else orig["exp_price"]}
                cl.chg = _amounts(new, rounding)
                cl.action = "modify" if any(cl.chg[k] != orig[k] for k in ("qty", "mat_price", "lab_price", "exp_price")) else "keep"
                if op.action == "spec_change" and op.new_item:
                    cl.action = "modify"
                    cl.spec = op.new_item.get("spec", cl.spec)
                    cl.unit = op.new_item.get("unit", cl.unit)
                    cl.name = op.new_item.get("name", cl.name)
                price_changed = any(cl.chg[k] != orig[k] for k in ("mat_price", "lab_price", "exp_price"))
                if price_changed and op.price_type == "contract":
                    cl.warnings.append("단가가 변경되었으나 단가 유형이 '기존 계약단가'입니다 - 적용단가 유형과 근거를 지정하세요")
                if price_changed and not op.price_basis:
                    cl.warnings.append("단가 변경 근거가 없습니다")
                if cl.chg["qty"] < cl.progress_qty:
                    cl.warnings.append(f"변경수량 {cl.chg['qty']} 이 기성 인정수량 {cl.progress_qty} 보다 작습니다")
        lines.append(cl)
        for a in adds_after.pop(it.uid, []):
            add_line(a)
    for a in adds_section_end.pop(cur_section_key, []):
        add_line(a)
    for key, rest in adds_section_end.items():   # 매칭 안 된 섹션의 신규 → 끝에
        if rest:
            seq += 1
            lines.append(ChangeLine(uid=f"sec-{hashlib.md5(key.encode()).hexdigest()[:8]}", item=None, action="add", section_path=key.split(" > ") if key else ["신규 공종"],
                                    name=key or "신규 공종", spec="", unit="", seq=seq, row_type="section"))
            for a in rest:
                add_line(a)
    for uid, rest in adds_after.items():
        for a in rest:
            add_line(a)

    keys = ("mat_amt", "lab_amt", "exp_amt", "tot_amt")
    tot = {"orig": {k: ZERO for k in keys}, "chg": {k: ZERO for k in keys}}
    sections: dict[str, dict] = {}
    for cl in lines:
        if cl.row_type != "item":
            continue
        for k in keys:
            tot["orig"][k] += cl.orig.get(k, ZERO)
            tot["chg"][k] += cl.chg.get(k, ZERO)
        sk = " > ".join(cl.section_path) or "(미분류)"
        sec = sections.setdefault(sk, {"section": sk, "orig": ZERO, "chg": ZERO})
        sec["orig"] += cl.orig.get("tot_amt", ZERO)
        sec["chg"] += cl.chg.get("tot_amt", ZERO)
    summary = {
        "orig": {k: s(v) for k, v in tot["orig"].items()}, "chg": {k: s(v) for k, v in tot["chg"].items()},
        "diff": {k: s(tot["chg"][k] - tot["orig"][k]) for k in keys},
        "counts": {"modify": sum(1 for l in lines if l.action == "modify"), "add": sum(1 for l in lines if l.action == "add" and l.row_type == "item"),
                   "delete": sum(1 for l in lines if l.action == "delete"), "keep": sum(1 for l in lines if l.action == "keep" and l.row_type == "item")},
        "warnings": [{"uid": l.uid, "name": l.name, "messages": l.warnings} for l in lines if l.warnings],
        "sections": [{"section": v["section"], "orig": s(v["orig"]), "chg": s(v["chg"]), "diff": s(v["chg"] - v["orig"])} for v in sections.values()],
    }
    # 원가계산서 당초/변경
    rules = db.query(CostRateRule).filter_by(project_id=project.id, version_id=base.id).order_by(CostRateRule.seq).all()
    if rules:
        from .costcalc import compute_cost_sheet
        rr = rounding.get("amount")
        co = compute_cost_sheet(rules, {"mat": tot["orig"]["mat_amt"], "lab": tot["orig"]["lab_amt"], "exp": tot["orig"]["exp_amt"]}, rr)
        cc = compute_cost_sheet(rules, {"mat": tot["chg"]["mat_amt"], "lab": tot["chg"]["lab_amt"], "exp": tot["chg"]["exp_amt"]}, rr)
        summary["cost_sheet"] = [{"name": a["name"], "kind": a["kind"], "rate": a["rate"], "rate_base": a["rate_base"], "base_text": a["base_text"], "fixed": a["fixed"],
                                  "original_amount": a["original_amount"], "orig": a["amount"], "chg": b["amount"],
                                  "diff": s(D(b["amount"]) - D(a["amount"])) if a["amount"] is not None and b["amount"] is not None else None}
                                 for a, b in zip(co, cc)]
    return lines, summary


def approve_change(db: Session, project: Project, dc: DesignChange, user_id: int | None) -> ContractVersion:
    if dc.status == "approved":
        raise ValueError("이미 승인된 설계변경입니다.")
    lines, summary = compute_change(db, project, dc)
    blocking = [w for w in summary["warnings"]]
    if blocking:
        raise ValueError(f"해결되지 않은 경고가 {len(blocking)}건 있습니다: {blocking[0]['name']} - {blocking[0]['messages'][0]}")
    base: ContractVersion = db.get(ContractVersion, dc.base_version_id)
    last = db.query(ContractVersion).filter_by(project_id=project.id).order_by(ContractVersion.version_no.desc()).first()
    nv = ContractVersion(project_id=project.id, version_no=last.version_no + 1, label=f"{dc.change_no}차 설계변경",
                         source_file_id=base.source_file_id, design_change_id=dc.id, status="approved", approved_at=datetime.utcnow())
    db.add(nv)
    db.flush()
    seq = 0
    tot = {k: ZERO for k in ("mat_amt", "lab_amt", "exp_amt", "tot_amt")}
    for cl in lines:
        seq += 1
        src = cl.item
        if cl.row_type == "section":
            db.add(EstimateItem(version_id=nv.id, uid=cl.uid, seq=seq, row_type="section", level=len(cl.section_path),
                                section_path=cl.section_path, sheet=src.sheet if src else "", source_row=src.source_row if src else None, name=cl.name))
            continue
        ei = EstimateItem(
            version_id=nv.id, uid=cl.uid, seq=seq, row_type="item", level=len(cl.section_path) + 1, section_path=cl.section_path,
            sheet=src.sheet if src else "", source_row=src.source_row if src else None,
            work_code=src.work_code if src else "", item_code=src.item_code if src else "", code=src.code if src else "",
            name=cl.name, spec=cl.spec, unit=cl.unit, qty=cl.chg["qty"],
            mat_price=cl.chg["mat_price"], mat_amt=cl.chg["mat_amt"], lab_price=cl.chg["lab_price"], lab_amt=cl.chg["lab_amt"],
            exp_price=cl.chg["exp_price"], exp_amt=cl.chg["exp_amt"], tot_price=cl.chg["tot_price"], tot_amt=cl.chg["tot_amt"],
            note=(src.note if src else "") or "", unit_price_ref=src.unit_price_ref if src else "",
            price_source={"price_type": cl.price_type, "basis": cl.price_basis, "change_no": dc.change_no} if cl.action in ("modify", "add") else (src.price_source if src else {}),
            cost_region=src.cost_region if src else "", is_new=cl.action == "add" or (src.is_new if src else False),
            is_deleted=cl.action == "delete",
        )
        db.add(ei)
        if not ei.is_deleted:
            for k in tot:
                tot[k] += cl.chg.get(k, ZERO)
    nv.totals = {k: s(v) for k, v in tot.items()}
    # 원가 비목 복사 (변경 금액 반영)
    if summary.get("cost_sheet"):
        rules = db.query(CostRateRule).filter_by(project_id=project.id, version_id=base.id).order_by(CostRateRule.seq).all()
        for r, cs in zip(rules, summary["cost_sheet"]):
            db.add(CostRateRule(project_id=project.id, version_id=nv.id, seq=r.seq, name=r.name, kind=r.kind, rate=r.rate,
                                rate_base=r.rate_base, base_text=r.base_text, amount=D(cs["chg"]) if cs["chg"] is not None else r.amount,
                                fixed=r.fixed, source=r.source, effective_date=r.effective_date))
    dc.status = "approved"
    dc.approved_at = datetime.utcnow()
    dc.result_version_id = nv.id
    dc.totals = {k: v for k, v in summary.items() if k in ("orig", "chg", "diff", "counts")}
    db.commit()
    return nv
