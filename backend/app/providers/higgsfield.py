"""Higgsfield API 연동.

공식 문서(2026-11-27 확인): https://docs.higgsfield.ai , https://open.higgsfield.ai/quick-start
- Base URL  : https://api.higgsfield.ai
- 인증      : Authorization: Key {KEY_ID}:{KEY_SECRET}
- 제출      : POST /{모델 경로}  (JSON, Idempotency-Key 헤더 권장)
              → {status: queued, request_id, status_url, cancel_url}
- 상태 조회 : GET status_url → queued | in_progress | completed | failed | nsfw | canceled
- 결과      : images[].url / video.url / audio.url   (파일은 7일 후 삭제 → 즉시 내려받아 보관)
- 취소      : POST cancel_url (queued 상태에서만, 202)
- 업로드    : POST /files/generate-upload-url {content_type} → upload_url(PUT), upload_headers, public_url
- 오류      : 401 인증, 403 잔액 부족, 404 계정에서 모델 없음, 422 검증 실패, 423 모델 일시 차단,
              429 큐 가득참(Retry-After), 503 모델 미준비.  failed·nsfw 는 과금되지 않음.
모델별 입력 필드는 서로 다르므로 코드에 고정하지 않고 provider_models 레지스트리의
capabilities.param_map / default_params 로 관리한다.
"""
import random
import time
import uuid

from .base import GenResult, ProviderError, call

BASE = "https://api.higgsfield.ai"
NAME = "higgsfield"
STATUS_MAP = {403: "balance", 404: "not_found", 423: "transient", 503: "transient"}
TERMINAL = {"completed", "failed", "nsfw", "canceled"}


class Higgsfield:
    def __init__(self, key_id: str, key_secret: str = ""):
        cred = f"{key_id}:{key_secret}" if key_secret else key_id
        self.headers = {"Authorization": f"Key {cred}", "Content-Type": "application/json"}

    # -- 연결 확인 -----------------------------------------------------
    def test(self) -> dict:
        """비용이 들지 않는 인증 확인: 존재하지 않는 요청의 상태를 조회한다.
        401 이면 키 오류, 404 이면 인증 통과(해당 요청만 없음)."""
        try:
            call(NAME, "GET", f"{BASE}/requests/{uuid.uuid4()}/status", headers=self.headers,
                 status_map=STATUS_MAP, retries=1)
        except ProviderError as e:
            if e.kind == "not_found":
                return {"ok": True, "note": "인증 성공. 모델별 사용 가능 여부는 첫 생성 시 확인됩니다."}
            raise
        return {"ok": True}

    # -- 제출 / 조회 ---------------------------------------------------
    def submit(self, endpoint: str, payload: dict, idempotency_key: str) -> dict:
        headers = {**self.headers, "Idempotency-Key": idempotency_key}
        return call(NAME, "POST", f"{BASE}/{endpoint.strip('/')}", headers=headers, json=payload,
                    status_map=STATUS_MAP, timeout=60)

    def status(self, request_id: str, status_url: str | None = None) -> dict:
        url = status_url or f"{BASE}/requests/{request_id}/status"
        return call(NAME, "GET", url, headers=self.headers, status_map=STATUS_MAP, timeout=30, retries=4)

    def cancel(self, request_id: str) -> bool:
        try:
            call(NAME, "POST", f"{BASE}/requests/{request_id}/cancel", headers=self.headers,
                 status_map=STATUS_MAP, retries=0)
            return True
        except ProviderError:
            return False  # 이미 처리 중이면 400

    def wait(self, request_id: str, status_url: str | None = None, timeout: float = 1500,
             heartbeat=None) -> GenResult:
        """문서 권장: 2초에서 시작해 1.5배씩 최대 10초까지 늘리며 폴링."""
        delay, started = 2.0, time.time()
        while True:
            body = self.status(request_id, status_url)
            st = body.get("status")
            if st in TERMINAL:
                return self._result(body, request_id)
            if time.time() - started > timeout:
                raise ProviderError(NAME, "transient", f"생성 대기 시간 초과({int(timeout)}초). 요청 {request_id}")
            if heartbeat:
                heartbeat()
            time.sleep(delay + random.random() * 0.5)
            delay = min(delay * 1.5, 10.0)

    @staticmethod
    def _result(body: dict, request_id: str) -> GenResult:
        st = body.get("status")
        if st == "nsfw":
            raise ProviderError(NAME, "moderation", "콘텐츠 검수에서 거부됨(과금되지 않음)")
        if st == "failed":
            raise ProviderError(NAME, "invalid", f"생성 실패(과금되지 않음): {body.get('error') or ''}")
        if st == "canceled":
            raise ProviderError(NAME, "invalid", "요청이 취소됨")
        urls = [i["url"] for i in body.get("images") or [] if i.get("url")]
        for k in ("video", "audio"):
            if isinstance(body.get(k), dict) and body[k].get("url"):
                urls.append(body[k]["url"])
        if not urls:
            raise ProviderError(NAME, "invalid", "완료 응답에 결과 URL이 없음")
        return GenResult(urls=urls, external_id=request_id, raw=body)

    def generate(self, endpoint: str, payload: dict, idempotency_key: str, on_submitted=None,
                 heartbeat=None) -> GenResult:
        sub = self.submit(endpoint, payload, idempotency_key)
        rid = sub.get("request_id")
        if not rid:
            raise ProviderError(NAME, "invalid", f"request_id 없음: {sub}")
        if on_submitted:
            on_submitted(rid)
        return self.wait(rid, sub.get("status_url"), heartbeat=heartbeat)

    # -- 참조 파일 업로드 ----------------------------------------------
    def upload(self, data: bytes, content_type: str = "image/png") -> str:
        info = call(NAME, "POST", f"{BASE}/files/generate-upload-url", headers=self.headers,
                    json={"content_type": content_type}, status_map=STATUS_MAP)
        # 저장소 URL에는 API 인증 헤더를 보내지 않는다(문서 지침).
        call("higgsfield-upload", "PUT", info["upload_url"], headers=info.get("upload_headers") or
             {"Content-Type": content_type}, content=data, timeout=300, retries=2)
        return info["public_url"]


def build_payload(model, *, prompt: str, aspect: str = "9:16", duration: float | None = None,
                  image_url: str | None = None, end_image_url: str | None = None,
                  seed: int | None = None, reference_id: str | None = None,
                  negative: str | None = None) -> dict:
    """레지스트리에 등록된 모델 스키마(capabilities)에 맞춰 요청 본문을 만든다."""
    cap = model.capabilities or {}
    pm = cap.get("param_map") or {}
    body = dict(model.default_params or {})
    max_len = cap.get("max_prompt")
    body[pm.get("prompt", "prompt")] = prompt[:max_len] if max_len else prompt
    if cap.get("aspect_ratios"):
        body[pm.get("aspect", "aspect_ratio")] = aspect if aspect in cap["aspect_ratios"] else cap["aspect_ratios"][0]
    if duration is not None and cap.get("duration"):
        lo, hi = cap["duration"]
        import math
        body[pm.get("duration", "duration")] = int(max(lo, min(hi, math.ceil(duration))))
    if image_url and pm.get("image"):
        body[pm["image"]] = image_url
    if end_image_url and pm.get("end_image"):
        body[pm["end_image"]] = end_image_url
    if seed and pm.get("seed"):
        lo, hi = cap.get("seed_range", [1, 2147483647])
        body[pm["seed"]] = max(lo, seed % hi) if seed % hi else lo
    if reference_id and pm.get("reference"):
        body[pm["reference"]] = reference_id
    if negative and pm.get("negative"):
        body[pm["negative"]] = negative
    return body
