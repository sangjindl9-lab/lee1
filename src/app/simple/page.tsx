import Link from "next/link";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ageLabelAt } from "@/lib/date";
import SimpleFeed from "@/components/SimpleFeed";

export const dynamic = "force-dynamic";

export default async function SimpleHome() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "PARENT") {
    // 부모가 미리보기로 들어온 경우에도 간편 모드 화면을 그대로 보여준다.
  }
  const familyId = user.familyId ?? "";
  const rows = await prisma.mediaAsset.findMany({
    where: { familyId, deletedAt: null, visibility: "FAMILY" },
    include: {
      child: { select: { name: true, nickname: true, birthDate: true } },
      likes: { where: { userId: user.id }, select: { id: true } },
      tags: { include: { tag: true } },
      _count: { select: { likes: true, comments: true } },
    },
    orderBy: [{ capturedAt: "desc" }, { createdAt: "desc" }],
    take: 20,
  });

  const items = rows.map((m) => ({
    id: m.id,
    thumbUrl: `/api/media/${m.id}/file?size=preview`,
    childName: m.child?.name ?? null,
    childNickname: m.child?.nickname ?? null,
    ageLabel: m.child ? ageLabelAt(m.child.birthDate, m.capturedAt) : "",
    capturedAtLabel: new Date(m.capturedAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10),
    kind: m.kind,
    likeCount: m._count.likes,
    commentCount: m._count.comments,
    liked: m.likes.length > 0,
    tags: m.tags.map((t) => t.tag.name),
  }));

  const latest = items[0];

  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-gradient-to-br from-rose-400 to-amber-300 p-6 text-white shadow-lg">
        <p className="text-lg font-semibold text-white/80">{user.name} 님, 안녕하세요</p>
        <h1 className="mt-1 text-3xl font-black leading-tight">
          {latest ? `${latest.childNickname} ${latest.childName} 새 사진이 왔어요` : "손주 사진을 모아두는 곳이에요"}
        </h1>
        <p className="mt-2 text-base text-white/85">
          {latest ? `가장 최근 사진 · ${latest.capturedAtLabel}` : "사진이 올라오면 여기에서 바로 볼 수 있어요."}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {latest && (
            <Link href={`/simple/viewer/${latest.id}`} className="big-btn bg-white text-rose-600">
              📷 새 사진 크게 보기
            </Link>
          )}
          <Link href="/simple" className="big-btn bg-white/20 text-white backdrop-blur">
            🔄 새로고침
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-3 px-1 text-2xl font-black text-slate-900">최근 사진 {items.length}장</h2>
        <SimpleFeed items={items} />
      </section>

      <section className="rounded-3xl bg-white p-5 text-center text-base text-slate-500 ring-1 ring-rose-100">
        사진을 한 번 누르면 크게 볼 수 있어요. 좌우로 넘기면 다음 사진으로 넘어갑니다.
      </section>
    </div>
  );
}
