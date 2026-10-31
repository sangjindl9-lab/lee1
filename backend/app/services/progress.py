"""공정률 계산.

규칙
- 항목 실적공정률 = 기준일까지 승인된 누계 시공수량 ÷ 설계수량 × 100
- 설계수량 0 → 계산 불가(None), 전체 공정률에서 제외
- 단위가 다른 수량은 합산하지 않음: 전체는 항목 공정률(100% 상한)의 가중평균
- 가중치: amount(설계금액) 또는 custom(사용자 지정)
- 계획공정률: 기간별 계획 누계수량(BoqPlan)이 있으면 그 값, 없으면 계획 시작~종료일 균등 배분
"""
from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import BoqItem, BoqPlan, Project, ProgressEntry
from ..util import q_rate, s

HUNDRED = Decimal("100")


def actual_cum_by_item(db: Session, project_id: int, upto: date, exclude_report_id: int | None = None,
                       strictly_before: bool = False) -> dict[int, Decimal]:
    cond = [ProgressEntry.project_id == project_id,
            ProgressEntry.work_date < upto if strictly_before else ProgressEntry.work_date <= upto]
    if exclude_report_id:
        cond.append(ProgressEntry.report_id != exclude_report_id)
    rows = db.execute(select(ProgressEntry.boq_item_id, func.sum(ProgressEntry.qty))
                      .where(*cond).group_by(ProgressEntry.boq_item_id)).all()
    return {r[0]: Decimal(r[1]) for r in rows}


def planned_qty(item: BoqItem, plans: list[BoqPlan], basis: date) -> Decimal | None:
    if plans:
        best = None
        for p in plans:
            if p.plan_date <= basis and (best is None or p.plan_date > best.plan_date):
                best = p
        return Decimal(best.planned_cum_qty) if best else Decimal(0)
    if item.plan_start and item.plan_end and item.plan_end >= item.plan_start:
        if basis < item.plan_start:
            return Decimal(0)
        if basis >= item.plan_end:
            return Decimal(item.design_qty)
        total_days = (item.plan_end - item.plan_start).days + 1
        done_days = (basis - item.plan_start).days + 1
        return Decimal(item.design_qty) * Decimal(done_days) / Decimal(total_days)
    return None


def item_rate(cum: Decimal, design: Decimal) -> Decimal | None:
    if design is None or Decimal(design) == 0:
        return None
    return cum / Decimal(design) * HUNDRED


def compute_project_progress(db: Session, project: Project, basis: date) -> dict:
    items = db.execute(select(BoqItem).where(BoqItem.project_id == project.id, BoqItem.deleted_at.is_(None))
                       .order_by(BoqItem.group_id, BoqItem.sort, BoqItem.id)).scalars().all()
    cum = actual_cum_by_item(db, project.id, basis)
    plan_rows = db.execute(select(BoqPlan).where(BoqPlan.boq_item_id.in_([i.id for i in items] or [0]))).scalars().all()
    plans: dict[int, list[BoqPlan]] = defaultdict(list)
    for p in plan_rows:
        plans[p.boq_item_id].append(p)

    method = project.progress_method
    out_items = []
    w_total = Decimal(0)
    w_actual = Decimal(0)
    w_plan = Decimal(0)
    excluded: list[dict] = []
    no_plan = 0
    for it in items:
        c = cum.get(it.id, Decimal(0))
        design = Decimal(it.design_qty)
        r = item_rate(c, design)
        capped = min(r, HUNDRED) if r is not None else None
        pq = planned_qty(it, plans.get(it.id, []), basis)
        pr = item_rate(pq, design) if pq is not None else None
        weight = Decimal(it.amount) if method == "amount" else Decimal(it.custom_weight or 0)
        reason = None
        if not it.include_in_progress:
            reason = "공정률 미반영 설정"
        elif r is None:
            reason = "설계수량 0 (계산 불가)"
        elif weight <= 0:
            reason = "가중치 0" if method == "custom" else "설계금액 0"
        if reason:
            excluded.append({"id": it.id, "name": it.name, "reason": reason})
        else:
            w_total += weight
            w_actual += weight * capped
            if pr is None:
                no_plan += 1
            else:
                w_plan += weight * min(pr, HUNDRED)
        out_items.append({
            "id": it.id, "group_id": it.group_id, "name": it.name, "spec": it.spec, "unit": it.unit,
            "design_qty": s(design), "cum_qty": s(c), "remaining_qty": s(design - c),
            "over_qty": s(c - design) if c > design else None,
            "rate": s(q_rate(r)) if r is not None else None,
            "rate_capped": s(q_rate(capped)) if capped is not None else None,
            "plan_qty": s(pq.quantize(Decimal("0.001"))) if pq is not None else None,
            "plan_rate": s(q_rate(min(pr, HUNDRED))) if pr is not None else None,
            "weight": s(weight), "included": reason is None, "excluded_reason": reason,
            "plan_start": it.plan_start.isoformat() if it.plan_start else None,
            "plan_end": it.plan_end.isoformat() if it.plan_end else None,
        })
    for oi in out_items:
        oi["weight_share"] = s(q_rate(Decimal(oi["weight"]) / w_total * HUNDRED)) if oi["included"] and w_total else None
    actual = q_rate(w_actual / w_total) if w_total else None
    planned = q_rate(w_plan / w_total) if w_total else None
    return {
        "basis_date": basis.isoformat(),
        "method": method,
        "method_label": "설계금액 가중" if method == "amount" else "사용자 지정 가중",
        "actual_rate": s(actual) if actual is not None else None,
        "plan_rate": s(planned) if planned is not None else None,
        "deviation": s(actual - planned) if actual is not None and planned is not None else None,
        "items": out_items,
        "excluded": excluded,
        "no_plan_count": no_plan,
        "basis_note": ("항목별 공정률(100% 상한)을 "
                       + ("설계금액" if method == "amount" else "사용자 지정 가중치")
                       + " 비율로 가중평균. 승인된 작업일보 수량만 반영. "
                       + (f"계획 미입력 {no_plan}개 항목은 계획 0%로 계산." if no_plan else "")),
    }
