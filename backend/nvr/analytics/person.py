"""사람 검출(YOLOX-s, Apache-2.0, OpenCV Zoo 배포본)과 간단한 다중 객체 추적.

전·후처리는 OpenCV Zoo 의 공식 예제(models/object_detection_yolox/yolox.py, demo.py)를 따른다.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field

import cv2
import numpy as np

PERSON_CLASS = 0


class YoloXPerson:
    def __init__(self, model_path: str, conf: float = 0.35, nms: float = 0.5, threads: int = 0):
        if threads:
            cv2.setNumThreads(threads)
        self.net = cv2.dnn.readNet(model_path)
        self.size = (640, 640)
        self.conf, self.nms = conf, nms
        self.lock = threading.Lock()  # cv2.dnn.Net 은 스레드 안전하지 않음
        grids, strides = [], []
        for s in (8, 16, 32):
            h, w = self.size[0] // s, self.size[1] // s
            xv, yv = np.meshgrid(np.arange(h), np.arange(w))
            g = np.stack((xv, yv), 2).reshape(1, -1, 2)
            grids.append(g)
            strides.append(np.full((*g.shape[:2], 1), s))
        self.grids = np.concatenate(grids, 1)
        self.strides = np.concatenate(strides, 1)

    def detect(self, bgr: np.ndarray) -> list[tuple[float, float, float, float, float]]:
        """사람 박스 [(x, y, w, h, score)] — 입력 영상 픽셀 좌표."""
        pad = np.full((self.size[0], self.size[1], 3), 114.0, np.float32)
        r = min(self.size[0] / bgr.shape[0], self.size[1] / bgr.shape[1])
        rs = cv2.resize(bgr, (int(bgr.shape[1] * r), int(bgr.shape[0] * r))).astype(np.float32)
        pad[: rs.shape[0], : rs.shape[1]] = rs
        blob = np.transpose(pad, (2, 0, 1))[np.newaxis]
        with self.lock:
            self.net.setInput(blob)
            outs = self.net.forward(self.net.getUnconnectedOutLayersNames())
        d = outs[0][0].copy()
        d[:, :2] = (d[:, :2] + self.grids[0]) * self.strides[0]
        d[:, 2:4] = np.exp(d[:, 2:4]) * self.strides[0]
        scores = d[:, 4] * d[:, 5 + PERSON_CLASS]
        keep_mask = scores >= self.conf
        if not keep_mask.any():
            return []
        b = d[keep_mask, :4]
        sc = scores[keep_mask]
        xywh = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 2], b[:, 3]], 1)
        idx = cv2.dnn.NMSBoxes(xywh.tolist(), sc.tolist(), self.conf, self.nms)
        out = []
        for i in np.array(idx).reshape(-1):
            x, y, w, h = (xywh[i] / r).tolist()
            out.append((max(0.0, x), max(0.0, y), w, h, float(sc[i])))
        return out


@dataclass
class Track:
    id: int
    box: tuple[float, float, float, float]  # x, y, w, h
    first_seen: float
    last_seen: float
    history: list[tuple[float, tuple[float, float, float, float]]] = field(default_factory=list)
    helmet_votes: list[bool] = field(default_factory=list)
    misses: int = 0

    @property
    def foot(self) -> tuple[float, float]:
        x, y, w, h = self.box
        return x + w / 2, y + h

    @property
    def center(self) -> tuple[float, float]:
        x, y, w, h = self.box
        return x + w / 2, y + h / 2


class Tracker:
    """IoU + 중심거리 기반 탐욕 매칭. 1초 간격 검출에서도 끊기지 않도록 거리 기준을 몸 높이로 정규화."""

    def __init__(self, max_misses: int = 3):
        self.tracks: dict[int, Track] = {}
        self.next_id = 1
        self.max_misses = max_misses

    @staticmethod
    def _iou(a, b) -> float:
        ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
        iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
        ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
        inter = iw * ih
        u = a[2] * a[3] + b[2] * b[3] - inter
        return inter / u if u > 0 else 0.0

    def update(self, dets: list[tuple[float, float, float, float, float]], t: float) -> list[Track]:
        pairs = []
        for tid, tr in self.tracks.items():
            for j, d in enumerate(dets):
                box = d[:4]
                iou = self._iou(tr.box, box)
                cx, cy = tr.center
                dx = (box[0] + box[2] / 2 - cx) / max(tr.box[3], 1)
                dy = (box[1] + box[3] / 2 - cy) / max(tr.box[3], 1)
                dist = (dx * dx + dy * dy) ** 0.5
                if iou > 0.1 or dist < 1.2:
                    pairs.append((iou - dist * 0.3, tid, j))
        pairs.sort(reverse=True)
        used_t, used_d = set(), set()
        for _, tid, j in pairs:
            if tid in used_t or j in used_d:
                continue
            tr = self.tracks[tid]
            tr.box = dets[j][:4]
            tr.last_seen, tr.misses = t, 0
            tr.history.append((t, tr.box))
            tr.history = tr.history[-400:]
            used_t.add(tid)
            used_d.add(j)
        for tid, tr in list(self.tracks.items()):
            if tid not in used_t:
                tr.misses += 1
                if tr.misses > self.max_misses:
                    del self.tracks[tid]
        for j, d in enumerate(dets):
            if j not in used_d:
                tr = Track(id=self.next_id, box=d[:4], first_seen=t, last_seen=t, history=[(t, d[:4])])
                self.tracks[self.next_id] = tr
                self.next_id += 1
        return [tr for tr in self.tracks.values() if tr.misses == 0]


# ───────────────────────── 안전모 판정(색 기반 추정) ─────────────────────────
# 안전모 대표 색(HSV, OpenCV 0~179 색상): 흰색·노랑·주황·빨강·파랑·초록
_HELMET_RANGES = [
    ((0, 0, 170), (179, 45, 255)),      # 흰색
    ((18, 90, 120), (35, 255, 255)),    # 노랑
    ((5, 120, 120), (18, 255, 255)),    # 주황
    ((0, 130, 100), (5, 255, 255)),     # 빨강
    ((170, 130, 100), (179, 255, 255)),  # 빨강
    ((95, 120, 80), (125, 255, 255)),   # 파랑
    ((40, 100, 80), (80, 255, 255)),    # 초록
]


def helmet_ratio(bgr: np.ndarray, box) -> float | None:
    """사람 박스 머리 부분에서 안전모 색 비율. 사람이 너무 작으면 None(판정 불가)."""
    x, y, w, h = [int(v) for v in box]
    if h < 40 or w < 12:
        return None
    hx0 = x + int(w * 0.2)
    hx1 = x + int(w * 0.8)
    hy0 = max(0, y)
    hy1 = y + max(4, int(h * 0.13))  # 머리 윗부분(안전모가 있을 자리)
    patch = bgr[hy0:hy1, max(0, hx0):max(0, hx1)]
    if patch.size == 0:
        return None
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    mask = np.zeros(hsv.shape[:2], np.uint8)
    for lo, hi in _HELMET_RANGES:
        mask |= cv2.inRange(hsv, np.array(lo, np.uint8), np.array(hi, np.uint8))
    return float(mask.mean() / 255.0)
