import Link from "next/link";
import AppShell from "@/components/AppShell";
import AdBanner from "@/components/AdBanner";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertFamily } from "@/lib/page-data";
import { ageLabelAt, ageMonthsAt, kstDateKey } from "@/lib/date";
import { careSummary } from "@/lib/care";
import { toMediaDTO, type MediaWithRelations } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const user = await getSessionUser();
  const familyId = await assertFamily(user);
  const children = await prisma.child.findMany({
    where: { familyId },
    orderBy: { sortOrder: "asc" },
    include: { albums: true },
  });
  const media = (await prisma.mediaAsset.findMany({
    where: { familyId, deletedAt: null },
    include: {
      tags: { include: { tag: true } },
      child: { select: { id: true, name: true, nickname: true, birthDate: true } },
      _count: { select: { likes: true, comments: true } },
    },
    orderBy: [{ capturedAt: "desc" }],
    take: 8,
  })) as MediaWithRelations[];
  const recent = media.map((m) => toMediaDTO(m));
  const care = await careSummary(familyId);
  const today = kstDateKey(new Date());

  const perChild = await Promise.all(
    children.map(async (child) => {
      const [count, latest] = await Promise.all([
        prisma.mediaAsset.count({ where: { childId: child.id, deletedAt: null } }),
        prisma.mediaAsset.findFirst({ where: { childId: child.id, deletedAt: null }, orderBy: { capturedAt: "desc" } }),
      ]);
      return { child, count, latest };
    }),
  );

  return (
    <AppShell active="/app">
      <section className="mb-5 overflow-hidden rounded-3xl bg-gradient-to-br from-rose-500 via-rose-400 to-amber-300 p-6 text-white shadow-lg shadow-rose-200/60">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/80">{user?.familyName ?? "가족"} · {today}</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">{user?.name} 님, 오늘도 수고 많으셨어요.</h1>
        <p className="mt-2 max-w-xl text-sm text-white/90">
          아이 사진은 원본 화질로 보관되고, 가족은 초대만으로 열람할 수 있어요. 오늘 올린 사진과 육아 기록을 한눈에 확인하세요.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/app/upload" className="btn bg-white text-rose-600 hover:bg-rose-50">
            ⬆️ 사진 올리기
          </Link>
          <Link href="/app/search" className="btn bg-white/15 text-white backdrop-blur hover:bg-white/25">
            🔎 예전 사진 찾기
          </Link>
          <Link href="/app/care" className="btn bg-white/15 text-white backdrop-blur hover:bg-white/25">
            🌙 육아기록
          </Link>
        </div>
      </section>

      <div className="mb-5">
        <AdBanner slot="today" />
      </div>

      <section className="mb-6">
        <h2 className="section-title mb-3">우리 아이</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {perChild.map(({ child, count, latest }) => (
            <Link
              key={child.id}
              href={`/app/album/${child.id}`}
              className="card group flex items-center gap-4 p-4 transition hover:-translate-y-0.5"
            >
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-rose-50">
                {latest ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/media/${latest.id}/file?size=thumb`} alt={child.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-2xl">👶</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-slate-900">
                  {child.name} <span className="text-xs font-semibold text-slate-400">{child.nickname}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {ageLabelAt(child.birthDate, new Date())} · 사진 {count}장
                </p>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {latest ? `최근: ${kstDateKey(latest.capturedAt)}` : "아직 사진이 없어요"}
                </p>
              </div>
              <span className="text-slate-300 transition group-hover:text-rose-400">›</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">최근 사진</h2>
            {children[0] && (
              <Link href={`/app/album/${children[0].id}`} className="text-xs font-semibold text-rose-500 hover:underline">
                앨범 전체 보기 →
              </Link>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-400">아직 사진이 없습니다. 첫 사진을 올려보세요.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {recent.slice(0, 8).map((m) => (
                <Link
                  key={m.id}
                  href={`/app/album/${m.childId}?focus=${m.id}`}
                  className="group relative aspect-square overflow-hidden rounded-2xl bg-slate-100"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.thumbUrl} alt={m.fileName} className="h-full w-full object-cover transition group-hover:scale-105" />
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {m.childNickname}
                  </span>
                  {m.kind === "VIDEO" && (
                    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">▶ 동영상</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="section-title mb-3">오늘의 육아기록</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
              <span className="text-slate-500">수면 합계</span>
              <span className="font-bold text-slate-800">{care.todaySleepLabel}</span>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
              <span className="text-slate-500">수유 합계</span>
              <span className="font-bold text-slate-800">{care.todayFeedMl} mL</span>
            </div>
            {care.ongoing.length > 0 && (
              <div className="rounded-2xl bg-indigo-50 px-3 py-2 text-indigo-700">
                🌙 {care.ongoing[0].childNickname ?? ""} {care.ongoing[0].durationLabel}
              </div>
            )}
            {care.ongoing.length === 0 && (
              <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs text-slate-400">진행 중인 수면 기록이 없습니다.</p>
            )}
          </div>
          <Link href="/app/care" className="btn-soft mt-3 w-full">
            기록하러 가기
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { href: "/app/settings", icon: "⚙️", title: "설정 · 광고 제거 상태", desc: "결제 상태 확인, 구매 복원, 문의 접수" },
          { href: "/app/trash", icon: "🗑️", title: "휴지통", desc: "삭제한 사진을 원래 앨범으로 복구" },
          { href: "/simple", icon: "👵", title: "가족 간편 모드 미리보기", desc: "조부모 화면을 그대로 확인" },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="card p-4 transition hover:-translate-y-0.5">
            <p className="text-lg">{item.icon}</p>
            <p className="mt-1 text-sm font-bold text-slate-800">{item.title}</p>
            <p className="text-xs text-slate-500">{item.desc}</p>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}
