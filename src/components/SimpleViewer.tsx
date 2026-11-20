"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type ViewerItem = {
  id: string;
  previewUrl: string;
  thumbUrl: string;
  childName: string | null;
  childNickname: string | null;
  ageLabel: string;
  capturedAtLabel: string;
  kind: string;
  likeCount: number;
  liked: boolean;
  originalUrl: string;
};

type CommentRow = { id: string; body: string; author: string; relation: string | null; createdAtLabel: string };

export default function SimpleViewer({ items, startIndex }: { items: ViewerItem[]; startIndex: number }) {
  const [index, setIndex] = useState(startIndex);
  const [likes, setLikes] = useState<Record<string, { liked: boolean; count: number }>>(
    Object.fromEntries(items.map((i) => [i.id, { liked: i.liked, count: i.likeCount }])),
  );
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentText, setCommentText] = useState("");
  const [showComments, setShowComments] = useState(false);
  const [busy, setBusy] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const item = items[index];

  const loadComments = useCallback(async (id: string) => {
    const res = await fetch(`/api/media/${id}/comments`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setComments(data.comments ?? []);
  }, []);

  useEffect(() => {
    if (!item) return;
    void loadComments(item.id);
  }, [item, loadComments]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(items.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items.length]);

  if (!item) {
    return (
      <div className="p-10 text-center">
        <p className="text-2xl font-bold">사진을 찾을 수 없어요.</p>
        <Link href="/simple" className="big-btn mt-4 bg-rose-500 text-white">돌아가기</Link>
      </div>
    );
  }

  async function toggleLike() {
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${item.id}/like`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setLikes((prev) => ({ ...prev, [item.id]: { liked: data.liked, count: data.likeCount } }));
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (commentText.trim().length === 0) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/media/${item.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentText }),
      });
      const data = await res.json();
      if (res.ok) {
        setComments((prev) => [...prev, data.comment]);
        setCommentText("");
      }
    } finally {
      setBusy(false);
    }
  }

  const like = likes[item.id] ?? { liked: false, count: 0 };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
      onTouchStart={(e) => {
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        if (!touchStart.current) return;
        const dx = e.changedTouches[0].clientX - touchStart.current.x;
        const dy = e.changedTouches[0].clientY - touchStart.current.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          if (dx < 0) setIndex((i) => Math.min(items.length - 1, i + 1));
          else setIndex((i) => Math.max(0, i - 1));
        }
        touchStart.current = null;
      }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Link href="/simple" className="big-btn bg-white/15 px-4 text-lg text-white">
          ✕ 닫기
        </Link>
        <p className="text-lg font-bold">
          {item.childNickname} {item.childName} · {item.ageLabel}
        </p>
        <span className="ml-auto text-lg font-bold text-white/70">
          {index + 1} / {items.length}
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {item.kind === "VIDEO" ? (
          <div className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.thumbUrl} alt="동영상" className="max-h-[62dvh] w-full object-contain" />
            <a href={item.originalUrl} className="big-btn absolute inset-x-8 bottom-4 bg-white/90 text-xl text-slate-900">
              ▶ 원본 동영상 내려받기
            </a>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.previewUrl} alt={item.childName ?? "사진"} className="max-h-[62dvh] w-full object-contain" />
        )}
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="absolute left-2 top-1/2 grid h-16 w-16 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-3xl disabled:opacity-20"
          aria-label="이전 사진"
        >
          ‹
        </button>
        <button
          onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
          disabled={index === items.length - 1}
          className="absolute right-2 top-1/2 grid h-16 w-16 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-3xl disabled:opacity-20"
          aria-label="다음 사진"
        >
          ›
        </button>
      </div>

      <div className="px-4 pb-4">
        <p className="text-base text-white/60">{item.capturedAtLabel}</p>
        <div className="mt-2 flex gap-2">
          <button onClick={toggleLike} disabled={busy} className={`big-btn flex-1 ${like.liked ? "bg-rose-500 text-white" : "bg-white/15 text-white"}`}>
            {like.liked ? "❤️" : "🤍"} 좋아요 {like.count > 0 ? like.count : ""}
          </button>
          <button onClick={() => setShowComments((v) => !v)} className="big-btn flex-1 bg-white/15 text-white">
            💬 댓글 {comments.length > 0 ? comments.length : ""}
          </button>
        </div>

        {showComments && (
          <div id="comments" className="mt-3 max-h-[30dvh] overflow-y-auto rounded-3xl bg-white p-3 text-slate-800">
            {comments.length === 0 && <p className="p-2 text-center text-base text-slate-400">첫 댓글을 남겨보세요.</p>}
            <ul className="space-y-2">
              {comments.map((c) => (
                <li key={c.id} className="rounded-2xl bg-slate-50 px-3 py-2 text-base">
                  <span className="font-bold">{c.author}</span>
                  {c.relation && <span className="ml-1 text-sm text-slate-400">({c.relation})</span>}
                  <p className="text-slate-700">{c.body}</p>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                className="input text-base"
                placeholder="댓글을 입력하세요"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitComment();
                }}
              />
              <button className="big-btn shrink-0 bg-rose-500 px-5 text-lg text-white" onClick={submitComment} disabled={busy}>
                등록
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
