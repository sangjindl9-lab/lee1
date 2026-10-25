"""표준 심볼 라이브러리 매칭 — 도면에서 찾은 객체(외곽 도형 + 내부 내용 + 안쪽 문자)를
사용자 제공 심볼(DWG 블록)·TTA 표준 그림기호와 비교해 '이름 추천'을 만든다.

추천은 확정이 아니다. 화면에 후보(점수)로만 보여 주고 사용자가 눌러야 품명으로 쓴다.
모양만 같은 기호(빈 원 등)는 후보가 여러 개 나오므로 점수를 낮게 매긴다.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from .geometry import bitmap_similarity

LIB_PATH = Path(__file__).resolve().parents[1] / "data" / "symbol_library.json"


LEARNED_PATH = LIB_PATH.with_name("symbol_library_learned.json")


@lru_cache(maxsize=1)
def load_library() -> dict:
    """표준 심볼(심볼 DWG·TTA) + 실제 도면 범례에서 학습한 기호(symbol_library_learned.json)."""
    lib = {"version": 0, "sources": [], "symbols": []}
    if LIB_PATH.exists():
        with open(LIB_PATH, encoding="utf-8") as fp:
            lib = json.load(fp)
    if LEARNED_PATH.exists():
        with open(LEARNED_PATH, encoding="utf-8") as fp:
            learned = json.load(fp)
        base = max((e["id"] for e in lib["symbols"]), default=0)
        for k, e in enumerate(learned, start=1):
            lib["symbols"].append({**e, "id": base + k})
        lib["sources"] = sorted(set(lib.get("sources", [])) | {e["source"] for e in learned})
    return lib


def _norm_code(s: str | None) -> str:
    return re.sub(r"[\s_\-]", "", (s or "")).upper()


@lru_cache(maxsize=1)
def _code_index() -> dict:
    idx = {}
    for e in load_library()["symbols"]:
        if e.get("code"):
            idx.setdefault(_norm_code(e["code"]), e)
    return idx


def _letters_of(texts) -> set[str]:
    out = set()
    for t in texts or []:
        t = re.sub(r"\s", "", str(t)).upper()
        if 0 < len(t) <= 4 and re.fullmatch(r"[A-Z0-9가-힣]+", t):
            out.add(t)
    return out


def _shape_score(a: dict, lib: dict) -> float:
    """a, lib: anchor 서술자 {kind, aspect, dashed, interior{empty,bm,n,fill}}"""
    if not a or not lib:
        return 0.0
    if a["kind"] != lib["kind"]:
        if {a["kind"], lib["kind"]} == {"rect", "poly"}:
            kf = 0.7
        else:
            return 0.0
    else:
        kf = 1.0
    da = abs(a["aspect"] - lib["aspect"])
    af = max(0.0, 1.0 - da / (0.35 if a["kind"] == "circle" else 0.25))
    if af <= 0:
        return 0.0
    df = 1.0 if bool(a.get("dashed")) == bool(lib.get("dashed")) else 0.6
    ia, il = a.get("interior") or {}, lib.get("interior") or {}
    if ia.get("empty") and il.get("empty"):
        inner = 0.72            # 빈 도형끼리는 모양만으로 구분이 안 됨 → 낮게
    elif ia.get("empty") != il.get("empty"):
        inner = 0.2
    else:
        inner = bitmap_similarity({"bm": ia.get("bm"), "n": ia.get("n")}, {"bm": il.get("bm"), "n": il.get("n")}, dil=1)
        if bool(ia.get("fill")) != bool(il.get("fill")):
            inner *= 0.6
    return kf * af * df * inner


def suggest(anchor: dict | None, letters=(), discipline: str | None = None, block: str | None = None, top: int = 3,
            whole: dict | None = None, extra: list[dict] | None = None) -> list[dict]:
    """→ [{name, discipline, source, score, code}] 점수 높은 순. 블록명이 라이브러리 코드와 같으면 그 기호를 1순위로."""
    out = []
    if block:
        e = _code_index().get(_norm_code(block))
        if e:
            out.append({"name": e["name"], "discipline": e["discipline"], "source": e["source"], "code": e.get("code"),
                        "score": 0.99, "why": "블록명 일치", "id": e["id"]})
    if not anchor:
        return out
    G = _letters_of(letters)
    cands = []
    # extra = 이 프로젝트에서 학습한 범례 기호 (같은 도면 세트의 기호라 공용 라이브러리보다 우선)
    for e in list(extra or []) + load_library()["symbols"]:
        if out and e["id"] == out[0]["id"]:
            continue
        s = _shape_score(anchor, e.get("anchor"))
        if e.get("project"):
            s = min(s * 1.15, 0.99) if s >= 0.35 else s
        if s < 0.35:
            continue
        if whole and (e.get("sig") or {}).get("bm"):
            # 외곽선 밖(등기구 꼬리·다리 등)까지 포함한 전체 모양 비교 — 같은 빈 원끼리 구분
            ws = bitmap_similarity(whole, e["sig"], dil=1)
            s = 0.75 * s + 0.25 * ws
        L = set(e.get("letters") or [])
        if L and G:
            s *= 1.25 if (L & G) else 0.45
        elif L and not G:
            s *= 0.4 if (anchor.get("interior") or {}).get("empty") else 0.8
        elif G and not L:
            s *= 0.6
        if discipline and e["discipline"] not in (discipline, "공통"):
            s *= 0.9
        s = min(s, 0.99 if e.get("project") else 0.97)
        if s >= 0.5:
            cands.append({"name": e["name"], "discipline": e["discipline"], "source": e["source"], "code": e.get("code"),
                          "score": round(s, 3), "why": ("프로젝트 범례 " if e.get("project") else "") + "모양" + ("·문자" if L & G else ""),
                          "id": e["id"], **({"spec": e.get("spec"), "unit": e.get("unit")} if e.get("project") else {})})
    cands.sort(key=lambda c: -c["score"])
    # 같은 이름 중복 제거
    seen = {c["name"] for c in out}
    for c in cands:
        if c["name"] in seen:
            continue
        seen.add(c["name"])
        out.append(c)
        if len(out) >= top:
            break
    return out


def thumb(sym_id: int) -> list:
    for e in load_library()["symbols"]:
        if e["id"] == sym_id:
            return e.get("thumb") or []
    return []
