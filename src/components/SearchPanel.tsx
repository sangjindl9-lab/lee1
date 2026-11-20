"use client";

import { useState } from "react";
import type { MediaDTO } from "@/lib/serialize";

type ChildInfo = { id: string; name: string; nickname: string };
type TagInfo = { id: string; name: string; count: number };

type SearchResponse = {
  ok: boolean;
  total: number;
  items: MediaDTO[];
  applied: string[];
  error?: { message: string };
};

export default function SearchPanel({
  children,
  tags,
  initialItems,
}: {
  children: ChildInfo[];
  tags: TagInfo[];
  initialItems: MediaDTO[];
}) {
  const [q, setQ] = useState("");
  const [childId, setChildId] = useState("");
  const [ageMonths, setAgeMonths] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [kind, setKind] = useState("");
  const [favorite, setFavorite] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [result, setResult] = useState<{ items: MediaDTO[]; applied: string[]; total: number } | null>({
    items: initialItems,
    applied: [],
    total: initialItems.length,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildQuery() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (childId) params.set("childId", childId);
    if (ageMonths) params.set("ageMonths", ageMonths);
    if (year) params.set("year", year);
    if (month) params.set("month", month);
    if (kind) params.set("kind", kind);
    if (favorite) params.set("favorite", "1");
    if (selectedTags.length) params.set("tags", selectedTags.join(","));
    return params.toString();
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/search?${buildQuery()}`, { cache: "no-store" });
      const data = (await res.json()) as SearchResponse;
      if (!res.ok) throw new Error(data.error?.message ?? "검색에 실패했습니다.");
      setResult({ items: data.items, applied: data.applied, total: data.total });
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const examples = ["둘째 생후 10개월 때 찍은 동영상", "첫째 백일 사진", "2025년 9월", "지우 첫걸음", "즐겨찾기 동영상"];

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <label className="label" htmlFor="q">
          촬영 날짜를 몰라도 자연어로 찾기
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            className="input"
            placeholder="예: 둘째 생후 10개월 때 찍은 동영상"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run();
            }}
          />
          <button className="btn-primary shrink-0" onClick={run} disabled={busy}>
            {busy ? "찾는 중…" : "검색"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {examples.map((example) => (
            <button
              key={example}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
              onClick={() => {
                setQ(example);
                setTimeout(() => void run(), 0);
              }}
            >
              {example}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor="s-child">아이</label>
            <select id="s-child" className="input" value={childId} onChange={(e) => setChildId(e.target.value)}>
              <option value="">모든 아이</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.nickname})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="s-age">생후 개월</label>
            <input id="s-age" className="input" type="number" min={0} max={72} placeholder="예: 10" value={ageMonths} onChange={(e) => setAgeMonths(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-year">연도</label>
            <input id="s-year" className="input" type="number" placeholder="2026" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-month">월</label>
            <input id="s-month" className="input" type="number" min={1} max={12} placeholder="4" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="s-kind">종류</label>
            <select id="s-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">사진+동영상</option>
              <option value="IMAGE">사진</option>
              <option value="VIDEO">동영상</option>
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${favorite ? "bg-amber-400 text-white" : "bg-slate-100 text-slate-600"}`}
            onClick={() => setFavorite((v) => !v)}
          >
            ⭐ 즐겨찾기만
          </button>
          {tags.map((tag) => (
            <button
              key={tag.id}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                selectedTags.includes(tag.name) ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-600"
              }`}
              onClick={() =>
                setSelectedTags((prev) => (prev.includes(tag.name) ? prev.filter((t) => t !== tag.name) : [...prev, tag.name]))
              }
            >
              #{tag.name} {tag.count}
            </button>
          ))}
        </div>
      </section>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-2 text-xs font-semibold text-red-600">{error}</p>}

      {result && (
        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="section-title">검색 결과 {result.total}개</h2>
            {result.applied.map((a) => (
              <span key={a} className="chip">{a}</span>
            ))}
          </div>
          {result.items.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-8 text-center text-sm text-slate-400">조건에 맞는 사진이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {result.items.map((m) => (
                <div key={m.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumbUrl} alt={m.fileName} className="h-full w-full object-cover" />
                  <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/75 to-transparent p-2">
                    <p className="truncate text-[11px] font-bold text-white">
                      {m.childNickname} · {m.ageLabel}
                    </p>
                    <p className="truncate text-[10px] text-white/75">
                      {m.capturedAtLabel.slice(0, 10)} · {m.kind === "VIDEO" ? "동영상" : "사진"}
                      {m.tags.length ? ` · ${m.tags.map((t) => `#${t}`).join(" ")}` : ""}
                    </p>
                  </div>
                  {m.kind === "VIDEO" && (
                    <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">▶</span>
                  )}
                  <a
                    href={m.downloadUrl}
                    className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-1 text-[10px] font-bold text-slate-700"
                  >
                    ⬇️ 원본
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
