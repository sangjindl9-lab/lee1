"""파이프라인 실행 컨텍스트: 로그, 예산 통제, 멱등 유료 호출, 산출물 저장."""
import hashlib
import json
import os
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm.attributes import flag_modified

from ..config import get_settings
from ..models import (ApiUsageLog, AuditLog, CostRecord, GeneratedAsset, Project, ProjectSettings, ProviderModel,
                      ProviderRequest, Scene, User)
from ..providers import registry
from ..providers.base import ProviderError
from ..providers.llm import LLM
from ..storage import get_storage


class BudgetExceeded(Exception):
    pass


class Cancelled(Exception):
    pass


class PipelineError(Exception):
    pass


class Ctx:
    def __init__(self, db, project: Project, worker_id: str = "inline"):
        self.db, self.p, self.worker_id = db, project, worker_id
        self.s = get_settings()
        self.user: User = db.get(User, project.user_id)
        cfg = db.query(ProjectSettings).filter_by(project_id=project.id).first()
        if not cfg:
            cfg = ProjectSettings(project_id=project.id)
            db.add(cfg)
            db.commit()
        self.cfg = cfg
        self.storage = get_storage()
        self.stage_count = 17  # 오케스트레이터가 실제 단계 수로 덮어쓴다
        self.work = os.path.abspath(os.path.join(self.s.work_dir, project.id))
        os.makedirs(self.work, exist_ok=True)

    # -- 기록 ----------------------------------------------------------
    def log(self, message: str, level: str = "info", action: str = "pipeline", **data):
        self.db.add(AuditLog(user_id=self.p.user_id, project_id=self.p.id, action=action, level=level,
                             message=message, data=data))
        self.db.commit()

    def usage(self, provider: str, endpoint: str, units: float, unit_type: str, ok: bool = True, ms: int | None = None):
        self.db.add(ApiUsageLog(user_id=self.p.user_id, project_id=self.p.id, provider=provider, endpoint=endpoint,
                                units=units, unit_type=unit_type, ok=ok, latency_ms=ms))
        self.db.commit()

    def data(self, stage: str) -> dict:
        return (self.p.stage_data or {}).get(stage) or {}

    def save_data(self, stage: str, value: dict):
        d = dict(self.p.stage_data or {})
        d[stage] = value
        self.p.stage_data = d
        flag_modified(self.p, "stage_data")
        self.db.commit()

    def scenes(self) -> list[Scene]:
        return self.db.query(Scene).filter_by(project_id=self.p.id).order_by(Scene.idx).all()

    # -- 잠금 유지·취소 확인 -------------------------------------------
    def heartbeat(self):
        self.db.refresh(self.p)
        if self.p.cancel_requested:
            raise Cancelled()
        if self.p.locked_by == self.worker_id:
            self.p.lock_expires_at = datetime.now(timezone.utc) + timedelta(seconds=self.s.lock_ttl_seconds)
            self.db.commit()

    def step(self, done: int, total: int, label: str | None = None):
        """단계 안에서의 진행(장면 3/12 등)을 전체 진행률과 진행 기록에 반영한다.
        단계가 끝나야만 진행률이 오르면, 장면마다 1분씩 걸리는 생성 단계에서 화면이 멈춘 것처럼 보인다."""
        st = self.p.stage_state or {}
        n_done = sum(1 for v in st.values() if (v or {}).get("status") == "done")
        frac = min(max(done / total, 0.0), 0.99) if total else 0.0
        self.p.progress = min(99, int((n_done + frac) / max(self.stage_count, 1) * 100))
        self.db.commit()
        if label:
            self.log(f"{label} {done}/{total}", "info", "step", done=done, total=total)

    # -- 예산 ----------------------------------------------------------
    def spent_since(self, since: datetime) -> float:
        v = self.db.query(func.coalesce(func.sum(CostRecord.amount_usd), 0.0)).filter(
            CostRecord.user_id == self.p.user_id, CostRecord.created_at >= since).scalar()
        return float(v or 0)

    def ensure_budget(self, est: float):
        """유료 호출 직전에 프로젝트·일·월 한도를 확인한다. 초과 시 과금하지 않고 승인 대기로 넘긴다."""
        est = est or 0.0
        if self.p.actual_cost_usd + est > self.p.max_cost_usd + 1e-9:
            raise BudgetExceeded(f"프로젝트 최대 비용 ${self.p.max_cost_usd:.2f} 초과 예상 "
                                 f"(사용 ${self.p.actual_cost_usd:.3f} + 예정 ${est:.3f})")
        now = datetime.now(timezone.utc)
        day = self.spent_since(now.replace(hour=0, minute=0, second=0, microsecond=0))
        if day + est > self.user.daily_cost_limit_usd + 1e-9:
            raise BudgetExceeded(f"일일 비용 한도 ${self.user.daily_cost_limit_usd:.2f} 초과 예상")
        month = self.spent_since(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
        if month + est > self.user.monthly_cost_limit_usd + 1e-9:
            raise BudgetExceeded(f"월간 비용 한도 ${self.user.monthly_cost_limit_usd:.2f} 초과 예상")

    def spend(self, provider: str, model_key: str | None, kind: str, amount: float | None, request_id=None,
              note: str | None = None, estimated: bool = True):
        if amount is None:
            amount, note = 0.0, (note or "") + " [단가 미등록: 금액 미집계]"
        self.db.add(CostRecord(user_id=self.p.user_id, project_id=self.p.id, provider=provider, model_key=model_key,
                               kind=kind, amount_usd=amount, estimated=estimated, request_id=request_id, note=note))
        self.p.actual_cost_usd = round((self.p.actual_cost_usd or 0) + amount, 6)
        self.db.commit()

    # -- 모델·공급자 ---------------------------------------------------
    def model(self, key: str | None) -> ProviderModel | None:
        return self.db.query(ProviderModel).filter_by(model_key=key).first() if key else None

    def pick(self, kind: str, tier: str = "standard", explicit: str | None = None, **kw) -> ProviderModel | None:
        kw.setdefault("prefer_priced", not self.cfg.allow_unpriced)
        return registry.pick_model(self.db, self.p.user_id, kind, tier, explicit, **kw)

    def cred(self, provider: str) -> dict:
        return registry.require(self.db, self.p.user_id, provider)

    def has(self, provider: str) -> bool:
        return registry.credentials(self.db, self.p.user_id, provider) is not None

    def agent(self, name: str, system: str, user: str, required: list[str], images: list[bytes] | None = None,
              tier: str = "standard", max_tokens: int = 8000) -> dict:
        """AI 에이전트 1회 호출(JSON 스키마 응답). 토큰 사용량과 비용을 기록한다."""
        m = self.pick("llm", tier, self.cfg.llm_model, need="vision" if images else None)
        if not m:
            raise ProviderError("llm", "config", "연결된 언어 AI가 없습니다. Claude·OpenAI·Gemini 중 하나의 API 키를 등록하세요.")
        self.ensure_budget(0)
        llm = LLM(m.provider, self.cred(m.provider)["api_key"], m.endpoint)
        t0 = time.time()
        try:
            res = llm.complete_json(system, user, required, images, max_tokens)
        except ProviderError as e:
            self.usage(m.provider, f"llm:{name}", 0, "tokens", ok=False, ms=int((time.time() - t0) * 1000))
            self.log(f"{name} 에이전트 실패: {e.message}", "error", "agent", agent=name, kind=e.kind)
            raise
        ms = int((time.time() - t0) * 1000)
        self.usage(m.provider, f"llm:{name}", res.input_tokens + res.output_tokens, "tokens", ms=ms)
        cost = None
        if m.unit_cost_usd is not None:
            cost = res.input_tokens / 1e6 * m.unit_cost_usd + res.output_tokens / 1e6 * (m.unit_cost_out_usd or m.unit_cost_usd)
        self.spend(m.provider, m.model_key, "llm", cost, note=f"{name} in={res.input_tokens} out={res.output_tokens}",
                   estimated=False if cost is not None else True)
        self.log(f"{name} 에이전트 완료 ({ms / 1000:.1f}초)", "info", "agent", agent=name, model=m.model_key,
                 tokens=[res.input_tokens, res.output_tokens])
        return res.data  # type: ignore[return-value]

    # -- 멱등 유료 호출 -------------------------------------------------
    def paid(self, *, provider: str, model: ProviderModel | None, kind: str, scene: Scene | None, payload: dict,
             est_cost: float | None, run, attempt: int = 0) -> dict:
        """같은 (프로젝트·장면·종류·모델·입력·시도번호)의 유료 호출은 한 번만 실행된다.

        - 완료 기록이 있으면 결과를 재사용한다(중복 과금 방지, 재시작 시 기존 소스 재활용).
        - 제출만 되고 끝나지 않은 기록이 있으면 새로 제출하지 않고 외부 작업 ID로 이어서 조회한다.
        run(idempotency_key, resume_id, on_submitted) → dict(JSON 저장 가능)
        """
        mk = model.model_key if model else None
        raw = json.dumps([self.p.id, scene.id if scene else None, kind, mk, payload, attempt], sort_keys=True,
                         ensure_ascii=False, default=str)
        key = hashlib.sha256(raw.encode()).hexdigest()
        row = self.db.query(ProviderRequest).filter_by(idempotency_key=key).first()
        if row and row.status == "completed":
            self.log(f"기존 생성 결과 재사용({kind})", "info", "reuse", request=row.id)
            return row.response
        resume_id = row.external_id if row and row.status == "submitted" else None
        if not resume_id:
            self.ensure_budget(est_cost or 0)
        if not row:
            row = ProviderRequest(user_id=self.p.user_id, project_id=self.p.id, scene_id=scene.id if scene else None,
                                  provider=provider, model_key=mk, kind=kind, idempotency_key=key, request=payload)
            self.db.add(row)
        row.attempts = (row.attempts or 0) + 1
        row.status, row.error = ("submitted" if resume_id else "pending"), None
        self.db.commit()  # 호출 전에 기록을 남겨야 서버가 죽어도 중복 제출하지 않는다

        def on_submitted(ext_id: str):
            row.external_id, row.status = ext_id, "submitted"
            self.db.commit()

        t0 = time.time()
        try:
            result = run(key, resume_id, on_submitted)
        except ProviderError as e:
            row.status, row.error, row.error_kind = "failed", e.message, e.kind
            row.duration_ms = int((time.time() - t0) * 1000)
            # 실패 요청의 과금 여부: Higgsfield 는 failed/nsfw 미과금(공식 문서). 그 외는 확인 불가로 남긴다.
            row.billed = False if provider == "higgsfield" else None
            self.db.commit()
            self.usage(provider, f"{kind}:{mk}", 0, kind, ok=False, ms=row.duration_ms)
            raise
        row.status, row.response, row.billed, row.cost_usd = "completed", result, True, est_cost
        row.duration_ms = int((time.time() - t0) * 1000)
        self.db.commit()
        self.usage(provider, f"{kind}:{mk}", 1, kind, ms=row.duration_ms)
        self.spend(provider, mk, kind, est_cost, request_id=row.id, note="단가표 기준 계산")
        return result

    # -- 산출물 --------------------------------------------------------
    def save_asset(self, kind: str, ext: str, *, data: bytes | None = None, path: str | None = None,
                   scene: Scene | None = None, **fields) -> GeneratedAsset:
        asset = GeneratedAsset(project_id=self.p.id, scene_id=scene.id if scene else None, kind=kind,
                               storage_key="", **fields)
        self.db.add(asset)
        self.db.flush()
        key = f"{self.p.id}/{kind}/{asset.id}.{ext}"
        if data is not None:
            self.storage.put_bytes(key, data)
            asset.sha256 = hashlib.sha256(data).hexdigest()
        else:
            self.storage.put_file(key, path)  # type: ignore[arg-type]
        asset.storage_key = key
        self.db.commit()
        return asset

    def asset(self, asset_id: str | None) -> GeneratedAsset | None:
        return self.db.get(GeneratedAsset, asset_id) if asset_id else None
