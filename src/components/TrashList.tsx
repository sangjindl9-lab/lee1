"use client";

import { useState } from "react";
import type { MediaDTO } from "@/lib/serialize";

export default function TrashList({ initialItems }: { initialItems: MediaDTO[] }) {
  const [items, setItems] = useState(initialItems);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/media/${id}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "복구하지 못했습니다.");
      setItems((prev) => prev.filter((m) => m.id !== id));
      setNotice(
        `${data.media?.childName ?? "아이"}의 원래 앨범으로 복구했습니다. 촬영일 ${data.media?.capturedAtLabel ?? "-"} · ${data.media?.visibilityLabel ?? ""}`,
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "복구하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700">{notice}</div>
      )}
      {items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-3xl">🗑️</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">휴지통이 비어 있습니다.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="card flex items-center gap-3 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.thumbUrl} alt={m.fileName} className="h-16 w-16 rounded-xl object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800">{m.fileName}</p>
                <p className="text-xs text-slate-500">
                  원래 위치: {m.childName}({m.childNickname}) 앨범 · {m.capturedAtLabel} · {m.visibilityLabel}
                </p>
                <p className="text-[11px] text-slate-400">
                  {m.ageLabel} · {m.kind === "VIDEO" ? "동영상" : "사진"} · 삭제 {m.deletedAt?.slice(0, 10)}
                </p>
              </div>
              <button className="btn-soft shrink-0" onClick={() => restore(m.id)} disabled={busy === m.id}>
                {busy === m.id ? "복구 중…" : "↩️ 복구"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
