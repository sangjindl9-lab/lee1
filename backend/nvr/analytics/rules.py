"""분석 규칙(순수 계산부 — DB·네트워크 없음, 시험에서 직접 호출).

모든 판정은 '조건이 일정 시간 지속될 때' 활성으로 본다. 화면 좌표는 0~1 정규화 좌표로 받는다.
정확도 한계(색 기반 불꽃·안전모, 기준영상 비교 수위)는 docs/04-미구현목록.md 에 적었다.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

import cv2
import numpy as np

from . import DEFAULT_PARAMS
from .person import Track, helmet_ratio

Box = tuple[float, float, float, float]


@dataclass
class Condition:
    active: bool
    score: float = 0.0
    boxes: list[Box] = field(default_factory=list)
    info: dict[str, Any] = field(default_factory=dict)


@dataclass
class RuleSpec:
    id: int
    type: str
    zone: list[list[float]] = field(default_factory=list)
    line: list[list[float]] = field(default_factory=list)
    params: dict[str, Any] = field(default_factory=dict)

    def p(self, key: str) -> Any:
        if key in self.params and self.params[key] is not None:
            return self.params[key]
        return DEFAULT_PARAMS.get(self.type, {}).get(key)


class Persist:
    """최근 window 초 동안 조건이 ratio 이상 참이고, 관찰 기간이 window 를 채웠을 때 참."""

    def __init__(self, window: float, ratio: float = 0.7):
        self.window, self.ratio = max(0.0, float(window)), ratio
        self.hist: deque[tuple[float, bool]] = deque()

    def update(self, t: float, flag: bool) -> bool:
        self.hist.append((t, flag))
        # 창(window) 바깥의 가장 최근 1개는 남겨 관찰 기간 계산의 기준점으로 쓴다
        while len(self.hist) >= 2 and t - self.hist[1][0] >= self.window:
            self.hist.popleft()
        if not flag:
            # 연속성 판단: 마지막 판정이 거짓이면 즉시 비활성(닫힘은 상위에서 유지 시간을 둔다)
            return False
        if self.window <= 0:
            return True
        span = t - self.hist[0][0]
        if span < self.window * 0.85:
            return False
        n_true = sum(1 for _, f in self.hist if f)
        return n_true / len(self.hist) >= self.ratio


def zone_mask(zone: list[list[float]], w: int, h: int) -> np.ndarray:
    m = np.zeros((h, w), np.uint8)
    if len(zone) >= 3:
        pts = np.array([[int(round(x * w)), int(round(y * h))] for x, y in zone], np.int32)
        cv2.fillPoly(m, [pts], 255)
    else:
        m[:] = 255
    return m


def _bbox_of(mask: np.ndarray) -> list[Box]:
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, a = stats[i]
        if a >= 12:
            out.append((float(x), float(y), float(w), float(h)))
    out.sort(key=lambda b: -b[2] * b[3])
    return out[:5]


# ─────────────────────────────── 불꽃 ───────────────────────────────
class FireRule:
    """색(RGB·YCbCr 규칙) + 밝은 중심부 + 형태 흔들림(flicker) + 지속시간.

    정지한 주황색 물체(안전조끼·표지판)는 흔들림이 없어 걸러지지만, 움직이는 주황색 물체·석양·용접 불꽃은
    오탐 가능성이 있다.
    """

    def __init__(self, spec: RuleSpec):
        self.spec = spec
        self.prev: np.ndarray | None = None
        self.persist = Persist(float(spec.p("persist_seconds")))
        self._zm: np.ndarray | None = None

    def candidate(self, bgr: np.ndarray) -> tuple[np.ndarray, float, float]:
        h, w = bgr.shape[:2]
        if self._zm is None or self._zm.shape != (h, w):
            self._zm = zone_mask(self.spec.zone, w, h)
        sens = float(self.spec.p("sensitivity"))
        b, g, r = [c.astype(np.int16) for c in cv2.split(bgr)]
        ycc = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
        y, cr, cb = [c.astype(np.int16) for c in cv2.split(ycc)]
        r_thr = int(215 - 70 * sens)
        rgb = (r > r_thr) & (r >= g) & (g > b) & ((r - b) > 60)
        ycc_rule = (y > cb) & (cr > cb) & ((cr - cb) > 25) & (y > 110)
        m = ((rgb & ycc_rule).astype(np.uint8) * 255) & self._zm
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        zone_area = max(1, int(np.count_nonzero(self._zm)))
        area = np.count_nonzero(m) / zone_area
        # 불꽃 중심부: 매우 밝고 채도가 낮아지는 부분(흰~노랑)
        core = (y > 200) & (r > 230) & (g > 150)
        dil = cv2.dilate(m, np.ones((9, 9), np.uint8)) > 0
        core_frac = float(np.count_nonzero(core & dil)) / max(1, np.count_nonzero(m))
        return m, area, core_frac

    def update(self, bgr: np.ndarray, t: float) -> Condition:
        m, _area, _core = self.candidate(bgr)
        prev, self.prev = self.prev, m
        zone_area = max(1, int(np.count_nonzero(self._zm)))
        min_area = float(self.spec.p("min_area"))
        need_flick = float(self.spec.p("flicker"))
        boxes: list[Box] = []
        area = best_flick = 0.0
        if prev is not None and prev.shape == m.shape:
            # 덩어리별로 흔들림을 따로 잰다(정지한 주황색 물체가 섞여도 불꽃 덩어리 판정이 희석되지 않도록)
            n, lab, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(m | prev, np.ones((7, 7), np.uint8)), 8)
            for i in range(1, n):
                x, y, w, h, _a = stats[i]
                cur = m[y:y + h, x:x + w]
                old = prev[y:y + h, x:x + w]
                sel = lab[y:y + h, x:x + w] == i
                cur_px = np.count_nonzero(cur[sel])
                if cur_px / zone_area < min_area:
                    continue
                union = np.count_nonzero((cur | old)[sel])
                fl = np.count_nonzero((cur ^ old)[sel]) / union if union else 0.0
                best_flick = max(best_flick, fl)
                if fl < need_flick:
                    continue
                y_, _, _ = cv2.split(cv2.cvtColor(bgr[y:y + h, x:x + w], cv2.COLOR_BGR2YCrCb))
                core = np.count_nonzero((y_ > 200) & sel & (cur > 0)) / max(1, cur_px)
                if core < 0.03:
                    continue
                area += cur_px / zone_area
                boxes.append((float(x), float(y), float(w), float(h)))
        cand = bool(boxes)
        act = self.persist.update(t, cand)
        return Condition(act, score=round(min(1.0, area * 50), 3), boxes=boxes,
                         info={"area": round(area, 4), "flicker": round(best_flick, 3)})


# ─────────────────────────────── 연기(시험 기능) ───────────────────────────────
class SmokeRule:
    """배경 차분 전경 중 채도가 낮은 회색 영역이 일정 면적 이상 지속되고, 그 부분의 윤곽(고주파)이 배경보다 흐려질 때."""

    def __init__(self, spec: RuleSpec):
        self.spec = spec
        self.bg = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=12, detectShadows=False)
        self.persist = Persist(float(spec.p("persist_seconds")))
        self.n = 0
        self._zm: np.ndarray | None = None

    def update(self, bgr: np.ndarray, t: float) -> Condition:
        h, w = bgr.shape[:2]
        if self._zm is None or self._zm.shape != (h, w):
            self._zm = zone_mask(self.spec.zone, w, h)
        fg = self.bg.apply(bgr)
        self.n += 1
        if self.n < 20:
            return Condition(False, info={"learning": True})
        hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
        sens = float(self.spec.p("sensitivity"))
        grey = (hsv[..., 1] < 60 + 40 * sens) & (hsv[..., 2] > 70) & (hsv[..., 2] < 235)
        m = ((fg > 0) & grey).astype(np.uint8) * 255 & self._zm
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        area = np.count_nonzero(m) / max(1, np.count_nonzero(self._zm))
        blur_ok = False
        if area >= float(self.spec.p("min_area")):
            bgimg = self.bg.getBackgroundImage()
            if bgimg is not None:
                lap_c = np.abs(cv2.Laplacian(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), cv2.CV_32F))
                lap_b = np.abs(cv2.Laplacian(cv2.cvtColor(bgimg, cv2.COLOR_BGR2GRAY), cv2.CV_32F))
                sel = m > 0
                eb = float(lap_b[sel].mean()) if sel.any() else 0.0
                ec = float(lap_c[sel].mean()) if sel.any() else 0.0
                blur_ok = eb > 1.0 and ec < eb * 0.85
        cand = area >= float(self.spec.p("min_area")) and blur_ok
        act = self.persist.update(t, cand)
        return Condition(act, score=round(min(1.0, area * 10), 3), boxes=_bbox_of(m) if cand else [],
                         info={"area": round(area, 4)})


# ─────────────────────────────── 수위 ───────────────────────────────
def _ncc(a: np.ndarray, b: np.ndarray) -> float | None:
    a = a.astype(np.float32).ravel()
    b = b.astype(np.float32).ravel()
    sa, sb = a.std(), b.std()
    if sa < 4 and sb < 4:
        return None  # 둘 다 평탄 → 상관계수 무의미
    if sa < 1e-3 or sb < 1e-3:
        return 0.0
    return float(((a - a.mean()) * (b - b.mean())).mean() / (sa * sb))


def _changed(ref: np.ndarray, cur: np.ndarray, thr: float) -> bool:
    """기준 대비 바뀐 셀: 무늬 상관이 낮거나, 무늬(표준편차)가 절반 이하로 사라졌거나, 밝기가 크게 달라짐."""
    c = _ncc(ref, cur)
    if c is None:
        return abs(float(ref.mean()) - float(cur.mean())) > 25
    sr, sc = float(ref.std()), float(cur.std())
    if sr >= 6 and sc < sr * 0.45:
        return True
    if abs(float(ref.mean()) - float(cur.mean())) > 45:
        return True
    return c < thr


class WaterLevelRule:
    """기준 영상(물이 없을 때)과 비교. 위험 구역의 바닥 무늬가 물에 덮여 사라지는 비율, 또는 눈금선(수위봉·벽면)을
    따라 아래에서부터 덮인 높이(%)로 판정한다. 조명 변화에 강하도록 셀 단위 정규화 상관을 쓴다.
    """

    def __init__(self, spec: RuleSpec, ref_gray: np.ndarray | None):
        self.spec = spec
        self.ref = ref_gray
        self.persist = Persist(float(spec.p("persist_seconds")), ratio=0.8)
        self.ncc_thr = 0.45

    def set_reference(self, gray: np.ndarray) -> None:
        self.ref = gray

    def measure(self, gray: np.ndarray) -> dict[str, Any]:
        h, w = gray.shape
        ref = self.ref if self.ref.shape == gray.shape else cv2.resize(self.ref, (w, h))
        cur = cv2.GaussianBlur(gray, (5, 5), 0)
        ref = cv2.GaussianBlur(ref, (5, 5), 0)
        out: dict[str, Any] = {}
        zm = zone_mask(self.spec.zone, w, h)
        cell = max(12, w // 32)
        tot = chg = 0
        for y0 in range(0, h - cell + 1, cell):
            for x0 in range(0, w - cell + 1, cell):
                if zm[y0 + cell // 2, x0 + cell // 2] == 0:
                    continue
                tot += 1
                if _changed(ref[y0:y0 + cell, x0:x0 + cell], cur[y0:y0 + cell, x0:x0 + cell], self.ncc_thr):
                    chg += 1
        out["changed_ratio"] = round(chg / tot, 3) if tot else 0.0
        if len(self.spec.line) == 2:
            (bx, by), (tx, ty) = self.spec.line
            n = 40
            r = max(5, w // 64)
            flags = []
            for i in range(n):
                f = (i + 0.5) / n
                px = int((bx + (tx - bx) * f) * w)
                py = int((by + (ty - by) * f) * h)
                y0, y1, x0, x1 = max(0, py - r), min(h, py + r + 1), max(0, px - r), min(w, px + r + 1)
                if y1 - y0 < 3 or x1 - x0 < 3:
                    flags.append(False)
                    continue
                flags.append(_changed(ref[y0:y1, x0:x1], cur[y0:y1, x0:x1], self.ncc_thr))
            # 아래에서부터 연속으로 덮인 높이(작은 끊김 1칸 허용)
            level, gap = 0, 0
            for i, fl in enumerate(flags):
                if fl:
                    level, gap = i + 1, 0
                else:
                    gap += 1
                    if gap > 1:
                        break
            out["level_percent"] = round(100 * level / n)
        return out

    def update(self, gray: np.ndarray, t: float) -> Condition:
        if self.ref is None:
            return Condition(False, info={"need_reference": True})
        m = self.measure(gray)
        if "level_percent" in m:
            cand = m["level_percent"] >= float(self.spec.p("danger_percent"))
            score = m["level_percent"] / 100
        else:
            cand = m["changed_ratio"] >= float(self.spec.p("changed_ratio"))
            score = m["changed_ratio"]
        act = self.persist.update(t, cand)
        return Condition(act, score=round(float(score), 3), info=m)


# ─────────────────────────────── 사람 기반 규칙 ───────────────────────────────
class PersonRule:
    """intrusion / loitering / crowd / fall / running / stationary / no_helmet."""

    def __init__(self, spec: RuleSpec):
        self.spec = spec
        self.enter: dict[int, float] = {}
        self.fall_since: dict[int, float] = {}
        self.votes: dict[int, deque[bool]] = {}
        self.persist = Persist(float(spec.p("persist_seconds") or 0))
        self._zm: np.ndarray | None = None

    def _in_zone(self, tr: Track, w: int, h: int) -> bool:
        if self._zm is None or self._zm.shape != (h, w):
            self._zm = zone_mask(self.spec.zone, w, h)
        fx, fy = tr.foot
        x, y = min(w - 1, max(0, int(fx))), min(h - 1, max(0, int(fy) - 1))
        return bool(self._zm[y, x])

    def update(self, tracks: list[Track], bgr: np.ndarray, t: float) -> Condition:
        h, w = bgr.shape[:2]
        typ = self.spec.type
        inside = [tr for tr in tracks if self._in_zone(tr, w, h)]
        alive = {tr.id for tr in tracks}
        for d in (self.enter, self.fall_since, self.votes):
            for k in [k for k in d if k not in alive]:
                del d[k]
        for tr in tracks:
            if tr not in inside:
                self.enter.pop(tr.id, None)
        for tr in inside:
            self.enter.setdefault(tr.id, t)
        hits: list[Track] = []
        info: dict[str, Any] = {"persons": len(tracks), "in_zone": len(inside)}
        if typ == "intrusion":
            need = float(self.spec.p("min_seconds"))
            hits = [tr for tr in inside if t - self.enter[tr.id] >= need]
        elif typ == "loitering":
            need = float(self.spec.p("dwell_seconds"))
            hits = [tr for tr in inside if t - self.enter[tr.id] >= need]
            if inside:
                info["max_dwell"] = round(max(t - self.enter[tr.id] for tr in inside))
        elif typ == "crowd":
            cand = len(inside) >= int(self.spec.p("min_count"))
            act = self.persist.update(t, cand)
            return Condition(act, score=len(inside), boxes=[tr.box for tr in inside] if cand else [], info=info)
        elif typ == "fall":
            need = float(self.spec.p("persist_seconds"))
            for tr in inside:
                x, y, bw, bh = tr.box
                lying = bw > bh * 1.2
                upright_before = any(b[3] > b[2] * 1.4 for tt, b in tr.history if t - tt <= 15)
                if lying and (upright_before or tr.id in self.fall_since):
                    self.fall_since.setdefault(tr.id, t)
                    if t - self.fall_since[tr.id] >= need:
                        hits.append(tr)
                else:
                    self.fall_since.pop(tr.id, None)
        elif typ == "running":
            need = float(self.spec.p("speed"))
            for tr in inside:
                pts = [(tt, b) for tt, b in tr.history if t - tt <= 3.0]
                if len(pts) < 3:
                    continue
                (t0, b0), (t1, b1) = pts[0], pts[-1]
                if t1 - t0 < 1.5:
                    continue
                f0 = (b0[0] + b0[2] / 2, b0[1] + b0[3])
                f1 = (b1[0] + b1[2] / 2, b1[1] + b1[3])
                hgt = np.mean([b[3] for _, b in pts])
                v = float(np.hypot(f1[0] - f0[0], f1[1] - f0[1]) / max(hgt, 1) / (t1 - t0))
                if v >= need:
                    hits.append(tr)
                info["max_speed"] = max(info.get("max_speed", 0), round(v, 2))
        elif typ == "stationary":
            need = float(self.spec.p("seconds"))
            for tr in inside:
                if t - self.enter[tr.id] < need:
                    continue
                pts = [b for tt, b in tr.history if t - tt <= need]
                if len(pts) < 3:
                    continue
                feet = np.array([(b[0] + b[2] / 2, b[1] + b[3]) for b in pts])
                hgt = float(np.mean([b[3] for b in pts]))
                spread = float(np.max(np.linalg.norm(feet - feet.mean(0), axis=1)))
                if spread < 0.35 * hgt:
                    hits.append(tr)
        elif typ == "no_helmet":
            min_px = float(self.spec.p("min_person_px"))
            sens = float(self.spec.p("sensitivity"))
            thr = 0.40 - 0.25 * sens  # 머리 윗부분 중 안전모 색 비율이 이보다 낮으면 '미착용' 표
            need = max(2, int(self.spec.p("persist_seconds")))
            undecided = 0
            for tr in inside:
                if tr.box[3] < min_px or tr.box[1] <= 2:
                    undecided += 1
                    continue
                r = helmet_ratio(bgr, tr.box)
                if r is None:
                    undecided += 1
                    continue
                v = self.votes.setdefault(tr.id, deque(maxlen=max(need + 2, 6)))
                v.append(r < thr)
                if len(v) >= need and sum(v) / len(v) >= 0.7:
                    hits.append(tr)
            info["undecided"] = undecided
        cond = Condition(bool(hits), score=len(hits), boxes=[tr.box for tr in hits], info=info)
        return cond


def make_rule(spec: RuleSpec, ref_gray: np.ndarray | None = None):
    if spec.type == "fire":
        return FireRule(spec)
    if spec.type == "smoke":
        return SmokeRule(spec)
    if spec.type == "water_level":
        return WaterLevelRule(spec, ref_gray)
    return PersonRule(spec)
