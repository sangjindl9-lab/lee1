"use client";

import Link from "next/link";
import { useState } from "react";

type Item = {
  id: string;
  thumbUrl: string;
  childName: string | null;
  childNickname: string | null;
  ageLabel: string;
  capturedAtLabel: string;
  kind: string;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  tags: string[];
};

export default function SimpleFeed({ items }: { items: Item[] }) {
  const [state, setState] = useState(items);
  const [busy, setBusy] = useState<string | null>(null);

  async function like(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/media/${id}/like`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setState((prev) => prev.map((m) => (m.id === id ? { ...m, liked: data.liked, likeCount: data.likeCount } : m)));
      }
    } finally {
      setBusy(null);
    }
  }

  if (state.length === 0) {
    return (
      <div className="rounded-3xl bg-white p-10 text-center ring-1 ring-rose-100">
        <p className="text-5xl">📷</p>
        <p className="mt-3 text-xl font-bold text-slate-600">아직 사진이 없어요.</p>
        <p className="text-base text-slate-400">사진이 올라오면 여기에서 바로 볼 수 있어요.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {state.map((item, index) => (
        <div key={item.id} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-rose-100">
          <Link href={`/simple/viewer/${item.id}`} className="relative block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.thumbUrl} alt={`${item.childNickname ?? ""} ${item.childName ?? "사진"}`} className="aspect-[4/3] w-full object-cover" />
            {index === 0 && (
              <span className="absolute left-3 top-3 rounded-full bg-rose-500 px-3 py-1 text-sm font-bold text-white">새 사진</span>
            )}
            {item.kind === "VIDEO" && (
              <span className="absolute bottom-3 right-3 rounded-full bg-black/70 px-3 py-1 text-sm font-bold text-white">▶ 동영상</span>
            )}
          </Link>
          <div className="flex items-center gap-2 p-3">
            <button
              onClick={() => like(item.id)}
              disabled={busy === item.id}
              className={`big-btn flex-1 ${item.liked ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-600"}`}
            >
              {item.liked ? "❤️" : "🤍"} 좋아요 {item.likeCount > 0 ? item.likeCount : ""}
            </button>
            <Link href={`/simple/viewer/${item.id}#comments`} className="big-btn flex-1 bg-slate-100 text-slate-700">
              💬 댓글 {item.commentCount > 0 ? item.commentCount : ""}
            </Link>
          </div>
          <p className="px-4 pb-3 text-base text-slate-500">
            {item.childNickname} {item.childName} · {item.ageLabel} · {item.capturedAtLabel.slice(0, 10)}
          </p>
        </div>
      ))}
    </div>
  );
}
