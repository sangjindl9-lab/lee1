"""공급자 카탈로그 · 모델 레지스트리 · 자격증명 조회.

모델명·버전·단가는 코드가 아니라 provider_models 테이블에서 관리한다(관리자 화면에서 추가·수정).
아래 SEED 는 2026-11-27 공식 문서에서 입력 스키마를 직접 확인한 모델만 schema_verified=True 로 둔다.
단가를 공식 페이지에서 확인하지 못한 모델은 unit_cost_usd=None(가격 미등록)으로 두고,
예산 계산 시 임의의 값을 넣지 않는다.
"""
from sqlalchemy.orm import Session

from ..models import ProviderConfig, ProviderModel
from ..security import decrypt_json
from .base import ProviderError

# id, 이름, 용도, 입력 필드, 구현 여부
CATALOG = [
    {"id": "higgsfield", "name": "Higgsfield", "kinds": ["image", "i2v", "t2v"], "implemented": True,
     "fields": ["key_id", "key_secret"], "optional": ["key_secret"], "docs": "https://docs.higgsfield.ai",
     "help": "open.higgsfield.ai 의 API Keys 에서 발급. 웹사이트 구독 크레딧과 API 잔액은 별개이며 API는 선불 잔액에서 차감됩니다."},
    {"id": "topview", "name": "Topview Platform", "kinds": ["image", "i2v"], "implemented": True, "fields": ["api_key"],
     "docs": "https://platform.topview.ai/docs/quickstart",
     "help": "platform.topview.ai 콘솔의 API keys 에서 발급(모델 생성·요청 조회 권한). 서버 환경변수 TOPVIEW_API_PLATFORM_KEY 로 넣어도 됩니다. Seedance·Kling·Wan 등 여러 영상 모델을 한 잔액으로 씁니다."},
    {"id": "anthropic", "name": "Claude (Anthropic)", "kinds": ["llm"], "implemented": True, "fields": ["api_key"],
     "docs": "https://docs.claude.com"},
    {"id": "openai", "name": "OpenAI", "kinds": ["llm", "image", "tts", "stt"], "implemented": True,
     "fields": ["api_key"], "docs": "https://platform.openai.com/docs"},
    {"id": "gemini", "name": "Google Gemini", "kinds": ["llm"], "implemented": True, "fields": ["api_key"],
     "docs": "https://ai.google.dev/gemini-api/docs"},
    {"id": "elevenlabs", "name": "ElevenLabs", "kinds": ["tts"], "implemented": True, "fields": ["api_key"],
     "docs": "https://elevenlabs.io/docs"},
    {"id": "tavily", "name": "Tavily Search", "kinds": ["search"], "implemented": True, "fields": ["api_key"],
     "docs": "https://docs.tavily.com"},
    {"id": "brave", "name": "Brave Search", "kinds": ["search"], "implemented": True, "fields": ["api_key"],
     "docs": "https://api.search.brave.com"},
    {"id": "youtube", "name": "YouTube Data API v3", "kinds": ["youtube"], "implemented": True, "fields": ["api_key"],
     "docs": "https://developers.google.com/youtube/v3"},
    {"id": "google_oauth", "name": "Google OAuth (유튜브 채널 연결·업로드)", "kinds": ["oauth"], "implemented": True,
     "fields": ["client_id", "client_secret"], "admin_only": True, "docs": "https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps",
     "help": "Google Cloud 콘솔에서 OAuth 클라이언트(웹 애플리케이션)를 만들고 리디렉션 URI에 '유튜브 채널 연결' 화면에 표시된 주소를 등록하세요."},
    # 아래는 공통 인터페이스에 추가할 수 있도록 자리만 잡아 둔 후보(미구현).
    {"id": "runway", "name": "Runway", "kinds": ["i2v"], "implemented": False, "fields": ["api_key"]},
    {"id": "google_veo", "name": "Google Veo", "kinds": ["t2v"], "implemented": False, "fields": ["api_key"]},
    {"id": "luma", "name": "Luma", "kinds": ["i2v"], "implemented": False, "fields": ["api_key"]},
    {"id": "fal", "name": "fal.ai", "kinds": ["image", "i2v"], "implemented": False, "fields": ["api_key"]},
    {"id": "replicate", "name": "Replicate", "kinds": ["image", "i2v"], "implemented": False, "fields": ["api_key"]},
    {"id": "google_tts", "name": "Google Cloud TTS", "kinds": ["tts"], "implemented": False, "fields": ["api_key"]},
    {"id": "azure_speech", "name": "Azure Speech", "kinds": ["tts"], "implemented": False, "fields": ["api_key", "region"]},
]
IMPLEMENTED = {c["id"] for c in CATALOG if c["implemented"]}

_HF_PRICE = "https://open.higgsfield.ai/pricing (2026-11-27 확인, 정가 기준. 계정 할인·해상도별 실제 단가는 콘솔에서 확인)"
_TV_PRICE = "https://platform.topview.ai/pricing (2026-11-27 확인. 실제 청구액은 작업 결과의 charged_usd)"
_RATIOS_WAN = ["16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]

SEED = [
    # ---- Higgsfield 이미지 ----
    dict(provider="higgsfield", model_key="hf-z-image-turbo", kind="image", display_name="Z-Image Turbo",
         endpoint="z-image/turbo", tier="economy", unit="per_image", unit_cost_usd=None, schema_verified=True,
         default_params={"resolution": "2k", "prompt_extend": False},
         capabilities={"aspect_ratios": ["9:16", "1:1", "2:3", "3:4", "16:9"], "max_prompt": 800,
                       "param_map": {"seed": "seed"}, "seed_range": [1, 2147483647]},
         notes="가격을 공식 가격 페이지에서 확인하지 못함 → 콘솔에서 확인 후 단가 입력"),
    dict(provider="higgsfield", model_key="hf-soul-v2", kind="image", display_name="SOUL V2 (인물·에디토리얼)",
         endpoint="higgsfield-ai/soul/v2/standard", tier="standard", unit="per_image", unit_cost_usd=None,
         schema_verified=True, default_params={"resolution": "1080p", "batch_size": 1},
         capabilities={"aspect_ratios": ["9:16", "16:9", "4:3", "3:4", "1:1", "2:3", "3:2"],
                       "param_map": {"seed": "seed", "reference": "custom_reference_id"},
                       "seed_range": [1, 1000000], "character_reference": True},
         notes="custom_reference_id(Soul ID)로 인물 일관성 유지 가능. 가격 미확인"),
    # ---- Higgsfield 영상 ----
    dict(provider="higgsfield", model_key="hf-wan3-prime-i2v", kind="i2v", display_name="Wan 3.0 Prime · 이미지→영상",
         endpoint="alibaba/wan-3.0-prime/image-to-video", tier="economy", unit="per_second", unit_cost_usd=0.068,
         price_source=_HF_PRICE, schema_verified=True,
         default_params={"resolution": "1080p", "generate_audio": False},
         capabilities={"duration": [2, 30], "aspect_ratios": _RATIOS_WAN, "end_frame": True,
                       "param_map": {"image": "image_url", "end_image": "end_image_url", "seed": "seed"}}),
    dict(provider="higgsfield", model_key="hf-wan3-prime-t2v", kind="t2v", display_name="Wan 3.0 Prime · 텍스트→영상",
         endpoint="alibaba/wan-3.0-prime/text-to-video", tier="economy", unit="per_second", unit_cost_usd=0.068,
         price_source=_HF_PRICE, schema_verified=True,
         default_params={"resolution": "1080p", "generate_audio": False},
         capabilities={"duration": [2, 30], "aspect_ratios": _RATIOS_WAN, "param_map": {"seed": "seed"}}),
    dict(provider="higgsfield", model_key="hf-kling3-std-i2v", kind="i2v", display_name="Kling 3.0 Standard · 이미지→영상",
         endpoint="kling-video/v3.0/std/image-to-video", tier="standard", unit="per_second", unit_cost_usd=0.063,
         price_source=_HF_PRICE, schema_verified=True, default_params={"sound": "off"},
         capabilities={"duration": [3, 15], "end_frame": True, "max_prompt": 2500,
                       "param_map": {"image": "image_url", "end_image": "last_image_url"}}),
    dict(provider="higgsfield", model_key="hf-kling3-pro-i2v", kind="i2v", display_name="Kling 3.0 Pro · 이미지→영상",
         endpoint="kling-video/v3.0/pro/image-to-video", tier="premium", unit="per_second", unit_cost_usd=0.084,
         price_source=_HF_PRICE, schema_verified=False, enabled=False, default_params={"sound": "off"},
         capabilities={"duration": [3, 15], "end_frame": True, "max_prompt": 2500,
                       "param_map": {"image": "image_url", "end_image": "last_image_url"}},
         notes="입력 스키마를 Standard와 동일하다고 가정(미검증). 실제 호출로 확인 후 활성화"),
    # Seedance(ByteDance) — Higgsfield API 경유. 화면비·시드 필드가 없고(입력 이미지를 따름) 추가 필드는 거부된다.
    dict(provider="higgsfield", model_key="hf-seedance25-i2v", kind="i2v", display_name="Seedance 2.5 · 이미지→영상",
         endpoint="bytedance/seedance-2.5/image-to-video", tier="premium", unit="per_second", unit_cost_usd=0.206,
         price_source=_HF_PRICE, schema_verified=True,
         default_params={"resolution": "1080p", "generate_audio": False},
         capabilities={"duration": [4, 30], "end_frame": True,
                       "param_map": {"image": "image_url", "end_image": "end_image_url"}},
         notes="단가는 가격표의 정가(최대 1080p) 기준. 480p는 $0.145/초로 표시됨 — 콘솔 청구액으로 확인"),
    dict(provider="higgsfield", model_key="hf-seedance20-i2v", kind="i2v", display_name="Seedance 2.0 · 이미지→영상",
         endpoint="bytedance/seedance-2.0/image-to-video", tier="premium", unit="per_second", unit_cost_usd=0.141,
         price_source=_HF_PRICE, schema_verified=True,
         default_params={"resolution": "1080p", "generate_audio": False},
         capabilities={"duration": [4, 15], "end_frame": True,
                       "param_map": {"image": "image_url", "end_image": "end_image_url"}},
         notes="단가는 가격표의 정가 기준. 480p는 $0.099/초로 표시됨 — 콘솔 청구액으로 확인"),
    # ---- Topview Platform (2026-11-27 문서·가격표 확인. 단가는 참조 영상 없는 경우의 초당 요금) ----
    dict(provider="topview", model_key="tv-seedance25-i2v", kind="i2v", display_name="Seedance 2.5 (Topview)",
         endpoint="bytedance/seedance-2.5", tier="premium", unit="per_second", unit_cost_usd=0.1849,
         price_source=_TV_PRICE, schema_verified=True,
         default_params={"resolution": "720p", "ratio": "adaptive", "generate_audio": False},
         capabilities={"template": "seedance", "mode": "image-to-video", "duration": [4, 30], "end_frame": True},
         notes="720p 기준 단가. 1080p 는 $0.4549/초 — default_params.resolution 과 단가를 함께 바꿀 것"),
    dict(provider="topview", model_key="tv-seedance20-mini-i2v", kind="i2v", display_name="Seedance 2.0 Mini (Topview)",
         endpoint="bytedance/seedance-2.0-mini", tier="economy", unit="per_second", unit_cost_usd=0.0643,
         price_source=_TV_PRICE, schema_verified=True,
         default_params={"resolution": "720p", "ratio": "adaptive", "generate_audio": False},
         capabilities={"template": "seedance", "mode": "image-to-video", "duration": [4, 15], "end_frame": True}),
    dict(provider="topview", model_key="tv-seedance20-i2v", kind="i2v", display_name="Seedance 2.0 (Topview)",
         endpoint="bytedance/seedance-2.0", tier="standard", unit="per_second", unit_cost_usd=0.1285,
         price_source=_TV_PRICE, schema_verified=False,
         default_params={"resolution": "720p", "ratio": "adaptive", "generate_audio": False},
         capabilities={"template": "seedance", "mode": "image-to-video", "duration": [4, 15], "end_frame": True},
         notes="입력 스키마를 2.0 Mini·2.5 와 같다고 보고 등록(모델 페이지 미확인)"),
    dict(provider="topview", model_key="tv-kling40-i2v", kind="i2v", display_name="Kling 4.0 (Topview)",
         endpoint="kling/kling-4.0", tier="standard", unit="per_second", unit_cost_usd=0.1397,
         price_source=_TV_PRICE, schema_verified=True, default_params={"resolution": "720P", "aspect_ratio": "9:16"},
         capabilities={"template": "kling", "mode": "image-to-video", "duration": [3, 30], "end_frame": True},
         notes="720P 기준 단가. 1080P 는 $0.2096/초"),
    dict(provider="topview", model_key="tv-wan30-i2v", kind="i2v", display_name="Wan 3.0 (Topview)",
         endpoint="alibaba/wan-3.0", tier="economy", unit="per_second", unit_cost_usd=0.0971,
         price_source=_TV_PRICE, schema_verified=True,
         default_params={"resolution": "1080P", "ratio": "adaptive", "audio": False},
         capabilities={"template": "wan", "mode": "image-to-video", "duration": [2, 30], "end_frame": True},
         notes="1080P 기준 단가. 720P 는 $0.0485/초"),
    dict(provider="topview", model_key="tv-seedream45", kind="image", display_name="Seedream 4.5 (Topview)",
         endpoint="bytedance/seedream-v4.5", tier="standard", unit="per_image", unit_cost_usd=None, schema_verified=True,
         default_params={"resolution": "2K", "aspect_ratio": "9:16"},
         capabilities={"template": "image", "max_prompt": 2000},
         notes="가격표에서 단가를 찾지 못함. 실제 청구액(charged_usd)은 생성 후 비용 기록에 남음"),
    # ---- 언어 AI ----
    dict(provider="anthropic", model_key="claude-sonnet", kind="llm", display_name="Claude Sonnet",
         endpoint="claude-sonnet-5-5", tier="standard", unit="per_mtok", unit_cost_usd=None,
         capabilities={"vision": True}, notes="모델 ID·단가는 연결 테스트의 모델 목록과 공식 가격표로 확인 후 수정"),
    dict(provider="anthropic", model_key="claude-haiku", kind="llm", display_name="Claude Haiku",
         endpoint="claude-haiku-5-5", tier="economy", unit="per_mtok", unit_cost_usd=None,
         capabilities={"vision": True}, notes="모델 ID·단가 확인 필요"),
    # ---- 음성 ----
    dict(provider="elevenlabs", model_key="eleven-multilingual-v2", kind="tts", display_name="ElevenLabs Multilingual v2",
         endpoint="eleven_multilingual_v2", tier="premium", unit="per_1k_chars", unit_cost_usd=None,
         capabilities={"word_timestamps": True}, notes="요금제별 단가 상이 → 단가 입력 필요"),
    dict(provider="openai", model_key="openai-tts-1", kind="tts", display_name="OpenAI 음성(최신 TTS 자동 선택)",
         endpoint="gpt-4o-mini-tts", tier="economy", unit="per_1k_chars", unit_cost_usd=None,
         capabilities={"word_timestamps": False},
         notes="계정의 모델 목록에서 말투 지시가 되는 최신 TTS 모델로 자동 교체. 한국어 품질은 ElevenLabs 한국어 음성이 더 좋음"),
    dict(provider="openai", model_key="openai-whisper-1", kind="stt", display_name="OpenAI Whisper",
         endpoint="whisper-1", tier="standard", unit="per_minute", unit_cost_usd=None, notes="단가 입력 필요"),
    dict(provider="openai", model_key="openai-gpt-image-1", kind="image", display_name="OpenAI GPT Image",
         endpoint="gpt-image-1", tier="standard", unit="per_image", unit_cost_usd=None,
         default_params={"size": "1024x1536"}, notes="모델 ID·단가 확인 필요(미검증)"),
]


def seed_models(db: Session) -> int:
    have = {m.model_key for m in db.query(ProviderModel.model_key)}
    n = 0
    for row in SEED:
        if row["model_key"] not in have:
            db.add(ProviderModel(**row))
            n += 1
    db.commit()
    return n


def credentials(db: Session, user_id: str | None, provider: str) -> dict | None:
    """사용자 키 우선, 없으면 관리자가 등록한 서비스 공용 키."""
    q = db.query(ProviderConfig).filter(ProviderConfig.provider == provider, ProviderConfig.is_active.is_(True))
    row = None
    if user_id:
        row = q.filter(ProviderConfig.user_id == user_id).first()
    row = row or q.filter(ProviderConfig.user_id.is_(None)).first()
    if not row or not row.credentials_enc:
        return _env_credentials(provider)
    return decrypt_json(row.credentials_enc)


# 서버 환경변수로 넣은 키(화면에서 등록한 키가 없을 때 사용)
ENV_KEYS = {"topview": {"api_key": "TOPVIEW_API_PLATFORM_KEY"}}


def _env_credentials(provider: str) -> dict | None:
    import os
    cred = {f: os.environ.get(var, "").strip() for f, var in ENV_KEYS.get(provider, {}).items()}
    return cred if cred and all(cred.values()) else None


def available_providers(db: Session, user_id: str | None) -> set[str]:
    q = db.query(ProviderConfig.provider).filter(ProviderConfig.is_active.is_(True), ProviderConfig.credentials_enc != "")
    q = q.filter((ProviderConfig.user_id == user_id) | (ProviderConfig.user_id.is_(None)))
    return {p for (p,) in q} | {p for p in ENV_KEYS if _env_credentials(p)}


TIER_ORDER = {"economy": 0, "standard": 1, "premium": 2}


def pick_model(db: Session, user_id: str | None, kind: str, tier: str = "standard",
               explicit: str | None = None, exclude: set[str] | None = None,
               need: str | None = None, prefer_priced: bool = True) -> ProviderModel | None:
    """연결된 공급자의 활성 모델 중 요청 등급에 가장 가까운 모델을 고른다."""
    avail = available_providers(db, user_id)
    models = [m for m in db.query(ProviderModel).filter(ProviderModel.kind == kind, ProviderModel.enabled.is_(True))
              if m.provider in avail and m.model_key not in (exclude or set())]
    if need:
        models = [m for m in models if (m.capabilities or {}).get(need)] or models
    if explicit:
        for m in models:
            if m.model_key == explicit:
                return m
    if not models:
        return None
    want = TIER_ORDER.get(tier, 1)
    # 단가가 등록된 모델 우선(비용을 계산할 수 있어야 자동 제작 가능) → 등급 차이가 작은 순 → 단가 낮은 순
    models.sort(key=lambda m: (prefer_priced and m.unit_cost_usd is None, abs(TIER_ORDER.get(m.tier, 1) - want),
                               m.unit_cost_usd if m.unit_cost_usd is not None else 1e9))
    return models[0]


def require(db: Session, user_id: str | None, provider: str) -> dict:
    c = credentials(db, user_id, provider)
    if not c:
        raise ProviderError(provider, "config", "API 키가 등록되지 않았습니다. 'API 연결 관리'에서 등록하세요.")
    return c
