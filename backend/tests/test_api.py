"""API·보안·공급자 어댑터 단위 검증."""
import httpx
import pytest

from app.db import SessionLocal
from app.models import ProviderConfig, ProviderModel, YoutubeMetricSnapshot
from app.providers import higgsfield as hf
from app.providers import speech, youtube
from app.providers.base import ProviderError

from .conftest import connect_all


def test_keys_are_encrypted_and_masked(client, world):
    client.put("/api/providers/anthropic", json={"credentials": {"api_key": "sk-ant-SECRET-VALUE-123"}})
    with SessionLocal() as db:
        row = db.query(ProviderConfig).filter_by(provider="anthropic").one()
        assert "SECRET" not in row.credentials_enc
    txt = client.get("/api/providers").text
    assert "SECRET" not in txt and "sk-******123" in txt


def test_provider_connection_tests(client, world):
    connect_all(client, prices=False)
    assert client.post("/api/providers/higgsfield/test").json()["ok"]  # 404(요청 없음) = 인증 통과
    assert "claude-sonnet-5-5" in client.post("/api/providers/anthropic/test").json()["models"]
    assert client.post("/api/providers/elevenlabs/test").json()["voices"] == 1
    assert client.post("/api/providers/youtube/test").json()["ok"]
    world.mock.get(url__regex=r"https://api\.higgsfield\.ai/requests/[^/]+/status").mock(
        return_value=httpx.Response(401, json={"detail": "Invalid credentials"}))
    r = client.post("/api/providers/higgsfield/test")
    assert r.status_code == 400 and "auth" in r.json()["detail"]
    st = {p["id"]: p for p in client.get("/api/providers").json()}
    assert st["higgsfield"]["verified"] is False and st["anthropic"]["verified"] is True
    assert st["runway"]["implemented"] is False
    assert client.put("/api/providers/runway", json={"credentials": {"api_key": "x"}}).status_code == 400


def test_user_isolation_and_admin_guard(client, world):
    connect_all(client)
    pid = client.post("/api/projects", json={"topic": "관리자 프로젝트"}).json()["id"]
    r = client.post("/api/auth/register", json={"username": "user1", "password": "password123"})
    other = {"Authorization": "Bearer " + r.json()["token"]}
    assert client.get(f"/api/projects/{pid}", headers=other).status_code == 404
    assert client.post(f"/api/projects/{pid}/cancel", headers=other).status_code == 404
    assert client.get("/api/projects", headers=other).json() == []
    assert client.get("/api/admin/users", headers=other).status_code == 403
    assert client.patch("/api/models/hf-z-image-turbo", json={"unit_cost_usd": 0}, headers=other).status_code == 403
    assert client.put("/api/providers/tavily", json={"credentials": {"api_key": "k"}, "scope": "global"}, headers=other).status_code == 403
    # 관리자가 등록한 공용 키는 일반 사용자도 쓸 수 있지만 키 값은 보이지 않는다
    client.put("/api/providers/gemini", json={"credentials": {"api_key": "g-shared-key-0001"}, "scope": "global"})
    g = next(p for p in client.get("/api/providers", headers=other).json() if p["id"] == "gemini")
    assert g["connected"] and g["mine"] is None and "shared-key" not in str(g)
    assert client.get("/api/projects").status_code == 200 and client.get("/api/auth/me", headers={"Authorization": "Bearer bad"}).status_code == 401


def test_batch_filters_near_duplicates(client, world):
    r = client.post("/api/batches", json={"topics": ["블랙홀은 어떻게 생길까", "블랙홀은 어떻게 생길까?", "문어의 심장은 왜 세 개일까", " "]}).json()
    assert len(r["created"]) == 2 and len(r["skipped"]) == 1 and "거의 같음" in r["skipped"][0]["reason"]
    assert all(p["status"] == "PENDING" and p["scheduled_at"] for p in r["created"]) and client.queued == []
    from app import tasks
    started = []
    import app.tasks as t
    orig = t.enqueue
    t.enqueue = lambda pid, queue=None: started.append(pid)
    try:
        out = tasks.tick()
    finally:
        t.enqueue = orig
    assert out["started"] == 1 and len(started) == 1  # 사용자별 한 번에 하나씩


def test_blocked_keyword_and_bad_options(client, world):
    client.put("/api/admin/settings", json={"blocked_keywords": ["도박"]})
    assert client.post("/api/projects", json={"topic": "도박으로 돈 버는 법"}).status_code == 400
    assert client.post("/api/projects", json={"topic": "정상 주제", "options": {"resolution": "640x480"}}).status_code == 400
    assert client.put("/api/admin/settings", json={"nope": 1}).status_code == 400


def test_upload_requires_explicit_approval(client, world):
    r = client.post("/api/projects/none/upload", json={"channel_id": "x", "confirm": True})
    assert r.status_code == 404
    assert client.get("/api/youtube/channels").json()["oauth_configured"] is False
    assert client.get("/api/youtube/oauth/start").status_code == 400


def test_youtube_analyze_uses_public_metrics_and_snapshots(client, world):
    connect_all(client, prices=False)
    r = client.get("/api/youtube/analyze", params={"q": "심해"}).json()
    v = r["videos"][0]
    assert v["is_short_estimated"] and v["metrics"]["short_basis"] == "해시태그" and v["metrics"]["views_per_subscriber"]
    assert "measured_views_per_hour" not in v["metrics"]  # 스냅샷이 1개뿐이면 증가량을 만들지 않는다
    assert "유지율" in v["limits"] and r["quota_used"] >= 200
    with SessionLocal() as db:
        assert db.query(YoutubeMetricSnapshot).count() == 3


def test_music_requires_license(client, world, tmp_path):
    from . import assets
    p = assets.music(str(tmp_path / "bgm.mp3"), 4)
    f = {"file": ("bgm.mp3", open(p, "rb"), "audio/mpeg")}
    r = client.post("/api/music", files=f, data={"title": "잔잔한 곡", "mood": "신비", "license_name": "직접 제작", "commercial_ok": "false"})
    assert r.status_code == 200 and r.json()["usable"] is False and r.json()["duration"] > 3
    assert client.post("/api/music", files={"file": ("x.exe", b"MZ", "application/octet-stream")},
                       data={"title": "x", "license_name": "x"}).status_code == 400


# ---- 어댑터 단위 ----
def test_higgsfield_payload_follows_registry(client):
    with SessionLocal() as db:
        wan = db.query(ProviderModel).filter_by(model_key="hf-wan3-prime-i2v").one()
        body = hf.build_payload(wan, prompt="p", aspect="9:16", duration=41.2, image_url="https://x/i.png", end_image_url="https://x/e.png", seed=7)
        assert body == {"resolution": "1080p", "generate_audio": False, "prompt": "p", "aspect_ratio": "9:16", "duration": 30,
                        "image_url": "https://x/i.png", "end_image_url": "https://x/e.png", "seed": 7}
        kl = db.query(ProviderModel).filter_by(model_key="hf-kling3-std-i2v").one()
        assert hf.build_payload(kl, prompt="p", duration=1.0, image_url="u", end_image_url="e") == {
            "sound": "off", "prompt": "p", "duration": 3, "image_url": "u", "last_image_url": "e"}


def test_higgsfield_terminal_states_and_errors(world):
    c = hf.Higgsfield("kid", "ksecret")
    for st, kind in (("nsfw", "moderation"), ("failed", "invalid"), ("canceled", "invalid")):
        with pytest.raises(ProviderError) as e:
            c._result({"status": st}, "r1")
        assert e.value.kind == kind
    world.mock.post("https://api.higgsfield.ai/z-image/turbo").mock(return_value=httpx.Response(429, headers={"Retry-After": "1"}, json={"detail": "account_queue_full"}))
    with pytest.raises(ProviderError) as e:
        c.submit("z-image/turbo", {"prompt": "x"}, "k1")
    assert e.value.kind == "rate_limit"
    world.mock.post("https://api.higgsfield.ai/z-image/turbo").mock(return_value=httpx.Response(403, json={"detail": "Insufficient balance"}))
    with pytest.raises(ProviderError) as e:
        c.submit("z-image/turbo", {"prompt": "x"}, "k2")
    assert e.value.kind == "balance"


def test_youtube_helpers():
    assert youtube.parse_duration("PT1M5S") == 65 and youtube.parse_duration("PT45S") == 45 and youtube.parse_duration(None) == 0
    m = youtube.analyze({"published_at": "2020-01-01T00:00:00Z", "view_count": 1000, "like_count": None, "comment_count": 5,
                         "title": "긴 영상", "description": "", "duration_sec": 600}, None, ["긴"])
    assert m["like_rate"] is None and m["views_per_subscriber"] is None and m["short_basis"] == "아님" and m["relevance"] == 1.0
    assert "state=abc" in youtube.oauth_url("cid", "https://x/cb", "abc") and "youtube.upload" in youtube.oauth_url("cid", "u", "s")


def test_word_timing_helpers():
    w = speech.chars_to_words(list("안녕 세계"), [0, .1, .2, .3, .4], [.1, .2, .3, .4, .5])
    assert w == [{"w": "안녕", "s": 0, "e": .2}, {"w": "세계", "s": .3, "e": .5}]
    r = speech.retime_script_words("3km 깊이", [{"w": "삼", "s": 0.1, "e": 0.3}, {"w": "킬로미터", "s": 0.3, "e": 0.9}, {"w": "깊이", "s": 1.0, "e": 1.4}], 1.5)
    assert [x["w"] for x in r] == ["3km", "깊이"] and r[0]["s"] == 0.1 and r[-1]["e"] == 1.4 and r[0]["e"] <= r[1]["s"] + 1e-6
    assert speech.apply_pronunciation("NASA 발표", {"NASA": "나사"}) == "나사 발표"


def test_higgsfield_key_pasted_as_one_line_in_either_field(client, world):
    from app.security import decrypt_json
    for cred in ({"key_id": "kid:ksecret"}, {"key_secret": " kid:ksecret "}, {"key_id": "kid", "key_secret": "ksecret"}):
        assert client.put("/api/providers/higgsfield", json={"credentials": cred}).status_code == 200
        with SessionLocal() as db:
            assert decrypt_json(db.query(ProviderConfig).filter_by(provider="higgsfield").one().credentials_enc) == {"key_id": "kid", "key_secret": "ksecret"}
        assert client.post("/api/providers/higgsfield/test").json()["ok"]
    r = client.put("/api/providers/higgsfield", json={"credentials": {}})
    assert r.status_code == 400 and "key_id" in r.json()["detail"] and "key_secret" not in r.json()["detail"]
