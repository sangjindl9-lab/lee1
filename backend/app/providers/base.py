"""공급자 공통 계층: 오류 분류, 재시도, HTTP 호출."""
import random
import time
from dataclasses import dataclass, field

import httpx


class ProviderError(Exception):
    """kind: auth | balance | rate_limit | invalid | moderation | transient | not_found | config"""

    def __init__(self, provider: str, kind: str, message: str, status: int | None = None):
        super().__init__(f"[{provider}] {kind}: {message}")
        self.provider = provider
        self.kind = kind
        self.message = message
        self.status = status

    @property
    def retryable(self) -> bool:
        return self.kind in ("transient", "rate_limit")


# 기본 HTTP 상태 → 오류 종류. 공급자별로 덮어쓴다.
DEFAULT_STATUS_MAP = {
    400: "invalid", 401: "auth", 402: "balance", 403: "auth", 404: "not_found",
    409: "transient", 422: "invalid", 423: "transient", 429: "rate_limit",
}


def _detail(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except Exception:
        return resp.text[:500]
    if isinstance(body, dict):
        for k in ("detail", "error", "message"):
            if k in body:
                v = body[k]
                if isinstance(v, dict):
                    v = v.get("message") or v
                return str(v)[:500]
    return str(body)[:500]


def call(
    provider: str, method: str, url: str, *, headers: dict | None = None, json: dict | None = None,
    params: dict | None = None, data=None, files=None, content=None, timeout: float = 60,
    retries: int = 3, status_map: dict | None = None, raw: bool = False,
):
    """재시도(지수 백오프 + 지터, 429 Retry-After 준수)를 포함한 HTTP 호출.

    POST 요청을 재시도할 때는 호출 측에서 Idempotency-Key 를 넣어 중복 과금을 막는다.
    """
    smap = {**DEFAULT_STATUS_MAP, **(status_map or {})}
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with httpx.Client(timeout=timeout, follow_redirects=True) as client:
                resp = client.request(method, url, headers=headers, json=json, params=params,
                                      data=data, files=files, content=content)
        except httpx.HTTPError as e:
            last = ProviderError(provider, "transient", f"네트워크 오류: {e}")
        else:
            if resp.status_code < 300:
                if raw:
                    return resp
                if not resp.content:
                    return {}
                try:
                    return resp.json()
                except Exception:
                    return {"_text": resp.text}
            kind = smap.get(resp.status_code, "transient" if resp.status_code >= 500 else "invalid")
            err = ProviderError(provider, kind, _detail(resp), resp.status_code)
            if not err.retryable:
                raise err
            last = err
            ra = resp.headers.get("Retry-After")
            if ra and ra.isdigit() and attempt < retries:
                time.sleep(min(int(ra), 60))
                continue
        if attempt < retries:
            time.sleep(min(2 ** attempt, 20) + random.random())
    assert last is not None
    raise last


def download(url: str, timeout: float = 300) -> bytes:
    resp = call("download", "GET", url, timeout=timeout, raw=True)
    return resp.content


@dataclass
class GenResult:
    """이미지·영상·음성 생성 결과."""
    urls: list[str] = field(default_factory=list)
    data: bytes | None = None
    external_id: str | None = None
    raw: dict = field(default_factory=dict)
    words: list[dict] = field(default_factory=list)  # [{w, s, e}]
