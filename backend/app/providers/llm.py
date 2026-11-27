"""언어 AI 어댑터: Claude(Anthropic) · OpenAI · Gemini 를 같은 인터페이스로 호출한다."""
import base64
import json
import re
from dataclasses import dataclass

from .base import ProviderError, call


@dataclass
class LLMResult:
    text: str
    data: dict | list | None
    input_tokens: int = 0
    output_tokens: int = 0


def parse_json(text: str):
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except Exception:
        pass
    i, j = t.find("{"), t.rfind("}")
    if i >= 0 and j > i:
        try:
            return json.loads(t[i:j + 1])
        except Exception:
            return None
    return None


class LLM:
    def __init__(self, provider: str, api_key: str, model: str):
        self.provider, self.api_key, self.model = provider, api_key, model

    # ------------------------------------------------------------------
    def complete(self, system: str, user: str, images: list[bytes] | None = None,
                 max_tokens: int = 8000) -> LLMResult:
        fn = getattr(self, f"_{self.provider}")
        res: LLMResult = fn(system, user, images or [], max_tokens)
        res.data = parse_json(res.text)
        return res

    def complete_json(self, system: str, user: str, required: list[str], images=None,
                      max_tokens: int = 8000) -> LLMResult:
        """JSON 응답을 요구하고, 필수 키가 빠지면 한 번 더 교정 요청한다."""
        sys = system + "\n\n반드시 유효한 JSON 객체 하나만 출력한다. 설명·마크다운·코드펜스 금지."
        res = self.complete(sys, user, images, max_tokens)
        missing = [k for k in required if not isinstance(res.data, dict) or k not in res.data]
        if missing:
            fix = (f"{user}\n\n[교정 요청] 이전 응답은 JSON이 아니거나 필수 키 {missing} 가 없었다. "
                   f"필수 키 {required} 를 모두 포함한 JSON 객체만 다시 출력하라.")
            res2 = self.complete(sys, fix, images, max_tokens)
            res2.input_tokens += res.input_tokens
            res2.output_tokens += res.output_tokens
            res = res2
            missing = [k for k in required if not isinstance(res.data, dict) or k not in res.data]
            if missing:
                raise ProviderError(self.provider, "invalid", f"LLM 응답에 필수 키 누락: {missing}")
        return res

    def list_models(self) -> list[str]:
        if self.provider == "anthropic":
            r = call("anthropic", "GET", "https://api.anthropic.com/v1/models", headers=self._ah(), retries=1)
            return [m["id"] for m in r.get("data", [])]
        if self.provider == "openai":
            r = call("openai", "GET", "https://api.openai.com/v1/models", headers=self._oh(), retries=1)
            return sorted(m["id"] for m in r.get("data", []))
        r = call("gemini", "GET", "https://generativelanguage.googleapis.com/v1beta/models",
                 headers={"x-goog-api-key": self.api_key}, retries=1)
        return [m["name"].split("/")[-1] for m in r.get("models", [])
                if "generateContent" in m.get("supportedGenerationMethods", [])]

    # -- Anthropic Messages API ---------------------------------------
    def _ah(self):
        return {"x-api-key": self.api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}

    def _anthropic(self, system, user, images, max_tokens):
        content = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                 "data": base64.b64encode(b).decode()}} for b in images]
        content.append({"type": "text", "text": user})
        r = call("anthropic", "POST", "https://api.anthropic.com/v1/messages", headers=self._ah(), timeout=300,
                 json={"model": self.model, "max_tokens": max_tokens, "system": system,
                       "messages": [{"role": "user", "content": content}]})
        text = "".join(p.get("text", "") for p in r.get("content", []) if p.get("type") == "text")
        u = r.get("usage", {})
        return LLMResult(text, None, u.get("input_tokens", 0), u.get("output_tokens", 0))

    # -- OpenAI Chat Completions --------------------------------------
    def _oh(self):
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def _openai(self, system, user, images, max_tokens):
        content = [{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(b).decode()}}
                   for b in images]
        content.append({"type": "text", "text": user})
        r = call("openai", "POST", "https://api.openai.com/v1/chat/completions", headers=self._oh(), timeout=300,
                 json={"model": self.model, "max_completion_tokens": max_tokens,
                       "response_format": {"type": "json_object"},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}]})
        u = r.get("usage", {})
        return LLMResult(r["choices"][0]["message"].get("content") or "", None,
                         u.get("prompt_tokens", 0), u.get("completion_tokens", 0))

    # -- Gemini generateContent ---------------------------------------
    def _gemini(self, system, user, images, max_tokens):
        parts = [{"inlineData": {"mimeType": "image/jpeg", "data": base64.b64encode(b).decode()}} for b in images]
        parts.append({"text": user})
        r = call("gemini", "POST",
                 f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                 headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"}, timeout=300,
                 json={"systemInstruction": {"parts": [{"text": system}]},
                       "contents": [{"role": "user", "parts": parts}],
                       "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": max_tokens}})
        cands = r.get("candidates") or []
        if not cands:
            raise ProviderError("gemini", "moderation", f"응답 없음: {r.get('promptFeedback')}")
        text = "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))
        u = r.get("usageMetadata", {})
        return LLMResult(text, None, u.get("promptTokenCount", 0), u.get("candidatesTokenCount", 0))
