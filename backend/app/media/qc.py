"""기술 품질검수: FFprobe/FFmpeg 필터와 OpenCV로 측정 가능한 항목만 점검한다."""
import json
import re
import subprocess

import cv2

from .ffmpeg import FF, summary


def _filter(path: str, args: list[str]) -> str:
    p = subprocess.run([FF, "-hide_banner", "-nostats", "-i", path, *args, "-f", "null", "-"],
                       capture_output=True, text=True, timeout=900, errors="replace")
    return p.stderr


def black_intervals(path: str) -> list[tuple[float, float]]:
    err = _filter(path, ["-vf", "blackdetect=d=0.4:pix_th=0.10", "-an"])
    return [(float(a), float(b)) for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", err)]


def freeze_intervals(path: str) -> list[tuple[float, float]]:
    err = _filter(path, ["-vf", "freezedetect=n=-55dB:d=2", "-an"])
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", err)]
    return list(zip(starts, ends + [1e9] * (len(starts) - len(ends))))


def silence_intervals(path: str) -> list[tuple[float, float]]:
    err = _filter(path, ["-af", "silencedetect=noise=-45dB:d=1.5", "-vn"])
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    return list(zip(starts, ends + [1e9] * (len(starts) - len(ends))))


def loudness(path: str) -> dict:
    err = _filter(path, ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-vn"])
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", err, re.S)
    if not m:
        return {}
    d = json.loads(m.group(0))
    return {"integrated_lufs": float(d["input_i"]), "true_peak_db": float(d["input_tp"]), "lra": float(d["input_lra"])}


def sample_frames(path: str, times: list[float], max_w: int = 360) -> list[dict]:
    """장면별 대표 프레임의 밝기·선명도를 재고, AI 시각 검수에 보낼 축소 JPEG를 만든다."""
    cap = cv2.VideoCapture(path)
    out = []
    for t in times:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            out.append({"t": t, "ok": False})
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        h, w = frame.shape[:2]
        small = cv2.resize(frame, (max_w, int(h * max_w / w)))
        _, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 80])
        out.append({"t": t, "ok": True, "brightness": float(gray.mean()),
                    "sharpness": float(cv2.Laplacian(gray, cv2.CV_64F).var()), "jpeg": buf.tobytes()})
    cap.release()
    return out


def scene_at(scenes: list[dict], t: float) -> int | None:
    for s in scenes:
        if s["start"] <= t < s["start"] + s["dur"]:
            return s["idx"]
    return None


def technical(path: str, timeline: dict, subtitle_issues: list[str]) -> dict:
    """측정 결과와 감점 내역. 점수 배분은 명세의 100점 기준 중 기술로 판정 가능한 부분."""
    scenes = timeline["scenes"]
    total = sum(s["dur"] for s in scenes)
    info = summary(path)
    fatal, issues, redo = [], [], set()

    # 출력 규격 (5점)
    spec = 5.0
    if (info["width"], info["height"]) != (timeline["width"], timeline["height"]):
        fatal.append(f"해상도 불일치: {info['width']}x{info['height']}")
        spec = 0
    if info["vcodec"] != "h264" or info["acodec"] != "aac" or info["pix_fmt"] != "yuv420p":
        issues.append({"cat": "spec", "msg": f"코덱 확인 필요: {info['vcodec']}/{info['acodec']}/{info['pix_fmt']}"})
        spec -= 2
    if abs(info["fps"] - timeline["fps"]) > 0.5:
        issues.append({"cat": "spec", "msg": f"프레임레이트 {info['fps']}"})
        spec -= 1
    if abs(info["duration"] - total) > 0.6:
        issues.append({"cat": "spec", "msg": f"길이 차이 {info['duration']} vs {round(total, 2)}"})
        spec -= 2
    if info["duration"] > 180.5:
        issues.append({"cat": "spec", "msg": "쇼츠 최대 길이(3분) 초과"})
        spec -= 2

    # 화면 (기술 측정분)
    visual_pen = 0.0
    blacks = black_intervals(path)
    black_total = sum(b - a for a, b in blacks)
    if black_total > total * 0.5:
        fatal.append("영상 대부분이 검은 화면")
    for a, b in blacks:
        if b - a >= 0.4:
            idx = scene_at(scenes, a)
            issues.append({"cat": "visual", "scene": idx, "msg": f"검은 화면 {a:.1f}~{b:.1f}초"})
            visual_pen += 4
            if idx is not None:
                redo.add(idx)
    for a, b in freeze_intervals(path):
        idx = scene_at(scenes, a)
        sc = next((s for s in scenes if s["idx"] == idx), None)
        if sc and sc["type"] == "video" and min(b, total) - a > 2.5:
            issues.append({"cat": "visual", "scene": idx, "msg": f"정지 프레임 {a:.1f}초부터"})
            visual_pen += 2
    frames = sample_frames(path, [s["start"] + s["dur"] / 2 for s in scenes])
    for s, f in zip(scenes, frames):
        if not f["ok"]:
            issues.append({"cat": "visual", "scene": s["idx"], "msg": "프레임을 읽지 못함"})
            visual_pen += 3
        elif f["sharpness"] < 15:
            issues.append({"cat": "visual", "scene": s["idx"], "msg": f"흐린 화면(선명도 {f['sharpness']:.0f})"})
            visual_pen += 1.5

    # 음향 (15점)
    audio = 15.0
    loud = loudness(path)
    if not loud:
        fatal.append("오디오 트랙을 분석할 수 없음")
        audio = 0
    else:
        if abs(loud["integrated_lufs"] + 14) > 2.5:
            issues.append({"cat": "audio", "msg": f"음량 {loud['integrated_lufs']} LUFS (목표 -14)"})
            audio -= 4
        if loud["true_peak_db"] > -0.3:
            issues.append({"cat": "audio", "msg": f"피크 과다 {loud['true_peak_db']} dBTP"})
            audio -= 3
    for a, b in silence_intervals(path):
        if min(b, total) - a > 2.0:
            issues.append({"cat": "audio", "scene": scene_at(scenes, a), "msg": f"무음 {a:.1f}~{min(b, total):.1f}초"})
            audio -= 2

    # 자막 (10점)
    subs = 10.0 - 2.0 * len(subtitle_issues)
    issues += [{"cat": "subtitle", "msg": m} for m in subtitle_issues]

    return {"probe": info, "loudness": loud, "black_seconds": round(black_total, 2), "fatal": fatal,
            "issues": issues, "redo_scenes": sorted(redo), "frames": frames,
            "scores": {"spec": max(spec, 0), "audio": max(audio, 0), "subtitle": max(subs, 0)},
            "visual_penalty": visual_pen}
