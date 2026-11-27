"""렌더링 엔진 실검증: 실제 FFmpeg로 MP4를 만들고 규격을 측정한다."""
import os

from app.media import ffmpeg, qc, subtitles
from app.providers.speech import proportional_words

from . import assets


def make_timeline(a, tmp, with_music=True):
    texts = ["바다 깊은 곳에는 빛이 닿지 않습니다.", "그런데도 생명은 스스로 빛을 냅니다!", "이유는 단 하나, 살아남기 위해서죠."]
    durs = [ffmpeg.duration(a[k]) + 0.25 for k in ("sp1", "sp2", "sp3")]
    scenes, t = [], 0.0
    for i, (txt, d) in enumerate(zip(texts, durs)):
        scenes.append({"idx": i, "start": t, "dur": d, "words": proportional_words(txt, d - 0.25),
                       "position": "lower", "emphasis": ["빛을"]})
        t += d
    cues = subtitles.build_cues(scenes, "ko")
    ass = os.path.join(tmp, "subs_src.ass")
    open(ass, "w", encoding="utf-8").write(subtitles.to_ass(cues))
    tl = {"width": 1080, "height": 1920, "fps": 30, "transition_sec": 0.3, "ass": ass, "look": {"color": True},
          "scenes": [
              {"idx": 0, "type": "image", "key": a["img1"], "audio_key": a["sp1"], "start": scenes[0]["start"],
               "dur": durs[0], "transition": "fade", "move": "zoom_in"},
              {"idx": 1, "type": "video", "key": a["vid"], "audio_key": a["sp2"], "start": scenes[1]["start"],
               "dur": durs[1], "transition": "cut"},
              {"idx": 2, "type": "image", "key": a["img2"], "audio_key": a["sp3"], "start": scenes[2]["start"],
               "dur": durs[2], "transition": "cut", "move": "pan_up"}],
          "audio": {"music": {"key": a["music"], "gain": 0.22}} if with_music else {}}
    return tl, cues


def test_render_full_pipeline(tmp_path):
    tmp = str(tmp_path)
    a = assets.bundle(os.path.join(tmp, "assets"))
    tl, cues = make_timeline(a, tmp)
    out = ffmpeg.render(tl, os.path.join(tmp, "work"), lambda k: k)
    info = ffmpeg.summary(out)
    total = sum(s["dur"] for s in tl["scenes"])
    assert (info["width"], info["height"]) == (1080, 1920)
    assert info["vcodec"] == "h264" and info["acodec"] == "aac" and info["pix_fmt"] == "yuv420p"
    assert abs(info["fps"] - 30) < 0.1 and abs(info["duration"] - total) < 0.2
    rep = qc.technical(out, tl, subtitles.check(cues, total))
    assert not rep["fatal"], rep["fatal"]
    assert abs(rep["loudness"]["integrated_lufs"] + 14) < 2.5
    assert rep["scores"]["spec"] == 5
    cover = ffmpeg.grab_frame(out, 1.0, os.path.join(tmp, "c.jpg"))
    ffmpeg.title_cover(cover, "심해 생물이 빛나는 진짜 이유", os.path.join(tmp, "t.jpg"), "Noto Sans CJK KR", tmp)
    assert os.path.getsize(os.path.join(tmp, "t.jpg")) > 10000


def test_subtitle_formats():
    scenes = [{"start": 0.0, "words": proportional_words("하나 둘 셋 넷 다섯 여섯 일곱 여덟.", 4.0), "position": "lower"},
              {"start": 4.2, "words": proportional_words("끝입니다.", 1.0), "position": "center"}]
    cues = subtitles.build_cues(scenes, "ko")
    assert len(cues) >= 3 and all(c["e"] > c["s"] for c in cues)
    assert all(cues[i]["e"] <= cues[i + 1]["s"] + 1e-6 for i in range(len(cues) - 1))
    srt, vtt, ass = subtitles.to_srt(cues), subtitles.to_vtt(cues), subtitles.to_ass(cues, style={"kinetic": True})
    assert "00:00:00,050 -->" in srt and vtt.startswith("WEBVTT") and "Style: Center" in ass
    assert "\\c&H0000E5FF&" in ass  # 강조색(#FFE500 → BGR)
    assert not any(c["text"].endswith(".") for c in cues)  # 화면 자막에는 마침표를 찍지 않는다


def test_cues_follow_spoken_phrases():
    words = proportional_words("심해는 어둡습니다, 그런데 생물의 대부분은 스스로 빛을 냅니다.", 4.0)
    cues = subtitles.build_cues([{"start": 0, "words": words, "position": "lower"}], "ko")
    assert [c["text"] for c in cues] == ["심해는 어둡습니다", "그런데 생물의 대부분은", "스스로 빛을 냅니다"]
    ass = subtitles.to_ass(cues)
    assert ass.count("Dialogue:") == len(cues)  # 기본은 구절 하나를 통째로(단어마다 깜빡이지 않음)
    assert not subtitles.check(cues, 5.4)


def test_black_video_is_fatal(tmp_path):
    import subprocess
    p = str(tmp_path / "black.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=1080x1920:r=30:d=3",
                    "-f", "lavfi", "-i", "sine=f=200:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                    "-shortest", p], check=True)
    tl = {"width": 1080, "height": 1920, "fps": 30, "scenes": [{"idx": 0, "type": "image", "start": 0, "dur": 3}]}
    rep = qc.technical(p, tl, [])
    assert any("검은 화면" in f for f in rep["fatal"]) and rep["redo_scenes"] == [0]
