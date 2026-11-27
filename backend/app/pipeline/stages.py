"""제작 파이프라인 단계 구현. 각 단계는 독립 실행되며 실패 시 그 단계부터 다시 시작한다."""
import math
import os
import random
from datetime import datetime, timezone

from ..media import ffmpeg, qc, subtitles
from sqlalchemy.orm.attributes import flag_modified

from ..models import (AudioTrack, Character, CostRecord, License, ProviderRequest, QualityReport, RenderJob, ResearchSource,
                      Scene, Script, Storyboard, Subtitle, YoutubeMetricSnapshot, YoutubeReference, Project,
                      ChannelAnalytics, YoutubeUpload, gset)
from ..providers import higgsfield as hf
from ..providers import speech
from ..providers.base import ProviderError, download
from ..providers.search import ENGINES
from ..providers.youtube import YouTubeData, analyze as yt_analyze
from . import agents as A
from .context import BudgetExceeded, Ctx, PipelineError

DURATIONS = [15, 30, 45, 60, 90, 120, 180]
CPS = {"ko": 5.0, "ja": 6.0, "zh": 4.5}  # 초당 글자 수(공백 제외) 추정치 — 실제 길이는 음성 합성 후 측정


def est_seconds(text: str, lang: str) -> float:
    if lang in CPS:
        return len(text.replace(" ", "")) / CPS[lang]
    return len(text) / 15.0


def today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# 1~2. 주제 분석 · 키워드 확장 ------------------------------------------
def analyze(c: Ctx):
    out = c.agent("트렌드 조사", A.TREND, A.j({
        "topic": c.p.topic, "language": A.LANG.get(c.p.language, c.p.language), "today": today(),
        "requested_duration": c.p.target_duration or "AI 자동", "mode": c.p.mode}),
        ["content_type", "keywords", "web_queries", "youtube_queries", "suggested_duration"], tier="economy")
    dur = c.p.target_duration or int(out.get("suggested_duration") or 45)
    out["duration"] = min(DURATIONS, key=lambda d: abs(d - dur))
    c.save_data("analyze", out)


# 3. 인터넷 자료 검색 ---------------------------------------------------
def web_research(c: Ctx):
    engines = [n for n in ENGINES if c.has(n)]
    if not engines:
        c.log("검색 API(Tavily·Brave)가 연결되지 않아 웹 조사를 건너뜁니다. 대본은 검증된 사실 없이 작성됩니다.", "warn")
        c.save_data("web_research", {"skipped": True, "sources": 0})
        return
    eng = ENGINES[engines[0]](c.cred(engines[0])["api_key"])
    c.db.query(ResearchSource).filter_by(project_id=c.p.id).delete()
    seen, n = set(), 0
    for q in (c.data("analyze").get("web_queries") or [c.p.topic])[:4]:
        try:
            hits = eng.search(q, 6)
        except ProviderError as e:
            c.usage(eng.name, "search", 1, "query", ok=False)
            if e.kind in ("auth", "balance"):
                raise
            c.log(f"검색 실패({q}): {e.message}", "warn")
            continue
        c.usage(eng.name, "search", 1, "query")
        for h in hits:
            if not h.url or h.url in seen:
                continue
            seen.add(h.url)
            c.db.add(ResearchSource(project_id=c.p.id, kind="web", url=h.url, title=h.title[:500], snippet=h.snippet,
                                    published_at=h.published, engine=h.engine))
            n += 1
    c.db.commit()
    c.save_data("web_research", {"engine": eng.name, "sources": n})


# 4. 유튜브 인기 영상 조사 ----------------------------------------------
def collect_youtube(db, user_id: str, yt: YouTubeData, queries: list[str], keywords: list[str], cap: int,
                    project_id: str | None = None, lang: str = "ko", windows=(7, 30, 1, 90)) -> dict:
    """쿼터 한도(cap) 안에서 기간·검색어 조합을 넓혀 가며 수집한다."""
    used = {"u": 0}
    prev = yt.on_quota

    def on_quota(method, units):
        used["u"] += units
        prev(method, units)

    yt.on_quota = on_quota
    region = {"ko": "KR", "ja": "JP", "en": "US", "es": "ES", "zh": "TW"}.get(lang, "KR")
    combos = [(q, d) for d in windows for q in queries[:1]] + [(q, 30) for q in queries[1:3]]
    ids, covered, limited = {}, [], None
    for q, days in combos:
        if used["u"] + 100 > cap - 10:
            limited = "쿼터 한도에 맞춰 분석 범위를 줄였습니다."
            break
        try:
            for vid in yt.search(q, days, n=15, region=region, lang=lang):
                ids.setdefault(vid, q)
            covered.append({"query": q, "days": days})
        except ProviderError as e:
            if e.kind == "rate_limit":
                limited = "YouTube API 일일 쿼터 초과로 수집을 중단했습니다."
                break
            raise
    vids = yt.videos(list(ids)) if ids else []
    chans = yt.channels([v["channel_id"] for v in vids]) if vids else {}
    if project_id:
        db.query(YoutubeReference).filter_by(project_id=project_id).delete()
    rows = []
    for v in vids:
        subs = (chans.get(v["channel_id"]) or {}).get("subscriber_count")
        m = yt_analyze(v, subs, keywords)
        # 실제 조회수 증가량은 이전에 수집한 스냅샷이 있을 때만 계산한다.
        last = db.query(YoutubeMetricSnapshot).filter_by(video_id=v["video_id"]).order_by(
            YoutubeMetricSnapshot.captured_at.desc()).first()
        if last and last.view_count is not None and v["view_count"] is not None:
            cap_at = last.captured_at if last.captured_at.tzinfo else last.captured_at.replace(tzinfo=timezone.utc)
            hrs = (datetime.now(timezone.utc) - cap_at).total_seconds() / 3600
            if hrs >= 1:
                m["measured_views_per_hour"] = round((v["view_count"] - last.view_count) / hrs, 2)
        db.add(YoutubeMetricSnapshot(video_id=v["video_id"], view_count=v["view_count"], like_count=v["like_count"],
                                     comment_count=v["comment_count"]))
        row = YoutubeReference(user_id=user_id, project_id=project_id, subscriber_count=subs, metrics=m,
                               is_short_estimated=m["short_basis"] != "아님", query=ids.get(v["video_id"]),
                               **{k: v[k] for k in ("video_id", "title", "description", "url", "channel_id",
                                                    "channel_title", "view_count", "like_count", "comment_count",
                                                    "published_at", "duration_sec", "thumbnail")})
        db.add(row)
        rows.append(row)
    db.commit()
    rows.sort(key=lambda r: r.metrics.get("score", 0), reverse=True)
    comments = {}
    for r in rows[:3]:
        if used["u"] + 1 <= cap:
            comments[r.video_id] = yt.comments(r.video_id, 15)
    return {"rows": rows, "comments": comments, "quota_used": used["u"], "covered": covered, "note": limited,
            "short_note": "쇼츠 여부는 길이·해시태그 기반 추정이며 공식 구분값이 아닙니다."}


def youtube_research(c: Ctx):
    if not c.has("youtube"):
        c.log("YouTube Data API 키가 없어 인기 영상 조사를 건너뜁니다.", "warn")
        c.save_data("youtube_research", {"skipped": True, "count": 0})
        return
    a = c.data("analyze")
    yt = YouTubeData(c.cred("youtube")["api_key"], on_quota=lambda m, u: c.usage("youtube", m, u, "quota"))
    try:
        r = collect_youtube(c.db, c.p.user_id, yt, a.get("youtube_queries") or [c.p.topic], a.get("keywords") or [],
                            gset(c.db, "youtube_quota_per_project"), c.p.id, c.p.language)
    except ProviderError as e:
        if e.kind == "auth":
            raise
        c.log(f"유튜브 조사 실패: {e.message}", "warn")
        c.save_data("youtube_research", {"skipped": True, "count": 0, "error": e.message})
        return
    c.save_data("youtube_research", {"count": len(r["rows"]), "quota_used": r["quota_used"], "covered": r["covered"],
                                     "comments": r["comments"], "note": r["note"], "short_note": r["short_note"]})


# 5~6. 시장·경쟁 분석 → 기획안 3개 이상 → 선정 --------------------------
def strategy(c: Ctx):
    refs = c.db.query(YoutubeReference).filter_by(project_id=c.p.id).all()
    refs.sort(key=lambda r: r.metrics.get("score", 0), reverse=True)
    durs = [r.duration_sec or 0 for r in refs]
    dist = {"~15초": sum(d <= 15 for d in durs), "16~30초": sum(15 < d <= 30 for d in durs),
            "31~60초": sum(30 < d <= 60 for d in durs), "61~180초": sum(60 < d <= 180 for d in durs)}
    videos = [{"video_id": r.video_id, "title": r.title, "views": r.view_count, "likes": r.like_count,
               "comments": r.comment_count, "subscribers": r.subscriber_count, "duration": r.duration_sec,
               "published": r.published_at, "metrics": r.metrics} for r in refs[:25]]
    web = [{"title": s.title, "snippet": (s.snippet or "")[:400]} for s in
           c.db.query(ResearchSource).filter_by(project_id=c.p.id, kind="web").limit(12)]
    a = c.data("analyze")
    user = (f"주제: {c.p.topic}\n언어: {A.LANG.get(c.p.language, c.p.language)}\n목표 길이: {a.get('duration')}초\n"
            f"제작 모드: {c.p.mode}\n주제 분석: {A.j({k: a.get(k) for k in ('content_type', 'audience', 'angle')})}\n"
            f"수집 영상 길이 분포(코드 집계): {A.j(dist)}\n"
            f"인기 영상 공개 지표:\n{A.ext(videos)}\n상위 영상 댓글:\n{A.ext(c.data('youtube_research').get('comments') or {})}\n"
            f"웹 조사 자료:\n{A.ext(web)}\n"
            + ("※ 유튜브 자료가 없다. insights 는 '자료 없음'으로 두고 주제 자체로 기획하라.\n" if not videos else ""))
    own = own_channel_performance(c)
    if own:
        user += f"내 채널의 실제 성과(YouTube Analytics, 본인 채널): {A.j(own)}\n이 실측 결과에서 잘된 길이·오프닝·주제 경향을 기획에 반영하라.\n"
    out = c.agent("총괄 프로듀서", A.PRODUCER, user, ["concepts", "selected_id", "reason"])
    concepts = out.get("concepts") or []
    if len(concepts) < 3:
        raise ProviderError("llm", "invalid", "기획안이 3개 미만으로 생성되었습니다.")
    sel = next((x for x in concepts if str(x.get("id")) == str(out.get("selected_id"))), concepts[0])
    out["selected"], out["duration_distribution"] = sel, dist
    c.save_data("strategy", out)
    c.log(f"기획안 {len(concepts)}개 중 '{sel.get('title')}' 선정", "info")


def own_channel_performance(c: Ctx) -> list[dict]:
    """본인 채널 업로드의 실측 지표(가장 긴 수집 구간)를 과거 제작 설정과 함께 요약한다."""
    out = []
    ups = c.db.query(YoutubeUpload, Project).join(Project, Project.id == YoutubeUpload.project_id).filter(
        Project.user_id == c.p.user_id, YoutubeUpload.video_id.isnot(None)).limit(30).all()
    for up, pr in ups:
        rows = c.db.query(ChannelAnalytics).filter_by(video_id=up.video_id).order_by(ChannelAnalytics.captured_at.desc()).all()
        if not rows:
            continue
        best = next((r for w in ("7d", "3d", "24h", "manual") for r in rows if r.window == w), rows[0])
        hook = ""
        sc = c.db.query(Script).filter_by(project_id=pr.id).order_by(Script.version.desc()).first()
        if sc and sc.sections:
            hook = (sc.sections[0].get("text") or "")[:80]
        out.append({"title": pr.title, "topic": pr.topic, "mode": pr.mode, "window": best.window,
                    "duration": (pr.package or {}).get("video", {}).get("duration"), "hook": hook, "metrics": best.metrics})
    return out


# 7. 사실관계 검증 ------------------------------------------------------
def factcheck(c: Ctx):
    srcs = c.db.query(ResearchSource).filter_by(project_id=c.p.id, kind="web").all()
    c.db.query(ResearchSource).filter_by(project_id=c.p.id, kind="fact").delete()
    c.db.commit()
    if not srcs:
        c.save_data("factcheck", {"facts": [], "unverified": True,
                                  "note": "조사 자료가 없어 검증된 사실 없이 진행합니다(구체적 수치·발언 사용 금지)."})
        return
    numbered = [{"id": i + 1, "title": s.title, "url": s.url, "published": s.published_at,
                 "text": (s.snippet or "")[:900]} for i, s in enumerate(srcs)]
    sel = c.data("strategy").get("selected") or {}
    out = c.agent("팩트체크", A.FACT, f"주제: {c.p.topic}\n기획: {A.j(sel)}\n확인일: {today()}\n수집 자료:\n{A.ext(numbered)}",
                  ["facts"])
    facts = []
    for f in out.get("facts") or []:
        ids = [i for i in f.get("source_ids") or [] if isinstance(i, int) and 1 <= i <= len(srcs)]
        if not ids or not f.get("claim"):
            continue  # 근거 번호가 실제 자료를 가리키지 않으면 버린다
        s = srcs[ids[0] - 1]
        row = ResearchSource(project_id=c.p.id, kind="fact", claim=f["claim"], url=s.url, title=s.title,
                             published_at=s.published_at, reliability=f.get("reliability") or "medium",
                             conflicting=bool(f.get("conflicting")), engine=s.engine,
                             snippet="; ".join(srcs[i - 1].url or "" for i in ids))
        c.db.add(row)
        facts.append(row)
    c.db.commit()
    usable = [f for f in facts if not f.conflicting and f.reliability != "low"]
    c.save_data("factcheck", {"facts": len(facts), "usable": len(usable), "rejected": out.get("rejected") or [],
                              "unverified": not usable})


def usable_facts(c: Ctx) -> list[ResearchSource]:
    return [f for f in c.db.query(ResearchSource).filter_by(project_id=c.p.id, kind="fact").order_by(
        ResearchSource.created_at) if not f.conflicting and f.reliability != "low"]


# 8~9. 제목 후보 · 대본 --------------------------------------------------
def script(c: Ctx):
    a, lang = c.data("analyze"), c.p.language
    target = a.get("duration") or 45
    per = CPS.get(lang)
    lo, hi = (int(target * per * 0.85), int(target * per * 1.05)) if per else (int(target * 13), int(target * 16))
    unit = "공백 제외 글자 수" if per else "공백 포함 글자 수"
    facts = [{"id": i + 1, "claim": f.claim, "reliability": f.reliability} for i, f in enumerate(usable_facts(c))]
    base = (f"주제: {c.p.topic}\n언어: {A.LANG.get(lang, lang)}\n목표 길이: {target}초 → 대본 전체 {unit} {lo}~{hi}\n"
            f"선정 기획: {A.j(c.data('strategy').get('selected'))}\n"
            f"검증된 사실(이것만 사실로 사용): {A.j(facts) if facts else '없음 — 구체적 수치·날짜·발언 금지'}")
    out = c.agent("대본 작가", A.WRITER, base, ["title_candidates", "final_title", "sections"])
    full = " ".join(s.get("text", "").strip() for s in out["sections"]).strip()
    est = est_seconds(full, lang)
    if not (target * 0.75 <= est <= target * 1.15):
        fix = (f"{base}\n\n[수정 요청] 직전 대본은 약 {est:.0f}초 분량이라 목표({target}초)와 맞지 않는다. "
               f"{unit} {lo}~{hi} 범위로 다시 써라. 직전 대본: {A.j(out['sections'])}")
        out = c.agent("대본 작가(분량 조정)", A.WRITER, fix, ["title_candidates", "final_title", "sections"])
        full = " ".join(s.get("text", "").strip() for s in out["sections"]).strip()
        est = est_seconds(full, lang)
    if not full:
        raise ProviderError("llm", "invalid", "대본이 비어 있습니다.")
    ver = c.db.query(Script).filter_by(project_id=c.p.id).count() + 1
    c.db.add(Script(project_id=c.p.id, version=ver, title_candidates=out["title_candidates"][:5],
                    final_title=out["final_title"], content_type=out.get("content_type") or a.get("content_type"),
                    sections=out["sections"], full_text=full, est_duration=round(est, 1),
                    policy_notes=out.get("policy_notes") or []))
    c.p.title = out["final_title"]
    c.db.commit()
    c.save_data("script", {"version": ver, "est_duration": round(est, 1), "chars": len(full)})


def latest_script(c: Ctx) -> Script:
    return c.db.query(Script).filter_by(project_id=c.p.id).order_by(Script.version.desc()).first()


# 10~12. 스토리보드 · 연출 · 캐릭터/배경 ---------------------------------
def storyboard(c: Ctx):
    sc = latest_script(c)
    fixed = None
    if c.cfg.character_id:
        ch = c.db.get(Character, c.cfg.character_id)
        if ch and ch.user_id == c.p.user_id:
            fixed = {"name": ch.name, **(ch.bible or {})}
    brand = c.cfg.branding or {}
    user = (f"언어: {A.LANG.get(c.p.language, c.p.language)}\n제목: {sc.final_title}\n콘텐츠 유형: {sc.content_type}\n"
            f"영상 스타일 지정: {c.cfg.style or 'AI 자동 결정'}\n"
            f"고정 캐릭터: {A.j(fixed) if fixed else '없음'}\n채널 브랜딩 색상: {brand.get('palette') or '없음'}\n"
            f"대본 구간: {A.j(sc.sections)}")
    out = c.agent("영상 감독", A.DIRECTOR, user, ["scenes", "visual_bible", "character_bible"], max_tokens=14000)
    raw = [s for s in out.get("scenes") or [] if (s.get("narration") or "").strip()]
    if not raw:
        raise ProviderError("llm", "invalid", "스토리보드 장면이 없습니다.")
    if fixed:
        chars = (out["character_bible"] or {}).setdefault("characters", [])
        if not any(x.get("name") == fixed["name"] for x in chars):
            chars.insert(0, fixed)
    c.db.query(Scene).filter_by(project_id=c.p.id).delete()
    for i, s in enumerate(raw[:40]):
        tr = s.get("transition") if s.get("transition") in A.TRANSITIONS else "cut"
        c.db.add(Scene(
            project_id=c.p.id, idx=i, narration=s["narration"].strip(), tts_text=(s.get("tts_text") or "").strip() or None,
            image_prompt=s.get("image_prompt"), video_prompt=s.get("video_prompt"),
            negative_prompt=s.get("negative_prompt"), characters=s.get("characters") or [],
            background=s.get("background"), shot=str(s.get("shot") or "")[:64], camera_move=str(s.get("camera_move") or "")[:64],
            lens=str(s.get("lens") or "")[:128], lighting=str(s.get("lighting") or "")[:255],
            color_mood=str(s.get("color_mood") or "")[:255], subject_motion=s.get("subject_motion"),
            subtitle_position="center" if s.get("subtitle_position") == "center" else "lower",
            emphasis_words=(s.get("emphasis_words") or [])[:2], sfx=str(s.get("sfx") or "")[:255], transition=tr,
            motion_need=max(0, min(3, int(s.get("motion_need") or 0))),
            importance=max(1, min(5, int(s.get("importance") or 3))), quality_bar=str(s.get("quality_bar") or "")[:255]))
    ver = c.db.query(Storyboard).filter_by(project_id=c.p.id).count() + 1
    c.db.add(Storyboard(project_id=c.p.id, version=ver, data={"music_mood": out.get("music_mood")},
                        character_bible=out["character_bible"] or {}, visual_bible=out["visual_bible"] or {}))
    c.db.query(Character).filter_by(project_id=c.p.id).delete()
    for ch in (out["character_bible"] or {}).get("characters") or []:
        if ch.get("name"):
            c.db.add(Character(user_id=c.p.user_id, project_id=c.p.id, name=ch["name"], bible=ch))
    c.db.commit()
    prev = c.data("storyboard")
    c.save_data("storyboard", {"version": ver, "scenes": len(raw), "seed": prev.get("seed") or random.randint(1, 999999),
                               "music_mood": out.get("music_mood") or c.data("analyze").get("music_mood")})


def latest_board(c: Ctx) -> Storyboard:
    return c.db.query(Storyboard).filter_by(project_id=c.p.id).order_by(Storyboard.version.desc()).first()


# 비용 최적화 AI(규칙 기반): 장면별 모델 선택 + 최대 예상 비용 + 예산 게이트 -----
TIER = {"economy": "economy", "quality": "standard", "cinematic": "premium", "auto": "standard"}


def unit_cost(model, units: float) -> float | None:
    return None if model is None or model.unit_cost_usd is None else model.unit_cost_usd * units


def video_seconds(model, dur: float) -> int:
    lo, hi = (model.capabilities or {}).get("duration") or [3, 10]
    return int(max(lo, min(hi, math.ceil(dur))))


def plan_budget(c: Ctx):
    mode, tier = c.p.mode, TIER.get(c.p.mode, "standard")
    scenes = c.scenes()
    fixed = c.db.get(Character, c.cfg.character_id) if c.cfg.character_id else None
    has_ref = bool(fixed and (fixed.provider_ref or {}).get("higgsfield_soul_id"))
    img = c.pick("image", tier, c.cfg.image_model, need="character_reference" if has_ref else None)
    i2v = c.pick("i2v", tier, c.cfg.video_model)
    tts = c.pick("tts", tier, c.cfg.tts_model, need="word_timestamps")
    stt = c.pick("stt") if tts and not (tts.capabilities or {}).get("word_timestamps") else None
    if not img:
        raise ProviderError("image", "config", "연결된 이미지 생성 모델이 없습니다. Higgsfield 또는 OpenAI 키를 등록하세요.")
    if not tts:
        raise ProviderError("tts", "config", "연결된 음성 합성 모델이 없습니다. ElevenLabs 또는 OpenAI 키를 등록하세요.")

    # 장면 종류 결정: 모든 장면에 비싼 모델을 쓰지 않는다.
    for s in scenes:
        s.image_model, s.video_model = img.model_key, None
        if mode == "economy" or not i2v:
            s.kind = "image"
        elif mode == "cinematic":
            s.kind = "video"
        else:  # quality·auto: 오프닝과 움직임이 중요한 장면만 영상
            s.kind = "video" if (s.idx == 0 or s.motion_need >= 2) else "image"
        if s.kind == "video":
            s.video_model = i2v.model_key
    if mode != "economy" and not i2v:
        c.log("연결된 영상 생성 모델이 없어 모든 장면을 이미지+자체 애니메이션으로 제작합니다.", "warn")

    def estimate() -> tuple[float, list[str]]:
        total, unpriced = 0.0, set()
        for s in scenes:
            d = est_seconds(s.narration, c.p.language) + 0.3
            cost = unit_cost(img, 1)
            if cost is None:
                unpriced.add(img.display_name)
            sc_cost = cost or 0.0
            if s.kind == "video":
                v = unit_cost(i2v, video_seconds(i2v, d))
                if v is None:
                    unpriced.add(i2v.display_name)
                sc_cost += v or 0.0
            s.est_cost_usd = round(sc_cost, 4)
            total += sc_cost
        chars = sum(len(s.tts_text or s.narration) for s in scenes)
        t = unit_cost(tts, chars / 1000)
        if t is None:
            unpriced.add(tts.display_name)
        total += t or 0.0
        if stt:
            st = unit_cost(stt, sum(est_seconds(s.narration, c.p.language) for s in scenes) / 60)
            if st is None:
                unpriced.add(stt.display_name)
            total += st or 0.0
        return total, sorted(unpriced)

    gen, unpriced = estimate()
    remaining = c.p.max_cost_usd - c.p.actual_cost_usd
    margin = 1.25  # 재생성 여유분
    if mode in ("auto", "quality"):
        # 예산의 85%를 넘으면 중요도가 낮은 영상 장면부터 이미지로 내린다.
        vids = sorted([s for s in scenes if s.kind == "video"], key=lambda s: (s.importance, s.motion_need))
        while gen * margin > remaining * 0.85 and vids:
            s = vids.pop(0)
            s.kind, s.video_model = "image", None
            gen, unpriced = estimate()
    llm_spent = sum(r.amount_usd for r in c.db.query(CostRecord)
                    .filter_by(project_id=c.p.id, kind="llm"))
    max_est = round(gen * margin + llm_spent * 0.6, 4)  # 남은 LLM 호출(검수·패키지)은 지금까지의 60%로 가정
    c.p.estimated_cost_usd = round(c.p.actual_cost_usd + max_est, 4)
    c.db.commit()
    plan = {"mode": mode, "image_model": img.model_key, "video_model": i2v.model_key if i2v else None,
            "tts_model": tts.model_key, "stt_model": stt.model_key if stt else None,
            "video_scenes": sum(s.kind == "video" for s in scenes), "image_scenes": sum(s.kind == "image" for s in scenes),
            "generation_estimate_usd": round(gen, 4), "max_estimate_usd": max_est, "unpriced_models": unpriced,
            "note": "예상 비용은 등록된 단가표 기준이며 실제 청구액은 공급자 콘솔에서 확인해야 합니다."}
    c.save_data("plan_budget", plan)
    c.log(f"예상 최대 비용 ${max_est:.3f} (영상 {plan['video_scenes']}장면 / 이미지 {plan['image_scenes']}장면)", "info")

    today0 = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    made = c.db.query(Project).filter(Project.user_id == c.p.user_id, Project.created_at >= today0,
                                      Project.status.notin_(["PENDING", "CANCELLED"])).count()
    if made > c.user.daily_video_limit:
        raise BudgetExceeded(f"일일 제작 수량 한도({c.user.daily_video_limit}개)를 넘었습니다.")
    if unpriced and not c.cfg.allow_unpriced:
        raise BudgetExceeded("단가가 등록되지 않은 모델이 있어 비용을 계산할 수 없습니다: " + ", ".join(unpriced) +
                             ". 관리자 화면에서 단가를 입력하거나, 단가 미등록 모델 사용을 승인하세요.")
    c.ensure_budget(max_est)


# 15. 내레이션 ----------------------------------------------------------
def narration(c: Ctx):
    plan = c.data("plan_budget")
    m = c.model(plan.get("tts_model"))
    if not m:
        raise ProviderError("tts", "config", "음성 합성 모델을 찾을 수 없습니다.")
    key = c.cred(m.provider)["api_key"]
    tts = speech.ElevenLabsTTS(key) if m.provider == "elevenlabs" else speech.OpenAITTS(key)
    voice = c.cfg.voice or (c.user.settings or {}).get("default_voice")
    if not voice:
        if m.provider == "elevenlabs":
            vs = tts.voices()
            if not vs:
                raise ProviderError("elevenlabs", "config", "계정에 사용할 수 있는 음성이 없습니다.")
            voice = vs[0]["id"]
        else:
            voice = "nova"
        c.cfg.voice = voice
        c.db.commit()
    speed = float((c.cfg.extra or {}).get("speed") or 1.0)
    pron = (c.user.settings or {}).get("pronunciation") or {}
    stt_m = c.model(plan.get("stt_model"))
    scenes = c.scenes()
    for n, s in enumerate(scenes):
        c.heartbeat()
        c.step(n, len(scenes))
        if s.audio_asset_id and s.words and s.status != "redo_audio":
            continue
        text = speech.apply_pronunciation(s.tts_text or s.narration, pron)
        payload = {"text": text, "voice": voice, "model": m.endpoint, "speed": speed}

        def run(_key, _resume, _on, text=text, s=s):
            r = tts.synth(text, voice, m.endpoint, speed)
            a = c.save_asset("audio", "mp3", data=r.data, scene=s, provider=m.provider, model_key=m.model_key,
                             meta={"voice": voice})
            return {"asset_id": a.id, "words": r.words}

        res = c.paid(provider=m.provider, model=m, kind="tts", scene=s, payload=payload,
                     est_cost=unit_cost(m, len(text) / 1000), run=run, attempt=s.attempts)
        asset = c.asset(res["asset_id"])
        dur = ffmpeg.duration(c.storage.local_path(asset.storage_key))
        asset.duration = dur
        words, method = res.get("words") or [], "tts_timestamps"
        if not words and stt_m and c.has(stt_m.provider):
            def run_stt(_k, _r, _o, asset=asset):
                data = open(c.storage.local_path(asset.storage_key), "rb").read()
                return {"words": speech.OpenAISTT(c.cred(stt_m.provider)["api_key"]).words(data, stt_m.endpoint, c.p.language)}
            try:
                words = c.paid(provider=stt_m.provider, model=stt_m, kind="stt", scene=s, payload={"asset": asset.id},
                               est_cost=unit_cost(stt_m, dur / 60), run=run_stt, attempt=s.attempts)["words"]
                method = "stt"
            except ProviderError as e:
                c.log(f"음성 인식 실패 → 비례 배분으로 대체: {e.message}", "warn")
        if words:
            s.words = speech.retime_script_words(s.narration, words, dur)
        else:
            s.words, method = speech.proportional_words(s.narration, dur), "proportional(추정)"
        s.sync_method, s.audio_asset_id = method, asset.id
        s.duration = round(dur + (0.5 if s.idx == len(scenes) - 1 else 0.25), 3)
        c.db.commit()
    t = 0.0
    for s in scenes:
        s.start, s.end = round(t, 3), round(t + s.duration, 3)
        t += s.duration
    c.db.commit()
    c.save_data("narration", {"total_duration": round(t, 2), "voice": voice,
                              "sync": sorted({s.sync_method for s in scenes})})
    if t > 180:
        c.log(f"전체 길이 {t:.0f}초로 쇼츠 최대 길이(180초)를 넘습니다.", "warn")


# 13. 이미지 생성 --------------------------------------------------------
def image_prompt(c: Ctx, s: Scene, board: Storyboard, simple: bool = False) -> str:
    vb = board.visual_bible or {}
    chars = {x.get("name"): x for x in (board.character_bible or {}).get("characters") or []}
    parts = [s.image_prompt or s.background or s.narration]
    if not simple:
        for name in s.characters or []:
            ch = chars.get(name)
            if ch:
                parts.append(f"{name}: " + ", ".join(str(ch[k]) for k in ("face", "body", "hair", "outfit", "props") if ch.get(k)))
        parts += [s.shot, s.lens, s.lighting or vb.get("lighting"), s.color_mood or vb.get("palette")]
    parts += [vb.get("style"), "vertical 9:16 composition, no text, no watermark"]
    if s.redo_reason and not simple:
        parts.append(f"Fix: {s.redo_reason}")
    return ". ".join(p.strip().rstrip(".") for p in parts if p and p.strip())


def _hf_run(c: Ctx, client: hf.Higgsfield, m, body: dict, kind: str, ext: str, s: Scene):
    def run(key, resume_id, on_submitted):
        if resume_id:
            c.log(f"장면 {s.idx + 1}: 기존 요청({resume_id})을 이어서 조회합니다.", "info", "resume")
            r = client.wait(resume_id, heartbeat=c.heartbeat)
        else:
            r = client.generate(m.endpoint, body, key, on_submitted, heartbeat=c.heartbeat)
        a = c.save_asset(kind, ext, data=download(r.urls[0]), scene=s, provider="higgsfield", model_key=m.model_key,
                         source_url=r.urls[0], meta={"request_id": r.external_id, "expires_at": r.raw.get("expires_at")})
        return {"asset_id": a.id, "url": r.urls[0]}
    return run


def _other_provider_model(c: Ctx, kind: str, tier: str, blocked: set[str]):
    """잔액 부족·인증 오류가 난 공급자를 빼고, 연결된 다른 공급자의 모델을 고른다."""
    from ..models import ProviderModel
    skip = {m.model_key for m in c.db.query(ProviderModel).filter(ProviderModel.provider.in_(blocked))}
    return c.pick(kind, tier, exclude=skip, prefer_priced=False)


def _openai_image_endpoint(c: Ctx, m, cache: dict) -> str:
    """등록된 모델 ID가 계정에 없으면, 계정의 모델 목록에서 최신 GPT 이미지 모델로 바꿔 쓴다."""
    if "ids" not in cache:
        try:
            from ..providers.llm import LLM
            cache["ids"] = LLM("openai", c.cred("openai")["api_key"], "").list_models()
        except ProviderError:
            cache["ids"] = []
    ids = cache["ids"]
    if not ids or m.endpoint in ids:
        return m.endpoint
    cands = sorted(i for i in ids if i.startswith("gpt-image") and "mini" not in i) or sorted(i for i in ids if i.startswith("gpt-image"))
    if not cands:
        return m.endpoint
    c.log(f"OpenAI 이미지 모델 ID를 계정에서 쓸 수 있는 {cands[-1]} 로 바꿉니다(기존 {m.endpoint}).", "warn")
    m.endpoint = cands[-1]
    c.db.commit()
    return m.endpoint


def images(c: Ctx):
    board, seed = latest_board(c), c.data("storyboard").get("seed")
    fixed = c.db.get(Character, c.cfg.character_id) if c.cfg.character_id else None
    ref_id = (fixed.provider_ref or {}).get("higgsfield_soul_id") if fixed else None
    blocked: set[str] = set(c.data("images").get("blocked_providers") or [])
    oa_cache: dict = {}
    all_scenes = c.scenes()
    for n, s in enumerate(all_scenes):
        c.heartbeat()
        if s.image_asset_id and s.status != "redo":
            c.step(n + 1, len(all_scenes))
            continue
        tried, last, step = set(), None, 0
        m = c.model(s.image_model)
        if m and m.provider in blocked:
            m = _other_provider_model(c, "image", m.tier, blocked) or m
        while m and step < 3:  # 원 프롬프트 → 단순화 프롬프트 → 대체 모델
            prompt = image_prompt(c, s, board, simple=step == 1)
            try:
                if m.provider == "higgsfield":
                    body = hf.build_payload(m, prompt=prompt, aspect="9:16", seed=seed, reference_id=ref_id,
                                            negative=s.negative_prompt)
                    res = c.paid(provider="higgsfield", model=m, kind="image", scene=s, payload=body,
                                 est_cost=unit_cost(m, 1), attempt=s.attempts * 10 + step,
                                 run=_hf_run(c, hf.Higgsfield(**c.cred("higgsfield")), m, body, "image", "png", s))
                else:
                    size = (m.default_params or {}).get("size", "1024x1536")
                    endpoint = _openai_image_endpoint(c, m, oa_cache) if m.provider == "openai" else m.endpoint
                    body = {"prompt": prompt, "size": size, "model": endpoint}

                    def run(_k, _r, _o, m=m, prompt=prompt, size=size, s=s, endpoint=endpoint):
                        r = speech.OpenAIImage(c.cred(m.provider)["api_key"]).generate(endpoint, prompt, size)
                        data = r.data or download(r.urls[0])
                        a = c.save_asset("image", "png", data=data, scene=s, provider=m.provider, model_key=m.model_key)
                        return {"asset_id": a.id}
                    res = c.paid(provider=m.provider, model=m, kind="image", scene=s, payload=body,
                                 est_cost=unit_cost(m, 1), attempt=s.attempts * 10 + step, run=run)
                s.image_asset_id, s.image_model = res["asset_id"], m.model_key
                if s.status == "redo":
                    s.video_asset_id = None  # 이미지가 바뀌면 영상도 다시 만든다
                c.db.commit()
                last = None
                break
            except ProviderError as e:
                last = e
                if e.kind == "config":
                    raise
                if e.kind in ("auth", "balance"):
                    # 이 공급자는 지금 쓸 수 없다 → 연결된 다른 공급자로 전환(없으면 실패 처리)
                    blocked.add(m.provider)
                    alt = _other_provider_model(c, "image", m.tier, blocked)
                    if not alt:
                        raise
                    why = "잔액 부족" if e.kind == "balance" else "인증 오류"
                    c.log(f"{m.provider} {why} → {alt.display_name}(으)로 전환해 이미지를 만듭니다.", "warn")
                    c.save_data("images", {**c.data("images"), "blocked_providers": sorted(blocked)})
                    m = alt
                    continue
                c.log(f"장면 {s.idx + 1} 이미지 생성 실패({e.kind}): {e.message}", "warn")
                if step == 1:
                    tried.add(m.model_key)
                    m = c.pick("image", m.tier, exclude=tried)
                step += 1
        if last:
            raise last
        c.step(n + 1, len(all_scenes), "이미지 생성")
    c.save_data("images", {"count": len(c.scenes()), "blocked_providers": sorted(blocked)})


# 14. 영상 생성 ---------------------------------------------------------
def videos(c: Ctx):
    todo = [s for s in c.scenes() if s.kind == "video" and (not s.video_asset_id or s.status == "redo")]
    if todo and not c.has("higgsfield"):
        raise ProviderError("higgsfield", "config", "영상 생성에는 Higgsfield API 키가 필요합니다.")
    client = hf.Higgsfield(**c.cred("higgsfield")) if todo else None
    made = degraded = 0
    no_video = "잔액 부족" if "higgsfield" in (c.data("images").get("blocked_providers") or []) else None
    for n, s in enumerate(todo):
        c.heartbeat()
        c.step(n, len(todo), "영상 생성" if n else None)
        if no_video:  # 영상 공급자를 쓸 수 없으면 남은 장면은 이미지 + 자체 애니메이션으로 만든다
            s.kind, s.video_model = "image", None
            c.db.commit()
            degraded += 1
            continue
        img = c.asset(s.image_asset_id)
        tried, m, ok = set(), c.model(s.video_model), False
        while m and not ok:
            try:
                # 입력 이미지는 공개 URL이어야 한다: Higgsfield 결과 URL(7일 유효)이 있으면 그대로, 없으면 업로드.
                url = img.source_url if img.provider == "higgsfield" and img.source_url else None
                if not url:
                    url = client.upload(open(c.storage.local_path(img.storage_key), "rb").read(), "image/png")
                    img.source_url = url
                    c.db.commit()
                prompt = ". ".join(x for x in [s.video_prompt or s.image_prompt, s.subject_motion,
                                               f"Camera: {s.camera_move or s.shot}" if (s.camera_move or s.shot) else None,
                                               "smooth natural motion, consistent subject, no text"] if x)
                body = hf.build_payload(m, prompt=prompt, aspect="9:16", duration=s.duration, image_url=url,
                                        seed=c.data("storyboard").get("seed"))
                secs = video_seconds(m, s.duration)
                res = c.paid(provider="higgsfield", model=m, kind="video", scene=s, payload=body,
                             est_cost=unit_cost(m, secs), attempt=s.attempts,
                             run=_hf_run(c, client, m, body, "video", "mp4", s))
                s.video_asset_id, s.video_model = res["asset_id"], m.model_key
                c.db.commit()
                ok, made = True, made + 1
            except ProviderError as e:
                if e.kind == "config":
                    raise
                if e.kind in ("auth", "balance"):
                    no_video = "잔액 부족" if e.kind == "balance" else "인증 오류"
                    break
                c.log(f"장면 {s.idx + 1} 영상 생성 실패({e.kind}, {m.display_name}): {e.message}", "warn")
                tried.add(m.model_key)
                m = c.pick("i2v", m.tier, exclude=tried)
        if not ok:
            s.kind, s.video_model = "image", None  # 잔액 부족이거나 대체 모델도 실패하면 이미지+자체 애니메이션으로 내린다
            c.db.commit()
            degraded += 1
            c.log(f"장면 {s.idx + 1}: 영상 생성이 모두 실패해 이미지 애니메이션으로 대체했습니다.", "warn")
    if no_video:
        c.log(f"Higgsfield {no_video}(으)로 영상 장면 {degraded}개를 이미지 애니메이션으로 만들었습니다.", "warn")
    for s in c.scenes():
        s.status, s.redo_reason = "ready", None
    c.db.commit()
    c.save_data("videos", {"generated": made, "degraded_to_image": degraded})


# 16. 배경음악 (음향 감독, 규칙 기반) -----------------------------------
def music(c: Ctx):
    mood = c.data("storyboard").get("music_mood")
    q = c.db.query(AudioTrack).filter(AudioTrack.kind == "music", (AudioTrack.user_id == c.p.user_id) | (AudioTrack.user_id.is_(None)))
    ok = []
    for t in q:
        lic = c.db.get(License, t.license_id) if t.license_id else None
        if lic and lic.commercial_ok:  # 상업적 이용이 확인된 음원만 사용
            ok.append((t, lic))
    if (c.cfg.extra or {}).get("no_music") or not ok:
        c.save_data("music", {"track": None, "note": "사용 가능한(상업적 이용 허락이 등록된) 음원이 없어 배경음악 없이 제작합니다."
                              if not ok else "배경음악 사용 안 함"})
        return
    pick = next(((t, l) for t, l in ok if t.mood == mood), ok[0])
    c.save_data("music", {"track": pick[0].id, "key": pick[0].storage_key, "title": pick[0].title, "mood": pick[0].mood,
                          "mood_matched": pick[0].mood == mood,
                          "license": {"name": pick[1].name, "type": pick[1].license_type, "source": pick[1].source_url,
                                      "attribution": pick[1].attribution}})


# 17~18. 자막 -----------------------------------------------------------
def subs(c: Ctx):
    scenes = c.scenes()
    cues = subtitles.build_cues([{"start": s.start, "words": s.words, "position": s.subtitle_position,
                                  "emphasis": s.emphasis_words} for s in scenes], c.p.language)
    w, h = (int(x) for x in c.cfg.resolution.split("x"))
    style = {"font": c.s.subtitle_font, **(c.cfg.subtitle_style or {})}
    c.db.query(Subtitle).filter_by(project_id=c.p.id).delete()
    files = {"srt": subtitles.to_srt(cues), "vtt": subtitles.to_vtt(cues), "ass": subtitles.to_ass(cues, w, h, style)}
    sync = ", ".join(sorted({s.sync_method or "" for s in scenes}))
    for fmt, text in files.items():
        key = f"{c.p.id}/subtitle/{c.p.language}.{fmt}"
        c.storage.put_bytes(key, text.encode("utf-8"))
        c.db.add(Subtitle(project_id=c.p.id, language=c.p.language, format=fmt, storage_key=key, sync_method=sync,
                          cues=[{k: x[k] for k in ("s", "e", "text")} for x in cues] if fmt == "srt" else []))
    c.db.commit()
    total = scenes[-1].end if scenes else 0
    extra = []
    for lang in (c.cfg.extra or {}).get("subtitle_languages") or []:
        if lang == c.p.language:
            continue
        try:
            out = c.agent("자막 번역", A.TRANSLATE, A.j({"target_language": A.LANG.get(lang, lang),
                                                       "lines": [x["text"] for x in cues]}), ["lines"], tier="economy")
            if len(out["lines"]) == len(cues):
                tr = [{**x, "text": t} for x, t in zip(cues, out["lines"])]
                key = f"{c.p.id}/subtitle/{lang}.srt"
                c.storage.put_bytes(key, subtitles.to_srt(tr).encode("utf-8"))
                c.db.add(Subtitle(project_id=c.p.id, language=lang, format="srt", storage_key=key, sync_method=sync))
                c.db.commit()
                extra.append(lang)
            else:
                c.log(f"{lang} 자막 번역의 줄 수가 맞지 않아 제외했습니다.", "warn")
        except ProviderError as e:
            c.log(f"{lang} 자막 번역 실패: {e.message}", "warn")
    c.save_data("subs", {"cues": len(cues), "issues": subtitles.check(cues, total, c.p.language), "sync": sync,
                         "extra_languages": extra})


# 19. 타임라인 (영상 편집 AI, 규칙 기반) --------------------------------
def timeline(c: Ctx):
    w, h = (int(x) for x in c.cfg.resolution.split("x"))
    items = []
    for s in c.scenes():
        use_video = s.kind == "video" and s.video_asset_id
        a = c.asset(s.video_asset_id if use_video else s.image_asset_id)
        if not a:
            raise PipelineError(f"장면 {s.idx + 1}의 화면 소재가 없습니다.")
        items.append({"idx": s.idx, "scene_id": s.id, "type": "video" if use_video else "image", "key": a.storage_key,
                      "audio_key": c.asset(s.audio_asset_id).storage_key if s.audio_asset_id else None,
                      "start": s.start, "dur": s.duration, "transition": s.transition,
                      "move": ffmpeg.camera_to_move(s.camera_move or s.shot, s.idx)})
    mus = c.data("music")
    brand = c.cfg.branding or {}
    tl = {"width": w, "height": h, "fps": c.cfg.fps, "transition_sec": 0.3, "scenes": items,
          "ass": f"{c.p.id}/subtitle/{c.p.language}.ass",
          "audio": {"music": {"key": mus["key"], "gain": float((c.cfg.extra or {}).get("music_gain") or 0.22)}} if mus.get("key") else {},
          "look": {"color": True, "denoise": bool((c.cfg.extra or {}).get("denoise"))},
          "branding": {"logo_key": brand.get("logo_key")} if brand.get("logo_key") else {}}
    c.db.add(RenderJob(project_id=c.p.id, timeline=tl, settings={"crf": 18, "vcodec": "h264", "acodec": "aac"}))
    c.db.commit()
    c.save_data("timeline", {"scenes": len(items), "duration": round(sum(i["dur"] for i in items), 2)})


def latest_job(c: Ctx) -> RenderJob:
    return c.db.query(RenderJob).filter_by(project_id=c.p.id).order_by(RenderJob.created_at.desc()).first()


# 24. 렌더링 ------------------------------------------------------------
def render(c: Ctx):
    job = latest_job(c)
    job.status, job.started_at = "running", datetime.now(timezone.utc)
    c.db.commit()
    work = os.path.join(c.work, f"render_{job.id}")
    try:
        out = ffmpeg.render(job.timeline, work, c.storage.local_path)
    except Exception as e:
        job.status, job.log = "failed", str(e)[-3000:]
        c.db.commit()
        raise
    key = f"{c.p.id}/final/{job.id}.mp4"
    c.storage.put_file(key, out)
    info = ffmpeg.summary(out)
    # 저해상도 소재를 확대한 4K 출력은 네이티브 4K로 표시하지 않는다.
    info["native_4k"] = False if info["height"] >= 3840 else None
    job.status, job.output_key, job.probe, job.finished_at = "done", key, info, datetime.now(timezone.utc)
    c.p.output_video_key = key
    c.db.commit()
    c.save_data("render", {"key": key, **info})


# 20~23. 품질검수 · 자동 재제작 ------------------------------------------
def review(c: Ctx):
    job = latest_job(c)
    path = c.storage.local_path(job.output_key)
    tl = job.timeline
    tech = qc.technical(path, tl, c.data("subs").get("issues") or [])
    frames = [f["jpeg"] for f in tech.pop("frames") if f.get("ok")]
    scenes, board, sc = c.scenes(), latest_board(c), latest_script(c)
    ai, partial = None, True
    vision = c.pick("llm", "standard", c.cfg.llm_model, need="vision")
    if vision and (vision.capabilities or {}).get("vision") and frames:
        try:
            facts = [f.claim for f in usable_facts(c)]
            user = (f"제목: {sc.final_title}\n대본: {sc.full_text}\n검증된 사실: {A.j(facts) if facts else '없음(구체적 수치가 대본에 있으면 감점)'}\n"
                    f"Visual Bible: {A.j(board.visual_bible)}\nCharacter Bible: {A.j(board.character_bible)}\n"
                    f"장면 목록(첨부 프레임 순서와 동일): " + A.j([{"scene": s.idx, "narration": s.narration, "kind": s.kind,
                                                        "quality_bar": s.quality_bar} for s in scenes[:20]]))
            ai = c.agent("품질검수", A.QA, user, ["visual", "story", "accuracy", "consistency"], images=frames[:20])
            partial = False
        except ProviderError as e:
            c.log(f"AI 시각 검수를 수행하지 못했습니다: {e.message}", "warn")
    else:
        c.log("이미지 입력을 지원하는 언어 AI가 없어 AI 시각 검수를 생략합니다(기술 검수만 수행).", "warn")

    ts = tech["scores"]
    scores = {"spec": ts["spec"], "audio": ts["audio"], "subtitle": ts["subtitle"]}
    fatal, redo = list(tech["fatal"]), set(tech["redo_scenes"])
    issues = list(tech["issues"])
    hints = {}
    if ai:
        def num(k, mx):
            try:
                return max(0.0, min(float(ai.get(k) or 0), mx))
            except (TypeError, ValueError):
                return 0.0
        scores.update(visual=max(num("visual", 25) - tech["visual_penalty"], 0), story=num("story", 20),
                      accuracy=num("accuracy", 15), consistency=num("consistency", 10))
        fatal += [str(x) for x in ai.get("fatal") or []]
        for it in ai.get("scene_issues") or []:
            issues.append({"cat": "ai", "scene": it.get("scene"), "severity": it.get("severity"), "msg": it.get("issue")})
            if it.get("severity") == "high" and isinstance(it.get("scene"), int):
                redo.add(it["scene"])
                hints[it["scene"]] = it.get("fix_hint")
        total = sum(scores.values())
    else:
        scores["visual_technical"] = max(25 - tech["visual_penalty"], 0)
        total = round(sum(scores.values()) / 55 * 100, 1)  # 평가 가능한 55점 만점 기준 환산
    total = round(total, 1)
    passed = not fatal and total >= gset(c.db, "quality_pass_score")
    rep = QualityReport(project_id=c.p.id, round=c.p.regen_rounds, scores=scores, total=total, passed=passed,
                        partial=partial, fatal=fatal, issues=issues,
                        technical={k: tech[k] for k in ("probe", "loudness", "black_seconds")})
    c.db.add(rep)
    c.db.commit()
    c.save_data("review", {"total": total, "passed": passed, "partial": partial, "fatal": fatal, "round": c.p.regen_rounds,
                           "policy": (ai or {}).get("policy"),
                           "disclaimer": "내부 품질 지표이며 유튜브 알고리즘·조회수를 보장하지 않습니다."})
    c.log(f"품질 점수 {total}점 ({'통과' if passed else '미달'}{', AI 시각 검수 미실시' if partial else ''})",
          "info" if passed else "warn")
    if passed:
        return None
    by_idx = {s.idx: s for s in scenes}
    targets = [by_idx[i] for i in sorted(redo) if i in by_idx]
    max_rounds = gset(c.db, "max_regen_rounds")
    if targets and c.p.regen_rounds < max_rounds:
        need = sum((s.est_cost_usd or 0) for s in targets)
        try:
            c.ensure_budget(need)
        except BudgetExceeded as e:
            c.log(f"재생성 비용이 예산을 넘어 재제작하지 않습니다: {e}", "warn")
        else:
            for s in targets:
                s.status, s.attempts = "redo", s.attempts + 1
                s.redo_reason = hints.get(s.idx) or next((i["msg"] for i in issues if i.get("scene") == s.idx), None)
            c.p.regen_rounds += 1
            c.db.commit()
            c.log(f"문제 장면 {[s.idx + 1 for s in targets]}만 다시 제작합니다 ({c.p.regen_rounds}/{max_rounds}회차).", "warn")
            return ["images", "videos", "timeline", "render", "review"]
    if fatal:
        raise PipelineError("품질검수에서 치명적 문제가 확인되었습니다: " + "; ".join(fatal))
    c.log("기준 점수에 못 미치지만 재시도 한도·대상이 없어 결과를 '품질 주의' 표시와 함께 내보냅니다.", "warn")
    return None


# 25~27. 업로드 패키지 ---------------------------------------------------
def package(c: Ctx):
    sc, board, job = latest_script(c), latest_board(c), latest_job(c)
    facts = usable_facts(c)
    rv = c.data("review")
    user = (f"언어: {A.LANG.get(c.p.language, c.p.language)}\n제목 후보: {A.j(sc.title_candidates)}\n대본: {sc.full_text}\n"
            f"영상 스타일: {A.j((board.visual_bible or {}).get('style'))}\n콘텐츠 유형: {sc.content_type}\n"
            f"길이: {job.probe.get('duration')}초\n대본 작성 시 주의 메모: {A.j(sc.policy_notes)}\n"
            f"품질검수 정책 메모: {A.j(rv.get('policy'))}")
    out = c.agent("유튜브 SEO", A.SEO, user, ["titles", "final_title", "description", "hashtags"], tier="economy")
    video = c.storage.local_path(job.output_key)
    scenes = c.scenes()
    top = max(scenes, key=lambda s: s.importance) if scenes else None
    times = [scenes[0].start + min(1.0, scenes[0].duration / 2)] if scenes else [0.5]
    if top and top.idx != 0:
        times.append(top.start + top.duration / 2)
    if len(scenes) > 2:
        times.append(scenes[-1].start + scenes[-1].duration / 3)
    covers = []
    for i, t in enumerate(times):
        p = ffmpeg.grab_frame(video, t, os.path.join(c.work, f"cover_{i}.jpg"))
        covers.append(c.save_asset("cover", "jpg", path=p, meta={"t": round(t, 2)}).storage_key)
    thumb = None
    try:
        tp = ffmpeg.title_cover(os.path.join(c.work, "cover_0.jpg"), out["final_title"], os.path.join(c.work, "thumb.jpg"),
                                c.s.subtitle_font, c.work)
        thumb = c.save_asset("cover", "jpg", path=tp, meta={"title": True}).storage_key
    except Exception as e:  # 대표 이미지는 부가 산출물 — 실패해도 패키지는 완성한다
        c.log(f"제목 대표 이미지 생성 실패: {e}", "warn")
    mus = c.data("music")
    c.p.package = {
        "titles": out["titles"][:5], "final_title": out["final_title"], "description": out["description"],
        "hashtags": out["hashtags"], "keywords": out.get("keywords") or [], "pinned_comment": out.get("pinned_comment"),
        "ai_disclosure": out.get("ai_disclosure"), "policy_check": out.get("policy_check"),
        "policy_disclaimer": "정책 검사는 위험을 줄이기 위한 사전 점검이며 수익 창출이나 저작권 문제의 부재를 보장하지 않습니다.",
        "sources": [{"claim": f.claim, "url": f.url, "title": f.title, "published": f.published_at,
                     "checked": f.checked_at.isoformat() if f.checked_at else None, "reliability": f.reliability} for f in facts],
        "unverified": c.data("factcheck").get("unverified", False),
        "covers": covers, "thumbnail": thumb,
        "thumbnail_note": "쇼츠는 업로드 API로 사용자 지정 썸네일을 넣을 수 없는 경우가 많아, 커버 프레임 후보를 함께 제공합니다. 적용 방식은 업로드 화면에서 확인하세요.",
        "subtitles": [s.storage_key for s in c.db.query(Subtitle).filter_by(project_id=c.p.id) if s.format in ("srt", "vtt")],
        "music": mus if mus.get("track") else None,
        "quality": {"total": rv.get("total"), "passed": rv.get("passed"), "partial": rv.get("partial"), "disclaimer": rv.get("disclaimer")},
        "video": job.probe, "cost_usd": c.p.actual_cost_usd,
    }
    c.p.title = out["final_title"]
    flag_modified(c.p, "package")
    c.db.commit()
    c.save_data("package", {"done": True})


def failed_requests(c: Ctx) -> int:
    return c.db.query(ProviderRequest).filter_by(project_id=c.p.id, status="failed").count()
