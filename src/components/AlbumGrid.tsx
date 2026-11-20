"use client";

import { useMemo, useState } from "react";
import type { MediaDTO } from "@/lib/serialize";

type TagInfo = { id: string; name: string; count: number };
type ChildInfo = { id: string; name: string; nickname: string; albums: Array<{ id: string; name: string }> };

export default function AlbumGrid({
  initialItems,
  children,
  tags,
  childId,
  focusId,
  canEdit,
}: {
  initialItems: MediaDTO[];
  children: ChildInfo[];
  tags: TagInfo[];
  childId: string;
  focusId?: string;
  canEdit: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<"all" | "IMAGE" | "VIDEO" | "favorite">("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<MediaDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tagNames, setTagNames] = useState(tags);

  const shown = useMemo(() => {
    return items.filter((m) => {
      if (filter === "favorite" && !m.favorite) return false;
      if ((filter === "IMAGE" || filter === "VIDEO") && m.kind !== filter) return false;
      if (tagFilter && !m.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [items, filter, tagFilter]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function patchMedia(id: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "변경에 실패했습니다.");
      setItems((prev) => prev.map((m) => (m.id === id ? data.media : m)));
      if (active?.id === id) setActive(data.media);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "변경에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function trashSelected() {
    if (!selected.size) return;
    if (!confirm(`${selected.size}개를 휴지통으로 옮길까요? 휴지통에서 원래 앨범 그대로 복구할 수 있습니다.`)) return;
    setBusy(true);
    let done = 0;
    for (const id of selected) {
      const res = await fetch(`/api/media/${id}`, { method: "DELETE" });
      if (res.ok) done += 1;
    }
    setItems((prev) => prev.filter((m) => !selected.has(m.id)));
    setSelected(new Set());
    setActive(null);
    setNotice(`${done}개를 휴지통으로 옮겼습니다.`);
    setBusy(false);
  }

  async function addTags() {
    if (!active || !tagInput.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${active.id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: tagInput.split(/[,\s#]+/).filter(Boolean) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "태그를 붙이지 못했습니다.");
      setItems((prev) => prev.map((m) => (m.id === data.media.id ? data.media : m)));
      setActive(data.media);
      setTagInput("");
      const tagRes = await fetch("/api/tags", { cache: "no-store" });
      const tagData = await tagRes.json();
      if (tagRes.ok) setTagNames(tagData.tags);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "태그를 붙이지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(name: string) {
    if (!active) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${active.id}/tags?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error("태그를 떼지 못했습니다.");
      setItems((prev) => prev.map((m) => (m.id === data.media.id ? data.media : m)));
      setActive(data.media);
    } finally {
      setBusy(false);
    }
  }

  function downloadSelected() {
    if (!selected.size) return;
    window.location.href = `/api/download?mediaIds=${[...selected].join(",")}`;
  }

  function downloadRange() {
    const qs = new URLSearchParams({ childId });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    window.location.href = `/api/download?${qs.toString()}`;
  }

  const child = children.find((c) => c.id === childId);

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "all", label: "전체" },
            { key: "IMAGE", label: "사진" },
            { key: "VIDEO", label: "동영상" },
            { key: "favorite", label: "⭐ 즐겨찾기" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key as typeof filter)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                filter === tab.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {tagNames.map((tag) => (
            <button
              key={tag.id}
              onClick={() => setTagFilter(tagFilter === tag.name ? null : tag.name)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                tagFilter === tag.name ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-600 hover:bg-rose-100"
              }`}
            >
              #{tag.name} {tag.count}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-500">✕</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-900 p-3 text-white shadow-lg">
          <span className="text-xs font-bold">{selected.size}개 선택</span>
          <button className="btn bg-white/15 text-xs text-white hover:bg-white/25" onClick={downloadSelected}>
            ⬇️ 선택 원본 ZIP
          </button>
          {canEdit && (
            <button className="btn bg-red-500/90 text-xs text-white hover:bg-red-500" onClick={trashSelected} disabled={busy}>
              🗑️ 휴지통으로
            </button>
          )}
          <button className="btn bg-white/10 text-xs text-white hover:bg-white/20" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-2 p-3 text-xs">
        <span className="pb-2 font-semibold text-slate-500">기간 원본 ZIP</span>
        <input type="date" className="input w-auto py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="pb-2 text-slate-400">~</span>
        <input type="date" className="input w-auto py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn-soft py-1.5" onClick={downloadRange}>
          기간으로 내려받기
        </button>
        <span className="ml-auto pb-2 text-slate-400">
            {child?.name} · {shown.length}개 표시 중
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="card p-10 text-center text-sm text-slate-400">조건에 맞는 사진이 없습니다.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((m) => {
            const isSelected = selected.has(m.id);
            return (
              <div
                key={m.id}
                id={`media-${m.id}`}
                className={`group relative aspect-square overflow-hidden rounded-2xl bg-slate-100 ring-2 transition ${
                  isSelected ? "ring-rose-500" : focusId === m.id ? "ring-amber-400" : "ring-transparent"
                }`}
              >
                <button className="absolute inset-0" onClick={() => (selected.size ? toggleSelect(m.id) : setActive(m))} aria-label={m.fileName}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumbUrl} alt={m.fileName} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                </button>
                <button
                  onClick={() => toggleSelect(m.id)}
                  className={`absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full text-xs font-bold shadow ${
                    isSelected ? "bg-rose-500 text-white" : "bg-white/85 text-slate-500"
                  }`}
                  aria-label="선택"
                >
                  {isSelected ? "✓" : ""}
                </button>
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <p className="truncate text-[11px] font-bold text-white">
                    {m.ageLabel} · {m.capturedAtLabel.slice(0, 10)}
                  </p>
                  <p className="truncate text-[10px] text-white/70">
                    {m.kind === "VIDEO" ? "동영상" : "사진"} · {m.tags.length ? m.tags.map((t) => `#${t}`).join(" ") : m.fileName}
                  </p>
                </div>
                {m.favorite && <span className="absolute right-2 top-2 text-sm">⭐</span>}
                {m.kind === "VIDEO" && (
                  <span className="absolute right-2 bottom-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">▶ 영상</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" onClick={() => setActive(null)}>
          <div className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="relative bg-black">
              {active.kind === "VIDEO" ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={active.thumbUrl} alt={active.fileName} className="max-h-[55dvh] w-full object-contain" />
                  <div className="absolute inset-0 grid place-items-center">
                    <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-slate-800">▶ 동영상 (원본 다운로드)</span>
                  </div>
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={active.previewUrl} alt={active.fileName} className="max-h-[55dvh] w-full object-contain" />
              )}
              <button
                onClick={() => setActive(null)}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/50 text-white"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">{active.fileName}</h3>
                <span className="chip">{active.childNickname} {active.childName}</span>
                <span className="chip">{active.ageLabel}</span>
                <span className="chip">{active.visibilityLabel}</span>
              </div>
              <p className="text-xs text-slate-500">
                촬영 {active.capturedAtLabel} · {active.kind === "VIDEO" ? "동영상" : "사진"} · {(active.sizeBytes / 1024).toFixed(0)}KB
                {active.width && active.height ? ` · ${active.width}×${active.height}` : ""}
              </p>
              <div className="grid gap-1 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
                <p>🖼️ 미리보기: {active.previewQuality ?? "-"}</p>
                <p>💾 보관 원본: {active.originalQuality ?? "-"}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {active.tags.map((t) => (
                  <button key={t} className="chip" onClick={() => removeTag(t)} title="눌러서 태그 떼기">
                    #{t} <span className="text-rose-400">✕</span>
                  </button>
                ))}
                {active.tags.length === 0 && <span className="text-xs text-slate-400">아직 태그가 없습니다.</span>}
              </div>
              <div className="flex flex-wrap gap-2">
                <a className="btn-primary" href={active.downloadUrl}>
                  ⬇️ 원본 다운로드
                </a>
                <button className="btn-soft" onClick={() => patchMedia(active.id, { favorite: !active.favorite })} disabled={busy}>
                  {active.favorite ? "⭐ 즐겨찾기 해제" : "☆ 즐겨찾기"}
                </button>
                <button className="btn-ghost" onClick={() => toggleSelect(active.id)}>
                  선택에 추가
                </button>
                {canEdit && (
                  <button
                    className="btn text-red-600 hover:bg-red-50"
                    onClick={async () => {
                      if (!confirm("이 사진을 휴지통으로 옮길까요?")) return;
                      await fetch(`/api/media/${active.id}`, { method: "DELETE" });
                      setItems((prev) => prev.filter((m) => m.id !== active.id));
                      setActive(null);
                      setNotice("휴지통으로 옮겼습니다. 휴지통에서 원래 앨범 그대로 복구할 수 있습니다.");
                    }}
                  >
                    🗑️ 삭제
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-rose-50/60 p-3">
                <input
                  className="input flex-1 py-1.5"
                  placeholder="태그 입력 (예: 첫걸음, 백일)"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addTags();
                  }}
                />
                <button className="btn-soft py-1.5" onClick={addTags} disabled={busy}>
                  태그 붙이기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
