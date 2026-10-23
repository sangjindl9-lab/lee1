"""테스트용 도면 생성기 — 실제 샘플 도면이 없으므로 ezdxf/PyMuPDF 로 생성한다.
모든 도면 제목에 '[테스트 도면]' 을 표기한다 (테스트 데이터임을 명시)."""
from __future__ import annotations

import math
from pathlib import Path

import ezdxf
import pymupdf


def _legend_block_fix(doc):
    b = doc.blocks.new("CCTV_FIX")
    b.add_circle((0, 0), 150)
    b.add_lwpolyline([(-80, -60), (80, -60), (0, 90), (-80, -60)])
    b.add_text("C", dxfattribs={"height": 60}).set_placement((-20, -20))
    return b


def _legend_block_ptz(doc):
    b = doc.blocks.new("CCTV_PTZ")
    b.add_circle((0, 0), 150)
    b.add_line((-100, 0), (100, 0))
    b.add_line((0, -100), (0, 100))
    b.add_circle((0, 0), 50)
    return b


def _legend_block_jb(doc):
    b = doc.blocks.new("JB_OUT")
    b.add_lwpolyline([(-120, -120), (120, -120), (120, 120), (-120, 120), (-120, -120)])
    b.add_text("JB", dxfattribs={"height": 70}).set_placement((-60, -30))
    return b


def make_cctv_plan(path: Path, n_fix: int = 12, n_ptz: int = 3, with_duplicate: bool = False, scale_text: bool = True):
    """사례 A: 공원 CCTV 배치도 + 범례표 + 통신 전선관(10m,20m,15m 연결) (단위 mm)."""
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4  # mm
    for name, color in (("T-CCTV", 1), ("T-CONDUIT", 4), ("T-UTP", 3), ("T-TEXT", 7), ("T-LEGEND", 7), ("T-EXIST", 8)):
        doc.layers.add(name, color=color)
    _legend_block_fix(doc)
    _legend_block_ptz(doc)
    _legend_block_jb(doc)
    msp = doc.modelspace()
    msp.add_text("[테스트 도면] 공원 CCTV 설치공사 — CCTV 배치도", dxfattribs={"height": 400, "layer": "T-TEXT"}).set_placement((0, 32000))
    msp.add_text("C-01", dxfattribs={"height": 300, "layer": "T-TEXT"}).set_placement((0, 31400))
    if scale_text:
        msp.add_text("SCALE 1/500", dxfattribs={"height": 300, "layer": "T-TEXT"}).set_placement((5000, 31400))
    # --- 기구 배치 ---
    for i in range(n_fix):
        msp.add_blockref("CCTV_FIX", (2000 + (i % 6) * 4000, 5000 + (i // 6) * 6000), dxfattribs={"layer": "T-CCTV", "rotation": (i * 37) % 360})
    for i in range(n_ptz):
        msp.add_blockref("CCTV_PTZ", (3000 + i * 8000, 20000), dxfattribs={"layer": "T-CCTV", "xscale": 1.0 + 0.5 * (i % 2), "yscale": 1.0 + 0.5 * (i % 2)})
    msp.add_blockref("JB_OUT", (12000, 25000), dxfattribs={"layer": "T-CCTV"})
    # 기존 시설 (신규 수량에 포함되면 안 됨)
    msp.add_blockref("CCTV_FIX", (26000, 26000), dxfattribs={"layer": "T-EXIST"})
    # --- 전선관: 10m, 20m, 15m 연결 구간 (mm) ---
    pts = [(2000, 2000), (12000, 2000), (12000, 22000), (27000, 22000)]
    for a, b in zip(pts, pts[1:]):
        msp.add_line(a, b, dxfattribs={"layer": "T-CONDUIT"})
    if with_duplicate:
        msp.add_line((2000, 2000), (12000, 2000), dxfattribs={"layer": "T-CONDUIT"})  # 중복 선분
    msp.add_text("CD22", dxfattribs={"height": 250, "layer": "T-TEXT"}).set_placement((6000, 2300))
    # --- 범례표 (우측) ---
    x0, y0 = 36000, 30000
    rows = [("기호", "품명", "규격", "단위"),
            ("CCTV_FIX", "고정형 네트워크 카메라", "4MP, 옥외형", "대"),
            ("CCTV_PTZ", "PTZ 네트워크 카메라", "30배 줌", "대"),
            ("JB_OUT", "통신 접속함", "옥외 방수형", "개"),
            ("LINE", "통신용 전선관", "CD 22mm", "m"),
            ("UTP", "LAN 케이블", "CAT.6 4P", "m")]
    rh, cols = 1200, [0, 3000, 11000, 18000, 21000]
    msp.add_text("범 례 표", dxfattribs={"height": 400, "layer": "T-LEGEND"}).set_placement((x0 + 8000, y0 + 600))
    for i in range(len(rows) + 1):
        y = y0 - i * rh
        msp.add_line((x0, y), (x0 + cols[-1], y), dxfattribs={"layer": "T-LEGEND"})
    for cx in cols:
        msp.add_line((x0 + cx, y0), (x0 + cx, y0 - len(rows) * rh), dxfattribs={"layer": "T-LEGEND"})
    for ri, row in enumerate(rows):
        y = y0 - ri * rh - rh * 0.65
        cy = y0 - ri * rh - rh * 0.5
        sym, *txt = row
        if ri == 0:
            msp.add_text(sym, dxfattribs={"height": 300, "layer": "T-LEGEND"}).set_placement((x0 + 900, y))
        elif sym in ("CCTV_FIX", "CCTV_PTZ", "JB_OUT"):
            msp.add_blockref(sym, (x0 + 1500, cy), dxfattribs={"layer": "T-LEGEND"})
        elif sym == "LINE":
            msp.add_line((x0 + 500, cy), (x0 + 2500, cy), dxfattribs={"layer": "T-CONDUIT"})
        elif sym == "UTP":
            msp.add_line((x0 + 500, cy), (x0 + 2500, cy), dxfattribs={"layer": "T-UTP"})
        for ci, t in enumerate(txt):
            msp.add_text(t, dxfattribs={"height": 300, "layer": "T-LEGEND"}).set_placement((x0 + cols[ci + 1] + 300, y))
    doc.saveas(path)
    return path


def make_cctv_riser(path: Path, n_cams: int = 14):
    """사례 A: CCTV 계통도 — 교차검증용 (배치도와 1대 차이)."""
    doc = ezdxf.new("R2018")
    doc.header["$INSUNITS"] = 4
    _legend_block_fix(doc)
    _legend_block_ptz(doc)
    msp = doc.modelspace()
    msp.add_text("[테스트 도면] CCTV 계통도", dxfattribs={"height": 400}).set_placement((0, 20000))
    msp.add_text("C-02", dxfattribs={"height": 300}).set_placement((0, 19400))
    for i in range(n_cams):
        msp.add_blockref("CCTV_FIX", (1000 + i * 1500, 10000))
    for i in range(3):
        msp.add_blockref("CCTV_PTZ", (1000 + i * 1500, 6000))
    doc.saveas(path)
    return path


def make_scanned_pdf(path: Path):
    """테스트 8: 축척 표기 없는 스캔형 PDF (이미지만)."""
    import numpy as np
    import cv2
    img = np.full((1200, 1700, 3), 255, np.uint8)
    cv2.rectangle(img, (100, 100), (1600, 1100), (0, 0, 0), 2)
    cv2.circle(img, (500, 500), 40, (0, 0, 0), 2)
    cv2.circle(img, (900, 500), 40, (0, 0, 0), 2)
    cv2.line(img, (500, 540), (900, 540), (0, 0, 0), 2)
    cv2.putText(img, "TEST DRAWING - NO SCALE", (120, 160), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2)
    tmp = path.with_suffix(".png")
    cv2.imwrite(str(tmp), img)
    pdf = pymupdf.open()
    page = pdf.new_page(width=842, height=595)
    page.insert_image(page.rect, filename=str(tmp))
    pdf.save(path)
    tmp.unlink()
    return path


def make_vector_pdf(path: Path):
    """벡터 PDF: 원형 기호 5개 + 'LEGEND' 표 (벡터 지문 매칭 테스트)."""
    pdf = pymupdf.open()
    page = pdf.new_page(width=842, height=595)
    page.insert_text((40, 40), "[TEST DRAWING] LIGHTING PLAN  SCALE 1/200", fontsize=12)
    page.insert_text((40, 60), "E-01", fontsize=10)
    for i in range(5):
        c = pymupdf.Point(150 + i * 100, 300)
        page.draw_circle(c, 12, width=1)
        page.draw_line(c + (-8, 0), c + (8, 0), width=1)
    # legend
    page.insert_text((600, 100), "LEGEND", fontsize=11)
    page.insert_text((600, 120), "SYMBOL", fontsize=8)
    page.insert_text((660, 120), "NAME", fontsize=8)
    page.insert_text((760, 120), "UNIT", fontsize=8)
    for i, (name, unit) in enumerate([("WALL LIGHT", "EA")]):
        y = 145 + i * 25
        c = pymupdf.Point(615, y - 4)
        page.draw_circle(c, 12, width=1)
        page.draw_line(c + (-8, 0), c + (8, 0), width=1)
        page.insert_text((660, y), name, fontsize=8)
        page.insert_text((760, y), unit, fontsize=8)
    for y in (108, 132, 158):
        page.draw_line(pymupdf.Point(595, y), pymupdf.Point(800, y), width=0.5)
    pdf.save(path)
    return path


if __name__ == "__main__":
    out = Path(__file__).parent / "fixtures"
    out.mkdir(exist_ok=True)
    make_cctv_plan(out / "test_cctv_plan.dxf")
    make_cctv_plan(out / "test_cctv_plan_dup.dxf", with_duplicate=True)
    make_cctv_riser(out / "test_cctv_riser.dxf")
    make_scanned_pdf(out / "test_scanned_noscale.pdf")
    make_vector_pdf(out / "test_vector.pdf")
    print("fixtures written to", out)
