"""HTML → PDF (WeasyPrint). 한글 폰트는 서버에 설치된 Noto Sans CJK KR / 나눔고딕 사용."""
import base64
import io
from decimal import Decimal, InvalidOperation
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import ApprovalDoc, Company, FileObject, User
from ..util import now_kst
from .storage import abs_path

TPL_DIR = Path(__file__).resolve().parent.parent / "templates" / "pdf"


def _num(v):
    if v is None or v == "":
        return ""
    try:
        d = Decimal(str(v))
    except InvalidOperation:
        return v
    neg = d < 0
    d = abs(d)
    t = format(d, "f")
    ip, _, fp = t.partition(".")
    fp = fp.rstrip("0")
    ip = f"{int(ip):,}"
    return ("-" if neg else "") + ip + ("." + fp if fp else "")


_env = Environment(loader=FileSystemLoader(str(TPL_DIR)), autoescape=select_autoescape(["html"]))
_env.filters["num"] = _num


def image_data_uri(f: FileObject | None, max_px: int = 1400) -> str | None:
    if not f:
        return None
    try:
        p = abs_path(f.stored_path)
        im = ImageOps.exif_transpose(Image.open(p))
        im.thumbnail((max_px, max_px))
        if im.mode not in ("RGB", "L"):
            bg = Image.new("RGB", im.size, "white")
            bg.paste(im, mask=im.split()[-1] if im.mode in ("RGBA", "LA") else None)
            im = bg
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def company_ctx(db: Session, company_id: int) -> dict:
    c = db.get(Company, company_id)
    logo = image_data_uri(db.get(FileObject, c.logo_file_id), 600) if c.logo_file_id else None
    seal = image_data_uri(db.get(FileObject, c.seal_file_id), 300) if c.seal_file_id else None
    return {"company": c, "logo": logo, "seal": seal}


def approval_signs(db: Session, doc: ApprovalDoc | None) -> list[dict]:
    if not doc:
        return []
    drafter = db.get(User, doc.drafter_id)
    signs = [{"label": "기안", "name": drafter.name if drafter else "",
              "at": doc.submitted_at.astimezone(now_kst().tzinfo).strftime("%m-%d") if doc.submitted_at else ""}]
    for st in doc.steps:
        if st.kind == "참조":
            continue
        u = db.get(User, st.approver_id)
        label = (u.position.name if u and u.position else st.kind)
        status = {"approved": "승인", "rejected": "반려", "pending": "결재중", "waiting": ""}.get(st.status, "")
        signs.append({"label": label if st.kind == "결재" else f"합의({label})", "name": u.name if u else "",
                      "status": status, "at": st.acted_at.astimezone(now_kst().tzinfo).strftime("%m-%d") if st.acted_at else ""})
    return signs


def render_pdf(template: str, landscape: bool = False, **ctx) -> bytes:
    from weasyprint import HTML
    html = _env.get_template(template).render(font=get_settings().pdf_font_family, landscape=landscape,
                                              printed_at=now_kst().strftime("%Y-%m-%d %H:%M"), **ctx)
    return HTML(string=html, base_url=str(TPL_DIR)).write_pdf()
