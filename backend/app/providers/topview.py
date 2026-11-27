"""Topview Platform API 연동.

공식 문서(2026-11-27 확인): https://platform.topview.ai/llms.txt , /docs/quickstart , /docs/authentication
- Base URL : https://platform-backend.topview.ai/api/v1
- 인증     : Authorization: Bearer {PLATFORM_KEY}   (환경변수 권장명 TOPVIEW_API_PLATFORM_KEY)
- 제출     : POST /models/{vendor}/{model}[/{mode}]/predictions  + Idempotency-Key → data.id
- 조회     : GET /predictions/{id} → data.status = created | processing | payment_required | completed | failed
             완료 시 data.outputs(결과 URL 배열, 서명 URL은 1시간), data.charged_usd(실제 청구액)
- 업로드   : POST /media/files (multipart: kind, file ≤ 20MiB) → data.download_url (임시 서명 URL)
- 오류     : 401 키 오류, 402 INSUFFICIENT_BALANCE, 403 권한·모델 허용 목록, 429/5xx 재시도.
             지원하지 않는 필드는 400(과금 없음)이므로 모델별 본문은 문서에 있는 필드만 보낸다.
모델마다 본문 구조가 달라 provider_models.capabilities.template 으로 구분한다.
"""
import math
import random
import time
import uuid

from .base import GenResult, ProviderError, call

BASE = "https://platform-backend.topview.ai/api/v1"
NAME = "topview"
STATUS_MAP = {402: "balance", 403: "auth", 404: "not_found", 503: "transient"}


class Topview:
    def __init__(self, api_key: str):
        self.headers = {"Authorization": f"Bearer {api_key}"}

    def test(self) -> dict:
        """비용 없는 인증 확인: 없는 작업을 조회한다. 401 이면 키 오류, 404 이면 인증 통과."""
        try:
            call(NAME, "GET", f"{BASE}/predictions/{uuid.uuid4()}", headers=self.headers, status_map=STATUS_MAP, retries=1)
        except ProviderError as e:
            if e.kind == "not_found":
                return {"ok": True, "note": "인증 성공. 모델 사용 가능 여부(키의 허용 모델·잔액)는 첫 생성 시 확인됩니다."}
            raise
        return {"ok": True}

    def submit(self, model_path: str, mode: str | None, body: dict, idempotency_key: str) -> str:
        url = f"{BASE}/models/{model_path.strip('/')}" + (f"/{mode}" if mode else "") + "/predictions"
        r = call(NAME, "POST", url, headers={**self.headers, "Content-Type": "application/json",
                                             "Idempotency-Key": idempotency_key}, json=body, status_map=STATUS_MAP)
        tid = (r.get("data") or {}).get("id")
        if not tid:
            raise ProviderError(NAME, "invalid", f"작업 ID 없음: {str(r)[:300]}")
        return tid

    def get(self, task_id: str) -> dict:
        r = call(NAME, "GET", f"{BASE}/predictions/{task_id}", headers=self.headers, status_map=STATUS_MAP,
                 timeout=30, retries=4)
        return r.get("data") or {}

    def wait(self, task_id: str, timeout: float = 1800, heartbeat=None) -> GenResult:
        delay, started = 3.0, time.time()
        while True:
            d = self.get(task_id)
            st = d.get("status")
            if st == "completed":
                outs = [u for u in d.get("outputs") or [] if u]
                if not outs:
                    raise ProviderError(NAME, "invalid", "완료 응답에 결과 URL이 없음")
                return GenResult(urls=outs, external_id=task_id, raw={"charged_usd": d.get("charged_usd"),
                                                                      "billing_state": d.get("billing_state")})
            if st == "payment_required":
                raise ProviderError(NAME, "balance", "잔액이 부족해 작업이 결제 대기 상태입니다.")
            if st == "failed":
                err = d.get("error")
                raise ProviderError(NAME, "invalid", f"생성 실패: {err if isinstance(err, str) else (err or {}).get('message') or err}")
            if time.time() - started > timeout:
                raise ProviderError(NAME, "transient", f"생성 대기 시간 초과({int(timeout)}초). 작업 {task_id}")
            if heartbeat:
                heartbeat()
            time.sleep(delay + random.random() * 0.5)
            delay = min(delay * 1.3, 8.0)

    def upload(self, data: bytes, filename: str = "frame.jpg", content_type: str = "image/jpeg", kind: str = "image") -> str:
        r = call(NAME, "POST", f"{BASE}/media/files", headers=self.headers, data={"kind": kind},
                 files={"file": (filename, data, content_type)}, status_map=STATUS_MAP, timeout=300, retries=2)
        url = (r.get("data") or {}).get("download_url")
        if not url:
            raise ProviderError(NAME, "invalid", "업로드 응답에 download_url 이 없음")
        return url


def build_body(model, *, prompt: str, duration: float | None = None, image_url: str | None = None,
               end_image_url: str | None = None) -> dict:
    """모델군(template)별 요청 본문. 문서에 있는 필드만 사용한다."""
    cap = model.capabilities or {}
    p = dict(model.default_params or {})
    t = cap.get("template")
    secs = None
    if duration is not None and cap.get("duration"):
        lo, hi = cap["duration"]
        secs = int(max(lo, min(hi, math.ceil(duration))))
    if t == "seedance":
        content = [{"type": "text", "text": prompt[:10000]}]
        if image_url:
            content.append({"type": "image_url", "role": "first_frame", "image_url": {"url": image_url}})
        if end_image_url:
            content.append({"type": "image_url", "role": "last_frame", "image_url": {"url": end_image_url}})
        return {"content": content, "duration": secs or 5, **p}
    if t == "wan":
        media = [{"type": "first_frame", "url": image_url}] if image_url else []
        if end_image_url:
            media.append({"type": "last_frame", "url": end_image_url})
        return {"input": {"prompt": prompt[:10000], **({"media": media} if media else {})},
                "parameters": {"duration": secs or 5, **p}}
    if t == "kling":
        body = {"prompt": prompt[:2500], "duration": secs or 5, **p}
        if image_url:
            body["image"] = image_url
        if end_image_url:
            body["last_image"] = end_image_url
        return body
    if t == "image":
        return {"prompt": prompt[:cap.get("max_prompt", 2000)], **p}
    raise ProviderError(NAME, "config", f"모델 {model.model_key} 의 capabilities.template 이 지정되지 않았습니다.")
