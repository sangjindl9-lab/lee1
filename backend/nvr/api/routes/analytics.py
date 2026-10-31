"""지능형 분석 규칙·상태·스냅샷 API."""
from __future__ import annotations

import datetime as dt
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...analytics import DEFAULT_PARAMS, DEFAULT_SEVERITY, LABELS, PERSON_RULES
from ...audit import audit
from ...config import get_settings
from ...models import AnalyticsRule, Camera, Event, ServiceHeartbeat, utcnow
from ..deps import Principal, client_ip, get_camera_for, get_db, require

router = APIRouter(prefix="/api", tags=["analytics"])

MAX_RULES_PER_CAMERA = 20
# 매개변수 허용 범위(최소, 최대)
PARAM_RANGE: dict[str, tuple[float, float]] = {
    "min_area": (0.0001, 0.5), "persist_seconds": (0, 600), "flicker": (0.0, 1.0), "sensitivity": (0.0, 1.0),
    "min_person_px": (20, 2000), "changed_ratio": (0.05, 1.0), "danger_percent": (5, 100), "min_seconds": (0, 3600),
    "dwell_seconds": (5, 86400), "min_count": (2, 200), "speed": (0.3, 10.0), "seconds": (10, 86400),
}

EXPLAIN = {
    "fire": "색(불꽃 색 범위)·밝은 중심부·형태 흔들림·지속시간으로 판정. 움직이는 주황색 물체·석양·용접 불꽃은 오탐 가능.",
    "smoke": "시험 기능. 회색·저채도 움직임이 넓게 지속되고 배경 윤곽이 흐려질 때. 안개·먼지·조명 변화에 오탐이 많음.",
    "no_helmet": "사람 검출 후 머리 윗부분의 안전모 색(흰·노랑·주황·빨강·파랑·초록) 비율로 추정. 모자·머리색·역광에 영향, "
                 "사람 키가 화면에서 최소 크기(기본 60px) 이상이어야 판정.",
    "water_level": "물이 없을 때의 기준 영상과 비교. 눈금선(수위봉·벽면)을 그리면 아래부터 덮인 높이(%)로, 없으면 구역 변화 비율로 판정. "
                   "기준 영상 저장이 먼저 필요.",
    "intrusion": "사람의 발 위치가 구역에 들어오면.",
    "loitering": "사람이 구역 안에 지정 시간 이상 머물면(추적이 끊기면 시간이 다시 시작될 수 있음).",
    "crowd": "구역 안 사람 수가 기준 이상이 지정 시간 지속되면.",
    "fall": "서 있던 사람의 박스가 가로로 누운 형태로 바뀌어 지속되면. 카메라 각도(정수리 시점)에 따라 부정확.",
    "running": "발 위치 이동 속도가 몸 높이 기준 초당 N배 이상이면.",
    "stationary": "사람이 지정 시간 이상 거의 움직이지 않으면(쓰러짐·작업자 이상 등 보조 판단).",
}


def _check_points(v: list[list[float]], max_n: int) -> list[list[float]]:
    if len(v) > max_n:
        raise ValueError(f"점은 최대 {max_n}개입니다.")
    out = []
    for pt in v:
        if len(pt) != 2:
            raise ValueError("점은 [x, y] 형식입니다.")
        x, y = float(pt[0]), float(pt[1])
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise ValueError("좌표는 화면 비율(0~1)입니다.")
        out.append([round(x, 4), round(y, 4)])
    return out


def _zone_ok(v):
    v = _check_points(v, 20)
    if 0 < len(v) < 3:
        raise ValueError("구역은 점 3개 이상이어야 합니다(비우면 화면 전체).")
    return v


def _line_ok(v):
    v = _check_points(v, 2)
    if len(v) not in (0, 2):
        raise ValueError("눈금선은 [바닥, 위] 두 점입니다.")
    return v


class RuleIn(BaseModel):
    type: str
    name: str = Field(default="", max_length=100)
    enabled: bool = True
    zone: list[list[float]] = []
    line: list[list[float]] = []
    params: dict[str, Any] = {}
    severity: str | None = None
    cooldown_seconds: int = Field(default=60, ge=0, le=86400)

    @field_validator("zone")
    @classmethod
    def _zone(cls, v):
        return _zone_ok(v)

    @field_validator("line")
    @classmethod
    def _line(cls, v):
        return _line_ok(v)


class RulePatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    enabled: bool | None = None
    zone: list[list[float]] | None = None
    line: list[list[float]] | None = None
    params: dict[str, Any] | None = None
    severity: str | None = None
    cooldown_seconds: int | None = Field(default=None, ge=0, le=86400)

    @field_validator("zone")
    @classmethod
    def _zone(cls, v):
        return None if v is None else _zone_ok(v)

    @field_validator("line")
    @classmethod
    def _line(cls, v):
        return None if v is None else _line_ok(v)


def _clean_params(typ: str, params: dict[str, Any]) -> dict[str, Any]:
    allowed = DEFAULT_PARAMS.get(typ, {})
    out: dict[str, Any] = {}
    for k, v in params.items():
        if k not in allowed:
            raise HTTPException(400, f"'{LABELS[typ]}' 규칙에 없는 설정입니다: {k}")
        try:
            num = float(v)
        except (TypeError, ValueError):
            raise HTTPException(400, f"{k} 는 숫자여야 합니다.") from None
        lo, hi = PARAM_RANGE.get(k, (0, 1e6))
        if not (lo <= num <= hi):
            raise HTTPException(400, f"{k} 는 {lo}~{hi} 범위입니다.")
        out[k] = int(num) if float(num).is_integer() and k in ("min_count", "min_person_px") else num
    return out


def _severity(v: str | None, typ: str) -> str:
    v = v or DEFAULT_SEVERITY.get(typ, "warning")
    if v not in ("info", "warning", "critical"):
        raise HTTPException(400, "중요도는 info / warning / critical 입니다.")
    return v


def _rule_out(r: AnalyticsRule) -> dict[str, Any]:
    return {"id": r.id, "camera_id": r.camera_id, "type": r.type, "type_label": LABELS.get(r.type, r.type),
            "name": r.name, "enabled": r.enabled, "zone": r.zone, "line": r.line,
            "params": {**DEFAULT_PARAMS.get(r.type, {}), **(r.params or {})}, "custom_params": r.params or {},
            "severity": r.severity, "cooldown_seconds": r.cooldown_seconds,
            "ref_requested_at": r.ref_requested_at.isoformat() if r.ref_requested_at else None,
            "ref_set_at": r.ref_set_at.isoformat() if r.ref_set_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None}


def _rule_for(db: Session, p: Principal, rid: int, request: Request) -> tuple[AnalyticsRule, Camera]:
    r = db.get(AnalyticsRule, rid)
    if not r:
        raise HTTPException(404, "규칙을 찾을 수 없습니다.")
    cam = get_camera_for(db, p, r.camera_id, request)
    return r, cam


@router.get("/analytics/meta")
def meta(p: Principal = Depends(require("live_view"))):
    return {"types": [{"type": t, "label": LABELS[t], "person": t in PERSON_RULES, "defaults": DEFAULT_PARAMS.get(t, {}),
                       "severity": DEFAULT_SEVERITY.get(t, "warning"), "explain": EXPLAIN.get(t, ""),
                       "experimental": t == "smoke"} for t in LABELS],
            "ranges": PARAM_RANGE}


@router.get("/analytics/status")
def status(p: Principal = Depends(require("live_view")), db: Session = Depends(get_db)):
    hb = db.get(ServiceHeartbeat, "analytics")
    alive = bool(hb and (utcnow() - hb.last_seen_at) < dt.timedelta(seconds=30))
    info = dict(hb.info) if hb else {}
    cams = {c.id: c for c in db.scalars(select(Camera).where(Camera.deleted_at.is_(None)))}
    per_cam = {}
    for cid, st in (info.get("cameras") or {}).items():
        c = cams.get(int(cid))
        if c and p.can_cam(c):
            per_cam[cid] = st
    counts = dict(db.execute(select(AnalyticsRule.camera_id, func.count()).where(AnalyticsRule.enabled.is_(True))
                             .group_by(AnalyticsRule.camera_id)).all())
    return {"service_alive": alive, "last_seen_at": hb.last_seen_at.isoformat() if hb else None,
            "model": info.get("model"), "model_error": info.get("model_error", ""), "fps": info.get("fps"),
            "detect_interval": info.get("detect_interval"), "cameras": per_cam,
            "rule_counts": {str(k): v for k, v in counts.items() if k in cams and p.can_cam(cams[k])}}


@router.get("/cameras/{camera_id}/analytics/rules")
def list_rules(camera_id: int, request: Request, p: Principal = Depends(require("live_view")),
               db: Session = Depends(get_db)):
    get_camera_for(db, p, camera_id, request)
    rules = db.scalars(select(AnalyticsRule).where(AnalyticsRule.camera_id == camera_id).order_by(AnalyticsRule.id)).all()
    return [_rule_out(r) for r in rules]


@router.post("/cameras/{camera_id}/analytics/rules")
def create_rule(camera_id: int, body: RuleIn, request: Request, p: Principal = Depends(require("settings")),
                db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, camera_id, request)
    if body.type not in LABELS:
        raise HTTPException(400, "지원하지 않는 분석 종류입니다.")
    n = db.scalar(select(func.count()).select_from(AnalyticsRule).where(AnalyticsRule.camera_id == cam.id)) or 0
    if n >= MAX_RULES_PER_CAMERA:
        raise HTTPException(400, f"카메라당 규칙은 최대 {MAX_RULES_PER_CAMERA}개입니다.")
    if body.type != "water_level" and body.line:
        raise HTTPException(400, "눈금선은 수위 규칙에서만 씁니다.")
    r = AnalyticsRule(camera_id=cam.id, type=body.type, name=body.name.strip(), enabled=body.enabled, zone=body.zone,
                      line=body.line, params=_clean_params(body.type, body.params),
                      severity=_severity(body.severity, body.type), cooldown_seconds=body.cooldown_seconds,
                      updated_at=utcnow())
    db.add(r)
    db.flush()
    audit(db, action="analytics.rule_create", user=p.user, ip=client_ip(request), target_type="camera",
          target_id=cam.id, details={"rule_id": r.id, "type": r.type, "name": r.name})
    db.commit()
    return _rule_out(r)


@router.patch("/analytics/rules/{rid}")
def update_rule(rid: int, body: RulePatch, request: Request, p: Principal = Depends(require("settings")),
                db: Session = Depends(get_db)):
    r, cam = _rule_for(db, p, rid, request)
    data = body.model_dump(exclude_unset=True)
    if "params" in data and data["params"] is not None:
        data["params"] = _clean_params(r.type, data["params"])
    if "severity" in data:
        data["severity"] = _severity(data["severity"], r.type)
    if data.get("line") and r.type != "water_level":
        raise HTTPException(400, "눈금선은 수위 규칙에서만 씁니다.")
    for k, v in data.items():
        if v is not None:
            setattr(r, k, v.strip() if isinstance(v, str) and k == "name" else v)
    r.updated_at = utcnow()
    audit(db, action="analytics.rule_update", user=p.user, ip=client_ip(request), target_type="camera",
          target_id=cam.id, details={"rule_id": r.id, "fields": sorted(data)})
    db.commit()
    return _rule_out(r)


@router.delete("/analytics/rules/{rid}")
def delete_rule(rid: int, request: Request, p: Principal = Depends(require("settings")), db: Session = Depends(get_db)):
    r, cam = _rule_for(db, p, rid, request)
    audit(db, action="analytics.rule_delete", user=p.user, ip=client_ip(request), target_type="camera",
          target_id=cam.id, details={"rule_id": r.id, "type": r.type, "name": r.name})
    db.delete(r)
    db.commit()
    ref = get_settings().analytics_dir / "ref" / f"rule{rid}.png"
    ref.unlink(missing_ok=True)
    return {"ok": True}


@router.post("/analytics/rules/{rid}/reference")
def request_reference(rid: int, request: Request, p: Principal = Depends(require("settings")),
                      db: Session = Depends(get_db)):
    """수위 규칙: 다음 분석 프레임을 '물이 없는 기준 영상'으로 저장하도록 요청."""
    r, cam = _rule_for(db, p, rid, request)
    if r.type != "water_level":
        raise HTTPException(400, "기준 영상은 수위 규칙에서만 씁니다.")
    r.ref_requested_at = utcnow()
    audit(db, action="analytics.reference", user=p.user, ip=client_ip(request), target_type="camera",
          target_id=cam.id, details={"rule_id": r.id})
    db.commit()
    return {"ok": True, "note": "분석 서비스가 다음 프레임을 기준 영상으로 저장합니다(수 초 소요). 물이 없는 평상시에 누르세요."}


@router.get("/cameras/{camera_id}/analytics/preview")
def preview(camera_id: int, request: Request, p: Principal = Depends(require("live_view")),
            db: Session = Depends(get_db)):
    """분석 결과가 그려진 최근 프레임(1초마다 갱신)."""
    cam = get_camera_for(db, p, camera_id, request)
    f = get_settings().analytics_dir / "live" / f"cam{cam.id}.jpg"
    try:
        st = f.stat()
    except OSError:
        raise HTTPException(404, "분석 화면이 아직 없습니다(규칙이 켜져 있고 분석 서비스가 동작해야 합니다).") from None
    if time.time() - st.st_mtime > 30:
        raise HTTPException(404, "분석 화면이 30초 이상 갱신되지 않았습니다(영상 입력 또는 분석 서비스 확인).")
    return Response(content=f.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/events/{event_id}/snapshot")
def event_snapshot(event_id: int, request: Request, p: Principal = Depends(require("live_view")),
                   db: Session = Depends(get_db)):
    ev = db.get(Event, event_id)
    if not ev or not ev.camera_id:
        raise HTTPException(404, "스냅샷이 없습니다.")
    get_camera_for(db, p, ev.camera_id, request, include_deleted=True)
    f = get_settings().analytics_dir / "snap" / f"{int(ev.id)}.jpg"
    if not f.is_file():
        raise HTTPException(404, "스냅샷이 없습니다(보관 기간이 지났거나 저장되지 않음).")
    audit(db, action="event.snapshot", user=p.user, ip=client_ip(request), target_type="event", target_id=ev.id,
          commit=True)
    return Response(content=f.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})
