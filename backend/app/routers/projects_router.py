import hashlib
import json
import math
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import EDIT_ROLES, audit, current_user, get_project_or_403, require_role
from ..config import settings
from ..db import get_db
from ..jobs import submit_process_file
from ..models import (CADLayer, DetectedEntity, DrawingFile, DrawingRevision, DrawingSheet, FileStatus, Project,
                      ReviewIssue, User)
from ..schemas import ProjectIn, ScaleIn, SheetMetaIn

router = APIRouter(prefix="/api/projects", tags=["projects"])

KIND_BY_EXT = {".dwg": "dwg", ".dxf": "dxf", ".pdf": "pdf", ".jpg": "image", ".jpeg": "image", ".png": "image",
               ".xlsx": "xlsx", ".xls": "xlsx"}
MAGIC = {"pdf": b"%PDF", "png": b"\x89PNG", "jpg": b"\xff\xd8", "dwg": b"AC10", "xlsx": b"PK"}


def _project_out(p: Project) -> dict:
    return {"id": p.id, "name": p.name, "client": p.client, "location": p.location, "work_type": p.work_type,
            "start_date": p.start_date, "end_date": p.end_date, "author": p.author, "reviewer": p.reviewer,
            "takeoff_settings": p.takeoff_settings or {}, "created_at": p.created_at.isoformat(),
            "file_count": len(p.files)}


@router.get("")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Project)
    if user.role.value != "superadmin":
        q = q.filter_by(company_id=user.company_id)
    return [_project_out(p) for p in q.order_by(Project.created_at.desc()).all()]


@router.post("")
def create_project(body: ProjectIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    if not body.name or not body.name.strip():
        raise HTTPException(400, "공사명은 필수입니다.")
    p = Project(company_id=user.company_id, created_by=user.id, **body.model_dump(exclude_none=True))
    if p.takeoff_settings is None:
        p.takeoff_settings = {}
    db.add(p)
    db.flush()
    audit(db, user, "create_project", p.id, name=p.name)
    db.commit()
    return _project_out(p)


@router.get("/{pid}")
def get_project(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _project_out(get_project_or_403(db, user, pid))


@router.put("/{pid}")
def update_project(pid: int, body: ProjectIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    p = get_project_or_403(db, user, pid)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    audit(db, user, "update_project", pid)
    db.commit()
    return _project_out(p)


@router.delete("/{pid}")
def delete_project(pid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    p = get_project_or_403(db, user, pid)
    audit(db, user, "delete_project", pid, name=p.name)
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---------------- 도면 파일 ----------------
def _file_out(f: DrawingFile) -> dict:
    rev = next((r for r in f.revisions if r.is_current), None)
    return {"id": f.id, "name": f.original_name, "kind": f.kind, "status": f.status.value, "progress": f.progress,
            "error": f.error, "warnings": f.warnings or [], "size": f.size_bytes, "sha256": f.sha256[:12],
            "created_at": f.created_at.isoformat(),
            "sheets": [_sheet_out(s) for s in (rev.sheets if rev else [])]}


def _sheet_out(s: DrawingSheet) -> dict:
    return {"id": s.id, "page_no": s.page_no, "sheet_name": s.sheet_name, "drawing_no": s.drawing_no,
            "drawing_title": s.drawing_title, "drawing_type": s.drawing_type, "discipline": s.discipline,
            "floor_zone": s.floor_zone, "source_kind": s.source_kind, "units": s.units,
            "scale_factor": s.scale_factor, "scale_confirmed": s.scale_confirmed, "bbox": s.bbox,
            "has_raster": bool(s.raster_path), "stats": s.stats or {},
            "layers": [{"id": L.id, "name": L.name, "color": L.color, "count": L.entity_count, "discipline": L.discipline_guess} for L in s.layers]}


@router.get("/{pid}/files")
def list_files(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    p = get_project_or_403(db, user, pid)
    return [_file_out(f) for f in p.files]


@router.post("/{pid}/files")
async def upload_files(pid: int, files: list[UploadFile] = File(...), user: User = Depends(require_role(*EDIT_ROLES)),
                       db: Session = Depends(get_db)):
    """여러 파일 동시 업로드. 확장자·용량·매직넘버 검증, 해시 중복 차단, 원본 불변 저장, 비동기 분석."""
    p = get_project_or_403(db, user, pid)
    results = []
    for up in files:
        ext = Path(up.filename or "").suffix.lower()
        if ext not in settings.allowed_extensions:
            results.append({"name": up.filename, "error": f"허용되지 않는 확장자: {ext}"})
            continue
        data = await up.read()
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            results.append({"name": up.filename, "error": f"용량 초과 ({settings.max_upload_mb}MB)"})
            continue
        kind = KIND_BY_EXT[ext]
        head = data[:8]
        ok_magic = {"pdf": head.startswith(MAGIC["pdf"]), "image": head.startswith(MAGIC["png"]) or head.startswith(MAGIC["jpg"]),
                    "dwg": head.startswith(MAGIC["dwg"]), "xlsx": head.startswith(MAGIC["xlsx"]) or ext == ".xls",
                    "dxf": b"SECTION" in data[:2000] or data[:40].strip().startswith(b"0")}[kind]
        if not ok_magic:
            results.append({"name": up.filename, "error": "파일 내용이 확장자와 일치하지 않습니다(악성/손상 의심)."})
            continue
        sha = hashlib.sha256(data).hexdigest()
        if db.query(DrawingFile).filter_by(project_id=pid, sha256=sha).first():
            results.append({"name": up.filename, "error": "동일한 파일이 이미 이 프로젝트에 등록되어 있습니다(중복 산출 방지)."})
            continue
        dest_dir = settings.originals_dir / str(pid)
        dest_dir.mkdir(parents=True, exist_ok=True)
        safe = f"{sha[:16]}{ext}"
        dest = dest_dir / safe
        dest.write_bytes(data)
        f = DrawingFile(project_id=pid, original_name=Path(up.filename).name, stored_path=str(dest), sha256=sha,
                        size_bytes=len(data), kind=kind, status=FileStatus.queued, uploaded_by=user.id)
        db.add(f)
        db.flush()
        db.add(DrawingRevision(file_id=f.id, rev_no="0", is_current=True))
        audit(db, user, "upload_file", pid, file=f.original_name, sha=sha[:12])
        db.commit()
        submit_process_file(f.id)
        results.append({"name": up.filename, "id": f.id, "status": "queued"})
    return results


@router.post("/{pid}/files/{fid}/reprocess")
def reprocess(pid: int, fid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    f = db.get(DrawingFile, fid)
    if not f or f.project_id != pid:
        raise HTTPException(404)
    f.status = FileStatus.queued
    db.commit()
    submit_process_file(fid)
    return {"ok": True}


@router.delete("/{pid}/files/{fid}")
def delete_file(pid: int, fid: int, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    f = db.get(DrawingFile, fid)
    if not f or f.project_id != pid:
        raise HTTPException(404)
    audit(db, user, "delete_file", pid, file=f.original_name)
    db.delete(f)
    db.commit()
    shutil.rmtree(settings.processed_dir / str(pid) / str(fid), ignore_errors=True)
    return {"ok": True}


@router.get("/{pid}/files/{fid}/original")
def download_original(pid: int, fid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    get_project_or_403(db, user, pid)
    f = db.get(DrawingFile, fid)
    if not f or f.project_id != pid:
        raise HTTPException(404)
    return FileResponse(f.stored_path, filename=f.original_name)


# ---------------- 시트 ----------------
def _sheet_checked(db, user, pid, sid) -> DrawingSheet:
    get_project_or_403(db, user, pid)
    s = db.get(DrawingSheet, sid)
    if not s or s.revision.file.project_id != pid:
        raise HTTPException(404, "시트가 없습니다.")
    return s


@router.get("/{pid}/sheets/{sid}")
def get_sheet(pid: int, sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _sheet_out(_sheet_checked(db, user, pid, sid))


@router.put("/{pid}/sheets/{sid}")
def update_sheet(pid: int, sid: int, body: SheetMetaIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    s = _sheet_checked(db, user, pid, sid)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    db.commit()
    return _sheet_out(s)


@router.get("/{pid}/sheets/{sid}/geometry")
def sheet_geometry(pid: int, sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """뷰어용 프리미티브(JSON). 처리본이며 원본과 분리 저장."""
    s = _sheet_checked(db, user, pid, sid)
    if not s.geometry_path or not Path(s.geometry_path).exists():
        raise HTTPException(404, "처리본이 없습니다. 재분석하십시오.")
    return FileResponse(s.geometry_path, media_type="application/json")


@router.get("/{pid}/sheets/{sid}/raster")
def sheet_raster(pid: int, sid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = _sheet_checked(db, user, pid, sid)
    if not s.raster_path or not Path(s.raster_path).exists():
        raise HTTPException(404, "래스터 이미지가 없습니다.")
    return FileResponse(s.raster_path, media_type="image/png")


@router.get("/{pid}/sheets/{sid}/entities")
def sheet_entities(pid: int, sid: int, etype: str | None = None, limit: int = 2000,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    _sheet_checked(db, user, pid, sid)
    q = db.query(DetectedEntity).filter_by(sheet_id=sid)
    if etype:
        q = q.filter_by(etype=etype)
    return [{"id": e.id, "handle": e.handle, "etype": e.etype, "layer": e.layer, "block": e.block_name, "x": e.x, "y": e.y,
             "text": e.text, "length": e.length, "bbox": e.bbox, "attrs": e.attrs} for e in q.limit(limit)]


@router.post("/{pid}/sheets/{sid}/scale")
def set_scale(pid: int, sid: int, body: ScaleIn, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """축척 확정. PDF/이미지는 반드시 사용자가 확인해야 길이가 산출된다 (테스트 8)."""
    s = _sheet_checked(db, user, pid, sid)
    if body.scale_factor:
        s.scale_factor = body.scale_factor
    elif body.ref_points and body.ref_length_m:
        (x0, y0), (x1, y1) = body.ref_points[:2]
        d = math.dist((x0, y0), (x1, y1))
        if d <= 0:
            raise HTTPException(400, "기준거리 두 점이 같습니다.")
        s.scale_factor = body.ref_length_m / d
    else:
        raise HTTPException(400, "scale_factor 또는 (ref_points + ref_length_m) 가 필요합니다.")
    if body.units:
        s.units = body.units
    s.scale_confirmed = True
    for issue in db.query(ReviewIssue).filter_by(sheet_id=sid, code="SCALE_UNCONFIRMED").all():
        issue.resolved = True
    audit(db, user, "confirm_scale", pid, sheet=sid, scale=s.scale_factor)
    db.commit()
    return _sheet_out(s)



@router.get("/{pid}/jobs/{jid}")
def get_job(pid: int, jid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from ..models import Job
    get_project_or_403(db, user, pid)
    j = db.get(Job, jid)
    if not j or j.project_id != pid:
        raise HTTPException(404)
    return {"id": j.id, "kind": j.kind, "status": j.status, "progress": j.progress, "message": j.message,
            "result": j.result or {}, "error": j.error, "created_at": j.created_at.isoformat(),
            "finished_at": j.finished_at.isoformat() if j.finished_at else None}


@router.get("/{pid}/jobs")
def list_jobs(pid: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from ..models import Job
    get_project_or_403(db, user, pid)
    return [{"id": j.id, "kind": j.kind, "status": j.status, "progress": j.progress, "message": j.message}
            for j in db.query(Job).filter_by(project_id=pid).order_by(Job.id.desc()).limit(10)]



@router.post("/{pid}/sheets/confirm-scales")
def confirm_scales(pid: int, only_plans: bool = True, user: User = Depends(require_role(*EDIT_ROLES)), db: Session = Depends(get_db)):
    """추정 축척이 있는 시트를 한 번에 확정 (도면마다 하나씩 누르지 않도록). 평면도 계열만 기본."""
    from .. import services
    n = 0
    for s in services.project_sheets(db, pid):
        if s.scale_confirmed or not s.scale_factor:
            continue
        if only_plans and (s.drawing_type or "") in ("계통도", "일람표", "범례"):
            continue
        s.scale_confirmed = True
        n += 1
        for issue in db.query(ReviewIssue).filter_by(sheet_id=s.id, code="SCALE_UNCONFIRMED").all():
            issue.resolved = True
    audit(db, user, "confirm_scales", pid, count=n)
    db.commit()
    return {"confirmed": n}
