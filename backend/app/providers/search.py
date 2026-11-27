"""웹 검색 어댑터. 새 검색엔진은 ENGINES 에 클래스를 추가하면 된다."""
from dataclasses import dataclass

from .base import call


@dataclass
class SearchHit:
    title: str
    url: str
    snippet: str
    published: str | None = None
    engine: str = ""


class Tavily:
    name = "tavily"

    def __init__(self, api_key: str):
        self.key = api_key

    def search(self, query: str, n: int = 6) -> list[SearchHit]:
        r = call(self.name, "POST", "https://api.tavily.com/search",
                 headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
                 json={"query": query, "max_results": n, "search_depth": "basic", "include_answer": False})
        return [SearchHit(h.get("title", ""), h.get("url", ""), (h.get("content") or "")[:1200],
                          h.get("published_date"), self.name) for h in r.get("results", [])]


class Brave:
    name = "brave"

    def __init__(self, api_key: str):
        self.key = api_key

    def search(self, query: str, n: int = 6) -> list[SearchHit]:
        r = call(self.name, "GET", "https://api.search.brave.com/res/v1/web/search",
                 headers={"X-Subscription-Token": self.key, "Accept": "application/json"},
                 params={"q": query, "count": n})
        out = []
        for h in (r.get("web") or {}).get("results", []):
            out.append(SearchHit(h.get("title", ""), h.get("url", ""), (h.get("description") or "")[:1200],
                                 h.get("page_age") or h.get("age"), self.name))
        return out


ENGINES = {"tavily": Tavily, "brave": Brave}
