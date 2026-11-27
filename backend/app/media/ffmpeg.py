"""FFmpeg/FFprobe 기반 렌더링 엔진.

타임라인(JSON) 하나로 결과를 재현할 수 있다. 장면 클립 정규화 → 전환 합성 → 자막 번인 →
내레이션/배경음악 믹싱(사이드체인 덕킹) → 라우드니스 정규화 → H.264/AAC MP4.
"""
import json
import os
import subprocess

FF = os.environ.get("FFMPEG_BIN", "ffmpeg")
FP = os.environ.get("FFPROBE_BIN", "ffprobe")
XFADES = {"fade", "dissolve", "slideleft", "slideright", "slideup", "slidedown", "wipeleft", "wiperight",
          "fadeblack", "circleopen", "smoothleft", "smoothup"}
MOVES = ("zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down")


class RenderError(Exception):
    pass


def run(cmd: list[str], cwd: str | None = None, timeout: int = 3600) -> str:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, errors="replace")
    if p.returncode != 0:
        raise RenderError(f"{os.path.basename(cmd[0])} 실패: {p.stderr[-1500:]}")
    return p.stderr


def probe(path: str) -> dict:
    p = subprocess.run([FP, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
                       capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise RenderError(f"ffprobe 실패: {p.stderr[-500:]}")
    return json.loads(p.stdout)


def duration(path: str) -> float:
    return float(probe(path)["format"]["duration"])


def summary(path: str) -> dict:
    info = probe(path)
    v = next((s for s in info["streams"] if s["codec_type"] == "video"), {})
    a = next((s for s in info["streams"] if s["codec_type"] == "audio"), {})
    num, den = (v.get("avg_frame_rate") or "0/1").split("/")
    return {"width": v.get("width"), "height": v.get("height"), "vcodec": v.get("codec_name"),
            "pix_fmt": v.get("pix_fmt"), "fps": round(float(num) / float(den or 1), 2) if float(den or 1) else 0,
            "acodec": a.get("codec_name"), "sample_rate": a.get("sample_rate"),
            "duration": round(float(info["format"]["duration"]), 3), "size": int(info["format"]["size"]),
            "container": info["format"].get("format_name")}


def camera_to_move(camera_move: str | None, idx: int) -> str:
    """스토리보드의 카메라 지시를 정지 이미지용 움직임으로 대응시킨다."""
    c = (camera_move or "").lower()
    table = [("dolly in", "zoom_in"), ("push", "zoom_in"), ("zoom in", "zoom_in"), ("dolly out", "zoom_out"),
             ("pull", "zoom_out"), ("zoom out", "zoom_out"), ("crane", "pan_up"), ("tilt up", "pan_up"),
             ("tilt down", "pan_down"), ("tilt", "pan_down"), ("aerial", "zoom_out"), ("tracking", "pan_right"),
             ("pan left", "pan_left"), ("pan", "pan_right"), ("orbit", "pan_left")]
    for key, mv in table:
        if key in c:
            return mv
    return ("zoom_in", "zoom_out")[idx % 2]  # 지시가 없으면 완만한 줌만 번갈아 적용


def image_clip(src: str, out: str, dur: float, w: int, h: int, fps: int, move: str = "zoom_in") -> None:
    n = max(int(round(dur * fps)), 1)
    sw, sh = int(w * 1.5) // 2 * 2, int(h * 1.5) // 2 * 2  # 떨림 방지를 위해 1.5배로 올린 뒤 줌/팬
    z, x, y = "1.10", "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    if move == "zoom_in":
        z = f"1+0.10*on/{n}"
    elif move == "zoom_out":
        z = f"1.10-0.10*on/{n}"
    elif move == "pan_left":
        x = f"(iw-iw/zoom)*(1-on/{n})"
    elif move == "pan_right":
        x = f"(iw-iw/zoom)*on/{n}"
    elif move == "pan_up":
        y = f"(ih-ih/zoom)*(1-on/{n})"
    elif move == "pan_down":
        y = f"(ih-ih/zoom)*on/{n}"
    vf = (f"scale={sw}:{sh}:force_original_aspect_ratio=increase,crop={sw}:{sh},"
          f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={w}x{h}:fps={fps},format=yuv420p")
    run([FF, "-y", "-loglevel", "error", "-loop", "1", "-framerate", str(fps), "-i", src, "-t", f"{dur:.3f}",
         "-vf", vf, "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-an", out])


def video_clip(src: str, out: str, dur: float, w: int, h: int, fps: int) -> None:
    src_d = duration(src)
    chain = [f"scale={w}:{h}:force_original_aspect_ratio=increase", f"crop={w}:{h}"]
    if src_d < dur:
        ratio = dur / src_d
        if ratio <= 1.3:  # 조금 모자라면 살짝 늦춰 맞춘다
            chain.append(f"setpts={ratio:.4f}*PTS")
        else:  # 많이 모자라면 마지막 프레임을 유지
            chain.append(f"tpad=stop_mode=clone:stop_duration={dur - src_d + 0.2:.3f}")
    chain += [f"fps={fps}", "format=yuv420p"]
    run([FF, "-y", "-loglevel", "error", "-i", src, "-t", f"{dur:.3f}", "-vf", ",".join(chain), "-r", str(fps),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-an", out])


def narration_track(items: list[dict], out: str) -> None:
    """items: [{path|None, dur}] → 장면 길이에 맞춰 이어 붙인 48kHz 스테레오 WAV."""
    cmd, parts = [FF, "-y", "-loglevel", "error"], []
    for i, it in enumerate(items):
        if it.get("path"):
            cmd += ["-i", it["path"]]
        else:
            cmd += ["-f", "lavfi", "-t", f"{it['dur']:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        parts.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:{it['dur']:.3f},"
                     f"asetpts=N/SR/TB[a{i}]")
    graph = ";".join(parts) + ";" + "".join(f"[a{i}]" for i in range(len(items))) + \
        f"concat=n={len(items)}:v=0:a=1[out]"
    run(cmd + ["-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", out])


def render(timeline: dict, work: str, resolve) -> str:
    """timeline 을 렌더링해 work/final.mp4 를 만든다. resolve(key) → 로컬 경로."""
    w, h, fps = timeline["width"], timeline["height"], timeline["fps"]
    scenes, T = timeline["scenes"], float(timeline.get("transition_sec", 0.3))
    os.makedirs(work, exist_ok=True)
    total = sum(s["dur"] for s in scenes)

    # 1) 장면 클립 정규화. 다음 장면으로 크로스페이드하는 장면은 T 만큼 길게 만든다(음성 싱크 유지).
    clips = []
    for i, s in enumerate(scenes):
        tr = s.get("transition", "cut") if i < len(scenes) - 1 else "cut"
        s["_tr"] = tr if tr in XFADES and s["dur"] > T * 3 else "cut"
        length = s["dur"] + (T if s["_tr"] != "cut" else 0)
        out = os.path.join(work, f"clip_{i:03d}.mp4")
        src = resolve(s["key"])
        if s["type"] == "video":
            video_clip(src, out, length, w, h, fps)
        else:
            image_clip(src, out, length, w, h, fps, s.get("move", "zoom_in"))
        clips.append(out)

    # 2) 내레이션 트랙
    narr = os.path.join(work, "narration.wav")
    narration_track([{"path": resolve(s["audio_key"]) if s.get("audio_key") else None, "dur": s["dur"]}
                     for s in scenes], narr)

    # 3) 최종 합성
    cmd = [FF, "-y", "-loglevel", "error"]
    for c in clips:
        cmd += ["-i", c]
    n = len(clips)
    cmd += ["-i", narr]
    graph = [f"[{i}:v]fps={fps},settb=1/{fps}[c{i}]" for i in range(n)]
    cur, acc = "[c0]", scenes[0]["dur"]
    for i in range(1, n):
        tr = scenes[i - 1]["_tr"]
        if tr == "cut":
            graph.append(f"{cur}[c{i}]concat=n=2:v=1:a=0,fps={fps},settb=1/{fps}[v{i}]")
        else:
            graph.append(f"{cur}[c{i}]xfade=transition={tr}:duration={T}:offset={acc:.3f},fps={fps},settb=1/{fps}[v{i}]")
        cur, acc = f"[v{i}]", acc + scenes[i]["dur"]
    post = []
    look = timeline.get("look") or {}
    if look.get("color", True):
        post.append("eq=contrast=1.04:saturation=1.08:gamma=1.0")
    if look.get("denoise"):
        post.append("hqdn3d=1.5:1.5:6:6")
    if timeline.get("ass"):
        sub = os.path.join(work, "subs.ass")
        if os.path.abspath(resolve(timeline["ass"])) != os.path.abspath(sub):
            import shutil
            shutil.copyfile(resolve(timeline["ass"]), sub)
        post.append("ass=subs.ass")
    post.append("format=yuv420p")
    graph.append(f"{cur}{','.join(post)}[vsub]")
    vout, idx = "[vsub]", n + 1
    logo = (timeline.get("branding") or {}).get("logo_key")
    music = (timeline.get("audio") or {}).get("music")
    if music:
        cmd += ["-stream_loop", "-1", "-i", resolve(music["key"])]
        m_idx, idx = idx, idx + 1
    if logo:
        cmd += ["-i", resolve(logo)]
        lw = int(w * 0.16)
        graph.append(f"[{idx}:v]scale={lw}:-1,format=rgba,colorchannelmixer=aa=0.85[lg]")
        graph.append(f"[vsub][lg]overlay=x=40:y=60[vlogo]")
        vout = "[vlogo]"
    if music:
        gain = float(music.get("gain", 0.22))
        graph.append(f"[{n}:a]asplit=2[na][nk]")
        graph.append(f"[{m_idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{total:.3f},volume={gain},"
                     f"afade=t=in:st=0:d=0.5,afade=t=out:st={max(total - 1.5, 0):.3f}:d=1.5[mu]")
        graph.append("[mu][nk]sidechaincompress=threshold=0.02:ratio=10:attack=15:release=350[md]")
        graph.append("[na][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]")
    else:
        graph.append(f"[{n}:a]loudnorm=I=-14:TP=-1.5:LRA=11[aout]")
    out = os.path.join(work, "final.mp4")
    cmd += ["-filter_complex", ";".join(graph), "-map", vout, "-map", "[aout]", "-t", f"{total:.3f}",
            "-r", str(fps), "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "18",
            "-preset", "medium", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out]
    run(cmd, cwd=work)
    return out


def grab_frame(video: str, t: float, out: str, scale: str | None = None) -> str:
    cmd = [FF, "-y", "-loglevel", "error", "-ss", f"{max(t, 0):.3f}", "-i", video, "-frames:v", "1", "-q:v", "2"]
    if scale:
        cmd += ["-vf", f"scale={scale}"]
    run(cmd + [out])
    return out


def title_cover(frame: str, title: str, out: str, font: str, work: str) -> str:
    """커버 프레임 위에 제목을 얹은 대표 이미지."""
    lines, line = [], ""
    for word in title.split():
        if len(line) + len(word) + 1 > 11 and line:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    tf = os.path.join(work, "cover_title.txt")
    with open(tf, "w", encoding="utf-8") as f:
        f.write("\n".join(lines[:4]))
    font_esc = font.replace(":", "\\:").replace("'", "")
    vf = (f"drawtext=textfile=cover_title.txt:font='{font_esc}':fontsize=h/15:fontcolor=white:borderw=8:"
          f"bordercolor=black:line_spacing=18:x=(w-text_w)/2:y=h*0.30")
    run([FF, "-y", "-loglevel", "error", "-i", frame, "-vf", vf, "-frames:v", "1", "-q:v", "2", out], cwd=work)
    return out
