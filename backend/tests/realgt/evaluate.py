"""정답지 대비 기호 검출 채점: 품목별 재현율(찾은/실제)·정밀도(맞은/검출), 거리 허용 6pt."""
import json, math, sys

def match_name(gt_name, item_name):
    a = gt_name.replace(" ", "")
    b = (item_name or "").replace(" ", "")
    keys = {"LED투광형전등기구": ["투광"], "JOINTBOX": ["JOINT"], "PULLBOX": ["PULL"], "신설분전반": ["신설분전반"],
            "기존분전반": ["기존분전반"], "신설전력용맨홀": ["신설전력용맨홀", "신설전력용"], "기존전력용맨홀": ["기존전력용맨홀", "기존전력용"]}
    return any(k in b for k in keys.get(a, [a]))

def score(gt_page: dict, dets: list[dict], tol=6.0):
    """dets: [{item_name, x, y}] → {품목: (TP, 실제, 검출)}"""
    out = {}
    for name, pts in gt_page.items():
        cand = [d for d in dets if match_name(name, d["item_name"])]
        used = set()
        tp = 0
        for gx, gy in pts:
            best = None
            for i, d in enumerate(cand):
                if i in used:
                    continue
                dd = math.dist((gx, gy), (d["x"], d["y"]))
                if dd <= tol and (best is None or dd < best[0]):
                    best = (dd, i)
            if best:
                used.add(best[1])
                tp += 1
        out[name] = (tp, len(pts), len(cand))
    return out

def report(results: dict):
    T = R = D = 0
    for page, res in results.items():
        for name, (tp, n, nd) in res.items():
            T += tp; R += n; D += nd
            print(f"  p{page} {name:14s} 실제 {n:3d}  찾음 {tp:3d}  검출 {nd:3d}  재현율 {tp/max(n,1):.0%}  정밀도 {tp/max(nd,1):.0%}")
    print(f"  합계: 재현율 {T/max(R,1):.1%}  정밀도 {T/max(D,1):.1%}  (실제 {R}, 찾음 {T}, 검출 {D})")
    return T / max(R, 1), T / max(D, 1)
