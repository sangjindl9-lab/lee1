"""PDF/이미지 분석 (PyMuPDF + OpenCV + Tesseract 한글 OCR).

- 벡터 PDF: 선·도형·텍스트 좌표 우선 추출 (page.get_drawings / get_text("dict"))
- 이미지 PDF: 렌더 → 기울기 보정·노이즈 제거 → OCR (kor+eng)
- 혼합: 둘 다
PDF 좌표는 포인트(1/72 in). 축척은 도면 표기에서 자동 추정하되 scale_confirmed=False 로 두고
사용자 확인 전에는 길이를 확정하지 않는다 (테스트 8).
"""
from __future__ import annotations

import re
import shutil
from pathlib import Path

import numpy as np
import pymupdf

from .dxf_parser import SheetData
from .geometry import bbox_of, polyline_length

try:
    import pytesseract
    HAS_TESSERACT = shutil.which("tesseract") is not None
except ImportError:  # pragma: no cover
    pytesseract = None
    HAS_TESSERACT = False

SCALE_RE = re.compile(r"(?:S\s*[=:：]|SCALE\s*[=:：]?|축\s*척\s*[=:：]?)\s*1\s*[/:：]\s*(\d{2,5})", re.I)
RENDER_DPI = 150


def _deskew_and_clean(img: np.ndarray) -> tuple[np.ndarray, float]:
    """기울기 보정 + 노이즈 제거. 반환 (이미지, 보정각도)."""
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
        if abs(angle) > 10:  # 큰 각도는 도면 특성상 오탐 가능성 → 보정 안 함
            angle = 0.0
    if abs(angle) > 0.2:
        h, w = gray.shape
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        gray = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return gray, angle


def ocr_image(gray: np.ndarray, lang: str = "kor+eng") -> list[dict]:
    """OCR → [{text,x,y,w,h,conf}] (픽셀 좌표). 엔진 없으면 빈 리스트 + 호출자가 경고."""
    if not HAS_TESSERACT:
        return []
    data = pytesseract.image_to_data(gray, lang=lang, config="--psm 11", output_type=pytesseract.Output.DICT)
    out = []
    for i, txt in enumerate(data["text"]):
        txt = (txt or "").strip()
        conf = float(data["conf"][i]) if data["conf"][i] not in ("-1", -1) else -1
        if txt and conf >= 30:
            out.append({"text": txt, "x": int(data["left"][i]), "y": int(data["top"][i]),
                        "w": int(data["width"][i]), "h": int(data["height"][i]), "conf": conf})
    return out


def parse_pdf(path: Path, out_dir: Path) -> list[SheetData]:
    doc = pymupdf.open(str(path))
    sheets: list[SheetData] = []
    out_dir.mkdir(parents=True, exist_ok=True)
    for pno, page in enumerate(doc, start=1):
        sheets.append(_parse_page(page, pno, out_dir))
    return sheets


def parse_image(path: Path, out_dir: Path) -> list[SheetData]:
    """JPG/PNG 도면 → PDF 페이지와 동일 처리 (이미지 전용)."""
    doc = pymupdf.open()
    img = pymupdf.open(str(path))
    rect = img[0].rect
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

    def flip(x, y):  # PDF y-down → 도면 y-up
        return (float(x), float(H - y))

    # --- 벡터 ---
    prims, entities, texts = [], [], []
    drawings = page.get_drawings()
    for di, d in enumerate(drawings):
        handle = f"p{pno}d{di}"
        pts_all = []
        items = d["items"]
        # 베지어 4개로 닫힌 원 → 원 프리미티브(지문 매칭용)
        if items and all(it[0] == "c" for it in items) and 3 <= len(items) <= 5:
            allp = [q for it in items for q in (it[1], it[2], it[3], it[4])]
            xs = [q.x for q in allp]
            ys = [q.y for q in allp]
            w, hh = max(xs) - min(xs), max(ys) - min(ys)
            if w > 0 and hh > 0 and abs(w - hh) / max(w, hh) < 0.08 and items[0][1].distance_to(items[-1][4]) < 0.5:
                cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
                r = (w + hh) / 4
                from .geometry import arc_points
                p = [flip(x, y) for x, y in arc_points(cx, cy, r, 0, 360, 24)]
                prims.append({"t": "c", "p": p, "r": r, "c": flip(cx, cy), "h": handle, "layer": "PDF"})
                entities.append({"h": handle, "t": "CIRCLE", "layer": "PDF", "bbox": bbox_of(p), "center": flip(cx, cy), "radius": r, "width": d.get("width")})
                continue
        for item in items:
            op = item[0]
            if op == "l":
                p = [flip(item[1].x, item[1].y), flip(item[2].x, item[2].y)]
                prims.append({"t": "l", "p": p, "h": handle, "layer": "PDF"})
                pts_all.extend(p)
            elif op == "re":
                r = item[1]
                p = [flip(r.x0, r.y0), flip(r.x1, r.y0), flip(r.x1, r.y1), flip(r.x0, r.y1), flip(r.x0, r.y0)]
                prims.append({"t": "l", "p": p, "h": handle, "layer": "PDF"})
                pts_all.extend(p)
            elif op == "c":  # 베지어 → 직선 근사
                p = [flip(q.x, q.y) for q in (item[1], item[2], item[3], item[4])]
                prims.append({"t": "a", "p": p, "h": handle, "layer": "PDF"})
                pts_all.extend(p)
            elif op == "qu":
                q = item[1]
                p = [flip(q.ul.x, q.ul.y), flip(q.ur.x, q.ur.y), flip(q.lr.x, q.lr.y), flip(q.ll.x, q.ll.y), flip(q.ul.x, q.ul.y)]
                prims.append({"t": "l", "p": p, "h": handle, "layer": "PDF"})
                pts_all.extend(p)
        if pts_all:
            entities.append({"h": handle, "t": "PDFPATH", "layer": "PDF", "bbox": bbox_of(pts_all),
                             "length": polyline_length(pts_all) if len(d["items"]) == 1 else None,
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
            bb = {"x0": x0, "y0": H - y1, "x1": x1, "y1": H - y0}
            texts.append({"h": handle, "text": s, "x": x0, "y": H - y1, "layer": "PDF", "height": y1 - y0, "bbox": bb})
            entities.append({"h": handle, "t": "TEXT", "layer": "PDF", "text": s, "x": x0, "y": H - y1, "bbox": bb})

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

    # --- 렌더 (뷰어 배경 + OCR) ---
    pix = page.get_pixmap(dpi=RENDER_DPI)
    raster = out_dir / f"page_{pno}.png"
    pix.save(str(raster))
    px_per_pt = RENDER_DPI / 72.0

    if kind != "pdf_vector":
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
        if pix.n == 4:
            img = img[:, :, :3]
        gray, angle = _deskew_and_clean(img.copy())
        if abs(angle) > 0.2:
            warnings.append(f"스캔 기울기 {angle:.2f}° 보정 적용")
        if pix.w < 1500:
            warnings.append("스캔 해상도가 낮아 OCR·기호 인식 정확도가 떨어질 수 있습니다.")
        if not HAS_TESSERACT:
            warnings.append("OCR 엔진(tesseract)이 설치되지 않아 스캔 도면의 문자를 인식하지 못했습니다.")
        else:
            for oi, o in enumerate(ocr_image(gray)):
                x, y = o["x"] / px_per_pt, o["y"] / px_per_pt
                w, h = o["w"] / px_per_pt, o["h"] / px_per_pt
                bb = {"x0": x, "y0": H - y - h, "x1": x + w, "y1": H - y}
                handle = f"p{pno}o{oi}"
                texts.append({"h": handle, "text": o["text"], "x": x, "y": H - y - h, "layer": "OCR",
                              "height": h, "bbox": bb, "conf": o["conf"]})
                entities.append({"h": handle, "t": "OCRTEXT", "layer": "OCR", "text": o["text"], "x": x, "y": H - y - h, "bbox": bb, "conf": o["conf"]})

    # --- 축척 추정 (확정 아님) ---
    scale_guess = None
    for t in texts:
        m = SCALE_RE.search(t["text"].replace(" ", ""))
        if m:
            denom = int(m.group(1))
            scale_guess = (25.4 / 72.0) / 1000.0 * denom   # 1pt = 25.4/72 mm → ×축척 → m
            break
    if scale_guess is None:
        warnings.append("축척 표기를 찾지 못했습니다. 길이 산출 전 축척 또는 기준거리를 입력하십시오.")
    else:
        warnings.append(f"도면 문자에서 축척 1/{denom} 을(를) 추정했습니다. 산출 전 확인·승인이 필요합니다.")

    layers = [{"name": "PDF", "color": 7, "count": len(drawings)}]
    if any(t["layer"] == "OCR" for t in texts):
        layers.append({"name": "OCR", "color": 1, "count": sum(1 for t in texts if t["layer"] == "OCR")})

    stats = {"drawings": len(drawings), "texts": len(texts), "image_area_ratio": round(img_area / page_area, 3),
             "render": {"w": pix.w, "h": pix.h, "dpi": RENDER_DPI}}
    sd = SheetData(source_kind=kind, units="pt", scale_factor=scale_guess, bbox={"x0": 0, "y0": 0, "x1": W, "y1": H},
                   layers=layers, entities=entities, blocks={}, prims=prims, texts=texts, warnings=warnings,
                   stats=stats, sheet_name=f"Page {pno}")
    sd.stats["raster_path"] = str(raster)
    return sd
