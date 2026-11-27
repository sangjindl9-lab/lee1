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
                 "verified_languages": v.get("verified_languages") or [],
                 "preview_url": v.get("preview_url"), "category": v.get("category")} for v in r.get("voices", [])]

    def synth(self, text: str, voice: str, model: str, speed: float = 1.0, language: str | None = None) -> GenResult:
        body = {"text": text, "model_id": model,
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15,
                                   "use_speaker_boost": True, "speed": max(0.7, min(1.2, speed))}}
        if language and model.startswith(("eleven_turbo_v2_5", "eleven_flash_v2_5")):
            body["language_code"] = language  # 언어 고정을 지원하는 모델만
        r = call(self.name, "POST", f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/with-timestamps",
                 headers=self.h, params={"output_format": "mp3_44100_192"}, timeout=300, json=body)
        al = r.get("alignment") or {}
        chars = al.get("characters") or []
        starts = al.get("character_start_times_seconds") or []
        ends = al.get("character_end_times_seconds") or []
        words = chars_to_words(chars, starts, ends)
        return GenResult(data=base64.b64decode(r["audio_base64"]), words=words,
                         raw={"chars": chars, "starts": starts, "ends": ends})


NARRATOR_STYLE = {
    "ko": "자연스러운 한국어 표준어 내레이션. 유튜브 지식 쇼츠 해설자처럼 또렷하고 생동감 있게 읽는다. "
          "띄어쓰기마다 끊지 말고 문장 단위로 자연스럽게 이어 읽으며, 문장 끝은 살짝 내려 마무리한다. "
          "외래어와 숫자는 한국 방송에서 읽는 방식대로 발음한다.",
}


class OpenAITTS:
    """POST /v1/audio/speech — 타임스탬프 없음(STT로 동기화). 최신 TTS 모델은 instructions 로 말투를 지시한다."""
    name = "openai"

    def __init__(self, api_key: str):
        self.h = {"Authorization": f"Bearer {api_key}"}

    def voices(self) -> list[dict]:
        return [{"id": v, "name": v, "labels": {}, "category": "openai"} for v in OPENAI_VOICES]

    def synth(self, text: str, voice: str, model: str, speed: float = 1.0, language: str | None = None) -> GenResult:
        body = {"model": model, "voice": voice or "coral", "input": text, "response_format": "mp3"}
        if model.startswith("tts-1"):
            body["speed"] = speed
        else:
            body["instructions"] = NARRATOR_STYLE.get(language or "", "Natural, clear, engaging documentary narration.")
        resp = call(self.name, "POST", "https://api.openai.com/v1/audio/speech", raw=True, timeout=300,
                    headers={**self.h, "Content-Type": "application/json"}, json=body)
        return GenResult(data=resp.content)


def pick_voice(voices: list[dict], language: str) -> dict | None:
    """대본 언어를 원어민처럼 말하는 음성을 고른다(영어 음성이 한국어를 읽으면 억양이 어색하다)."""
    names = {"ko": ("korean", "ko", "한국"), "ja": ("japanese", "ja"), "zh": ("chinese", "zh", "mandarin"),
             "es": ("spanish", "es"), "en": ("english", "en", "american", "british")}.get(language, (language,))

    def native(v):
        labels = {k: str(x).lower() for k, x in (v.get("labels") or {}).items()}
        if labels.get("language") in names or any(n in labels.get("accent", "") for n in names):
            return True
        return any((l.get("language") or "").lower() in names and not l.get("accent", "").lower().startswith(("american", "british"))
                   for l in v.get("verified_languages") or [] if language != "en")
    cands = [v for v in voices if native(v)]
    if not cands:
        return None
    # 내레이션용(narration/documentary) 라벨이 있으면 우선
    cands.sort(key=lambda v: 0 if any(k in str(v.get("labels")).lower() for k in ("narrat", "documentary", "news")) else 1)
    return cands[0]


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


def scene_spans(texts: list[str]) -> tuple[str, list[tuple[int, int]]]:
    """장면 문장들을 한 번에 읽을 하나의 텍스트로 잇고, 각 장면의 글자 범위를 돌려준다."""
    full, spans = "", []
    for t in texts:
        t = " ".join(t.split())
        if full:
            full += " "
        spans.append((len(full), len(full) + len(t)))
        full += t
    return full, spans


def split_by_chars(spans, chars, starts, ends, total: float) -> list[dict] | None:
    """글자 단위 정렬로 장면 경계 시각과 장면별 단어 시각을 구한다. 정렬이 입력과 어긋나면 None."""
    if not chars or len(chars) != len(starts) or spans[-1][1] > len(chars):
        return None
    out = []
    for a, b in spans:
        idx = [i for i in range(a, b) if not chars[i].isspace()]
        if not idx:
            return None
        out.append({"s": float(starts[idx[0]]), "e": float(ends[idx[-1]]), "a": a, "b": b})
    return _cut_points(out, total)


def split_by_words(spans, full: str, words: list[dict], total: float) -> list[dict] | None:
    """음성 인식 단어 시각(대본 단어 수에 맞춰 보정된 것)으로 장면 경계를 구한다."""
    toks = full.split()
    if len(words) != len(toks):
        return None
    out, w = [], 0
    for a, b in spans:
        n = len(full[a:b].split())
        if n == 0:
            return None
        out.append({"s": words[w]["s"], "e": words[w + n - 1]["e"], "a": a, "b": b, "w0": w, "w1": w + n})
        w += n
    return _cut_points(out, total)


def _cut_points(segs: list[dict], total: float) -> list[dict]:
    """장면 사이 무음 구간의 가운데에서 자른다. 첫 장면은 0초, 마지막 장면은 끝까지."""
    for i, sg in enumerate(segs):
        sg["cut_s"] = 0.0 if i == 0 else round((segs[i - 1]["e"] + sg["s"]) / 2, 3)
    for i, sg in enumerate(segs):
        sg["cut_e"] = round(total, 3) if i == len(segs) - 1 else segs[i + 1]["cut_s"]
    return segs
