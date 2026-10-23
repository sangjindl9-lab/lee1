"""기성 계산 엔진: 전회·금회·누계·잔여·기성률 (Decimal)."""
from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..models import ContractVersion, EstimateItem, ProgressClaim, ProgressItem, Project
from .calc import D, ZERO, line_amounts, project_rounding, s


@dataclass
class ProgressLine:
    item: EstimateItem
    contract_qty: Decimal
    contract_amt: Decimal
    prev_qty: Decimal = ZERO
    prev_amt: Decimal = ZERO
    prev_mat: Decimal = ZERO
    prev_lab: Decimal = ZERO
    prev_exp: Decimal = ZERO
    this_qty: Decimal = ZERO
    this_mat: Decimal = ZERO
    this_lab: Decimal = ZERO
    this_exp: Decimal = ZERO
    this_amt: Decimal = ZERO
    memo: str = ""
    override_approved: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def cum_qty(self) -> Decimal:
        return self.prev_qty + self.this_qty

    @property
    def cum_amt(self) -> Decimal:
        return self.prev_amt + self.this_amt

    @property
    def remain_qty(self) -> Decimal:
        return self.contract_qty - self.cum_qty

    @property
    def remain_amt(self) -> Decimal:
        return self.contract_amt - self.cum_amt

    @property
    def rate(self) -> Decimal:
        if self.contract_amt == 0:
            return ZERO if self.cum_amt == 0 else Decimal(100)
        return (self.cum_amt / self.contract_amt * 100).quantize(Decimal("0.01"))

    def as_dict(self) -> dict[str, Any]:
        it = self.item
        return {
            "uid": it.uid, "seq": it.seq, "row_type": it.row_type, "level": it.level, "section_path": it.section_path,
            "name": it.name, "spec": it.spec, "unit": it.unit, "note": it.note, "sheet": it.sheet, "source_row": it.source_row,
            "contract_qty": s(self.contract_qty), "contract_price": s(it.tot_price), "contract_amt": s(self.contract_amt),
            "mat_price": s(it.mat_price), "lab_price": s(it.lab_price), "exp_price": s(it.exp_price),
            "prev_qty": s(self.prev_qty), "prev_amt": s(self.prev_amt),
            "this_qty": s(self.this_qty), "this_mat_amt": s(self.this_mat), "this_lab_amt": s(self.this_lab),
            "this_exp_amt": s(self.this_exp), "this_amt": s(self.this_amt),
            "cum_qty": s(self.cum_qty), "cum_amt": s(self.cum_amt),
            "remain_qty": s(self.remain_qty), "remain_amt": s(self.remain_amt), "rate": s(self.rate),
            "memo": self.memo, "override_approved": self.override_approved, "warnings": self.warnings,
        }


def _prev_cumulative(db: Session, project_id: int, claim: ProgressClaim) -> dict[str, dict[str, Decimal]]:
    """이 회차 이전의 확정 회차 누계 (uid별)."""
    prev = (db.query(ProgressClaim).filter(ProgressClaim.project_id == project_id, ProgressClaim.claim_no < claim.claim_no,
                                           ProgressClaim.status == "confirmed").all())
    acc: dict[str, dict[str, Decimal]] = {}
    for pc in prev:
        for pi in pc.items:
            a = acc.setdefault(pi.uid, {"qty": ZERO, "amt": ZERO, "mat": ZERO, "lab": ZERO, "exp": ZERO})
            a["qty"] += D(pi.this_qty)
            a["amt"] += D(pi.this_tot_amt)
            a["mat"] += D(pi.this_mat_amt)
            a["lab"] += D(pi.this_lab_amt)
            a["exp"] += D(pi.this_exp_amt)
    return acc


def compute_claim(db: Session, project: Project, claim: ProgressClaim,
                  inputs: dict[str, dict] | None = None) -> tuple[list[ProgressLine], dict[str, Any]]:
    """claim 의 저장된 입력(또는 inputs 로 덮어쓴 값)으로 전 품목 기성 계산.
    inputs: {uid: {"this_qty"|"cum_qty"|"rate"|"this_rate": value, "memo":..., "override_approved": bool}}"""
    rounding = project_rounding(project)
    version: ContractVersion = db.get(ContractVersion, claim.contract_version_id)
    prev = _prev_cumulative(db, project.id, claim)
    saved = {pi.uid: pi for pi in claim.items}
    lines: list[ProgressLine] = []
    totals = {k: ZERO for k in ("contract_amt", "prev_amt", "this_amt", "this_mat", "this_lab", "this_exp", "cum_amt", "remain_amt")}
    warnings: list[dict] = []
    for it in version.items:
        if it.row_type != "item" or it.is_deleted:
            lines.append(ProgressLine(item=it, contract_qty=ZERO, contract_amt=ZERO))
            continue
        cq = D(it.qty)
        ca = D(it.tot_amt) if it.tot_amt is not None else line_amounts(cq, it.mat_price, it.lab_price, it.exp_price, rounding)["tot_amt"]
        pl = ProgressLine(item=it, contract_qty=cq, contract_amt=ca)
        p = prev.get(it.uid)
        if p:
            pl.prev_qty, pl.prev_amt, pl.prev_mat, pl.prev_lab, pl.prev_exp = p["qty"], p["amt"], p["mat"], p["lab"], p["exp"]
        # 입력값 결정
        this_qty = ZERO
        memo = ""
        override = False
        if saved.get(it.uid):
            sp = saved[it.uid]
            this_qty, memo, override = D(sp.this_qty), sp.memo or "", bool(sp.override_approved)
        inp = (inputs or {}).get(it.uid)
        if inp is not None:
            memo = inp.get("memo", memo)
            override = bool(inp.get("override_approved", override))
            if inp.get("this_qty") is not None:
                this_qty = D(inp["this_qty"])
            elif inp.get("cum_qty") is not None:
                this_qty = D(inp["cum_qty"]) - pl.prev_qty
            elif inp.get("rate") is not None:        # 누계 기성률(%)
                this_qty = (cq * D(inp["rate"]) / 100) - pl.prev_qty
            elif inp.get("this_rate") is not None:   # 금회 기성률(%)
                this_qty = cq * D(inp["this_rate"]) / 100
        qd = int(rounding.get("qty_digits", 4))
        this_qty = this_qty.quantize(Decimal(1).scaleb(-qd))
        pl.this_qty = this_qty
        pl.memo = memo
        pl.override_approved = override
        # 금액: 재료/노무/경비 분리 유지
        if it.mat_price is not None or it.lab_price is not None or it.exp_price is not None:
            am = line_amounts(this_qty, it.mat_price, it.lab_price, it.exp_price, rounding)
            pl.this_mat, pl.this_lab, pl.this_exp, pl.this_amt = am["mat_amt"], am["lab_amt"], am["exp_amt"], am["tot_amt"]
        else:
            am = line_amounts(this_qty, it.tot_price, None, None, rounding)
            pl.this_amt = am["mat_amt"]
            pl.this_mat = am["mat_amt"] if it.cost_region in ("", "mat") else ZERO
            if it.cost_region == "lab":
                pl.this_lab, pl.this_mat = pl.this_amt, ZERO
            elif it.cost_region == "exp":
                pl.this_exp, pl.this_mat = pl.this_amt, ZERO
        # 준공/최종 정산: 잔여 금액 단수 보정 (누계수량 = 계약수량이면 누계금액 = 계약금액)
        if claim.is_final and pl.cum_qty == cq and pl.cum_amt != ca:
            diff = ca - pl.cum_amt
            pl.this_amt += diff
            pl.this_mat += diff
            pl.warnings.append(f"준공 정산 단수 보정 {diff}")
        # 검증
        if this_qty < 0 and not claim.is_adjustment and not override:
            pl.warnings.append("금회 수량이 음수입니다 (정산 회차 또는 승인 필요)")
        if pl.cum_qty > cq and not override:
            pl.warnings.append(f"누계수량 {pl.cum_qty} 이(가) 계약수량 {cq} 을(를) 초과합니다")
        if pl.warnings:
            warnings.append({"uid": it.uid, "name": it.name, "row": it.source_row, "messages": pl.warnings})
        lines.append(pl)
        totals["contract_amt"] += ca
        totals["prev_amt"] += pl.prev_amt
        totals["this_amt"] += pl.this_amt
        totals["this_mat"] += pl.this_mat
        totals["this_lab"] += pl.this_lab
        totals["this_exp"] += pl.this_exp
        totals["cum_amt"] += pl.cum_amt
        totals["remain_amt"] += pl.remain_amt
    rate = (totals["cum_amt"] / totals["contract_amt"] * 100).quantize(Decimal("0.01")) if totals["contract_amt"] else ZERO
    summary = {k: s(v) for k, v in totals.items()}
    summary["cum_rate"] = s(rate)
    summary["warning_count"] = len(warnings)
    summary["warnings"] = warnings[:200]
    # 공종별 집계
    sections: dict[str, dict] = {}
    for pl in lines:
        if pl.item.row_type != "item":
            continue
        key = " > ".join(pl.item.section_path) or "(미분류)"
        sec = sections.setdefault(key, {"section": key, "contract_amt": ZERO, "prev_amt": ZERO, "this_amt": ZERO, "cum_amt": ZERO})
        sec["contract_amt"] += pl.contract_amt
        sec["prev_amt"] += pl.prev_amt
        sec["this_amt"] += pl.this_amt
        sec["cum_amt"] += pl.cum_amt
    summary["sections"] = [{k: (s(v) if isinstance(v, Decimal) else v) for k, v in sec.items()} for sec in sections.values()]
    return lines, summary


def save_inputs(db: Session, project: Project, claim: ProgressClaim, inputs: dict[str, dict]) -> dict[str, Any]:
    if claim.status == "confirmed":
        raise ValueError("확정된 기성 회차는 수정할 수 없습니다.")
    lines, summary = compute_claim(db, project, claim, inputs)
    existing = {pi.uid: pi for pi in claim.items}
    for pl in lines:
        if pl.item.row_type != "item":
            continue
        pi = existing.get(pl.item.uid)
        if pi is None:
            if pl.this_qty == 0 and not pl.memo:
                continue
            pi = ProgressItem(claim_id=claim.id, uid=pl.item.uid)
            claim.items.append(pi)
        pi.this_qty = pl.this_qty
        pi.this_mat_amt, pi.this_lab_amt, pi.this_exp_amt, pi.this_tot_amt = pl.this_mat, pl.this_lab, pl.this_exp, pl.this_amt
        pi.prev_qty, pi.prev_tot_amt = pl.prev_qty, pl.prev_amt
        pi.memo = pl.memo
        pi.override_approved = pl.override_approved
    claim.totals = {k: v for k, v in summary.items() if k not in ("warnings", "sections")}
    db.commit()
    db.refresh(claim)
    return summary


def confirm_claim(db: Session, project: Project, claim: ProgressClaim) -> dict[str, Any]:
    if claim.status == "confirmed":
        raise ValueError("이미 확정된 회차입니다.")
    # 이전 회차가 미확정이면 불가
    open_prev = db.query(ProgressClaim).filter(ProgressClaim.project_id == project.id, ProgressClaim.claim_no < claim.claim_no,
                                               ProgressClaim.status != "confirmed").count()
    if open_prev:
        raise ValueError("이전 회차가 아직 확정되지 않았습니다.")
    lines, summary = compute_claim(db, project, claim)
    blocking = [w for w in summary["warnings"]]
    for pl in lines:
        if pl.warnings and not pl.override_approved:
            raise ValueError(f"검증 경고가 있어 확정할 수 없습니다: {pl.item.name} - {pl.warnings[0]}")
    save_inputs(db, project, claim, {})
    from datetime import datetime
    claim.status = "confirmed"
    claim.confirmed_at = datetime.utcnow()
    db.commit()
    return summary
