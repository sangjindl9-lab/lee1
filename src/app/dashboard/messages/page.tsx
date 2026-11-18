import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/session";
import { EmptyState, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "메시지" };

export default async function MessagesPage() {
  const actor = await requireActor("/dashboard/messages");
  const threads = await prisma.messageThread.findMany({
    where: { OR: [{ buyerId: actor.id }, { sellerId: actor.id }] },
    include: {
      order: { include: { product: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <SectionHeading title="메시지" description="거래별 작업실에서 판매자·구매자와 소통합니다." />
      {threads.length === 0 ? (
        <EmptyState title="메시지가 없습니다" description="주문이 생성되면 거래별 대화방이 만들어집니다." />
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Link key={t.id} href={`/dashboard/messages/${t.id}`} className="card block p-4 hover:border-[var(--color-navy)]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">
                  {t.order?.product?.title ?? t.subject}
                </div>
                <span className="text-[0.6875rem] text-[#8c98aa]">{t.createdAt.toLocaleDateString("ko-KR")}</span>
              </div>
              <p className="mt-1 line-clamp-1 text-[0.8125rem] text-[#5a6a80]">
                {t.messages[0]?.body ?? "대화를 시작해 보세요."}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
