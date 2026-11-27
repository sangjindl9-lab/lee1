"""YouTube Data API v3 · OAuth · 업로드 · Analytics.

쿼터(공식 기준): search.list 100, videos.list 1, channels.list 1, commentThreads.list 1,
videos.insert 는 비용이 크므로(과거 1600 단위) Google Cloud 콘솔의 쿼터표로 확인한다.
공식 API로 확인할 수 없는 값(타 채널 유지율·CTR 등)은 만들지 않는다.
"""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from .base import ProviderError, call

API = "https://www.googleapis.com/youtube/v3"
NAME = "youtube"
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]
QUOTA = {"search": 100, "videos": 1, "channels": 1, "commentThreads": 1}


def parse_duration(iso: str | None) -> int:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None  # 비공개 값(좋아요·구독자 숨김)은 None 으로 둔다


class YouTubeData:
    def __init__(self, api_key: str, on_quota=None):
        self.key = api_key
        self.on_quota = on_quota or (lambda method, units: None)

    def _get(self, method: str, params: dict) -> dict:
        try:
            r = call(NAME, "GET", f"{API}/{method}", params={**params, "key": self.key}, retries=2,
                     status_map={403: "invalid"})
        except ProviderError as e:
            if e.status == 403 and "quota" in e.message.lower():
                raise ProviderError(NAME, "rate_limit", "YouTube API 일일 쿼터 초과", 403) from None
            if e.status == 400 and "API key" in e.message:
                raise ProviderError(NAME, "auth", e.message, 400) from None
            raise
        self.on_quota(method, QUOTA.get(method, 1))
        return r

    def test(self) -> dict:
        self._get("videos", {"part": "id", "chart": "mostPopular", "maxResults": 1, "regionCode": "KR"})
        return {"ok": True}

    def search(self, q: str, days: int | None = None, order: str = "viewCount", n: int = 25,
               region: str = "KR", lang: str = "ko") -> list[str]:
        p = {"part": "id", "type": "video", "q": q, "order": order, "maxResults": min(n, 50),
             "videoDuration": "short", "regionCode": region, "relevanceLanguage": lang}
        if days:
            p["publishedAfter"] = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
        r = self._get("search", p)
        return [i["id"]["videoId"] for i in r.get("items", []) if i.get("id", {}).get("videoId")]

    def videos(self, ids: list[str]) -> list[dict]:
        out = []
        for i in range(0, len(ids), 50):
            r = self._get("videos", {"part": "snippet,statistics,contentDetails", "id": ",".join(ids[i:i + 50])})
            for v in r.get("items", []):
                sn, st = v.get("snippet", {}), v.get("statistics", {})
                th = sn.get("thumbnails", {})
                out.append({
                    "video_id": v["id"], "title": sn.get("title"), "description": (sn.get("description") or "")[:2000],
                    "url": f"https://www.youtube.com/watch?v={v['id']}", "channel_id": sn.get("channelId"),
                    "channel_title": sn.get("channelTitle"), "published_at": sn.get("publishedAt"),
                    "duration_sec": parse_duration(v.get("contentDetails", {}).get("duration")),
                    "view_count": _int(st.get("viewCount")), "like_count": _int(st.get("likeCount")),
                    "comment_count": _int(st.get("commentCount")), "tags": sn.get("tags") or [],
                    "thumbnail": (th.get("high") or th.get("medium") or th.get("default") or {}).get("url"),
                })
        return out

    def most_popular(self, region: str = "KR", n: int = 50) -> list[dict]:
        r = self._get("videos", {"part": "id", "chart": "mostPopular", "regionCode": region, "maxResults": n})
        return self.videos([v["id"] for v in r.get("items", [])])

    def channels(self, ids: list[str]) -> dict[str, dict]:
        out = {}
        ids = list(dict.fromkeys(i for i in ids if i))
        for i in range(0, len(ids), 50):
            r = self._get("channels", {"part": "snippet,statistics", "id": ",".join(ids[i:i + 50])})
            for c in r.get("items", []):
                st = c.get("statistics", {})
                out[c["id"]] = {"title": c.get("snippet", {}).get("title"),
                                "subscriber_count": None if st.get("hiddenSubscriberCount") else _int(st.get("subscriberCount")),
                                "video_count": _int(st.get("videoCount"))}
        return out

    def comments(self, video_id: str, n: int = 20) -> list[str]:
        try:
            r = self._get("commentThreads", {"part": "snippet", "videoId": video_id, "order": "relevance",
                                             "maxResults": n, "textFormat": "plainText"})
        except ProviderError:
            return []  # 댓글 사용 중지 영상
        return [i["snippet"]["topLevelComment"]["snippet"].get("textDisplay", "")[:300] for i in r.get("items", [])]


def analyze(v: dict, sub_count: int | None, keywords: list[str]) -> dict:
    """공개 수치만으로 계산하는 성과 지표. 추정 항목은 이름에 명시한다."""
    try:
        pub = datetime.fromisoformat((v.get("published_at") or "").replace("Z", "+00:00"))
        hours = max((datetime.now(timezone.utc) - pub).total_seconds() / 3600, 1.0)
    except ValueError:
        hours = None
    views = v.get("view_count") or 0
    text = f"{v.get('title') or ''} {v.get('description') or ''}".lower()
    kw = [k.lower() for k in keywords if k]
    rel = sum(1 for k in kw if k in text) / len(kw) if kw else 0.0
    m = {
        "hours_since_publish": round(hours, 1) if hours else None,
        "avg_views_per_hour": round(views / hours, 2) if hours else None,  # 게시 후 평균(실제 증가 곡선 아님)
        "views_per_subscriber": round(views / sub_count, 3) if sub_count else None,
        "like_rate": round((v.get("like_count") or 0) / views, 4) if views and v.get("like_count") is not None else None,
        "comment_rate": round((v.get("comment_count") or 0) / views, 5) if views and v.get("comment_count") is not None else None,
        "relevance": round(rel, 2),
    }
    dur = v.get("duration_sec") or 0
    tagged = "#shorts" in text or "#쇼츠" in text
    m["short_basis"] = "해시태그" if tagged else ("길이(추정)" if 0 < dur <= 180 else "아님")
    import math
    score = (math.log10((m["avg_views_per_hour"] or 0) + 1) * 2.0
             + min(m["views_per_subscriber"] or 0, 20) * 0.15
             + (m["like_rate"] or 0) * 20 + rel * 2.0)
    m["score"] = round(score, 3)
    return m


# ---------------------------------------------------------------- OAuth --
def oauth_url(client_id: str, redirect_uri: str, state: str) -> str:
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
        "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent",
        "include_granted_scopes": "true", "state": state})


def oauth_exchange(client_id: str, client_secret: str, redirect_uri: str, code: str) -> dict:
    return call("google-oauth", "POST", "https://oauth2.googleapis.com/token", retries=1, data={
        "code": code, "client_id": client_id, "client_secret": client_secret,
        "redirect_uri": redirect_uri, "grant_type": "authorization_code"})


def oauth_refresh(client_id: str, client_secret: str, refresh_token: str) -> dict:
    return call("google-oauth", "POST", "https://oauth2.googleapis.com/token", retries=1, data={
        "refresh_token": refresh_token, "client_id": client_id, "client_secret": client_secret,
        "grant_type": "refresh_token"})


def oauth_revoke(token: str) -> None:
    try:
        call("google-oauth", "POST", "https://oauth2.googleapis.com/revoke", data={"token": token}, retries=0)
    except ProviderError:
        pass


class YouTubeAccount:
    """사용자가 OAuth로 연결한 본인 채널 전용."""

    def __init__(self, access_token: str):
        self.h = {"Authorization": f"Bearer {access_token}"}

    def my_channel(self) -> dict | None:
        r = call(NAME, "GET", f"{API}/channels", headers=self.h, params={"part": "snippet,statistics", "mine": "true"})
        items = r.get("items") or []
        if not items:
            return None
        c = items[0]
        th = c["snippet"].get("thumbnails", {})
        return {"channel_id": c["id"], "title": c["snippet"].get("title"),
                "thumbnail": (th.get("default") or {}).get("url")}

    def upload(self, path: str, title: str, description: str, tags: list[str], privacy: str = "private",
               synthetic: bool | None = None, category: str = "22") -> dict:
        """videos.insert (재개 가능 업로드). 기본 공개 범위는 private."""
        import os

        status = {"privacyStatus": privacy, "selfDeclaredMadeForKids": False}
        if synthetic is not None:
            status["containsSyntheticMedia"] = synthetic
        meta = {"snippet": {"title": title[:100], "description": description[:5000], "tags": tags[:30],
                            "categoryId": category}, "status": status}
        size = os.path.getsize(path)
        init = call(NAME, "POST", "https://www.googleapis.com/upload/youtube/v3/videos", raw=True, retries=1,
                    params={"uploadType": "resumable", "part": "snippet,status"}, json=meta,
                    headers={**self.h, "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(size)})
        loc = init.headers.get("Location")
        if not loc:
            raise ProviderError(NAME, "invalid", "업로드 세션 URL을 받지 못함")
        with open(path, "rb") as f:
            return call(NAME, "PUT", loc, headers={**self.h, "Content-Type": "video/mp4",
                                                   "Content-Length": str(size)}, content=f.read(),
                        timeout=1800, retries=1)

    def video_report(self, video_id: str, start: str, end: str) -> dict:
        """YouTube Analytics API: 본인 채널 영상 지표."""
        r = call("youtube-analytics", "GET", "https://youtubeanalytics.googleapis.com/v2/reports", headers=self.h,
                 params={"ids": "channel==MINE", "startDate": start, "endDate": end, "filters": f"video=={video_id}",
                         "metrics": "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,"
                                    "likes,comments,subscribersGained,subscribersLost"})
        cols = [c["name"] for c in r.get("columnHeaders", [])]
        rows = r.get("rows") or []
        return dict(zip(cols, rows[0])) if rows else {}
