from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from ..models import (ApprovalDoc, DailyReport, FileObject, Material, MaterialRequest, Project, PurchaseOrder, Quote,
                      User)
from ..security import Ctx, get_ctx, perm
from ..services import approval as ap
from ..services.common import audit
from ..services.storage import abs_path, save_upload
from ..util import now_kst

router = APIRouter(prefix="/api/files", tags=["files"])

CATEGORIES = ["사진", "첨부", "계약서", "도면", "내역서", "시방서", "견적서", "승인자료", "성적서", "인증서", "공문", "회의록", "로고", "직인", "기타"]


def resolve_owner(ctx: Ctx, owner_type: str, owner_id: int | None, write: bool = False) -> int | None:
    """첨부 대상의 접근 권한을 검사하고 현장 id 를 돌려준다."""
    db = ctx.db
    if owner_type == "project":
        return ctx.project(owner_id).id
    if owner_type == "daily_report":
        r = db.get(DailyReport, owner_id)
        if not r or r.company_id != ctx.company_id:
            raise HTTPException(404, "작업일보를 찾을 수 없습니다.")
        ctx.project(r.project_id)
        if write and r.status not in ("draft", "rejected", "correcting"):
            raise HTTPException(409, "승인·제출된 일보에는 사진을 추가·삭제할 수 없습니다. 정정 요청 후 처리하세요.")
        return r.project_id
    if owner_type == "material_request":
        r = db.get(MaterialRequest, owner_id)
        if not r or r.company_id != ctx.company_id:
            raise HTTPException(404, "자재요청을 찾을 수 없습니다.")
        ctx.project(r.project_id)
        return r.project_id
    if owner_type == "quote":
        q = db.get(Quote, owner_id)
        if not q or q.company_id != ctx.company_id:
            raise HTTPException(404, "견적을 찾을 수 없습니다.")
        r = db.get(MaterialRequest, q.request_id)
        ctx.project(r.project_id)
        return r.project_id
    if owner_type == "po":
        po = db.get(PurchaseOrder, owner_id)
        if not po or po.company_id != ctx.company_id:
            raise HTTPException(404, "발주서를 찾을 수 없습니다.")
        ctx.project(po.project_id)
        return po.project_id
    if owner_type == "approval":
        d = db.get(ApprovalDoc, owner_id)
        if not d or not ap.can_view(ctx, d):
            raise HTTPException(404, "결재문서를 찾을 수 없습니다.")
        if write and d.status not in ("draft", "in_progress") and d.drafter_id != ctx.user.id:
            raise HTTPException(409, "완료된 결재문서에는 첨부할 수 없습니다.")
        return d.project_id
    if owner_type == "material":
        m = db.get(Material, owner_id)
        if not m or m.company_id != ctx.company_id:
            raise HTTPException(404, "자재를 찾을 수 없습니다.")
        if write:
            ctx.require("material.master")
        return None
    if owner_type == "company":
        if write:
            ctx.require("admin.settings")
        return None
    raise HTTPException(400, "알 수 없는 첨부 대상")


def file_out(f: FileObject, users: dict | None = None) -> dict:
    return {"id": f.id, "name": f.original_name, "category": f.category, "mime": f.mime, "size": f.size,
            "has_thumb": bool(f.thumb_path), "owner_type": f.owner_type, "owner_id": f.owner_id, "project_id": f.project_id,
            "taken_date": f.taken_date.isoformat() if f.taken_date else None, "work_type": f.work_type,
            "location": f.location, "phase": f.phase, "title": f.title, "description": f.description,
            "uploaded_by": (users or {}).get(f.uploaded_by), "created_at": f.created_at.isoformat()}


@router.post("")
def upload(owner_type: str = Form(...), owner_id: int | None = Form(None), category: str = Form("첨부"),
           taken_date: date | None = Form(None), work_type: str | None = Form(None), location: str | None = Form(None),
           phase: str | None = Form(None), title: str | None = Form(None), description: str | None = Form(None),
           files: list[UploadFile] = File(...), ctx: Ctx = Depends(perm("file.upload"))):
    if category not in CATEGORIES:
        raise HTTPException(400, "파일 분류가 올바르지 않습니다.")
    if len(files) > 30:
        raise HTTPException(400, "한 번에 30개까지 업로드할 수 있습니다.")
    project_id = resolve_owner(ctx, owner_type, owner_id, write=True)
    saved = []
    for up in files:
        info = save_upload(ctx.company_id, up)
        cat = category
        if category in ("첨부", "사진"):
            cat = "사진" if info["is_image"] else "첨부"
        f = FileObject(company_id=ctx.company_id, project_id=project_id, owner_type=owner_type, owner_id=owner_id,
                       category=cat, original_name=info["original_name"], stored_path=info["stored_path"],
                       thumb_path=info["thumb_path"], mime=info["mime"], size=info["size"], sha256=info["sha256"],
                       taken_date=taken_date, work_type=work_type, location=location, phase=phase,
                       title=title, description=description, uploaded_by=ctx.user.id)
        ctx.db.add(f)
        ctx.db.flush()
        saved.append(f)
        audit(ctx, "upload", "file", f.id, f"파일 업로드: {f.original_name}", project_id=project_id)
    ctx.db.commit()
    return [file_out(f) for f in saved]


@router.get("")
def list_files(owner_type: str | None = None, owner_id: int | None = None, project_id: int | None = None,
               category: str | None = None, phase: str | None = None, date_from: date | None = None,
               date_to: date | None = None, q: str | None = None, ctx: Ctx = Depends(get_ctx)):
    st = select(FileObject).where(FileObject.company_id == ctx.company_id, FileObject.deleted_at.is_(None))
    if owner_type:
        resolve_owner(ctx, owner_type, owner_id)
        st = st.where(FileObject.owner_type == owner_type, FileObject.owner_id == owner_id)
    elif project_id:
        ctx.project(project_id)
        st = st.where(FileObject.project_id == project_id)
    else:
        ids = ctx.project_ids()
        if ids is not None:
            st = st.where(FileObject.project_id.in_(ids or [0]))
        else:
            st = st.where(FileObject.project_id.is_not(None))
    if category:
        st = st.where(FileObject.category == category)
    if phase:
        st = st.where(FileObject.phase == phase)
    if date_from:
        st = st.where(FileObject.taken_date >= date_from)
    if date_to:
        st = st.where(FileObject.taken_date <= date_to)
    if q:
        like = f"%{q}%"
        st = st.where(FileObject.original_name.ilike(like) | FileObject.title.ilike(like) |
                      FileObject.location.ilike(like) | FileObject.work_type.ilike(like))
    users = {u.id: u.name for u in ctx.db.execute(select(User).where(User.company_id == ctx.company_id)).scalars()}
    rows = ctx.db.execute(st.order_by(FileObject.taken_date.desc().nulls_last(), FileObject.id.desc()).limit(1000)).scalars()
    return [file_out(f, users) for f in rows]


def _file(ctx: Ctx, fid: int) -> FileObject:
    f = ctx.db.get(FileObject, fid)
    if not f or f.company_id != ctx.company_id or f.deleted_at:
        raise HTTPException(404, "파일을 찾을 수 없습니다.")
    resolve_owner(ctx, f.owner_type, f.owner_id)
    return f


@router.get("/{fid}/download")
def download(fid: int, inline: bool = False, ctx: Ctx = Depends(get_ctx)):
    f = _file(ctx, fid)
    if f.owner_type != "company":
        ctx.require("file.download")
    p = abs_path(f.stored_path)
    if not p.exists():
        raise HTTPException(410, "저장소에서 파일 원본을 찾을 수 없습니다. 백업에서 복원이 필요합니다.")
    return FileResponse(p, media_type=f.mime, filename=f.original_name,
                        content_disposition_type="inline" if inline else "attachment")


@router.get("/{fid}/thumb")
def thumb(fid: int, ctx: Ctx = Depends(get_ctx)):
    f = _file(ctx, fid)
    if not f.thumb_path:
        raise HTTPException(404, "미리보기가 없습니다.")
    return FileResponse(abs_path(f.thumb_path), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


class MetaIn(BaseModel):
    category: str | None = None
    taken_date: date | None = None
    work_type: str | None = None
    location: str | None = None
    phase: str | None = None
    title: str | None = None
    description: str | None = None


@router.put("/{fid}")
def update_meta(fid: int, body: MetaIn, ctx: Ctx = Depends(perm("file.upload"))):
    f = _file(ctx, fid)
    resolve_owner(ctx, f.owner_type, f.owner_id, write=True)
    if body.category and body.category not in CATEGORIES:
        raise HTTPException(400, "파일 분류가 올바르지 않습니다.")
    for k, v in body.model_dump().items():
        if k == "category" and not v:
            continue
        setattr(f, k, v)
    audit(ctx, "update", "file", f.id, f"파일 정보 수정: {f.original_name}", project_id=f.project_id)
    ctx.db.commit()
    return file_out(f)


@router.delete("/{fid}")
def delete_file(fid: int, ctx: Ctx = Depends(get_ctx)):
    f = _file(ctx, fid)
    if f.uploaded_by != ctx.user.id:
        ctx.require("file.delete")
    resolve_owner(ctx, f.owner_type, f.owner_id, write=True)
    f.deleted_at = now_kst()
    audit(ctx, "delete", "file", f.id, f"파일 삭제(휴지통): {f.original_name}", project_id=f.project_id)
    ctx.db.commit()
    return {"ok": True}
