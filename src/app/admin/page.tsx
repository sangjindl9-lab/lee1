import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireOperator } from "@/lib/session";
import { settlementSummary } from "@/server/services/reconciliation";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "운영 현황" };

export default async function AdminHome() {
  await requireOperator("REVIEW");
  const [summary, statusCounts, pendingProducts, openDisputes, pendingSellers, recentAudit] = await Promise.all([
    settlementSummary(),
    prisma.order.groupBy({ by: ["paymentStatus"], _count: true }),
    prisma.product.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.dispute.count({ where: { status: { in: ["OPEN", "EVIDENCE", "NEGOTIATION"] } } }),
    prisma.sellerProfile.count({ where: { status: "PENDING" } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="총 거래액(결제 기준)" value={formatKrw(summary.grossTotal)} />
        <Stat label="플랫폼 수수료 수익" value={formatKrw(summary.platformRevenue)} note="수수료 + 부가세" />
        <Stat label="판매자 지급 누계" value={formatKrw(summary.payoutTotal)} />
        <Stat label="환불 누계" value={formatKrw(summary.refundTotal)} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Link href="/admin/products" className="card p-4 hover:border-[var(--color-navy)]">
          <div className="text-[0.6875rem] text-[#8c98aa]">심사 대기 상품</div>
          <div className="text-[1.25rem] font-extrabold text-[var(--color-navy)]">{pendingProducts}건</div>
        </Link>
        <Link href="/admin/disputes" className="card p-4 hover:border-[var(--color-navy)]">
          <div className="text-[0.6875rem] text-[#8c98aa]">진행 중 분쟁</div>
          <div className="text-[1.25rem] font-extrabold text-[var(--color-navy)]">{openDisputes}건</div>
        </Link>
        <Link href="/admin/sellers" className="card p-4 hover:border-[var(--color-navy)]">
          <div className="text-[0.6875rem] text-[#8c98aa]">판매자 심사 대기</div>
          <div className="text-[1.25rem] font-extrabold text-[var(--color-navy)]">{pendingSellers}명</div>
        </Link>
      </div>

      <div className="card mt-4 p-4">
        <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">결제 상태 분포</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {statusCounts.map((s) => (
            <Badge key={s.paymentStatus} tone={s.paymentStatus === "PAID" ? "green" : "gray"}>
              {s.paymentStatus} {s._count}
            </Badge>
          ))}
        </div>
        <p className="mt-3 text-[0.6875rem] text-[#8c98aa]">
          총 거래액과 플랫폼 수수료 수익을 구분해 표시합니다. 대사 결과는 &lsquo;대사&rsquo; 메뉴에서 확인합니다.
        </p>
      </div>

      <div className="card mt-4 p-4">
        <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">최근 감사 기록</div>
        <ul className="mt-2 space-y-1 text-[0.75rem] text-[#5a6a80]">
          {recentAudit.map((a) => (
            <li key={a.id}>
              · {a.createdAt.toLocaleString("ko-KR")} · {a.action} · {a.targetType}/{a.targetId.slice(0, 8)} ·{" "}
              {a.actorRole ?? "SYSTEM"}
            </li>
          ))}
          {recentAudit.length === 0 && <li>기록이 없습니다.</li>}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[0.6875rem] text-[#8c98aa]">{label}</div>
      <div className="text-[1.125rem] font-extrabold text-[var(--color-navy)]">{value}</div>
      {note && <div className="text-[0.625rem] text-[#8c98aa]">{note}</div>}
    </div>
  );
}
