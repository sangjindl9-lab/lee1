import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { agreeChangeAction, proposeChangeAction, signContractAction, stageOrderAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(`/dashboard/contracts/${id}`);

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      request: true,
      quote: { include: { seller: true } },
      stages: { orderBy: { seq: "asc" }, include: { order: true } },
      changes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!contract) notFound();
  const isBuyer = contract.buyerId === actor.id;
  const isSeller = contract.quote.sellerId === actor.sellerProfileId;
  if (!isBuyer && !isSeller) notFound();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={contract.status === "ACTIVE" ? "green" : "amber"}>{contract.status}</Badge>
            <span className="text-[0.6875rem] text-[#8c98aa]">
              {contract.contractNo} · v{contract.version}
            </span>
          </div>
          <h1 className="mt-2 text-[1.25rem] font-black text-[var(--color-navy)]">{contract.request.title}</h1>
          <p className="text-[0.8125rem] text-[#5a6a80]">
            판매자 {contract.quote.seller.displayName} · 총액 {formatKrw(contract.totalAmount)}
          </p>
        </div>
        <Link href={`/requests/${contract.requestId}`} className="btn btn-outline btn-sm">
          의뢰 보기
        </Link>
      </div>

      {(sp.error || sp.ok) && (
        <div className="mt-4">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-4">
        <Notice tone="warn" title="계약서 초안 안내">
          {contract.draftNotice}
        </Notice>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">단계별 진행</h2>
            <ol className="mt-3 space-y-2">
              {contract.stages.map((s) => (
                <li key={s.id} className="rounded-lg border border-[var(--color-line)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-[0.8125rem] font-bold text-[var(--color-navy)]">
                        {s.seq}단계 · {s.title}
                      </span>
                      <div className="text-[0.6875rem] text-[#8c98aa]">{s.deliverables}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[0.8125rem] font-semibold">{formatKrw(s.amountKrw)}</span>
                      <Badge tone={s.status === "SETTLED" ? "green" : s.status === "APPROVED" ? "blue" : "gray"}>
                        {s.status}
                      </Badge>
                    </div>
                  </div>
                  {isBuyer && s.orderId && (
                    <Link href={`/orders/${s.orderId}`} className="mt-2 inline-block text-[0.6875rem] font-semibold text-[var(--color-accent)]">
                      단계 주문 보기 →
                    </Link>
                  )}
                  {isBuyer && !s.orderId && contract.status === "ACTIVE" && (
                    <form action={stageOrderAction} className="mt-2">
                      <input type="hidden" name="stageId" value={s.id} />
                      <button className="btn btn-primary btn-sm" type="submit">
                        이 단계 결제 진행
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          </div>

          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">변경 계약</h2>
            <div className="mt-3 space-y-2">
              {contract.changes.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">변경 제안이 없습니다.</p>}
              {contract.changes.map((c) => (
                <div key={c.id} className="rounded-lg border border-[var(--color-line)] p-3 text-[0.8125rem]">
                  <div className="flex justify-between">
                    <span className="font-semibold">{c.description}</span>
                    <Badge tone={c.status === "AGREED" ? "green" : "amber"}>{c.status}</Badge>
                  </div>
                  <div className="mt-1 text-[0.75rem] text-[#5a6a80]">
                    금액 {c.addedAmount >= 0 ? "+" : ""}
                    {formatKrw(c.addedAmount)} · 기간 +{c.addedDays}일
                  </div>
                  <div className="mt-1 text-[0.6875rem] text-[#8c98aa]">
                    구매자 {c.buyerAgreedAt ? "동의" : "미동의"} · 판매자 {c.sellerAgreedAt ? "동의" : "미동의"}
                  </div>
                  {c.status === "PROPOSED" && (
                    <form action={agreeChangeAction} className="mt-2">
                      <input type="hidden" name="changeId" value={c.id} />
                      <input type="hidden" name="contractId" value={contract.id} />
                      <button className="btn btn-outline btn-sm" type="submit">
                        동의
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
            <form action={proposeChangeAction} className="mt-4 space-y-2 border-t border-[var(--color-line)] pt-3">
              <input type="hidden" name="contractId" value={contract.id} />
              <input name="description" required className="input" placeholder="추가·변경 요구사항" />
              <div className="grid grid-cols-2 gap-2">
                <input name="addedAmount" className="input" inputMode="numeric" placeholder="추가 금액(원)" />
                <input name="addedDays" className="input" inputMode="numeric" placeholder="추가 기간(일)" />
              </div>
              <button className="btn btn-outline" type="submit">
                변경 계약 제안
              </button>
            </form>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <h2 className="text-[0.875rem] font-bold text-[var(--color-navy)]">서명</h2>
            <p className="mt-2 text-[0.75rem] text-[#5a6a80]">
              구매자 {contract.signedByBuyerAt ? "서명 완료" : "미서명"} · 판매자{" "}
              {contract.signedBySellerAt ? "서명 완료" : "미서명"}
            </p>
            {contract.status !== "ACTIVE" && (
              <form action={signContractAction} className="mt-3">
                <input type="hidden" name="contractId" value={contract.id} />
                <button className="btn btn-primary w-full" type="submit">
                  계약서 초안에 서명
                </button>
              </form>
            )}
            <p className="mt-2 text-[0.6875rem] text-[#8c98aa]">
              양측 서명 후 1단계 결제가 가능해집니다. 서명은 계약 버전과 함께 기록됩니다.
            </p>
          </div>
          <div className="card p-4 text-[0.75rem] leading-relaxed text-[#5a6a80]">
            <div className="font-bold text-[var(--color-navy)]">계약 조건</div>
            <p className="mt-2 whitespace-pre-line">{contract.quote.scope}</p>
            <p className="mt-2 text-[0.6875rem]">
              제외: {contract.quote.outOfScope} · 검수 기준: {contract.quote.inspectionCriteria}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
