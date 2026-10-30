from __future__ import annotations

import re
import zoneinfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...audit import audit
from ...models import Camera, Driver, Site
from ...security.netguard import TargetDenied, validate_network_list
from ..deps import Principal, active_principal, client_ip, get_db, require, require_superadmin

router = APIRouter(prefix="/api", tags=["sites"])
_CODE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


class SiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=40)
    timezone: str = "Asia/Seoul"
    allowed_networks: list[str] = []
    description: str = Field(default="", max_length=2000)


class SitePatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    timezone: str | None = None
    allowed_networks: list[str] | None = None
    description: str | None = Field(default=None, max_length=2000)


def site_out(s: Site, camera_count: int | None = None) -> dict:
    return {"id": s.id, "name": s.name, "code": s.code, "timezone": s.timezone,
            "allowed_networks": [str(n) for n in s.allowed_networks], "description": s.description,
            "camera_count": camera_count}


def _tz(tz: str) -> str:
    try:
        zoneinfo.ZoneInfo(tz)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"알 수 없는 시간대: {tz}") from exc
    return tz


def _nets(v: list[str]) -> list[str]:
    try:
        return validate_network_list(v)
    except TargetDenied as exc:
        raise HTTPException(400, exc.message) from exc


@router.get("/sites")
def list_sites(p: Principal = Depends(active_principal), db: Session = Depends(get_db)):
    q = select(Site).order_by(Site.name)
    counts = dict(db.execute(select(Camera.site_id, func.count()).where(Camera.deleted_at.is_(None))
                             .group_by(Camera.site_id)).all())
    return {"items": [site_out(s, counts.get(s.id, 0)) for s in db.scalars(q) if p.can_site(s.id)]}


@router.post("/sites")
def create_site(body: SiteIn, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    if not _CODE.match(body.code):
        raise HTTPException(400, "현장 코드는 영문·숫자·_- 만 사용할 수 있습니다.")
    if db.scalar(select(Site).where(Site.code == body.code)):
        raise HTTPException(409, "이미 사용 중인 현장 코드입니다.")
    s = Site(name=body.name, code=body.code, timezone=_tz(body.timezone),
             allowed_networks=_nets(body.allowed_networks), description=body.description)
    db.add(s)
    db.flush()
    audit(db, action="site.create", user=p.user, ip=client_ip(request), target_type="site", target_id=s.id,
          details={"name": s.name, "allowed_networks": s.allowed_networks})
    db.commit()
    return site_out(s, 0)


@router.patch("/sites/{site_id}")
def update_site(site_id: int, body: SitePatch, request: Request, p: Principal = Depends(require("settings")),
                db: Session = Depends(get_db)):
    s = db.get(Site, site_id)
    if not s or not p.can_site(site_id):
        raise HTTPException(404, "현장을 찾을 수 없습니다.")
    changes = {}
    if body.name is not None:
        s.name = body.name
        changes["name"] = body.name
    if body.timezone is not None:
        s.timezone = _tz(body.timezone)
        changes["timezone"] = body.timezone
    if body.allowed_networks is not None:
        # 허용망은 SSRF 경계이므로 최고관리자만 변경
        if not p.is_superadmin:
            raise HTTPException(403, "허용 네트워크는 최고관리자만 변경할 수 있습니다.")
        s.allowed_networks = _nets(body.allowed_networks)
        changes["allowed_networks"] = s.allowed_networks
    if body.description is not None:
        s.description = body.description
    audit(db, action="site.update", user=p.user, ip=client_ip(request), target_type="site", target_id=s.id,
          details=changes)
    db.commit()
    return site_out(s)


@router.delete("/sites/{site_id}")
def delete_site(site_id: int, request: Request, p: Principal = Depends(require_superadmin), db: Session = Depends(get_db)):
    s = db.get(Site, site_id)
    if not s:
        raise HTTPException(404, "현장을 찾을 수 없습니다.")
    n = db.scalar(select(func.count()).select_from(Camera).where(Camera.site_id == site_id)) or 0
    if n:
        raise HTTPException(409, "카메라(삭제된 카메라의 녹화 포함)가 남아 있는 현장은 삭제할 수 없습니다.")
    db.delete(s)
    audit(db, action="site.delete", user=p.user, ip=client_ip(request), target_type="site", target_id=site_id)
    db.commit()
    return {"ok": True}


@router.get("/drivers")
def list_drivers(p: Principal = Depends(active_principal), db: Session = Depends(get_db)):
    out = []
    for d in db.scalars(select(Driver).order_by(Driver.id)):
        out.append({
            "id": d.id, "vendor": d.vendor, "name": d.name, "models": d.models, "firmware": d.firmware,
            "doc_url": d.doc_url, "doc_checked_at": d.doc_checked_at.isoformat() if d.doc_checked_at else None,
            "doc_access": d.doc_access, "protocols": d.protocols, "codecs": d.codecs, "auth_methods": d.auth_methods,
            "features": d.features, "verification_status": d.verification_status, "implemented": d.implemented,
            "notes": d.notes,
        })
    return {"items": out}
