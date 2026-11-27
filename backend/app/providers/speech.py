"""음성 합성(TTS) · 음성 인식(STT) · OpenAI 이미지 어댑터."""
import base64
import re

from .base import GenResult, call

OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"]


def chars_to_words(chars: list[str], starts: list[float], ends: list[float]) -> list[dict]:
    """ElevenLabs 글자 단위 정렬 → 단어 단위 타임스탬프."""
    words, cur, s, e = [], "", None, 0.0
    for ch, cs, ce in zip(chars, starts, ends):
        if ch.isspace():
            if cur:
                words.append({"w": cur, "s": round(s, 3), "e": round(e, 3)})
                cur, s = "", None
            continue
        if s is None:
            s = cs
        cur += ch
        e = ce
    if cur:
        words.append({"w": cur, "s": round(s, 3), "e": round(e, 3)})
    return words


class ElevenLabsTTS:
    """POST /v1/text-to-speech/{voice_id}/with-timestamps — 글자 단위 타임스탬프 제공."""
    name = "elevenlabs"

    def __init__(self, api_key: str):
        self.h = {"xi-api-key": api_key, "Content-Type": "application/json"}

    def test(self):
        r = call(self.name, "GET", "https://api.elevenlabs.io/v1/voices", headers=self.h, retries=1)
        return {"ok": True, "voices": len(r.get("voices", []))}

    def voices(self) -> list[dict]:
        r = call(self.name, "GET", "https://api.elevenlabs.io/v1/voices", headers=self.h, retries=1)
        return [{"id": v["voice_id"], "name": v.get("name"), "labels": v.get("labels") or {},
                 "preview_url": v.get("preview_url"), "category": v.get("category")} for v in r.get("voices", [])]

    def synth(self, text: str, voice: str, model: str, speed: float = 1.0) -> GenResult:
        r = call(self.name, "POST", f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps",
                 headers=self.h, params={"output_format": "mp3_44100_128"}, timeout=180,
                 json={"text": text, "model_id": model, "voice_settings": {"speed": max(0.7, min(1.2, speed))}})
        al = r.get("alignment") or {}
        words = chars_to_words(al.get("characters") or [], al.get("character_start_times_seconds") or [],
                               al.get("character_end_times_seconds") or [])
        return GenResult(data=base64.b64decode(r["audio_base64"]), words=words, raw={"alignment": bool(words)})


class OpenAITTS:
    """POST /v1/audio/speech — 타임스탬프 없음(STT 또는 비례 배분으로 동기화)."""
    name = "openai"

    def __init__(self, api_key: str):
        self.h = {"Authorization": f"Bearer {api_key}"}

    def voices(self) -> list[dict]:
        return [{"id": v, "name": v, "labels": {}, "category": "openai"} for v in OPENAI_VOICES]

    def synth(self, text: str, voice: str, model: str, speed: float = 1.0) -> GenResult:
        resp = call(self.name, "POST", "https://api.openai.com/v1/audio/speech", raw=True, timeout=180,
                    headers={**self.h, "Content-Type": "application/json"},
                    json={"model": model, "voice": voice or "alloy", "input": text, "response_format": "mp3",
                          "speed": speed})
        return GenResult(data=resp.content)


class OpenAISTT:
    """POST /v1/audio/transcriptions (verbose_json, 단어 타임스탬프)."""
    name = "openai"

    def __init__(self, api_key: str):
        self.h = {"Authorization": f"Bearer {api_key}"}

    def words(self, audio: bytes, model: str = "whisper-1", language: str | None = None) -> list[dict]:
        data = {"model": model, "response_format": "verbose_json", "timestamp_granularities[]": "word"}
        if language:
            data["language"] = language
        r = call(self.name, "POST", "https://api.openai.com/v1/audio/transcriptions", headers=self.h, data=data,
                 files={"file": ("audio.mp3", audio, "audio/mpeg")}, timeout=300)
        return [{"w": w["word"].strip(), "s": float(w["start"]), "e": float(w["end"])} for w in r.get("words", [])]


class OpenAIImage:
    """POST /v1/images/generations — b64_json 반환."""
    name = "openai"

    def __init__(self, api_key: str):
        self.h = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    def generate(self, model: str, prompt: str, size: str = "1024x1536", quality: str | None = None) -> GenResult:
        body = {"model": model, "prompt": prompt[:4000], "size": size, "n": 1}
        if quality:
            body["quality"] = quality
        r = call(self.name, "POST", "https://api.openai.com/v1/images/generations", headers=self.h, json=body,
                 timeout=300)
        d = (r.get("data") or [{}])[0]
        if d.get("b64_json"):
            return GenResult(data=base64.b64decode(d["b64_json"]), raw={"usage": r.get("usage")})
        return GenResult(urls=[d["url"]])


def apply_pronunciation(text: str, table: dict | None) -> str:
    """전문용어 발음 사전 적용 (예: {"NASA": "나사"})."""
    for k, v in (table or {}).items():
        if k:
            text = re.sub(re.escape(k), v, text)
    return text


def proportional_words(text: str, duration: float) -> list[dict]:
    """타임스탬프를 받을 수 없을 때: 글자 수 비례로 단어 시간을 배분(추정 동기화)."""
    toks = text.split()
    total = sum(len(t) for t in toks) or 1
    lead, tail = 0.05, 0.1
    span = max(duration - lead - tail, 0.1)
    out, t = [], lead
    for tok in toks:
        d = span * len(tok) / total
        out.append({"w": tok, "s": round(t, 3), "e": round(t + d, 3)})
        t += d
    return out


def retime_script_words(script_text: str, stt_words: list[dict], duration: float) -> list[dict]:
    """STT 타이밍을 대본 단어에 입힌다(자막 오탈자 방지: 글자는 대본, 시간은 음성 인식)."""
    toks = script_text.split()
    if not stt_words or not toks:
        return proportional_words(script_text, duration)
    if len(toks) == len(stt_words):
        return [{"w": t, "s": w["s"], "e": w["e"]} for t, w in zip(toks, stt_words)]
    # 단어 수가 다르면 누적 글자 비율로 STT 시간축에 사상한다.
    stt_total = sum(len(w["w"]) for w in stt_words) or 1
    marks, acc = [], 0
    for w in stt_words:
        marks.append((acc / stt_total, w["s"]))
        acc += len(w["w"])
    marks.append((1.0, stt_words[-1]["e"]))

    def at(frac: float) -> float:
        for (f0, t0), (f1, t1) in zip(marks, marks[1:]):
            if f0 <= frac <= f1:
                return t0 + (t1 - t0) * ((frac - f0) / (f1 - f0) if f1 > f0 else 0)
        return marks[-1][1]

    total, acc, out = sum(len(t) for t in toks) or 1, 0, []
    for t in toks:
        s = at(acc / total)
        acc += len(t)
        out.append({"w": t, "s": round(s, 3), "e": round(at(acc / total), 3)})
    return out
