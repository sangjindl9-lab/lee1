import { prisma } from "@/lib/db";
import { requireOperator } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "감사 기록" };

export default async function AdminAuditPage() {
  await requireOperator("REVIEW");
  const logs = await prisma.auditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div>
      <h1 className="text-[1.125rem] font-bold text-[var(--color-navy)]">감사 기록</h1>
      <p className="mt-1 text-[0.75rem] text-[#8c98aa]">
        운영·거래의 주요 작업을 기록합니다. 계좌 변경, 심사, 분쟁 판단, 지급·환불 처리가 포함됩니다.
      </p>
      <div className="card mt-4 overflow-x-auto p-4">
        <table className="w-full min-w-[720px] text-left text-[0.75rem]">
          <thead className="border-b border-[var(--color-line)] text-[0.6875rem] text-[#8c98aa]">
            <tr>
              <th className="py-2">일시</th>
              <th className="py-2">작업</th>
              <th className="py-2">대상</th>
              <th className="py-2">처리자</th>
              <th className="py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id} className="border-b border-[var(--color-line)]">
                <td className="py-2">{l.createdAt.toLocaleString("ko-KR")}</td>
                <td className="py-2 font-medium">{l.action}</td>
                <td className="py-2 text-[#5a6a80]">
                  {l.targetType}/{l.targetId.slice(0, 8)}
                </td>
                <td className="py-2 text-[#5a6a80]">{l.actor?.name ?? "SYSTEM"}</td>
                <td className="py-2 text-[#8c98aa]">{l.ip ?? "-"}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-[#8c98aa]">
                  기록이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
