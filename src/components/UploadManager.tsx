"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ChildInfo = {
  id: string;
  name: string;
  nickname: string;
  albums: Array<{ id: string; name: string; visibility: string }>;
};
type MemberInfo = { id: string; name: string; relation: string | null; role: string };

type UploadStatus = "PENDING" | "UPLOADING" | "DONE" | "FAILED";

type Row = {
  clientFileId: string;
  itemId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: UploadStatus;
  error?: string | null;
  mediaId?: string | null;
  duplicate?: boolean;
  attempts?: number;
  failOnce?: boolean;
  file?: File | null;
};

type SessionSummary = { total: number; done: number; failed: number; pending: number; duplicates: number; text: string };

type LatestSession = {
  session: {
    id: string;
    childId: string;
    childName: string | null;
    albumId: string;
    albumName: string | null;
    visibility: string;
    status: string;
    totalFiles: number;
    summary: SessionSummary | null;
    createdAt: string;
  };
  items: Array<{
    id: string;
    clientFileId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    status: UploadStatus;
    mediaId: string | null;
    duplicate: boolean;
    error: string | null;
    attempts: number;
  }>;
};

const STATUS_STYLE: Record<UploadStatus, string> = {
  PENDING: "bg-slate-100 text-slate-500",
  UPLOADING: "bg-amber-100 text-amber-700",
  DONE: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-600",
};
const STATUS_LABEL: Record<UploadStatus, string> = {
  PENDING: "대기",
  UPLOADING: "전송 중",
  DONE: "완료",
  FAILED: "실패",
};

type SendResult = { ok: boolean; mediaId?: string | null; duplicate?: boolean; message?: string };

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 서버 경유 업로드 (저장소 직접 업로드가 안 될 때의 대체 경로) */
async function sendProxy(sid: string, row: { itemId?: string; fileName: string }, file: File, capturedAt: string, simulateFail = false): Promise<SendResult> {
  const form = new FormData();
  form.append("file", file, row.fileName);
  form.append("capturedAt", capturedAt);
  const headers: Record<string, string> = {};
  if (simulateFail) headers["x-simulate-fail"] = "1";
  const res = await fetch(`/api/uploads/${sid}/items/${row.itemId}`, { method: "POST", body: form, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, message: data?.error?.message };
  return { ok: true, mediaId: data.item?.mediaId, duplicate: data.item?.duplicate };
}

/**
 * 저장소로 바로 올린다: 서버에 허가(용량 확인·서명 주소)를 받고 → 저장소에 PUT → 완료 알림.
 * 사진 바이트가 서버를 거치지 않아 서버 전송 비용이 들지 않는다. 직접 업로드가 막히면 서버 경유로 다시 시도한다.
 */
async function sendDirectOrProxy(sid: string, row: { itemId?: string; fileName: string; mimeType: string }, file: File, capturedAt: string): Promise<SendResult> {
  let contentHash = "";
  try {
    contentHash = await sha256Hex(file);
  } catch {
    return sendProxy(sid, row, file, capturedAt);
  }
  const prep = await fetch(`/api/uploads/${sid}/items/${row.itemId}/direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentHash, sizeBytes: file.size, mimeType: file.type || row.mimeType, fileName: row.fileName, capturedAt }),
  });
  const plan = await prep.json().catch(() => ({}));
  if (!prep.ok) return { ok: false, message: plan?.error?.message };
  if (plan.mode === "duplicate") return { ok: true, mediaId: plan.mediaId, duplicate: true };
  if (plan.mode !== "direct" || !plan.url) return sendProxy(sid, row, file, capturedAt);
  try {
    const put = await fetch(plan.url, { method: "PUT", body: file, headers: plan.headers ?? {} });
    if (!put.ok) throw new Error(`PUT ${put.status}`);
  } catch {
    if (file.size <= 60 * 1024 * 1024) return sendProxy(sid, row, file, capturedAt);
    return { ok: false, message: "저장소에 올리지 못했습니다. 연결을 확인하고 다시 시도해 주세요." };
  }
  const done = await fetch(`/api/uploads/${sid}/items/${row.itemId}/complete`, { method: "POST" });
  const data = await done.json().catch(() => ({}));
  if (!done.ok) return { ok: false, message: data?.error?.message };
  return { ok: true, mediaId: data.item?.mediaId, duplicate: false };
}

let counter = 0;
const newClientId = () => `c${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export default function UploadManager({
  children,
  members,
  defaultChildId,
}: {
  children: ChildInfo[];
  members: MemberInfo[];
  defaultChildId?: string;
}) {
  const [childId, setChildId] = useState(defaultChildId ?? children[0]?.id ?? "");
  const [albumId, setAlbumId] = useState("");
  const [visibility, setVisibility] = useState("FAMILY");
  const [rows, setRows] = useState<Row[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedChild = children.find((c) => c.id === childId);
  const album = selectedChild?.albums.find((a) => a.id === albumId) ?? selectedChild?.albums[0];

  /** 앱 재실행 복원: 서버에 남아 있는 최근 세션 + 기기에 보관한 파일 */
  const restoreSession = useCallback(async () => {
    const res = await fetch("/api/uploads/latest", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { latest: LatestSession | null };
    if (!data.latest) return;
    const { session, items } = data.latest;
    if (session.status === "COMPLETED" && items.every((i) => i.status === "DONE")) {
      setRestored(false);
      return;
    }
    const { loadUploadFile } = await import("@/lib/idb");
    const restoredRows: Row[] = await Promise.all(
      items.map(async (item) => {
        const file = item.status === "DONE" ? null : await loadUploadFile(`${session.id}:${item.clientFileId}`);
        return {
          clientFileId: item.clientFileId,
          itemId: item.id,
          fileName: item.fileName,
          mimeType: item.mimeType,
          sizeBytes: item.sizeBytes,
          status: item.status,
          mediaId: item.mediaId,
          duplicate: item.duplicate,
          error: item.error,
          attempts: item.attempts,
          file,
        };
      }),
    );
    setSessionId(session.id);
    setChildId(session.childId);
    setAlbumId(session.albumId);
    setVisibility(session.visibility);
    setRows(restoredRows);
    setSummary(session.summary);
    setRestored(true);
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (!selectedChild) return;
    setAlbumId((prev) => (selectedChild.albums.some((a) => a.id === prev) ? prev : selectedChild.albums[0]?.id ?? ""));
  }, [selectedChild]);

  const stats = useMemo(() => {
    const done = rows.filter((r) => r.status === "DONE").length;
    const failed = rows.filter((r) => r.status === "FAILED").length;
    const pending = rows.filter((r) => r.status === "PENDING" || r.status === "UPLOADING").length;
    const duplicates = rows.filter((r) => r.status === "DONE" && r.duplicate).length;
    return { done, failed, pending, duplicates, total: rows.length };
  }, [rows]);

  const totalBytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const created: Row[] = list.map((file, index) => ({
      clientFileId: newClientId(),
      fileName: file.name,
      mimeType: file.type || (file.name.endsWith(".mp4") ? "video/mp4" : "application/octet-stream"),
      sizeBytes: file.size,
      status: "PENDING",
      file,
      failOnce: simulate && (rows.length + index) % 33 === 32,
    }));
    setRows((prev) => [...prev, ...created]);
    setSummary(null);
  }

  async function generateTestFiles(count = 100) {
    setBusy(true);
    try {
      const { saveUploadFile } = await import("@/lib/idb");
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      const created: Row[] = [];
      for (let i = 1; i <= count; i += 1) {
        if (ctx) {
          const hue = (i * 137) % 360;
          const grad = ctx.createLinearGradient(0, 0, 640, 480);
          grad.addColorStop(0, `hsl(${hue}, 80%, 88%)`);
          grad.addColorStop(1, `hsl(${(hue + 60) % 360}, 70%, 72%)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = "#1f2937";
          ctx.font = "bold 64px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(`테스트 ${i}`, 320, 230);
          ctx.font = "28px sans-serif";
          ctx.fillText(new Date().toISOString().slice(0, 10), 320, 280);
        }
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
        if (!blob) continue;
        const file = new File([blob], `테스트사진_${String(i).padStart(3, "0")}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        const clientFileId = newClientId();
        created.push({
          clientFileId,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          status: "PENDING",
          file,
          failOnce: simulate && created.length % 33 === 32,
        });
        void saveUploadFile(`staged:${clientFileId}`, file);
      }
      // 동영상 1개 (자리표시자 바이트)
      const videoBytes = new Uint8Array(256 * 1024);
      videoBytes.set([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], 0);
      for (let i = 8; i < videoBytes.length; i += 1) videoBytes[i] = (i * 31) % 256;
      const video = new File([videoBytes], `테스트영상_${new Date().toISOString().slice(0, 10)}.mp4`, {
        type: "video/mp4",
        lastModified: Date.now(),
      });
      const videoId = newClientId();
      created.push({
        clientFileId: videoId,
        fileName: video.name,
        mimeType: video.type,
        sizeBytes: video.size,
        status: "PENDING",
        file: video,
        failOnce: simulate && created.length % 33 === 32,
      });
      void saveUploadFile(`staged:${videoId}`, video);
      setRows((prev) => [...prev, ...created]);
      setSummary(null);
      setNotice(`테스트 파일 ${created.length}개(사진 ${count}장 + 동영상 1개)를 준비했습니다.`);
    } finally {
      setBusy(false);
    }
  }

  async function beginUpload() {
    if (!album || !rows.length) return;
    setShowConfirm(false);
    setBusy(true);
    try {
      const { saveUploadFile } = await import("@/lib/idb");
      const res = await fetch("/api/uploads/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          childId,
          albumId: album.id,
          visibility,
          files: rows.map((r) => ({
            clientFileId: r.clientFileId,
            fileName: r.fileName,
            mimeType: r.mimeType,
            sizeBytes: r.sizeBytes,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "업로드 세션을 만들지 못했습니다.");
      const id: string = data.session.id;
      setSessionId(id);
      const withIds: Row[] = rows.map((r) => {
        const serverItem = (data.items as Array<{ id: string; clientFileId: string }>).find((i) => i.clientFileId === r.clientFileId);
        return { ...r, itemId: serverItem?.id, status: "PENDING" as UploadStatus, attempts: 0 };
      });
      setRows(withIds);
      await Promise.all(
        withIds.map(async (r) => {
          if (!r.file) return;
          const ok = await saveUploadFile(`${id}:${r.clientFileId}`, r.file);
          if (ok) {
            const { deleteUploadFile } = await import("@/lib/idb");
            await deleteUploadFile(`staged:${r.clientFileId}`);
          }
        }),
      );
      await runQueue(withIds, id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "업로드를 시작하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const runQueue = useCallback(
    async (targets: Row[], sid: string) => {
      const queue = targets.filter((r) => r.file);
      if (!queue.length) {
        setNotice("재시도할 파일이 기기에 남아 있지 않습니다. 파일을 다시 선택해 주세요.");
        return;
      }
      let cursor = 0;
      const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (cursor < queue.length) {
          const row = queue[cursor];
          cursor += 1;
          setRows((prev) =>
            prev.map((r) => (r.clientFileId === row.clientFileId ? { ...r, status: "UPLOADING", error: null } : r)),
          );
          try {
            const file = row.file as File;
            const capturedAt = new Date(file.lastModified || Date.now()).toISOString();
            const simulate = row.failOnce && (row.attempts ?? 0) === 0;
            const data = simulate ? await sendProxy(sid, row, file, capturedAt, true) : await sendDirectOrProxy(sid, row, file, capturedAt);
            if (!data.ok) {
              setRows((prev) =>
                prev.map((r) =>
                  r.clientFileId === row.clientFileId
                    ? { ...r, status: "FAILED", error: data.message ?? "전송에 실패했습니다.", attempts: (r.attempts ?? 0) + 1 }
                    : r,
                ),
              );
            } else {
              setRows((prev) =>
                prev.map((r) =>
                  r.clientFileId === row.clientFileId
                    ? {
                        ...r,
                        status: "DONE",
                        mediaId: data.mediaId,
                        duplicate: data.duplicate,
                        error: null,
                        attempts: (r.attempts ?? 0) + 1,
                      }
                    : r,
                ),
              );
              const { deleteUploadFile } = await import("@/lib/idb");
              await deleteUploadFile(`${sid}:${row.clientFileId}`);
            }
          } catch {
            setRows((prev) =>
              prev.map((r) =>
                r.clientFileId === row.clientFileId
                  ? { ...r, status: "FAILED", error: "네트워크 연결이 끊겼습니다.", attempts: (r.attempts ?? 0) + 1 }
                  : r,
              ),
            );
          }
        }
      });
      await Promise.all(workers);
      const sum = await fetch(`/api/uploads/${sid}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => d.summary as SessionSummary)
        .catch(() => null);
      if (sum) setSummary(sum);
    },
    [],
  );

  async function retryFailed() {
    if (!sessionId) return;
    setBusy(true);
    setNotice(null);
    const failed = rows.filter((r) => r.status === "FAILED" && r.file);
    if (!failed.length) {
      setNotice("재시도할 파일이 기기에 남아 있지 않습니다. 파일을 다시 선택해 주세요.");
      setBusy(false);
      return;
    }
    await runQueue(failed, sessionId);
    setBusy(false);
  }

  const missingFiles = rows.filter((r) => r.status === "FAILED" && !r.file).length;

  return (
    <div className="space-y-4">
      {restored && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
          이전 업로드 세션을 복원했습니다. 완료 {stats.done}개 · 실패 {stats.failed}개 · 대기 {stats.pending}개
          {missingFiles > 0 ? ` (기기에 없는 파일 ${missingFiles}개는 다시 선택해 주세요)` : ""}
        </div>
      )}

      <section className="card p-5">
        <h2 className="section-title mb-1">1. 어느 아이 앨범에 올릴까요?</h2>
        <p className="mb-3 text-xs text-slate-500">아이가 둘 이상이면 업로드 전에 대상 아이와 공유 가족을 꼭 확인하세요.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="child">
              아이
            </label>
            <select id="child" className="input" value={childId} onChange={(e) => setChildId(e.target.value)}>
              {children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.nickname})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="album">
              앨범
            </label>
            <select id="album" className="input" value={album?.id ?? ""} onChange={(e) => setAlbumId(e.target.value)}>
              {selectedChild?.albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="visibility">
              공개 범위
            </label>
            <select id="visibility" className="input" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="FAMILY">가족 전체 공개 (초대된 가족 전원)</option>
              <option value="PARENTS_ONLY">부모만 공개</option>
              <option value="PRIVATE">나만 보기</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="section-title">2. 사진·동영상 선택</h2>
            <p className="text-xs text-slate-500">한 번에 여러 장을 선택하면 파일마다 진행 상태를 보여줍니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-soft" onClick={() => fileInput.current?.click()}>
              📁 파일 선택
            </button>
            <button className="btn-ghost" onClick={() => generateTestFiles(100)} disabled={busy}>
              테스트 100장 + 동영상 만들기
            </button>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} className="h-4 w-4 accent-rose-500" />
          일부 전송 실패 시뮬레이션 (테스트용 · 33번째 파일마다 첫 시도 실패)
        </label>
        {notice && <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">{notice}</p>}
      </section>

      {rows.length > 0 && (
        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">
              업로드 목록 <span className="text-sm font-semibold text-slate-400">{rows.length}개 · {(totalBytes / 1024 / 1024).toFixed(1)}MB</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {!sessionId && (
                <button className="btn-primary" onClick={() => setShowConfirm(true)} disabled={busy || !rows.length}>
                  업로드 시작
                </button>
              )}
              {stats.failed > 0 && (
                <button className="btn-dark" onClick={retryFailed} disabled={busy}>
                  🔁 실패한 항목만 다시 올리기 ({stats.failed})
                </button>
              )}
              {sessionId && stats.pending === 0 && stats.failed === 0 && (
                <a className="btn-soft" href={`/app/album/${childId}`}>
                  앨범에서 확인 →
                </a>
              )}
            </div>
          </div>

          <div className="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-400 to-rose-600 transition-all"
              style={{ width: `${rows.length ? Math.round((stats.done / rows.length) * 100) : 0}%` }}
            />
          </div>
          <div className="mb-3 grid grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded-xl bg-slate-50 py-2">
              <p className="font-bold text-slate-700">{stats.total}</p>
              <p className="text-slate-400">전체</p>
            </div>
            <div className="rounded-xl bg-emerald-50 py-2">
              <p className="font-bold text-emerald-700">{stats.done}</p>
              <p className="text-emerald-500">완료</p>
            </div>
            <div className="rounded-xl bg-red-50 py-2">
              <p className="font-bold text-red-600">{stats.failed}</p>
              <p className="text-red-400">실패</p>
            </div>
            <div className="rounded-xl bg-amber-50 py-2">
              <p className="font-bold text-amber-700">{stats.pending}</p>
              <p className="text-amber-500">대기/전송중</p>
            </div>
          </div>

          <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {rows.map((row) => (
              <li key={row.clientFileId} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs hover:bg-slate-50">
                <span className={`w-14 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-bold ${STATUS_STYLE[row.status]}`}>
                  {STATUS_LABEL[row.status]}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{row.fileName}</span>
                {row.duplicate && <span className="shrink-0 text-[10px] font-bold text-amber-600">중복→기존 항목</span>}
                {row.error && <span className="max-w-[45%] shrink-0 truncate text-[10px] text-red-500">{row.error}</span>}
                {(row.mediaId || row.status === "DONE") && (
                  <a
                    className="shrink-0 text-[10px] font-bold text-rose-500 hover:underline"
                    href={`/api/media/${row.mediaId}/file?size=thumb`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    보기
                  </a>
                )}
              </li>
            ))}
          </ul>

          {summary && (
            <div
              data-testid="upload-summary"
              className={`mt-3 rounded-2xl px-4 py-3 text-sm font-bold ${
                summary.failed > 0 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {summary.text}
              {summary.duplicates > 0 && (
                <span className="ml-1 text-xs font-semibold text-amber-700">
                  · 이미 저장된 {summary.duplicates}개는 새로 등록하지 않았습니다.
                </span>
              )}
            </div>
          )}
        </section>
      )}

      {showConfirm && album && selectedChild && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3" onClick={() => setShowConfirm(false)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">업로드 전 확인</h3>
            <p className="mt-1 text-xs text-slate-500">대상 아이와 공유 범위를 확인해 주세요.</p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">대상 아이</dt>
                <dd className="font-bold text-slate-800">
                  {selectedChild.name} ({selectedChild.nickname})
                </dd>
              </div>
              <div className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">앨범</dt>
                <dd className="font-bold text-slate-800">{album.name}</dd>
              </div>
              <div className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">공개 범위</dt>
                <dd className="font-bold text-slate-800">
                  {visibility === "FAMILY" ? "가족 전체 공개" : visibility === "PARENTS_ONLY" ? "부모만 공개" : "나만 보기"}
                </dd>
              </div>
              <div className="rounded-xl bg-rose-50 px-3 py-2">
                <dt className="text-xs font-semibold text-rose-500">이 앨범을 볼 수 있는 가족</dt>
                <dd className="mt-0.5 text-xs text-slate-700">
                  {visibility === "PRIVATE"
                    ? "나만 볼 수 있습니다."
                    : members
                        .filter((m) => (visibility === "PARENTS_ONLY" ? m.role === "PARENT" : true))
                        .map((m) => `${m.name}${m.relation ? `(${m.relation})` : ""}`)
                        .join(", ")}
                </dd>
              </div>
              <div className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
                <dt className="text-slate-500">파일</dt>
                <dd className="font-bold text-slate-800">
                  {rows.length}개 · {(totalBytes / 1024 / 1024).toFixed(1)}MB
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setShowConfirm(false)}>
                취소
              </button>
              <button className="btn-primary flex-1" onClick={beginUpload}>
                확인하고 업로드
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
