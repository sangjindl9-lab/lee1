"""실제 도면 PDF/DXF 의 범례표에서 기호(도형)와 품명을 뽑아 심볼 라이브러리 보강 항목을 만든다.

사용: python tools/learn_legends.py <out.json> <공종> <파일1> [<파일2> ...]
결과 항목 형식은 app/data/symbol_library.json 의 symbols 와 같다 (source = 파일명).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine import legend as L  # noqa: E402
from app.engine.anchor import anchor_descriptor  # noqa: E402
from app.engine.dxf_parser import parse_dxf_sheets  # noqa: E402
from app.engine.geometry import bbox_of, bitmap_signature, prim_bbox  # noqa: E402
from app.engine.pdf_parser import ocr_cell, parse_pdf  # noqa: E402


def _norm_prims(prims, n=300):
    pts = [q for p in prims for q in p["p"]]
    if not pts:
        return []
    b = bbox_of(pts)
    s = 100.0 / max(b["x1"] - b["x0"], b["y1"] - b["y0"], 1e-9)
    return [{"t": p.get("t", "l"), "p": [(round((x - b["x0"]) * s, 1), round((y - b["y0"]) * s, 1)) for x, y in p["p"]]} for p in prims[:n]]


def learn_file(path: Path, disc: str, work: Path) -> tuple[list[dict], list[str]]:
    log, out = [], []
    if path.suffix.lower() == ".pdf":
        sheets = parse_pdf(path, work / path.stem)
    else:
        sheets = parse_dxf_sheets(path)
    for si, sd in enumerate(sheets, start=1):
        geo = {"prims": sd.prims, "texts": sd.texts, "entities": sd.entities, "blocks": sd.blocks, "bbox": sd.bbox,
               "_raster": sd.source_kind in ("pdf_raster", "pdf_mixed", "image")}
        fn = None
        rp = (sd.stats or {}).get("raster_path")
        if rp and (sd.stats.get("outline_text") or geo["_raster"]):
            dpi = sd.stats["render"]["dpi"]
            fn = lambda region, rp=rp, dpi=dpi, H=sd.bbox["y1"]: ocr_cell(rp, dpi, H, region)  # noqa: E731
        try:
            res = L.auto_detect_legends(geo, fn)
        except Exception as ex:  # 한 시트 실패는 건너뜀
            log.append(f"  p{si}: 범례 인식 오류 {type(ex).__name__}")
            continue
        for t in res:
            n_ok = 0
            for r in t.rows:
                name = (r.item_name or "").strip()
                cell = r.symbol_cell
                if not name or not cell or len(name) < 2 or r.category != "device":
                    continue
                prims = [p for p in sd.prims if len(p.get("p", [])) >= 2 and _inside(prim_bbox(p), cell)]
                if r.block_name and r.block_name in sd.blocks:
                    prims = sd.blocks[r.block_name].get("prims") or prims
                if not prims:
                    continue
                letters = [x["text"] for x in sd.texts if x.get("bbox") and _inside(x["bbox"], cell)]
                desc = anchor_descriptor(prims)
                sig = bitmap_signature(prims)
                b = bbox_of([q for p in prims for q in p["p"]])
                out.append({"name": re.sub(r"\s+", " ", name)[:80], "code": r.block_name, "discipline": disc, "category": "device",
                            "source": f"사용자 제공 도면({path.name})", "spec": r.spec,
                            "letters": [x.strip().upper() for x in letters if 0 < len(x.strip()) <= 4][:4],
                            "texts": letters[:6], "anchor": desc, "sig": sig,
                            "aspect": round(min(b["x1"] - b["x0"], b["y1"] - b["y0"]) / max(b["x1"] - b["x0"], b["y1"] - b["y0"], 1e-9), 3),
                            "thumb": _norm_prims(prims)})
                n_ok += 1
            log.append(f"  p{si} {sd.sheet_name}: 범례표 '{t.title}' {len(t.rows)}행 → 기호 {n_ok}개 학습")
    return out, log


def _inside(b, r, m=0.5):
    return b["x0"] >= r["x0"] - m and b["x1"] <= r["x1"] + m and b["y0"] >= r["y0"] - m and b["y1"] <= r["y1"] + m


if __name__ == "__main__":
    out_path, disc, files = Path(sys.argv[1]), sys.argv[2], [Path(x) for x in sys.argv[3:]]
    work = out_path.parent / "learn_work"
    work.mkdir(parents=True, exist_ok=True)
    allx, logs = [], []
    for f in files:
        items, log = learn_file(f, disc, work)
        logs.append(f"{f.name}: {len(items)}개")
        logs += log
        allx += items
    prev = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else []
    out_path.write_text(json.dumps(prev + allx, ensure_ascii=False), encoding="utf-8")
    print("\n".join(logs))
    print("learned", len(allx))
