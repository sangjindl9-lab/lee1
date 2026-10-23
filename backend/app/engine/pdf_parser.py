"""PDF/이미지 분석 (PyMuPDF + OpenCV + Tesseract 한글 OCR).

- 벡터 PDF: 선·도형·텍스트 좌표 우선 추출. 문자가 윤곽선(패스)으로 변환된 CAD PDF(텍스트 0개)는 OCR 로 문자 복원.
- 이미지 PDF: 렌더 → 기울기 보정·노이즈 제거 → OCR (kor+eng)
- 레이어 대용: PDF 에는 레이어가 없으므로 선 굵기·색을 '스타일 키'(예: L0.42 #000000) 로 만들어 레이어처럼 사용.
PDF 좌표는 포인트(1/72 in). 축척은 도면 표기에서 추정하되 scale_confirmed=False (사용자 확인 전 길이 미확정).
"""
from __future__ import annotations

import math
import os
import re
import shutil
from pathlib import Path

import numpy as np
import pymupdf

from .dxf_parser import SheetData
from .geometry import arc_points, bbox_of, polyline_length

# tesseract 는 기본으로 OpenMP 다중 스레드를 쓰는데, 서버(공유 vCPU)에서는 스레드 경합으로 오히려 3~4배 느려진다.
# 페이지 단위 병렬 처리를 하므로 tesseract 내부 스레드는 1개로 고정한다. (자식 프로세스에 상속)
os.environ.setdefault("OMP_THREAD_LIMIT", "1")

try:
    import pytesseract
    HAS_TESSERACT = shutil.which("tesseract") is not None
except ImportError:  # pragma: no cover
    pytesseract = None
    HAS_TESSERACT = False

SCALE_RE = re.compile(r"(?:S\s*[=:：]|SCALE\s*[=:：]?|축\s*척\s*[=:：]?|A3\s*[=:：]|A1\s*[=:：])\s*1\s*[/:：]\s*(\d{2,5})", re.I)
RENDER_DPI = 150
PAPER_SCALE_RE = re.compile(r"(A[0-4])[:：=]?(?:S=)?1[/:：](\d{2,5})")
PAPERS = {"A0": (1189, 841), "A1": (841, 594), "A2": (594, 420), "A3": (420, 297), "A4": (297, 210)}


def _paper_of(w_pt: float, h_pt: float) -> str | None:
    w, h = sorted((w_pt * 25.4 / 72, h_pt * 25.4 / 72), reverse=True)
    for name, (pw, ph) in PAPERS.items():
        if abs(w - pw) / pw < 0.04 and abs(h - ph) / ph < 0.04:
            return name
    return None
OCR_DPI = 300


def _deskew_and_clean(img: np.ndarray) -> tuple[np.ndarray, float]:
    import cv2
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    gray = cv2.medianBlur(gray, 3)
    thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thr > 0))
    angle = 0.0
    if len(coords) > 100:
        rect = cv2.minAreaRect(coords.astype(np.float32))
        a = rect[-1]
        angle = -(90 + a) if a < -45 else -a
        if abs(angle) > 10:
            angle = 0.0
    if abs(angle) > 0.2:
        h, w = gray.shape
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        gray = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return gray, angle


def _raster_lines(gray: np.ndarray, min_len_px: int = 30) -> list[tuple[float, float, float, float]]:
    """이진화(적응형) → 긴 가로/세로 커널 모폴로지 → 연결요소 → 직선 (픽셀 좌표, y-down)."""
    import cv2
    thr = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, 31, 15)
    thr = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))
    out = []
    for horiz in (True, False):
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (min_len_px, 1) if horiz else (1, min_len_px))
        m = cv2.morphologyEx(thr, cv2.MORPH_OPEN, k)
        n, _, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
        segs = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            if horiz and w >= min_len_px:
                segs.append((float(y + h / 2), float(x), float(x + w)))
            elif not horiz and h >= min_len_px:
                segs.append((float(x + w / 2), float(y), float(y + h)))
        # 글자·노이즈로 끊긴 격자선 이어 붙이기: 같은 줄(±4px)에서 간격 ≤ 120px
        segs.sort()
        rows: list[list] = []
        for c, a, b in segs:
            if rows and abs(rows[-1][0] - c) <= 4:
                rows[-1][1].append((a, b))
            else:
                rows.append([c, [(a, b)]])
        for c, parts in rows:
            parts.sort()
            cur = list(parts[0])
            for a, b in parts[1:]:
                if a - cur[1] <= 250:
                    cur[1] = max(cur[1], b)
                else:
                    out.append((cur[0], c, cur[1], c) if horiz else (c, cur[0], c, cur[1]))
                    cur = [a, b]
            out.append((cur[0], c, cur[1], c) if horiz else (c, cur[0], c, cur[1]))
    return out


def ocr_image(gray: np.ndarray, lang: str = "kor+eng") -> list[dict]:
    """OCR → 단어 박스 [{text,x,y,w,h,conf}] (픽셀). CAD 폰트는 글자 사이가 벌어져 한 글자씩 나오므로 호출자가 줄 단위로 합친다."""
    if not HAS_TESSERACT:
        return []
    data = pytesseract.image_to_data(gray, lang=lang, config="--psm 11", output_type=pytesseract.Output.DICT)
    out = []
    for i, txt in enumerate(data["text"]):
        txt = (txt or "").strip()
        try:
            conf = float(data["conf"][i])
        except (TypeError, ValueError):
            conf = -1
        if txt and conf >= 30:
            out.append({"text": txt, "x": int(data["left"][i]), "y": int(data["top"][i]),
                        "w": int(data["width"][i]), "h": int(data["height"][i]), "conf": conf})
    return out


def merge_words_to_lines(words: list[dict], vlines: list[tuple[float, float, float]] | None = None, max_gap_h: float = 3.0) -> list[dict]:
    """같은 줄(세로 겹침 ≥ 50%)의 단어를 합친다. CAD 폰트는 글자 간격이 넓으므로 간격 허용을 크게(3h) 두되,
    두 단어 사이에 세로 격자선(vlines: (x, y0, y1), 픽셀)이 있으면 다른 칸이므로 합치지 않는다."""
    words = sorted(words, key=lambda w: (w["y"], w["x"]))
    vl = vlines or []

    def separated(a, b):
        ya0, ya1 = min(a["y"], b["y"]), max(a["y"] + a["h"], b["y"] + b["h"])
        xa, xb = a["x"] + a["w"], b["x"]
        return any(xa < x < xb and y0 < ya1 and y1 > ya0 for x, y0, y1 in vl)

    lines: list[list[dict]] = []
    for w in words:
        placed = False
        for L in lines:
            last = L[-1]
            vy = min(last["y"] + last["h"], w["y"] + w["h"]) - max(last["y"], w["y"])
            gap = w["x"] - (last["x"] + last["w"])
            if vy >= 0.5 * min(last["h"], w["h"]) and -0.3 * w["h"] <= gap <= max_gap_h * max(last["h"], w["h"]) and not separated(last, w):
                L.append(w)
                placed = True
                break
        if not placed:
            lines.append([w])
    out = []
    for L in lines:
        x0 = min(w["x"] for w in L)
        y0 = min(w["y"] for w in L)
        x1 = max(w["x"] + w["w"] for w in L)
        y1 = max(w["y"] + w["h"] for w in L)
        s = L[0]["text"]
        for a, b in zip(L, L[1:]):
            gap = b["x"] - (a["x"] + a["w"])
            both_ascii = a["text"][-1].isascii() and b["text"][0].isascii()
            s += ("" if gap < 1.0 * max(a["h"], b["h"]) and not both_ascii else " ") + b["text"]
        out.append({"text": s, "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "conf": sum(w["conf"] for w in L) / len(L)})
    return out


def _style_key(d: dict) -> str:
    w = d.get("width")
    col = d.get("color")
    fill = d.get("fill")
    if (w is None or w == 0) and col is None:
        return "FILL " + _hex(fill)
    return f"L{round(w or 0, 2)} {_hex(col)}"


def _hex(c) -> str:
    if not c:
        return "#none"
    return "#%02x%02x%02x" % tuple(int(round(v * 255)) for v in c[:3])


def _pdf_workers(n_pages: int) -> int:
    try:
        w = int(os.environ.get("KET_PDF_WORKERS", "0"))
    except ValueError:
        w = 0
    if w <= 0:
        try:
            cpus = len(os.sched_getaffinity(0))
        except AttributeError:  # pragma: no cover
            cpus = os.cpu_count() or 1
        w = min(cpus, 4)
    return max(1, min(w, n_pages))


def _parse_page_subprocess(path: str, pno: int, out_dir: str) -> SheetData:
    """한 페이지를 독립 파이썬 프로세스에서 분석 (PyMuPDF 는 스레드 안전하지 않고, multiprocessing spawn 은
    호출한 스크립트를 다시 import 하므로 사용하지 않는다). 결과는 pickle 파일로 받는다."""
    import pickle
    import subprocess
    import sys
    backend_dir = str(Path(__file__).resolve().parents[2])
    res = Path(out_dir) / f".page_{pno}.pkl"
    env = dict(os.environ)
    env["PYTHONPATH"] = backend_dir + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    r = subprocess.run([sys.executable, "-m", "app.engine.pdf_page_worker", path, str(pno), out_dir, str(res)],
                       env=env, cwd=backend_dir, capture_output=True, text=True, timeout=1800)
    if r.returncode != 0 or not res.exists():
        raise RuntimeError(f"page {pno} worker failed: {(r.stderr or '')[-500:]}")
    try:
        with open(res, "rb") as fp:
            return pickle.load(fp)
    finally:
        res.unlink(missing_ok=True)


def parse_pdf(path: Path, out_dir: Path, progress=None) -> list[SheetData]:
    """페이지별 분석. 여러 페이지면 페이지 단위 프로세스 병렬(KET_PDF_WORKERS, 기본 min(CPU,4)). progress(done, total)."""
    doc = pymupdf.open(str(path))
    n = len(doc)
    out_dir.mkdir(parents=True, exist_ok=True)
    workers = _pdf_workers(n)
    results: dict[int, SheetData] = {}
    if workers > 1:
        from concurrent.futures import ThreadPoolExecutor, as_completed
        try:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = {ex.submit(_parse_page_subprocess, str(path), pno, str(out_dir)): pno for pno in range(1, n + 1)}
                for f in as_completed(futs):
                    try:
                        results[futs[f]] = f.result()
                    except Exception:
                        pass  # 실패한 페이지는 아래에서 순차 재처리
                    if progress:
                        progress(len(results), n)
        except Exception:
            pass
    for pno in range(1, n + 1):
        if pno not in results:
            results[pno] = _parse_page(doc[pno - 1], pno, out_dir)
            if progress:
                progress(len(results), n)
    doc.close()
    return [results[p] for p in range(1, n + 1)]


def parse_image(path: Path, out_dir: Path) -> list[SheetData]:
    doc = pymupdf.open()
    img = pymupdf.open(str(path))
    pdfbytes = img.convert_to_pdf()
    imgpdf = pymupdf.open("pdf", pdfbytes)
    doc.insert_pdf(imgpdf)
    out_dir.mkdir(parents=True, exist_ok=True)
    sd = _parse_page(doc[0], 1, out_dir)
    sd.source_kind = "image"
    return [sd]


def _parse_page(page: pymupdf.Page, pno: int, out_dir: Path) -> SheetData:
    warnings: list[str] = []
    W, H = page.rect.width, page.rect.height

    rot = page.rotation_matrix   # 회전된 페이지(렌더 기준)로 변환. 벡터/문자 좌표는 비회전 좌표계로 나온다.

    def flip(x, y):
        q = pymupdf.Point(x, y) * rot
        return (float(q.x), float(H - q.y))

    def flip_bbox(x0, y0, x1, y1):
        a, b = flip(x0, y0), flip(x1, y1)
        return {"x0": min(a[0], b[0]), "y0": min(a[1], b[1]), "x1": max(a[0], b[0]), "y1": max(a[1], b[1])}

    # --- 벡터: 패스 단위로 점열을 이어 붙여 프리미티브 수를 줄인다 (글자 윤곽선 = 1 프리미티브) ---
    prims, entities, texts = [], [], []
    drawings = page.get_drawings()
    style_counts: dict[str, int] = {}
    for di, d in enumerate(drawings):
        handle = f"p{pno}d{di}"
        items = d["items"]
        if not items:
            continue
        sk = _style_key(d)
        style_counts[sk] = style_counts.get(sk, 0) + 1
        is_fill = sk.startswith("FILL")
        # 베지어 3~5개로 닫힌 원 → 원 프리미티브
        if all(it[0] == "c" for it in items) and 3 <= len(items) <= 5:
            allp = [q for it in items for q in (it[1], it[2], it[3], it[4])]
            xs = [q.x for q in allp]
            ys = [q.y for q in allp]
            w, hh = max(xs) - min(xs), max(ys) - min(ys)
            if w > 0 and hh > 0 and abs(w - hh) / max(w, hh) < 0.08 and items[0][1].distance_to(items[-1][4]) < 0.5:
                cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
                r = (w + hh) / 4
                p = [flip(x, y) for x, y in arc_points(cx, cy, r, 0, 360, 24)]
                prims.append({"t": "c", "p": p, "r": r, "c": flip(cx, cy), "h": handle, "layer": sk})
                entities.append({"h": handle, "t": "CIRCLE", "layer": sk, "bbox": bbox_of(p), "center": flip(cx, cy), "radius": r})
                continue
        subpaths: list[list[tuple]] = []
        cur: list[tuple] = []
        has_curve = False
        for item in items:
            op = item[0]
            if op == "l":
                a, b = flip(item[1].x, item[1].y), flip(item[2].x, item[2].y)
                if cur and math.dist(cur[-1], a) < 1e-3:
                    cur.append(b)
                else:
                    if len(cur) >= 2:
                        subpaths.append(cur)
                    cur = [a, b]
            elif op == "c":
                has_curve = True
                pts = [flip(q.x, q.y) for q in (item[1], item[2], item[3], item[4])]
                if cur and math.dist(cur[-1], pts[0]) < 1e-3:
                    cur.extend(pts[1:])
                else:
                    if len(cur) >= 2:
                        subpaths.append(cur)
                    cur = pts
            elif op in ("re", "qu"):
                if len(cur) >= 2:
                    subpaths.append(cur)
                cur = []
                if op == "re":
                    r = item[1]
                    subpaths.append([flip(r.x0, r.y0), flip(r.x1, r.y0), flip(r.x1, r.y1), flip(r.x0, r.y1), flip(r.x0, r.y0)])
                else:
                    q = item[1]
                    subpaths.append([flip(q.ul.x, q.ul.y), flip(q.ur.x, q.ur.y), flip(q.lr.x, q.lr.y), flip(q.ll.x, q.ll.y), flip(q.ul.x, q.ul.y)])
        if len(cur) >= 2:
            subpaths.append(cur)
        pts_all = []
        for sp in subpaths:
            prims.append({"t": "f" if is_fill else ("a" if has_curve else "l"), "p": sp, "h": handle, "layer": sk})
            pts_all.extend(sp)
        if pts_all:
            entities.append({"h": handle, "t": "PDFFILL" if is_fill else "PDFPATH", "layer": sk, "bbox": bbox_of(pts_all),
                             "length": polyline_length(pts_all) if (len(subpaths) == 1 and not is_fill) else None,
                             "width": d.get("width"), "color": d.get("color")})

    tdict = page.get_text("dict")
    for bi, blk in enumerate(tdict.get("blocks", [])):
        if blk.get("type") != 0:
            continue
        for li, line in enumerate(blk.get("lines", [])):
            s = "".join(sp["text"] for sp in line["spans"]).strip()
            if not s:
                continue
            x0, y0, x1, y1 = line["bbox"]
            handle = f"p{pno}t{bi}_{li}"
            bb = flip_bbox(x0, y0, x1, y1)
            texts.append({"h": handle, "text": s, "x": bb["x0"], "y": bb["y0"], "layer": "TEXT", "height": bb["y1"] - bb["y0"], "bbox": bb})
            entities.append({"h": handle, "t": "TEXT", "layer": "TEXT", "text": s, "x": bb["x0"], "y": bb["y0"], "bbox": bb})

    # --- 이미지 여부 판정 ---
    img_area = 0.0
    for info in page.get_images(full=True):
        try:
            for r in page.get_image_rects(info[0]):
                img_area += r.width * r.height
        except Exception:
            pass
    page_area = W * H
    is_raster = img_area / page_area > 0.5 and len(drawings) < 50 and len(texts) < 20
    is_mixed = img_area / page_area > 0.2 and not is_raster
    kind = "pdf_raster" if is_raster else ("pdf_mixed" if is_mixed else "pdf_vector")

    # --- 렌더 (뷰어 배경) ---
    pix = page.get_pixmap(dpi=RENDER_DPI)
    raster = out_dir / f"page_{pno}.png"
    pix.save(str(raster))

    # --- OCR: 스캔/혼합 또는 문자가 윤곽선으로 변환된 벡터 PDF(텍스트 0개) ---
    outline_text = kind == "pdf_vector" and len(texts) == 0 and len(drawings) > 20
    if kind != "pdf_vector" or outline_text:
        if outline_text:
            warnings.append("문자가 윤곽선(패스)으로 변환된 PDF 입니다. OCR 로 문자를 복원했으므로 범례·도면번호를 확인하십시오.")
        opix = page.get_pixmap(dpi=OCR_DPI)
        img = np.frombuffer(opix.samples, dtype=np.uint8).reshape(opix.h, opix.w, opix.n)
        if opix.n == 4:
            img = img[:, :, :3]
        if outline_text:
            import cv2
            gray = cv2.cvtColor(np.ascontiguousarray(img), cv2.COLOR_BGR2GRAY)
            angle = 0.0
        else:
            gray, angle = _deskew_and_clean(img.copy())
            if abs(angle) > 0.2:
                warnings.append(f"스캔 기울기 {angle:.2f}° 보정 적용")
            if opix.w < 1500:
                warnings.append("스캔 해상도가 낮아 OCR·기호 인식 정확도가 떨어질 수 있습니다.")
        if not outline_text:
            # 스캔 이미지에서 표 격자선(수평·수직 직선) 추출 → 벡터 프리미티브로 추가 (범례표 칸 구조 인식용)
            try:
                kk = OCR_DPI / 72.0
                for (x0, y0, x1, y1) in _raster_lines(gray):
                    a, b = (x0 / kk, H - y0 / kk), (x1 / kk, H - y1 / kk)
                    prims.append({"t": "l", "p": [a, b], "h": f"p{pno}rl{len(prims)}", "layer": "RASTER-LINE"})
                style_counts["RASTER-LINE"] = sum(1 for pr in prims if pr.get("layer") == "RASTER-LINE")
            except Exception:
                pass
        if not HAS_TESSERACT:
            warnings.append("OCR 엔진(tesseract)이 설치되지 않아 문자를 인식하지 못했습니다.")
        else:
            k = OCR_DPI / 72.0
            # 세로 격자선 (픽셀 좌표, y-down) — 표 칸 경계에서 단어 병합을 끊는다
            vlines = []
            for pr in prims:
                if pr["t"] == "l" and len(pr["p"]) == 2:
                    (ax, ay), (bx, by) = pr["p"]
                    if abs(ax - bx) < 0.5 and abs(ay - by) > 8:
                        vlines.append((ax * k, (H - max(ay, by)) * k, (H - min(ay, by)) * k))
            for oi, o in enumerate(merge_words_to_lines(ocr_image(gray), vlines)):
                x, y, w, h = o["x"] / k, o["y"] / k, o["w"] / k, o["h"] / k
                bb = {"x0": x, "y0": H - y - h, "x1": x + w, "y1": H - y}
                handle = f"p{pno}o{oi}"
                texts.append({"h": handle, "text": o["text"], "x": x, "y": H - y - h, "layer": "OCR", "height": h, "bbox": bb, "conf": o["conf"]})
                entities.append({"h": handle, "t": "OCRTEXT", "layer": "OCR", "text": o["text"], "x": x, "y": H - y - h, "bbox": bb, "conf": o["conf"]})

    # --- 축척 추정 (확정 아님) ---
    # 한국 도면 표제란은 'A1: 1/200  A3: 1/400' 처럼 출력 용지별 축척을 함께 적는다.
    # PDF 페이지 크기로 용지를 판정해 그 용지의 축척을 고르고, 근거를 경고에 남긴다.
    paper = _paper_of(W, H)
    tagged: dict[str, int] = {}
    denoms = []
    for t in texts:
        raw = t["text"].replace(" ", "").upper()
        for m in PAPER_SCALE_RE.finditer(raw):
            tagged.setdefault(m.group(1), int(m.group(2)))
        for m in SCALE_RE.finditer(raw):
            denoms.append(int(m.group(1)))
    scale_guess, basis = None, None
    if paper and paper in tagged:
        denom, basis = tagged[paper], f"용지 {paper} 기준 표기 'A{paper[1:]}: 1/{tagged[paper]}'"
    elif denoms:
        denom = max(set(denoms), key=denoms.count)
        basis = f"도면 표기 1/{denom}" + (f" (여러 값 {sorted(set(denoms))} 중 최빈값)" if len(set(denoms)) > 1 else "")
    if basis:
        scale_guess = (25.4 / 72.0) / 1000.0 * denom
        warnings.append(f"축척 1/{denom} 추정 — {basis}, PDF 용지 {paper or '비표준'} ({W * 25.4 / 72:.0f}×{H * 25.4 / 72:.0f}mm). 확인 후 확정하십시오.")
    else:
        warnings.append("축척 표기를 찾지 못했습니다. 길이 산출 전 축척 또는 기준거리를 입력하십시오.")

    layers = [{"name": k, "color": 7, "count": v} for k, v in sorted(style_counts.items(), key=lambda kv: -kv[1])]
    if texts:
        layers.append({"name": "OCR" if any(t["layer"] == "OCR" for t in texts) else "TEXT", "color": 1, "count": len(texts)})
    stats = {"drawings": len(drawings), "prims": len(prims), "texts": len(texts), "image_area_ratio": round(img_area / page_area, 3),
             "outline_text": outline_text, "render": {"w": pix.w, "h": pix.h, "dpi": RENDER_DPI}}
    sd = SheetData(source_kind=kind, units="pt", scale_factor=scale_guess, bbox={"x0": 0, "y0": 0, "x1": W, "y1": H},
                   layers=layers, entities=entities, blocks={}, prims=prims, texts=texts, warnings=warnings,
                   stats=stats, sheet_name=f"Page {pno}")
    sd.stats["raster_path"] = str(raster)
    return sd


def ocr_cell(raster_path: str, dpi: float, page_h: float, region: dict, psm: int = 7, lang: str = "kor+eng") -> str:
    """표의 한 칸을 잘라 고해상도(2배)로 OCR — 희소 OCR 보다 셀 단위 인식이 정확하다."""
    if not HAS_TESSERACT:
        return ""
    try:
        import cv2
        img = cv2.imread(raster_path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return ""
        k = dpi / 72.0
        Hpx = img.shape[0]
        x0, x1 = int(region["x0"] * k), int(region["x1"] * k)
        y0, y1 = int(Hpx - region["y1"] * k), int(Hpx - region["y0"] * k)
        crop = img[max(0, y0):max(0, y1), max(0, x0):max(0, x1)]
        if crop.size == 0 or crop.shape[0] < 4:
            return ""
        # 잉크가 거의 없는 빈 칸은 OCR 생략 (스캔 범례표의 빈 행 수백 칸 → 수십 분 소요 방지)
        if (crop < 128).mean() < 0.004:
            return ""
        crop = cv2.resize(crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        crop = cv2.copyMakeBorder(crop, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255)
        txt = pytesseract.image_to_string(crop, lang=lang, config=f"--psm {psm}")
        return " ".join(txt.split())
    except Exception:
        return ""
