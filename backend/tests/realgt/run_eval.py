"""실도면 채점 실행: 범례(2페이지) → 평면도(6,7페이지) 검출 → 정답 대비 점수.
사용: python tests/realgt/run_eval.py [--reparse]"""
import functools, json, os, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import pymupdf
from app.engine.pdf_parser import _parse_page, ocr_cell
from app.engine import legend as L
from app.engine.detect import detect_in_sheet
from tests.realgt.evaluate import report, score

PDF = "/tmp/aa/aa.pdf"; CACHE = Path("/tmp/aa/cache"); CACHE.mkdir(parents=True, exist_ok=True)
gt = json.load(open(Path(__file__).parent / "aa_e.json"))

def page(pno):
    f = CACHE / f"p{pno}.json"
    if f.exists() and "--reparse" not in sys.argv:
        return json.load(open(f))
    sd = _parse_page(pymupdf.open(PDF)[pno - 1], pno, CACHE)
    geo = {"prims": sd.prims, "texts": sd.texts, "entities": sd.entities, "blocks": {}, "bbox": sd.bbox,
           "_raster": False, "raster": sd.stats["raster_path"], "outline_text": sd.stats.get("outline_text")}
    json.dump(geo, open(f, "w"))
    return geo

def oc(geo):
    return functools.partial(ocr_cell, geo["raster"], 150, geo["bbox"]["y1"]) if geo.get("outline_text") else None

t0 = time.time()
g2 = page(2)
legs = L.auto_detect_legends(g2, oc(g2))
rows = [r for t in legs for r in t.rows]
syms = [{"id": i, "block_name": None, "fingerprint": r.fingerprint, "symbol_name": r.symbol_name, "category": r.category,
         "image_path": None, "item_name": r.item_name} for i, r in enumerate(rows) if r.category == "device" and r.item_name]
names = {s["id"]: s["item_name"] for s in syms}
print("범례 기호:", [s["item_name"] for s in syms])
results = {}
for pno in (6, 7):
    g = page(pno)
    local = L.auto_detect_legends(g, oc(g))
    excl = [t.region for t in local]
    t1 = time.time()
    dets = detect_in_sheet(g, syms, excl)
    print(f"p{pno}: 지역범례 {len(local)}개, 검출 {len(dets)}개 ({time.time()-t1:.0f}s)")
    dl = [{"item_name": names[d.legend_symbol_id], "x": d.x, "y": d.y, "status": d.status} for d in dets]
    if "-v" in sys.argv:
        for d in sorted(dl, key=lambda d: d["item_name"]):
            print("    ", d["item_name"][:16], round(d["x"]), round(d["y"]), d["status"])
    results[str(pno)] = score(gt["pages"][str(pno)], dl)
rec, prec = report(results)
print(f"총 {time.time()-t0:.0f}s")
