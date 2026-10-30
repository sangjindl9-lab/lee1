from __future__ import annotations

import datetime as dt
import zoneinfo
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...audit import audit
from ...config import get_settings
from ...models import Camera, ExportJob, RecordingSegment, utcnow
from ...storage import safe_join
from ..deps import Principal, client_ip, get_camera_for, get_db, require
from .recordings import _parse_ts

router = APIRouter(prefix="/api/exports", tags=["exports"])

STATUS_TEXT = {"queued": "대기", "running": "처리 중", "done": "완료", "failed": "실패", "cancelled": "취소됨",
               "expired": "만료됨"}


class ExportIn(BaseModel):
    camera_id: int
    start: str
    end: str
    mode: str = "copy"  # copy(원본 복사, 키프레임 단위) / exact(재인코딩, 정확한 구간)
    watermark: bool = False


def job_out(j: ExportJob, cam: Camera | None) -> dict:
    return {
        "id": j.id, "camera_id": j.camera_id, "camera_name": cam.name if cam else "", "user_id": j.user_id,
        "start": j.start_at.isoformat(), "end": j.end_at.isoformat(), "mode": j.mode, "watermark": j.watermark,
        "status": j.status, "status_label": STATUS_TEXT.get(j.status, j.status), "progress": round(j.progress, 1),
        "error": j.error, "note": j.note,
        "actual_start": j.actual_start_at.isoformat() if j.actual_start_at else None,
        "actual_end": j.actual_end_at.isoformat() if j.actual_end_at else None,
        "size_bytes": j.size_bytes, "sha256": j.sha256, "created_at": j.created_at.isoformat() if j.created_at else None,
        "finished_at": j.finished_at.isoformat() if j.finished_at else None,
        "expires_at": j.expires_at.isoformat() if j.expires_at else None,
        "cancel_requested": j.cancel_requested,
    }


@router.post("")
def create_export(body: ExportIn, request: Request, p: Principal = Depends(require("download")),
                  db: Session = Depends(get_db)):
    cam = get_camera_for(db, p, body.camera_id, request, include_deleted=True)
    t0, t1 = _parse_ts(body.start, "start"), _parse_ts(body.end, "end")
    s = get_settings()
    if t1 <= t0:
        raise HTTPException(400, "종료 시각이 시작 시각보다 늦어야 합니다.")
    if (t1 - t0) > dt.timedelta(minutes=s.export_max_minutes):
        raise HTTPException(400, f"한 번에 최대 {s.export_max_minutes}분까지 내보낼 수 있습니다.")
    if body.mode not in ("copy", "exact"):
        raise HTTPException(400, "mode 는 copy 또는 exact 입니다.")
    if body.watermark and body.mode != "exact":
        raise HTTPException(400, "표시용 워터마크는 재인코딩(정확한 구간) 모드에서만 넣을 수 있습니다.")
    n = db.scalar(select(func.count()).select_from(RecordingSegment).where(
        RecordingSegment.camera_id == cam.id, RecordingSegment.status == "ready",
        RecordingSegment.end_at > t0, RecordingSegment.start_at < t1)) or 0
    if not n:
        raise HTTPException(404, "해당 구간에 녹화가 없습니다.")
    active = db.scalar(select(func.count()).select_from(ExportJob).where(
        ExportJob.user_id == p.user.id, ExportJob.status.in_(("queued", "running")))) or 0
    if active >= 5:
        raise HTTPException(429, "진행 중인 내보내기 작업이 많습니다(최대 5개).")
    job = ExportJob(user_id=p.user.id, camera_id=cam.id, start_at=t0, end_at=t1, mode=body.mode,
                    watermark=body.watermark)
    db.add(job)
    db.flush()
    audit(db, action="export.request", user=p.user, ip=client_ip(request), target_type="camera", target_id=cam.id,
          details={"job_id": job.id, "start": t0.isoformat(), "end": t1.isoformat(), "mode": body.mode,
                   "watermark": body.watermark})
    db.commit()
    return job_out(job, cam)


@router.get("")
def list_exports(p: Principal = Depends(require("download")), db: Session = Depends(get_db)):
    q = select(ExportJob).order_by(ExportJob.id.desc()).limit(200)
    if not p.is_superadmin:
        q = q.where(ExportJob.user_id == p.user.id)
    jobs = db.scalars(q).all()
    cams = {c.id: c for c in db.scalars(select(Camera).where(Camera.id.in_({j.camera_id for j in jobs})))} if jobs else {}
    return {"items": [job_out(j, cams.get(j.camera_id)) for j in jobs]}


def _job_for(db: Session, p: Principal, job_id: int) -> ExportJob:
    j = db.get(ExportJob, job_id)
    if not j or (j.user_id != p.user.id and not p.is_superadmin):
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    return j


@router.post("/{job_id}/cancel")
def cancel_export(job_id: int, request: Request, p: Principal = Depends(require("download")),
                  db: Session = Depends(get_db)):
    j = _job_for(db, p, job_id)
    if j.status == "queued":
        j.status = "cancelled"
        j.finished_at = utcnow()
    elif j.status == "running":
        j.cancel_requested = True
    else:
        raise HTTPException(409, "이미 끝난 작업입니다.")
    audit(db, action="export.cancel", user=p.user, ip=client_ip(request), target_type="export", target_id=j.id)
    db.commit()
    return job_out(j, db.get(Camera, j.camera_id))


@router.get("/{job_id}/download")
def download_export(job_id: int, request: Request, p: Principal = Depends(require("download")),
                    db: Session = Depends(get_db)):
    j = _job_for(db, p, job_id)
    cam = get_camera_for(db, p, j.camera_id, request, include_deleted=True)  # 현장 권한 재확인
    if j.status != "done":
        raise HTTPException(409, "다운로드할 수 없는 상태입니다.")
    if j.expires_at and j.expires_at < utcnow():
        raise HTTPException(410, "다운로드 기한이 지났습니다. 다시 내보내기 하세요.")
    try:
        path = safe_join(get_settings().exports_dir, j.rel_path)
    except ValueError as exc:
        raise HTTPException(404, "파일이 없습니다.") from exc
    if not path.is_file():
        raise HTTPException(410, "파일이 없습니다.")
    tz = zoneinfo.ZoneInfo(cam.site.timezone)
    name = f"{cam.name}_{j.start_at.astimezone(tz):%Y%m%d_%H%M%S}-{j.end_at.astimezone(tz):%H%M%S}.mp4"
    audit(db, action="export.download", user=p.user, ip=client_ip(request), target_type="export", target_id=j.id,
          details={"camera_id": cam.id, "sha256": j.sha256, "size": j.size_bytes}, commit=True)
    return FileResponse(path, media_type="video/mp4", headers={
        "Content-Disposition": f"attachment; filename=\"export_{j.id}.mp4\"; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "no-store",
    })
