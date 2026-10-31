"""파일 저장소. 기본은 서버 디스크(FILE_STORAGE_DIR). 인터페이스를 유지하면 S3 호환 저장소로 교체 가능."""
import hashlib
import io
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps

from ..config import get_settings
from ..util import now_kst

ALLOWED_EXT = {
    "jpg", "jpeg", "png", "gif", "webp", "heic", "bmp",
    "pdf", "xlsx", "xls", "csv", "docx", "doc", "hwp", "hwpx", "pptx", "ppt", "txt",
    "zip", "dwg", "dxf",
}
IMAGE_EXT = {"jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"}
BLOCKED_MAGIC = [b"MZ", b"\x7fELF", b"#!"]  # 실행파일·스크립트 차단

MIME = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp",
    "bmp": "image/bmp", "heic": "image/heic", "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xls": "application/vnd.ms-excel",
    "csv": "text/csv", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "doc": "application/msword", "hwp": "application/x-hwp", "hwpx": "application/x-hwpx",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "ppt": "application/vnd.ms-powerpoint", "txt": "text/plain", "zip": "application/zip",
    "dwg": "application/acad", "dxf": "application/dxf",
}


def root() -> Path:
    p = get_settings().file_storage_dir
    p.mkdir(parents=True, exist_ok=True)
    return p


def _ext(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def save_upload(company_id: int, up: UploadFile) -> dict:
    name = (up.filename or "file").replace("\\", "/").split("/")[-1][:250]
    ext = _ext(name)
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"허용되지 않는 파일 형식입니다: .{ext or '(없음)'}")
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = up.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"파일 크기는 {get_settings().max_upload_mb}MB 이하만 가능합니다: {name}")
    if not data:
        raise HTTPException(400, f"빈 파일입니다: {name}")
    if any(data.startswith(m) for m in BLOCKED_MAGIC):
        raise HTTPException(400, f"실행 파일은 업로드할 수 없습니다: {name}")
    if ext == "pdf" and not data.startswith(b"%PDF"):
        raise HTTPException(400, f"PDF 형식이 아닙니다: {name}")
    is_image = ext in IMAGE_EXT and ext != "heic"
    if is_image:
        try:
            Image.open(io.BytesIO(data)).verify()
        except Exception:
            raise HTTPException(400, f"손상되었거나 이미지가 아닌 파일입니다: {name}")
    now = now_kst()
    rel_dir = Path(str(company_id)) / now.strftime("%Y") / now.strftime("%m")
    (root() / rel_dir).mkdir(parents=True, exist_ok=True)
    key = uuid.uuid4().hex
    rel = rel_dir / f"{key}.{ext}"
    (root() / rel).write_bytes(data)
    _blob_put(str(rel), data)
    thumb_rel = None
    if is_image:
        try:
            im = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
            im.thumbnail((640, 640))
            if im.mode not in ("RGB", "L"):
                im = im.convert("RGB")
            thumb_rel = rel_dir / f"{key}_t.jpg"
            im.save(root() / thumb_rel, "JPEG", quality=82)
            _blob_put(str(thumb_rel), (root() / thumb_rel).read_bytes())
        except Exception:
            thumb_rel = None
    return {
        "original_name": name, "stored_path": str(rel), "thumb_path": str(thumb_rel) if thumb_rel else None,
        "mime": MIME.get(ext, "application/octet-stream"), "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(), "is_image": is_image or ext == "heic",
    }


def abs_path(rel: str) -> Path:
    p = (root() / rel).resolve()
    if root().resolve() not in p.parents:
        raise HTTPException(400, "잘못된 파일 경로")
    if not p.exists():
        data = _blob_get(rel)
        if data is not None:  # 디스크가 초기화된 경우 DB 원본에서 복구
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
    return p


# ---------------------------------------------------------------- DB 보관 모드
# FILE_STORAGE_MODE=db 이면 파일 원본을 DB(file_blobs)에도 저장한다.
# 디스크가 재배포 때 초기화되는 호스팅(Render 무료 등)에서도 첨부파일이 유지된다.
def _db_mode() -> bool:
    return get_settings().file_storage_mode == "db"


def _blob_put(key: str, data: bytes) -> None:
    if not _db_mode():
        return
    from sqlalchemy.dialects.postgresql import insert
    from ..db import session_factory
    from ..models import FileBlob
    with session_factory()() as db:
        db.execute(insert(FileBlob).values(key=key, data=data).on_conflict_do_nothing())
        db.commit()


def _blob_get(key: str) -> bytes | None:
    if not _db_mode():
        return None
    from ..db import session_factory
    from ..models import FileBlob
    with session_factory()() as db:
        b = db.get(FileBlob, key)
        return bytes(b.data) if b else None
