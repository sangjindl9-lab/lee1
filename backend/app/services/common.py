"""감사로그, 문서번호 채번, 알림, 낙관적 잠금 공통 처리."""
import re
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..models import AuditLog, Company, DocSequence, Notification
from ..permissions import DEFAULT_COMPANY_SETTINGS
from ..security import Ctx
from ..util import s, today_kst


def jsonable(v):
    if isinstance(v, Decimal):
        return s(v)
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return v


def row_dict(obj, exclude: tuple = ()) -> dict:
    return {c.name: jsonable(getattr(obj, c.key if hasattr(c, "key") else c.name))
            for c in obj.__table__.columns if c.name not in exclude}


def audit(ctx: Ctx, action: str, entity: str, entity_id: int | None, summary: str = "",
          before: dict | None = None, after: dict | None = None, project_id: int | None = None) -> None:
    ctx.db.add(AuditLog(company_id=ctx.company_id, user_id=ctx.user.id, action=action, entity=entity,
                        entity_id=entity_id, project_id=project_id, summary=summary[:500],
                        before=jsonable(before) if before else None, after=jsonable(after) if after else None,
                        ip=ctx.ip))


def company_settings(db: Session, company_id: int) -> dict:
    c = db.get(Company, company_id)
    merged = dict(DEFAULT_COMPANY_SETTINGS)
    merged.update(c.settings or {})
    merged["doc_formats"] = {**DEFAULT_COMPANY_SETTINGS["doc_formats"], **(c.settings or {}).get("doc_formats", {})}
    return merged


def next_doc_no(db: Session, company_id: int, kind: str, project_code: str = "", on: date | None = None) -> str:
    """문서번호 채번. {YYYY}{MM}{DD}{PROJECT}{SEQ:n} 토큰 지원. 행 잠금으로 중복 번호 방지."""
    on = on or today_kst()
    fmt = company_settings(db, company_id)["doc_formats"].get(kind, kind + "-{YYYY}-{SEQ:5}")
    period = on.strftime("%Y%m") if "{MM}" in fmt else on.strftime("%Y")
    if "{DD}" in fmt:
        period = on.strftime("%Y%m%d")
    seq = None
    if "{SEQ" in fmt:
        stmt = pg_insert(DocSequence).values(company_id=company_id, kind=kind, period=period, last_no=1)
        stmt = stmt.on_conflict_do_update(index_elements=["company_id", "kind", "period"],
                                          set_={"last_no": DocSequence.last_no + 1}).returning(DocSequence.last_no)
        seq = db.execute(stmt).scalar_one()
    out = fmt.replace("{YYYY}", on.strftime("%Y")).replace("{YY}", on.strftime("%y")) \
             .replace("{MM}", on.strftime("%m")).replace("{DD}", on.strftime("%d")).replace("{PROJECT}", project_code)
    out = re.sub(r"\{SEQ(?::(\d+))?\}", lambda m: str(seq).zfill(int(m.group(1) or 1)), out)
    return out


def notify(db: Session, company_id: int, user_ids, kind: str, title: str, link: str | None = None) -> None:
    for uid in set(u for u in user_ids if u):
        db.add(Notification(company_id=company_id, user_id=uid, kind=kind, title=title[:300], link=link))


def check_version(obj, version) -> None:
    if version is None:
        return
    if int(version) != obj.version:
        raise HTTPException(409, "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 확인하세요.")


def bump(obj) -> None:
    obj.version = (obj.version or 0) + 1


def get_owned(db: Session, model, obj_id: int, company_id: int, what: str = "자료"):
    obj = db.get(model, obj_id)
    if not obj or getattr(obj, "company_id", None) != company_id or getattr(obj, "deleted_at", None):
        raise HTTPException(404, f"{what}을(를) 찾을 수 없습니다.")
    return obj


def lock(db: Session, model, obj_id: int):
    return db.execute(select(model).where(model.id == obj_id).with_for_update()).scalar_one_or_none()
