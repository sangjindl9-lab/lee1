"""테스트용 합성 소재(FFmpeg로 생성). 외부 API를 호출하지 않는다."""
import os
import subprocess


def _ff(args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def image(path, color="0x224488", w=1080, h=1920):
    _ff(["-f", "lavfi", "-i", f"gradients=s={w}x{h}:c0={color}:c1=0xddaa33:d=1", "-frames:v", "1", path])
    return path


def video(path, dur=3, w=720, h=1280):
    # 실제 생성 영상처럼 화면 전체가 움직이도록 시간에 따라 바뀌는 잡음을 섞는다(움직임 검사 통과용)
    _ff(["-f", "lavfi", "-i", f"testsrc2=s={w}x{h}:r=24:d={dur}", "-vf", "noise=alls=30:allf=t", "-pix_fmt", "yuv420p", path])
    return path


def speech(path, dur=3.0, freq=220):
    # 말소리를 흉내 낸 끊어지는 톤(무음 검출·덕킹 확인용)
    _ff(["-f", "lavfi", "-i", f"sine=f={freq}:d={dur}", "-af",
         "tremolo=f=4:d=0.9,volume=0.8", "-ar", "44100", "-b:a", "128k", path])
    return path


def music(path, dur=8.0):
    _ff(["-f", "lavfi", "-i", f"sine=f=110:d={dur}", "-af", "volume=0.6", path])
    return path


def bundle(d):
    os.makedirs(d, exist_ok=True)
    return {
        "img1": image(os.path.join(d, "a.png")), "img2": image(os.path.join(d, "b.png"), "0x662244"),
        "vid": video(os.path.join(d, "v.mp4")), "sp1": speech(os.path.join(d, "s1.mp3"), 2.6),
        "sp2": speech(os.path.join(d, "s2.mp3"), 3.2, 260), "sp3": speech(os.path.join(d, "s3.mp3"), 2.2, 300),
        "music": music(os.path.join(d, "m.mp3")),
    }
