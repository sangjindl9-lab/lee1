"""주제 입력 → 완성 MP4 까지의 E2E와 장애·과금 방지 시나리오.
외부 API 응답만 모의이고, 파이프라인·DB·FFmpeg 렌더링·품질 측정은 실제로 실행된다."""
import io
import zipfile

from app.db import SessionLocal
from app.media import ffmpeg
from app.models import CostRecord, Project, ProviderRequest, ResearchSource, Scene
from app.pipeline import orchestrator
from app.storage import get_storage

from .conftest import SCENES as SCENES_TXT, connect_all, run


def make(c, **kw):
    r = c.post("/api/projects", json={"topic": "심해 생물은 왜 빛날까", "mode": "quality", **kw})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_e2e_topic_to_mp4(client, world):
    connect_all(client)
    pid = make(client, options={"subtitle_languages": ["en"]})
    assert client.queued == [pid]
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert d["status"] == "COMPLETED" and d["progress"] == 100
    assert all(s["status"] == "done" for s in d["stages"]) and len(d["stages"]) == 17

    # 기획안 3개 이상 → 선정, 근거 없는 사실은 버려짐
    assert len(d["stage_data"]["strategy"]["concepts"]) == 3 and d["stage_data"]["strategy"]["selected"]["id"] == "C"
    facts = [s for s in d["sources"] if s["kind"] == "fact"]
    assert len(facts) == 1 and facts[0]["url"] == "https://example.org/biolum" and facts[0]["checked_at"]

    # 경제형이 아니면 모든 장면을 실제 영상으로 만든다
    kinds = [s["kind"] for s in d["scenes"]]
    assert kinds == ["video"] * 4
    assert world.calls["hf_image"] == 4 and world.calls["hf_video"] == 4
    # 내레이션은 대본 전체를 한 번에 합성하고, 글자 타임스탬프로 장면을 잘라 쓴다
    assert world.calls["tts"] == 1 and world.tts_texts[0] == " ".join(t for t, _, _ in SCENES_TXT)
    assert {s["sync_method"] for s in d["scenes"]} == {"tts_timestamps"}
    assert all(abs(a["end"] - b["start"]) < 1e-3 for a, b in zip(d["scenes"], d["scenes"][1:]))

    # Higgsfield 요청 본문이 공식 스키마의 필드만 쓰는지(z-image 는 추가 필드 거부)
    for kind, body in world.hf_bodies:
        if kind == "image":
            assert set(body) <= {"prompt", "resolution", "aspect_ratio", "prompt_extend", "seed"}
            assert body["aspect_ratio"] == "9:16" and len(body["prompt"]) <= 800
        else:
            # quality 모드 → standard 등급의 Kling 3.0 Standard (화면비는 입력 이미지를 따르므로 필드 없음)
            assert set(body) == {"image_url", "prompt", "duration", "sound"}
            assert body["image_url"].startswith("https://cdn.test/") and 3 <= body["duration"] <= 15 and body["sound"] == "off"
    assert len(set(world.idem_keys)) == len(world.idem_keys)

    # 실제 렌더 결과물 규격
    with SessionLocal() as db:
        p = db.get(Project, pid)
        path = get_storage().local_path(p.output_video_key)
        info = ffmpeg.summary(path)
        total = sum(s.duration for s in db.query(Scene).filter_by(project_id=pid))
        assert (info["width"], info["height"], info["vcodec"], info["acodec"]) == (1080, 1920, "h264", "aac")
        assert abs(info["duration"] - total) < 0.3
        costs = db.query(CostRecord).filter_by(project_id=pid).all()
        assert abs(sum(x.amount_usd for x in costs) - p.actual_cost_usd) < 1e-6 and p.actual_cost_usd > 0
        assert p.actual_cost_usd <= p.estimated_cost_usd + 0.02

    q = d["quality"][-1]
    assert q["passed"] and not q["partial"] and q["total"] >= 90 and set(q["scores"]) == {"spec", "audio", "subtitle", "visual", "story", "accuracy", "consistency"}
    pk = d["package"]
    assert len(pk["titles"]) == 5 and pk["hashtags"] and pk["sources"] and pk["ai_disclosure"] and len(pk["cover_urls"]) >= 2
    assert {(s["language"], s["format"]) for s in d["subtitles"]} >= {("ko", "srt"), ("ko", "vtt"), ("ko", "ass"), ("en", "srt")}

    # 다운로드
    r = client.get(f"/api/projects/{pid}/download")
    assert r.status_code == 200 and r.headers["content-type"] == "video/mp4" and len(r.content) > 50_000
    z = zipfile.ZipFile(io.BytesIO(client.get(f"/api/projects/{pid}/package.zip").content))
    assert {"video.mp4", "metadata.json", "upload_guide.md", "subtitles/ko.srt"} <= set(z.namelist())
    assert client.get(d["video_url"].replace("http://testserver", "")).status_code == 200


def test_prompt_injection_is_isolated(client, world):
    connect_all(client)
    pid = make(client)
    seen = []
    orig = world.answer
    world.answer = lambda name, user, body: (seen.append((name, user, body["system"])), orig(name, user, body))[1]
    assert run(pid) == "COMPLETED"
    fact_user, fact_sys = next((u, s) for n, u, s in seen if n == "팩트체크 AI")
    assert fact_user.count("</external_data>") == 1  # 자료 안의 닫는 태그는 제거돼 블록을 탈출하지 못한다
    assert "신뢰할 수 없는 자료" in fact_sys


def test_unpriced_models_wait_for_approval_without_billing(client, world):
    connect_all(client, prices=False)
    pid = make(client)
    assert run(pid) == "AWAITING_APPROVAL"
    d = client.get(f"/api/projects/{pid}").json()
    assert "단가가 등록되지 않은" in d["error"]
    assert world.calls["hf_image"] == 0 and world.calls["tts"] == 0  # 유료 생성 호출 없음
    assert client.post(f"/api/projects/{pid}/approve", json={"allow_unpriced": True}).status_code == 200
    assert run(pid) == "COMPLETED"
    assert world.calls["llm"]["대본 작가 AI"] == 1  # 승인 후 재개 시 앞 단계는 다시 돌지 않는다
    soul = [b for k, b in world.hf_bodies if k == "image"]  # 승인 후에는 standard 등급의 SOUL V2 사용
    assert soul and all(set(b) <= {"prompt", "aspect_ratio", "resolution", "batch_size", "seed"} and 1 <= b["seed"] <= 1000000 for b in soul)


def test_budget_exceeded_stops_before_generation(client, world):
    connect_all(client)
    pid = make(client, max_cost_usd=0.03)
    assert run(pid) == "AWAITING_APPROVAL"
    assert world.calls["hf_image"] == 0 and world.calls["hf_video"] == 0 and world.calls["tts"] == 0
    assert client.post(f"/api/projects/{pid}/approve", json={"max_cost_usd": 0.001}).status_code == 400
    assert client.post(f"/api/projects/{pid}/approve", json={"max_cost_usd": 5}).status_code == 200
    assert run(pid) == "COMPLETED"


def test_auto_mode_downgrades_video_scenes_to_fit_budget(client, world):
    connect_all(client)
    pid = make(client, mode="auto", max_cost_usd=0.5)  # 영상 1장면(약 $0.3)이 예산의 85%를 넘지 않게 조정되는지
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert d["actual_cost_usd"] <= 0.5


def test_insufficient_balance_then_retry(client, world):
    connect_all(client)
    world.balance_empty = True
    pid = make(client)
    assert run(pid) == "FAILED"
    d = client.get(f"/api/projects/{pid}").json()
    assert "잔액" in d["error"] and d["current_stage"] == "images"
    tts_before = world.calls["tts"]
    world.balance_empty = False
    assert client.post(f"/api/projects/{pid}/retry").status_code == 200
    assert run(pid) == "COMPLETED"
    assert world.calls["tts"] == tts_before  # 이미 만든 내레이션은 재사용


def test_restart_resumes_stage_and_never_double_bills(client, world, monkeypatch):
    connect_all(client)
    pid = make(client)
    boom = {"n": 0}

    def crash(c):
        boom["n"] += 1
        raise RuntimeError("워커 프로세스 종료 시뮬레이션")
    stages = [(k, s, q, label, crash if k == "subs" else fn) for k, s, q, label, fn in orchestrator.STAGES]
    monkeypatch.setattr(orchestrator, "STAGES", stages)
    assert run(pid) == "FAILED"
    snap = dict(world.calls, llm=dict(world.calls["llm"]))
    monkeypatch.undo()
    monkeypatch.setattr("app.providers.base.time.sleep", lambda *_: None)
    monkeypatch.setattr("app.providers.higgsfield.time.sleep", lambda *_: None)
    with SessionLocal() as db:  # 서버 재시작 후: 잠금이 풀린 FAILED 작업을 재시도
        p = db.get(Project, pid)
        assert p.locked_by is None and p.stage_state["videos"]["status"] == "done" and p.stage_state["subs"]["status"] == "failed"
    from app.api.projects import _restart
    with SessionLocal() as db:
        monkeypatch.setattr("app.tasks.enqueue", lambda *a, **k: None)
        _restart(db, db.get(Project, pid))
    assert run(pid) == "COMPLETED"
    for k in ("hf_image", "hf_video", "tts"):
        assert world.calls[k] == snap[k], k  # 생성 API가 다시 호출되지 않음
    assert world.calls["llm"]["대본 작가 AI"] == snap["llm"]["대본 작가 AI"]


def test_crash_after_submit_resumes_same_external_request(client, world, monkeypatch):
    """제출 직후 서버가 죽은 경우: 재시작하면 새로 제출하지 않고 기존 request_id 를 이어서 조회한다."""
    connect_all(client)
    pid = make(client, mode="economy")
    from app.providers import higgsfield
    real_wait, state = higgsfield.Higgsfield.wait, {"crashed": False}

    def wait(self, request_id, *a, **k):
        if not state["crashed"]:
            state["crashed"] = True
            raise RuntimeError("제출 후 종료")
        return real_wait(self, request_id, *a, **k)
    monkeypatch.setattr(higgsfield.Higgsfield, "wait", wait)
    assert run(pid) == "FAILED"
    assert world.calls["hf_image"] == 1
    with SessionLocal() as db:
        row = db.query(ProviderRequest).filter_by(project_id=pid, kind="image").one()
        assert row.status == "submitted" and row.external_id
        ext = row.external_id
    client.post(f"/api/projects/{pid}/retry")
    assert run(pid) == "COMPLETED"
    assert world.calls["hf_image"] == 4  # 장면 4개 = 제출 4회(첫 장면 재제출 없음)
    with SessionLocal() as db:
        first = db.query(ProviderRequest).filter_by(project_id=pid, kind="image", external_id=ext).one()
        assert first.status == "completed"


def test_stale_running_project_is_recovered(client, world):
    from datetime import datetime, timedelta, timezone
    connect_all(client)
    pid = make(client)
    with SessionLocal() as db:
        p = db.get(Project, pid)
        p.status, p.locked_by = "GENERATING", "dead-worker"
        p.lock_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
        assert orchestrator.stale_projects(db) == [pid]
    assert run(pid) == "COMPLETED"  # 만료된 잠금은 새 워커가 가져간다


def test_lock_prevents_concurrent_run(client, world):
    connect_all(client)
    pid = make(client)
    with SessionLocal() as db:
        assert orchestrator.acquire(db, pid, "worker-a")
        assert not orchestrator.acquire(db, pid, "worker-b")
    assert run(pid) == "locked"
    assert world.calls["llm"] == {}


def test_failed_scene_is_regenerated_only(client, world):
    connect_all(client)
    world.qa_script = [{"visual": 12, "story": 18, "accuracy": 14, "consistency": 6, "fatal": [], "policy": {"risk": "low"},
                        "scene_issues": [{"scene": 2, "severity": "high", "issue": "손가락 왜곡", "fix_hint": "hands hidden"}]}]
    pid = make(client)
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert [q["passed"] for q in d["quality"]] == [False, True] and d["regen_rounds"] == 1
    assert world.calls["hf_image"] == 5 and world.calls["hf_video"] == 5 and world.calls["tts"] == 1  # 문제 장면 1개만 다시 생성
    assert any("Fix: hands hidden" in b["prompt"] for k, b in world.hf_bodies if k == "image")


def test_fatal_quality_fails(client, world):
    connect_all(client)
    world.qa_script = [{"visual": 20, "story": 18, "accuracy": 2, "consistency": 9, "scene_issues": [], "policy": {"risk": "high"},
                        "fatal": ["실존 인물의 허위 발언 포함"]}]
    pid = make(client)
    assert run(pid) == "FAILED"
    assert "치명적" in client.get(f"/api/projects/{pid}").json()["error"]


def test_script_length_is_revised_once(client, world):
    connect_all(client)
    world.script_long_first = True
    pid = make(client)
    assert run(pid) == "COMPLETED"
    assert world.calls["llm"]["대본 작가 AI"] == 2


def test_runs_without_search_and_youtube(client, world):
    connect_all(client)
    client.delete("/api/providers/tavily")
    client.delete("/api/providers/youtube")
    pid = make(client)
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert d["package"]["unverified"] is True and d["package"]["sources"] == []
    assert world.calls["tavily"] == 0 and world.calls["yt_search"] == 0


def test_missing_providers_fail_with_clear_message(client, world):
    client.put("/api/providers/anthropic", json={"credentials": {"api_key": "x"}})
    pid = make(client)
    assert run(pid) == "FAILED"
    assert "이미지 생성 모델" in client.get(f"/api/projects/{pid}").json()["error"]


def test_cancel_and_idempotent_create(client, world):
    connect_all(client)
    h = {"Idempotency-Key": "abc-123"}
    a = client.post("/api/projects", json={"topic": "같은 요청"}, headers=h).json()
    b = client.post("/api/projects", json={"topic": "같은 요청"}, headers=h).json()
    assert a["id"] == b["id"] and client.queued == [a["id"]]
    assert client.post(f"/api/projects/{a['id']}/cancel").json()["status"] == "CANCELLED"
    assert run(a["id"]) == "CANCELLED" and world.calls["llm"] == {}


def test_edit_scene_then_rebuild_only_needed_stages(client, world):
    connect_all(client)
    pid = make(client, mode="economy")
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    sid = d["scenes"][1]["id"]
    r = client.patch(f"/api/projects/{pid}/scenes/{sid}", json={"narration": "수정한 문장입니다."}).json()
    assert r["rebuild_from"] == "narration"
    before = dict(world.calls, llm=dict(world.calls["llm"]))
    assert client.post(f"/api/projects/{pid}/rebuild", json={"from_stage": "narration"}).status_code == 200
    assert run(pid) == "COMPLETED"
    assert world.calls["tts"] == before["tts"] + 1 and world.calls["hf_image"] == before["hf_image"]
    assert world.calls["llm"]["대본 작가 AI"] == before["llm"]["대본 작가 AI"]
    with SessionLocal() as db:
        assert db.query(ResearchSource).filter_by(project_id=pid, kind="fact").count() == 1


def test_render_stages_are_handed_to_render_queue(client, world):
    """웹/파이프라인 워커와 렌더링 워커 분리: 렌더 단계에서 render 큐로 넘긴다."""
    connect_all(client)
    pid = make(client, mode="economy")
    handoffs = []
    assert orchestrator.run_project(pid, "pipeline", lambda p, q: handoffs.append((p, q))) == "handoff:render"
    assert handoffs == [(pid, "render")]
    with SessionLocal() as db:
        p = db.get(Project, pid)
        assert p.locked_by is None and p.stage_state["timeline"]["status"] == "done" and "render" not in p.stage_state
        assert orchestrator.queue_for(p) == "render"
    assert orchestrator.run_project(pid, "render", lambda p, q: handoffs.append((p, q))) == "COMPLETED"
    assert len(handoffs) == 1


def test_higgsfield_out_of_credits_switches_to_openai(client, world):
    """Higgsfield 잔액이 없으면 OpenAI 이미지로 전환하고, 영상 장면은 이미지 애니메이션으로 만들어 끝까지 완성한다."""
    connect_all(client)
    client.put("/api/providers/openai", json={"credentials": {"api_key": "sk-openai-test"}})
    world.balance_empty = True
    pid = make(client)  # quality 모드: 원래는 첫 장면이 영상
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert world.calls["hf_image"] == 0 and world.calls["hf_video"] == 0 and world.calls["openai_image"] == 4
    assert all(b["model"] == "gpt-image-2" and b["size"] == "1024x1536" for b in world.openai_bodies)  # 계정의 실제 모델 ID로 교체
    assert [s["kind"] for s in d["scenes"]] == ["image"] * 4 and all(s["image_model"] == "openai-gpt-image-1" for s in d["scenes"])
    assert any("전환" in l["message"] for l in d["logs"]) and d["stage_data"]["videos"]["degraded_to_image"] == 4


def test_multiple_video_models_via_topview(client, world):
    """영상 모델을 여러 개 고르면 중요한 장면은 좋은 모델, 나머지는 싼 모델을 쓰고 실제 청구액을 기록한다."""
    connect_all(client)
    client.put("/api/providers/topview", json={"credentials": {"api_key": "tv-key"}})
    assert client.post("/api/providers/topview/test").json()["ok"]
    pid = make(client, mode="cinematic", max_cost_usd=20,
               options={"video_models": ["tv-seedance20-mini-i2v", "tv-kling40-i2v", "tv-wan30-i2v"]})
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    used = [s["video_model"] for s in d["scenes"]]
    assert used == ["tv-kling40-i2v", "tv-seedance20-mini-i2v", "tv-seedance20-mini-i2v", "tv-kling40-i2v"]  # 중요도 5·3·3·4
    assert world.calls["hf_video"] == 0 and world.calls["tv_upload"] == 4
    by = {}
    for path, body in world.tv_bodies:
        by.setdefault(path, []).append(body)
    k = by["kling/kling-4.0/image-to-video"][0]
    assert set(k) == {"prompt", "image", "duration", "resolution", "aspect_ratio"} and k["aspect_ratio"] == "9:16" and 3 <= k["duration"] <= 30
    sd = by["bytedance/seedance-2.0-mini/image-to-video"][0]
    assert set(sd) == {"content", "duration", "resolution", "ratio", "generate_audio"} and sd["ratio"] == "adaptive"
    assert sd["content"][1] == {"type": "image_url", "role": "first_frame", "image_url": {"url": sd["content"][1]["image_url"]["url"]}}
    video_cost = sum(c["amount_usd"] for c in d["costs"] if c["kind"] == "video")
    assert abs(video_cost - 2.0) < 1e-6  # 단가표가 아니라 공급자가 알려 준 청구액(0.5 × 4)


def test_topview_out_of_balance_falls_back_to_other_provider(client, world):
    connect_all(client)
    client.put("/api/providers/topview", json={"credentials": {"api_key": "tv-key"}})
    world.tv_no_balance = True
    pid = make(client, mode="cinematic", max_cost_usd=20, options={"video_models": ["tv-wan30-i2v"]})
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert all(s["kind"] == "video" and s["video_model"].startswith("hf-") for s in d["scenes"])  # Higgsfield 로 전환
    assert world.calls["hf_video"] == 4


def test_topview_key_from_environment(client, world, monkeypatch):
    monkeypatch.setenv("TOPVIEW_API_PLATFORM_KEY", "tv-key")
    tvp = next(p for p in client.get("/api/providers").json() if p["id"] == "topview")
    assert tvp["connected"] and tvp["env"] and tvp["mine"] is None
    from app.providers import registry
    with SessionLocal() as db:
        assert registry.credentials(db, None, "topview") == {"api_key": "tv-key"} and "topview" in registry.available_providers(db, None)


def test_auto_mode_keeps_video_by_switching_to_cheaper_model(client, world):
    """예산이 빠듯하면 이미지로 내리기 전에 더 싼 영상 모델로 바꾼다."""
    connect_all(client)
    pid = make(client, mode="auto", max_cost_usd=3, options={"video_model": "hf-kling3-std-i2v"})
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert all(s["kind"] == "video" for s in d["scenes"])
    assert d["actual_cost_usd"] <= 3


def test_sound_design_titles_punch_and_static_clip_retry(client, world):
    """배경음악·효과음 생성, 상단 타이틀, 펀치인, 정지에 가까운 클립 재생성까지 실제 렌더로 확인."""
    connect_all(client)
    world.static_once = True
    pid = make(client, max_cost_usd=20)
    assert run(pid) == "COMPLETED"
    d = client.get(f"/api/projects/{pid}").json()
    assert world.calls["music"] == 1 and world.calls["sfx"] == 3  # hit·whoosh·riser 각 1회
    assert world.calls["hf_video"] == 5  # 첫 장면이 정지 화면 → 한 번 재생성
    assert d["scenes"][0]["edit"]["motion"] > 4 and d["scenes"][0]["attempts"] == 1
    assert d["package"]["music"]["title"] == "AI 생성 배경음악"
    with SessionLocal() as db:
        from app.models import RenderJob
        tl = db.query(RenderJob).filter_by(project_id=pid).first().timeline
        assert [x["kind"] for x in tl["audio"]["sfx"]] == ["hit", "whoosh", "riser"] and tl["scenes"][0]["punch"] is True
        ass = open(get_storage().local_path(f"{pid}/subtitle/ko.ass"), encoding="utf-8").read()
        assert "Style: Title" in ass and "단 3초" in ass and "1. 유인" in ass
    # 같은 사용자의 다음 영상은 효과음을 다시 만들지 않는다
    pid2 = make(client, max_cost_usd=20)
    assert run(pid2) == "COMPLETED" and world.calls["sfx"] == 3
