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


def submit_job(project_id: int, user_id: int | None, kind: str) -> int:
    """백그라운드 작업 등록 → job id 즉시 반환. 같은 프로젝트에서 같은 종류가 실행 중이면 그 id 를 돌려준다."""
    from .models import Job
    db = SessionLocal()
    try:
        running = db.query(Job).filter(Job.project_id == project_id, Job.kind == kind, Job.status.in_(["queued", "running"])).first()
        if running:
            return running.id
        j = Job(project_id=project_id, user_id=user_id, kind=kind, status="queued", message="대기 중")
        db.add(j)
        db.commit()
        jid = j.id
    finally:
        db.close()
    _executor.submit(run_job, jid)
    return jid


def run_job(job_id: int):
    from datetime import datetime
    from . import services
    from .models import Job, Project, User
    from .auth import audit
    db = SessionLocal()
    try:
        j = db.get(Job, job_id)
        j.status, j.progress, j.message = "running", 1, "시작"
        db.commit()

        def progress(p: int, msg: str):
            j.progress, j.message = max(1, min(99, int(p))), msg[:300]
            db.commit()

        if j.kind == "takeoff":
            d = services.run_detection(db, j.project_id, progress=lambda p, m: progress(5 + p * 0.55, m))
            progress(62, "배관·케이블 선로 분석")
            r = services.run_routes(db, j.project_id)
            progress(85, "물량 집계")
            items = services.recompute_quantities(db, j.project_id)
            progress(93, "교차 검증")
            issues = services.cross_validate(db, j.project_id)
            j.result = {"detection": d, "routes": r, "items": len(items), "cross_issues": len(issues)}
        elif j.kind == "legend_auto":
            created = services.auto_detect_legends(db, j.project_id, progress=lambda p, m: progress(5 + p * 0.9, m))
            proj = db.get(Project, j.project_id)
            n = services.apply_library(db, j.project_id, proj.company_id)
            j.result = {"created": len(created), "rows": sum(len(t.symbols) for t in created), "library_hits": n}
        else:
            raise ValueError(f"알 수 없는 작업: {j.kind}")
        user = db.get(User, j.user_id) if j.user_id else None
        audit(db, user, f"job_{j.kind}", j.project_id, **{k: v for k, v in j.result.items() if not isinstance(v, (dict, list))})
        j.status, j.progress, j.message, j.finished_at = "done", 100, "완료", datetime.utcnow()
        db.commit()
    except Exception as ex:
        log.error("job %s failed: %s\n%s", job_id, ex, traceback.format_exc())
        db.rollback()
        j = db.get(Job, job_id)
        if j:
            from datetime import datetime as _dt
            j.status, j.error, j.message, j.finished_at = "failed", f"{type(ex).__name__}: {ex}"[:1000], "실패", _dt.utcnow()
            db.commit()
    finally:
        db.close()


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
            _set(db, f, progress=10, error=None)
            try:
                dxf, conv_warn = convert_dwg_to_dxf(src, proc_dir / "converted")
            except ConversionError as ex:
                _set(db, f, status=FileStatus.needs_converter if "설치되어 있지 않습니다" in str(ex) else FileStatus.failed,
                     error=str(ex), progress=0)
                return
            _set(db, f, progress=30)
            sheets = [parse_dxf(dxf)]
            sheets[0].warnings = conv_warn + sheets[0].warnings
        elif f.kind == "dxf":
            sheets = [parse_dxf(src)]
        elif f.kind == "pdf":
            sheets = parse_pdf(src, proc_dir, progress=lambda d, n: _set(db, f, progress=30 + int(30 * d / n)))
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
    "계통도": ["계통도", "계통", "RISER", "DIAGRAM", "결선도", "구성도"],
    "일람표": ["일람표", "SCHEDULE", "LIST", "목록"],
    "평면도": ["평면도", "배치도", "PLAN", "LAYOUT", "포설도"],
    "상세도": ["상세도", "DETAIL", "외형도", "단면도", "설치도"],
    "기타": ["개요", "현황", "표지", "주기사항", "곡선도"],
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
    """도면 문자에서 도면명·도면번호·종류·공종 추정 (OCR 문자도 고려: 큰 글씨 우선, 표제란(우하단) 우선)."""
    import re
    title = dno = dtype = disc = None
    dno_re = re.compile(r"^(?:[A-Z]{1,3}\s*[-_]\s*\d{1,3}\s*[-_]\s*\d{1,4}|[A-Z]{1,3}\s*[-_]\s*\d{2,4})$", re.I)
    big = sorted(sd.texts, key=lambda t: -(float(t.get("height") or 0)))[:8]
    found = {}
    for t in big:
        up = t["text"].upper()
        for k, keys in TYPE_KEYS.items():
            if k not in found and any(x in up for x in keys):
                found[k] = t["text"].strip()
    for k in ("평면도", "상세도", "계통도", "일람표", "범례", "기타"):
        if k in found:
            if k == "범례" and big and found[k] != big[0]["text"].strip():
                continue
            dtype, title = k, found[k]
            break
    bb = sd.bbox or {"x0": 0, "y0": 0, "x1": 1, "y1": 1}
    cands = []
    for t in sd.texts:
        s = t["text"].strip()
        if disc is None:
            disc = guess_discipline(s)
        if dno_re.match(s) and len(s) <= 14:
            # 우하단(표제란)에 가까울수록 우선
            score = (t["x"] - bb["x0"]) / max(bb["x1"] - bb["x0"], 1) - (t["y"] - bb["y0"]) / max(bb["y1"] - bb["y0"], 1)
            cands.append((score, re.sub(r"\s+", "", s).upper()))
    if cands:
        # '도면번호/SHEET NO/DWG NO' 라벨이 있으면 그 라벨 오른쪽·가까운 후보 우선
        label = None
        for t in sd.texts:
            u = t["text"].replace(" ", "").upper()
            if "도면번호" in u or "SHEETNO" in u or "DWGNO" in u or "DRAWINGNO" in u:
                label = t
                break
        if label:
            def dist(c):
                return abs(c[2] - label["y"]) * 3 + max(0.0, label["x"] - c[1]) + 0.2 * abs(c[1] - label["x"])
            cands2 = [(sc, re.sub(r"\s+", "", t["text"]).upper(), t["y"], t["x"]) for sc, t in
                      [(0, t) for t in sd.texts if dno_re.match(t["text"].strip()) and len(t["text"].strip()) <= 14]]
            if cands2:
                dno = min(cands2, key=lambda c: dist((c[0], c[3], c[2])))[1]
        if dno is None:
            dno = max(cands)[1]
    if dno is None:
        # OCR 표제란: '도면번호 E - 20 - 001' 이 '번호는 20 001' 처럼 깨진 경우
        tb_re = re.compile(r"번호[^0-9A-Z]{0,4}([A-Z])?\s*[-–—]?\s*(\d{2})\s*[-–—]?\s*(\d{3})\b")
        for t in sd.texts:
            m = tb_re.search(t["text"].upper())
            if m:
                letter = m.group(1) or {"전기": "E", "정보통신": "T", "소방전기": "F"}.get(disc or "", "")
                dno = f"{letter}-{m.group(2)}-{m.group(3)}" if letter else f"{m.group(2)}-{m.group(3)}"
                break
    if title is None:
        for t in big:
            s = t["text"].strip()
            if len(re.findall(r"[가-힣]", s)) >= 3 and len(s) <= 40:
                title = s
                break
    return title, dno, dtype, disc
