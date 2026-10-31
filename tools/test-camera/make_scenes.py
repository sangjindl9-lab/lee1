#!/usr/bin/env python3
"""[시험 전용] 지능형 분석 시험용 합성 장면(JPEG 연속 이미지) 생성.

실제 화재·침수 영상이 아닙니다. 분석 규칙이 '동작하는지'를 확인하기 위한 인공 장면이며, 실제 현장 정확도를
의미하지 않습니다. 화면 상단에 SYNTHETIC 문구가 들어갑니다.

  python make_scenes.py --out /opt/scenes [--vtest vtest.avi]
    fire/   : 공사장 배경 + 정지한 주황색 드럼(오탐 시험용) + 20~50초 사이 흔들리는 불꽃 (60초 반복, 10fps)
    water/  : 바닥 무늬 + 수위봉. 0~40초 마른 상태 → 40~100초 수위 상승 → 100~140초 유지 → 140~180초 하강 (5fps)
    people/ : OpenCV 공개 샘플 vtest.avi(보행자) 를 640x480 JPEG 로 변환 (10fps)
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

W, H = 640, 360


def _label(img, text):
    cv2.rectangle(img, (0, 0), (W, 22), (0, 0, 0), -1)
    cv2.putText(img, text, (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)


def _site_background(rng) -> np.ndarray:
    bg = np.full((H, W, 3), (120, 125, 130), np.uint8)
    # 하늘·벽·바닥
    bg[:120] = (190, 170, 150)
    cv2.rectangle(bg, (0, 120), (W, 230), (105, 110, 115), -1)
    for x in range(0, W, 40):  # 비계
        cv2.line(bg, (x, 120), (x, 230), (70, 70, 70), 2)
    cv2.line(bg, (0, 170), (W, 170), (70, 70, 70), 2)
    noise = rng.normal(0, 10, (H, W, 1)).astype(np.int16)
    bg = np.clip(bg.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return bg


def fire_scene(out: Path, seconds=60, fps=10, seed=1):
    rng = np.random.default_rng(seed)
    base = _site_background(rng)
    # 정지한 주황색 드럼(색만 보면 불꽃과 비슷 — 흔들림이 없어 걸러져야 함)
    cv2.rectangle(base, (480, 230), (530, 310), (0, 120, 255), -1)
    cv2.rectangle(base, (480, 250), (530, 258), (255, 255, 255), -1)
    out.mkdir(parents=True, exist_ok=True)
    for i in range(seconds * fps):
        t = i / fps
        img = base.copy()
        if 20 <= t < 50:
            grow = min(1.0, (t - 20) / 5)
            layer = np.zeros((H, W, 3), np.float32)
            cx, cy = 220, 300
            for k in range(14):
                dx = rng.normal(0, 10)
                hgt = (60 + rng.normal(0, 15)) * grow
                wid = (28 + rng.normal(0, 6)) * grow
                ry = cy - hgt * (0.3 + 0.7 * rng.random())
                cv2.ellipse(layer, (int(cx + dx), int(ry)), (max(2, int(wid / 2)), max(2, int(hgt / 2))), 0, 0, 360,
                            (0, 60, 230), -1)
            for k in range(8):
                dx = rng.normal(0, 7)
                hgt = (40 + rng.normal(0, 10)) * grow
                cv2.ellipse(layer, (int(cx + dx), int(cy - hgt / 2)), (max(2, int(12 * grow)), max(2, int(hgt / 2))), 0,
                            0, 360, (40, 170, 255), -1)
            cv2.ellipse(layer, (cx + int(rng.normal(0, 3)), cy - int(15 * grow)), (max(2, int(8 * grow)), max(2, int(18 * grow))),
                        0, 0, 360, (200, 245, 255), -1)
            layer = cv2.GaussianBlur(layer, (0, 0), 3)
            m = (layer.max(axis=2, keepdims=True) > 10).astype(np.float32)
            img = (img * (1 - m) + layer * m).astype(np.uint8)
        _label(img, f"SYNTHETIC FIRE TEST t={t:4.1f}s (fire 20-50s)")
        cv2.imwrite(str(out / f"{i:05d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])


def water_scene(out: Path, fps=5, seed=2):
    rng = np.random.default_rng(seed)
    base = np.full((H, W, 3), (95, 105, 110), np.uint8)
    base[:110] = (185, 175, 160)
    # 바닥 무늬(보도블록·자갈)
    for y in range(110, H, 18):
        off = 0 if (y // 18) % 2 else 14
        for x in range(-14, W, 28):
            c = int(rng.integers(80, 150))
            cv2.rectangle(base, (x + off, y), (x + off + 26, y + 16), (c, c + 5, c + 8), -1)
    noise = rng.normal(0, 12, (H, W, 1)).astype(np.int16)
    base = np.clip(base.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    # 수위봉(빨강·흰색 눈금) x=560, y 340(바닥)~150(위)
    for k, y in enumerate(range(150, 340, 19)):
        cv2.rectangle(base, (552, y), (568, y + 19), (0, 0, 220) if k % 2 else (240, 240, 240), -1)
    out.mkdir(parents=True, exist_ok=True)
    total = 180
    for i in range(total * fps):
        t = i / fps
        if t < 40:
            lvl = 0.0
        elif t < 100:
            lvl = (t - 40) / 60
        elif t < 140:
            lvl = 1.0
        else:
            lvl = max(0.0, 1 - (t - 140) / 40)
        img = base.copy()
        if lvl > 0:
            wy = int(H - lvl * (H - 160))  # 수면 높이(위로 갈수록 작음)
            water = np.full((H - wy, W, 3), (70, 85, 60), np.float32)
            ripple = rng.normal(0, 4, (H - wy, W, 1)).astype(np.float32)
            water = np.clip(water + ripple, 0, 255)
            reg = img[wy:].astype(np.float32)
            img[wy:] = (reg * 0.15 + water * 0.85).astype(np.uint8)
            cv2.line(img, (0, wy), (W, wy), (110, 120, 100), 2)
        _label(img, f"SYNTHETIC WATER TEST t={t:5.1f}s level={int(lvl * 100)}%")
        cv2.imwrite(str(out / f"{i:05d}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 85])


def people_scene(out: Path, src: str):
    out.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(src)
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        f = cv2.resize(f, (640, 480))
        cv2.putText(f, "TEST CLIP (OpenCV sample vtest.avi)", (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1,
                    cv2.LINE_AA)
        cv2.imwrite(str(out / f"{i:05d}.jpg"), f, [cv2.IMWRITE_JPEG_QUALITY, 85])
        i += 1
    if i == 0:
        raise SystemExit("vtest 영상을 읽지 못했습니다")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--vtest")
    a = ap.parse_args()
    o = Path(a.out)
    fire_scene(o / "fire")
    water_scene(o / "water")
    if a.vtest:
        people_scene(o / "people", a.vtest)


if __name__ == "__main__":
    main()
