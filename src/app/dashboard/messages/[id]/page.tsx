import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActor } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { sendMessageAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(`/dashboard/messages/${id}`);
  const thread = await prisma.messageThread.findUnique({
    where: { id },
    include: {
      order: { include: { product: true } },
      messages: { include: { sender: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!thread) notFound();
  if (thread.buyerId !== actor.id && thread.sellerId !== actor.id) notFound();

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[1.125rem] font-bold text-[var(--color-navy)]">
            {thread.order?.product?.title ?? thread.subject}
          </h1>
          <p className="text-[0.6875rem] text-[#8c98aa]">거래별 작업실 대화</p>
        </div>
        {thread.orderId && (
          <Link href={`/orders/${thread.orderId}`} className="btn btn-outline btn-sm">
            거래 보기
          </Link>
        )}
      </div>

      {sp.error && (
        <div className="mb-3">
          <Notice tone="danger">{sp.error}</Notice>
        </div>
      )}

      <div className="card p-4">
        <ul className="space-y-3">
          {thread.messages.map((m) => {
            const mine = m.senderId === actor.id;
            return (
              <li key={m.id} className={mine ? "text-right" : ""}>
                <div className="text-[0.6875rem] text-[#8c98aa]">
                  {m.sender.name} · {m.createdAt.toLocaleString("ko-KR")}
                </div>
                <div
                  className={`mt-1 inline-block max-w-[80%] rounded-lg px-3 py-2 text-left text-[0.8125rem] ${
                    mine ? "bg-[var(--color-navy)] text-white" : "bg-[var(--color-tint)] text-[#3c4a60]"
                  }`}
                >
                  {m.body}
                </div>
              </li>
            );
          })}
          {thread.messages.length === 0 && (
            <li className="text-[0.8125rem] text-[#8c98aa]">아직 메시지가 없습니다. 거래 조건을 확인해 보세요.</li>
          )}
        </ul>

        <form action={sendMessageAction} className="mt-5 flex gap-2 border-t border-[var(--color-line)] pt-4">
          <input type="hidden" name="threadId" value={thread.id} />
          <input type="hidden" name="back" value={`/dashboard/messages/${thread.id}`} />
          <input name="body" required className="input" placeholder="메시지를 입력하세요" />
          <button className="btn btn-primary shrink-0" type="submit">
            보내기
          </button>
        </form>
        <p className="mt-2 text-[0.6875rem] text-[#8c98aa]">
          <Badge tone="gray">기록 보관</Badge> 메시지는 분쟁 시 양측 자료로 사용될 수 있습니다.
        </p>
      </div>
    </div>
  );
}
