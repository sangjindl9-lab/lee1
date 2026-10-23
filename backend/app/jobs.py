"""비동기 도면 처리 파이프라인. 기본 thread 큐(단일 서버), KET_JOB_BACKEND=celery 시 Celery 사용."""
from __future__ import annotations

import json
import logging
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import settings
from .db import SessionLocal
from .engine.dxf_parser import ConversionError, SheetData, convert_dwg_to_dxf, parse_dxf
from .engine.pdf_parser import parse_image, parse_pdf
from .models import CADLayer, DetectedEntity, DrawingFile, DrawingRevision, DrawingSheet, FileStatus

log = logging.getLogger("ket.jobs")
_executor = ThreadPoolExecutor(max_workers=2)
_lock = threading.Lock()


def submit_process_file(file_id: int):
    if settings.job_backend == "celery":
        from .celery_app import process_file_task  # noqa
        process_file_task.delay(file_id)
    else:
        _executor.submit(process_file, file_id)


def _set(db, f: DrawingFile, **kw):
    for k, v in kw.items():
        setattr(f, k, v)
    db.commit()


def process_file(file_id: int):
    db = SessionLocal()
    try:
        f = db.get(DrawingFile, file_id)
        if not f:
            return
        _set(db, f, status=FileStatus.processing, progress=5, error=None)
        src = Path(f.stored_path)
        proc_dir = settings.processed_dir / str(f.project_id) / str(f.id)
        proc_dir.mkdir(parents=True, exist_ok=True)

        sheets: list[SheetData] = []
        if f.kind == "dwg":
            try:
                dxf = convert_dwg_to_dxf(src, proc_dir / "converted")
            except ConversionError as ex:
                _set(db, f, status=FileStatus.needs_converter, error=str(ex), progress=0)
                return
            _set(db, f, progress=30)
            sheets = [parse_dxf(dxf)]
        elif f.kind == "dxf":
            sheets = [parse_dxf(src)]
        elif f.kind == "pdf":
            sheets = parse_pdf(src, proc_dir)
        elif f.kind == "image":
            sheets = parse_image(src, proc_dir)
        elif f.kind == "xlsx":
            # 장비일람표/범례 엑셀은 legend 모듈에서 별도 처리 (시트 없음)
            _set(db, f, status=FileStatus.done, progress=100)
            return
        else:
            _set(db, f, status=FileStatus.failed, error=f"지원하지 않는 파일 형식: {f.kind}")
            return
        _set(db, f, progress=60)

        rev = db.query(DrawingRevision).filter_by(file_id=f.id, is_current=True).first()
        if not rev:
            rev = DrawingRevision(file_id=f.id, rev_no="0")
            db.add(rev)
            db.flush()
        # 재처리 시 기존 시트 제거 (사용자 수정 데이터는 sheet 와 별도 테이블의 user_locked 로 보존)
        for old in list(rev.sheets):
            db.delete(old)
        db.flush()

        all_warnings = []
        for i, sd in enumerate(sheets, start=1):
            gpath = proc_dir / f"sheet_{i}.json"
            with open(gpath, "w", encoding="utf-8") as fp:
                json.dump({"prims": sd.prims, "texts": sd.texts, "bbox": sd.bbox,
                           "blocks": {k: {"fingerprint": v["fingerprint"], "texts": v["texts"], "prims": v["prims"]} for k, v in sd.blocks.items()},
                           "entities": sd.entities}, fp, ensure_ascii=False)
            title, dno, dtype, disc = guess_sheet_meta(sd)
            sheet = DrawingSheet(revision_id=rev.id, page_no=i, sheet_name=sd.sheet_name, drawing_no=dno,
                                 drawing_title=title, drawing_type=dtype, discipline=disc,
                                 source_kind=sd.source_kind, units=sd.units, scale_factor=sd.scale_factor,
                                 scale_confirmed=(sd.source_kind == "dxf" and sd.scale_factor is not None),
                                 bbox=sd.bbox, geometry_path=str(gpath),
                                 raster_path=sd.stats.get("raster_path"), stats=sd.stats)
            db.add(sheet)
            db.flush()
            for L in sd.layers:
                db.add(CADLayer(sheet_id=sheet.id, name=L["name"], color=L.get("color"), entity_count=L.get("count", 0),
                                discipline_guess=guess_discipline(L["name"])))
            # 핵심 엔터티만 DB 저장 (INSERT/TEXT/선형) — 근거 추적용
            for e in sd.entities:
                db.add(DetectedEntity(sheet_id=sheet.id, handle=e.get("h"), etype=e["t"], layer=e.get("layer"),
                                      block_name=e.get("block"), x=e.get("x"), y=e.get("y"), rotation=e.get("rot"),
                                      scale=e.get("scale"), text=e.get("text"), length=e.get("length"),
                                      bbox=e.get("bbox"), attrs=e.get("attrs")))
            all_warnings.extend(f"[{sd.sheet_name}] {w}" for w in sd.warnings)
            _set(db, f, progress=60 + int(35 * i / len(sheets)))

        _set(db, f, status=FileStatus.done, progress=100, warnings=all_warnings)
        log.info("processed file %s: %d sheets", f.id, len(sheets))
    except Exception as ex:
        log.error("process_file failed: %s\n%s", ex, traceback.format_exc())
        db.rollback()
        f = db.get(DrawingFile, file_id)
        if f:
            _set(db, f, status=FileStatus.failed, error=f"{type(ex).__name__}: {ex}"[:1000])
    finally:
        db.close()


DISC_KEYS = {
    "정보통신": ["통신", "TEL", "COMM", "CCTV", "LAN", "UTP", "광", "FIBER", "TV", "방송", "PA", "AP", "DATA"],
    "전기": ["전기", "ELEC", "ELE", "조명", "LIGHT", "LTG", "전력", "POWER", "PWR", "콘센트", "RECEP", "분전", "PANEL", "접지", "GND", "TRAY"],
    "소방전기": ["소방", "FIRE", "FA", "감지기"],
}
TYPE_KEYS = {
    "범례": ["범례", "LEGEND", "SYMBOL"],
    "계통도": ["계통도", "계통", "RISER", "DIAGRAM", "결선도"],
    "일람표": ["일람표", "SCHEDULE", "LIST"],
    "평면도": ["평면도", "배치도", "PLAN", "LAYOUT"],
}


def guess_discipline(s: str | None) -> str | None:
    if not s:
        return None
    u = s.upper()
    for d, keys in DISC_KEYS.items():
        if any(k.upper() in u for k in keys):
            return d
    return None


def guess_sheet_meta(sd: SheetData) -> tuple[str | None, str | None, str | None, str | None]:
    """도면 문자에서 도면명·도면번호·종류·공종 추정 (표제란 위치 무관, 키워드 기반)."""
    import re
    title = dno = dtype = disc = None
    dno_re = re.compile(r"^(?:[A-Z]{1,3}[-_ ]?\d{1,4}(?:[-_]\d{1,3})?|E[-]?\d+|T[-]?\d+|C[-]?\d+)$", re.I)
    # 도면 종류는 큰 글씨(제목) 우선. 범례는 다른 종류 키워드가 없을 때만 (평면도 안의 범례표 제목 오판 방지)
    big = sorted(sd.texts, key=lambda t: -(float(t.get("height") or 0)))[:8]
    found = {}
    for t in big:
        up = t["text"].upper()
        for k, keys in TYPE_KEYS.items():
            if k not in found and any(x in up for x in keys):
                found[k] = t["text"].strip()
    for k in ("평면도", "계통도", "일람표", "범례"):
        if k in found:
            # '범례' 는 범례 제목이 시트에서 가장 큰 글씨일 때만 (평면도 안의 범례표 오판 방지)
            if k == "범례" and big and found[k] != big[0]["text"].strip():
                continue
            dtype, title = k, found[k]
            break
    for t in sd.texts:
        s = t["text"].strip()
        if disc is None:
            disc = guess_discipline(s)
        if dno is None and dno_re.match(s) and len(s) <= 12:
            dno = s
    if title is None and big:
        title = big[0]["text"].strip()[:120]
    return title, dno, dtype, disc
