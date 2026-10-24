"""표준 심볼 라이브러리 생성 — 사용자가 제공한 심볼 원본에서 기호별 이름·공종·모양 지문을 만든다.

입력
  - 심볼 DWG/DXF (블록 1개 = 기호 1개, 블록명 = 기호명):  tn(통신), en(전기), fn(소방)
  - TTA 표준 PDF  TTAK.KO-04.0082 '옥내 배선용 그림 기호' (명칭 | 그림기호 표)
출력
  - app/data/symbol_library.json  (원본 파일은 배포하지 않고, 이름·지문·축소 도형만 저장)

사용: python tools/build_symbol_library.py --dxf tn.dxf:정보통신 --dxf en.dxf:전기 --dxf fn.dxf:소방전기 --tta tta.pdf
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.engine.anchor import anchor_descriptor  # noqa: E402
from app.engine.dxf_parser import parse_dxf, repair_dxf_text_breaks  # noqa: E402
from app.engine.geometry import bbox_of, bitmap_signature  # noqa: E402

# 블록명 접두어(분류용) — 'd-방송단자함' → '방송단자함'
PREFIX = re.compile(r"^(?:[0-9]-|[a-zA-Z]-(?=[가-힣]))")
# 주기(설명문)·가닥수 표시·회로번호·인출/입상 표시 등은 수량 기호가 아님
SKIP = re.compile(r"^(arrow|m-|0-|t-|Z-[2-9]$|Z-회로번호|Z-인출|Z-입상|Z-입하|Z-G\d|A\$|\*|범례$)", re.I)

CODE_NAMES = {
    # 전기 (en)
    "분전반s": "분전반", "FS": "플로트스위치", "PS": "압력스위치", "MCC": "MCC반(전동기제어반)", "MCCB": "배선용차단기(MCCB)",
    "WHM": "전력량계", "WHM2": "전력량계", "SW1": "스위치 1구", "SW2": "스위치 2구", "SW3": "스위치 3구", "SW4": "스위치 4구",
    "SW33": "3로 스위치", "SF-SW": "안전스위치(SF-SW)",
    "IL비상등": "비상조명등", "IL쎈서등": "센서등", "IL직부2": "직부등", "IL직부방습": "방습형 직부등", "IL직부식탁": "식탁등",
    "EL매입다운라이트": "매입 다운라이트", "MH투광기": "투광등(MH)", "FL슬림": "형광등(슬림형)", "FL방습": "형광등(방습형)",
    "FL직부": "형광등(직부형)", "FL-PP": "형광등(PP)", "s-접지시험단자함": "접지시험단자함", "s-피뢰침": "피뢰침", "s-fan": "환풍기",
    "s-선풍기2": "천장 선풍기", "RC-옥내": "룸에어컨(옥내기)", "RC-옥외": "룸에어컨(옥외기)", "Z-죠인트박스": "조인트박스(J/B)",
    "Z-풀박스": "풀박스(P/B)", "Z-연결박스": "연결박스", "Z-맨홀s": "맨홀", "z-맨홀s": "맨홀", "Z-수공s": "수공", "z-수공s": "수공",
    "CO1": "콘센트 1구", "CO2": "콘센트 2구", "CO1E": "콘센트 1구(EL 누전차단기붙이)", "CO2E": "콘센트 2구(EL 누전차단기붙이)",
    "CO1W": "콘센트 1구(WP 방수형)", "CO2W": "콘센트 2구(WP 방수형)", "CO1N": "콘센트 1구(CO1N)", "CO2N": "콘센트 2구(CO2N)",
    "CO1T": "콘센트 1구(CO1T)", "CON11": "콘센트 1구(CON11)", "CON12": "콘센트 2구(CON12)", "CON11E": "콘센트 1구(EL, CON11E)",
    "CON12E": "콘센트 2구(EL, CON12E)", "CON11W": "콘센트 1구(WP, CON11W)", "CON12W": "콘센트 2구(WP, CON12W)",
    # 통신 (tn)
    "d-AMP": "증폭기(AMP)", "i-인터폰": "인터폰", "i-인터폰1": "인터폰", "s-카메라": "카메라(CCTV)",
    # 소방 (fn)
    "PS ": "압력스위치",
}


def friendly(code: str) -> str:
    if code in CODE_NAMES:
        return CODE_NAMES[code]
    m = re.match(r"^(IL벽부|MH외등|FPL-|FL-S|con-t)(\d*)$", code)
    if m:
        base = {"IL벽부": "벽부등", "MH외등": "외등(MH)", "FPL-": "FPL 등기구", "FL-S": "형광등(FL-S)", "con-t": "통신 인출구"}[m.group(1)]
        return f"{base} ({code})"
    name = PREFIX.sub("", code)
    name = re.sub(r"([가-힣])(\d+)$", r"\1 \2", name)    # 한글 뒤 숫자만 띄움: 연기식감지기3 → 연기식감지기 3
    return name


def _norm_prims(prims: list[dict], n: int = 300) -> list[dict]:
    pts = [q for p in prims for q in p["p"]]
    if not pts:
        return []
    b = bbox_of(pts)
    s = 100.0 / max(b["x1"] - b["x0"], b["y1"] - b["y0"], 1e-9)
    return [{"t": p.get("t", "l"), "p": [(round((x - b["x0"]) * s, 1), round((y - b["y0"]) * s, 1)) for x, y in p["p"]]} for p in prims[:n]]


def _letters(texts: list[str]) -> list[str]:
    out = []
    for t in texts:
        t = t.strip()
        if 0 < len(t) <= 4 and re.fullmatch(r"[A-Za-z0-9가-힣]+", t):
            out.append(t.upper())
    return out


def entry(name, code, disc, source, prims, texts, note=None):
    prims = [p for p in prims if len(p.get("p", [])) >= 2]
    if not prims:
        return None
    desc = anchor_descriptor(prims)
    sig = bitmap_signature(prims)
    pts = [q for p in prims for q in p["p"]]
    b = bbox_of(pts)
    return {"name": name, "code": code, "discipline": disc, "category": "device", "source": source,
            "letters": _letters(texts), "texts": [t for t in texts if t][:6], "anchor": desc, "sig": sig,
            "aspect": round(min(b["x1"] - b["x0"], b["y1"] - b["y0"]) / max(b["x1"] - b["x0"], b["y1"] - b["y0"], 1e-9), 3),
            "thumb": _norm_prims(prims), **({"note": note} if note else {})}


def from_dxf(path: Path, disc: str, label: str) -> list[dict]:
    repair_dxf_text_breaks(path)
    sd = parse_dxf(path)
    out = []
    for code, b in sd.blocks.items():
        if SKIP.match(code) or b.get("is_xref"):
            continue
        texts = b.get("texts") or []
        if any(len(t) > 10 for t in texts) or len(b.get("prims") or []) > 150:
            continue   # 설명문이 붙은 상세·주기 블록
        e = entry(friendly(code), code, disc, label, b.get("prims") or [], texts)
        if e:
            out.append(e)
    return out


def from_tta(path: Path) -> list[dict]:
    sys.path.insert(0, str(Path(__file__).parent))
    from tta_extract import extract
    out = []
    for r in extract(str(path)):
        name = r["name"].strip()
        if not r["prims"] or name.replace(" ", "") in ("명칭",) or re.match(r"^3\.\d", name):
            continue
        page = r["page"]
        if page <= 12:
            continue        # 3.2 일반배선(선 종류)은 기호 수량 대상 아님
        disc = "전기" if page <= 15 else "정보통신"
        e = entry(re.sub(r"\s+", " ", name), None, disc, "TTA TTAK.KO-04.0082", r["prims"], r["texts"])
        if e:
            out.append(e)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dxf", action="append", default=[], help="path:공종[:라벨]")
    ap.add_argument("--tta")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "app" / "data" / "symbol_library.json"))
    a = ap.parse_args()
    lib = []
    for spec in a.dxf:
        parts = spec.split(":")
        p, disc = Path(parts[0]), parts[1]
        label = parts[2] if len(parts) > 2 else f"사용자 제공 심볼({p.stem})"
        lib += from_dxf(p, disc, label)
    if a.tta:
        lib += from_tta(Path(a.tta))
    # 같은 공종·이름·모양 중복 제거
    seen, uniq = set(), []
    for e in lib:
        k = (e["discipline"], e["name"], (e["sig"] or {}).get("bm"))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(e)
    for i, e in enumerate(uniq):
        e["id"] = i + 1
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fp:
        json.dump({"version": 1, "sources": sorted({e["source"] for e in uniq}), "symbols": uniq}, fp, ensure_ascii=False, separators=(",", ":"))
    from collections import Counter
    print(len(uniq), "symbols", Counter(e["discipline"] for e in uniq), "anchors", sum(1 for e in uniq if e["anchor"]), "→", a.out)


if __name__ == "__main__":
    main()
