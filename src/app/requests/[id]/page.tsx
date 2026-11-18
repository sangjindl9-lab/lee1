import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { getCurrentActor } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { selectQuoteAction, submitQuoteAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function RequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await getCurrentActor();
  const request = await prisma.devRequest.findUnique({
    where: { id },
    include: {
      quotes: { include: { seller: true, contract: true }, orderBy: { createdAt: "desc" } },
      contract: true,
    },
  });
  if (!request) notFound();
  if (request.visibility === "PRIVATE" && request.buyerId !== actor?.id) notFound();

  const isOwner = actor?.id === request.buyerId;
  const isSeller = !!actor?.sellerProfileId;

  return (
    <div className="container-dv py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone="amber">{request.status}</Badge>
            <Badge tone={request.visibility === "PRIVATE" ? "gray" : "blue"}>
              {request.visibility === "PRIVATE" ? "비공개" : "공개"}
            </Badge>
            <span className="text-[0.6875rem] text-[#8c98aa]">{request.requestNo}</span>
          </div>
          <h1 className="mt-2 text-[1.5rem] font-black text-[var(--color-navy)]">{request.title}</h1>
          <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">
            예산 {request.budgetKrw ? formatKrw(request.budgetKrw) : "협의"} · 납기 {request.deadline ?? "협의"} ·
            공개일 {request.createdAt.toLocaleDateString("ko-KR")}
          </p>
        </div>
        {request.contract && isOwner && (
          <Link href={`/dashboard/contracts/${request.contract.id}`} className="btn btn-primary btn-sm">
            계약 보기
          </Link>
        )}
      </div>

      {(sp.error || sp.ok) && (
        <div className="mt-4">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">의뢰 내용</h2>
            <dl className="mt-3 space-y-3 text-[0.875rem] leading-relaxed">
              <div>
                <dt className="text-[0.6875rem] text-[#8c98aa]">개발 목적</dt>
                <dd className="whitespace-pre-line">{request.purpose}</dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] text-[#8c98aa]">기능 요구사항</dt>
                <dd className="whitespace-pre-line">{request.features}</dd>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Detail k="실행 환경" v={request.environment} />
                <Detail k="소스 조건" v={request.sourceCondition ?? "-"} />
                <Detail k="권리 귀속" v={request.rights ?? "-"} />
                <Detail k="유지보수" v={request.maintenance ?? "-"} />
              </div>
            </dl>
          </div>

          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">견적 {request.quotes.length}건</h2>
            <div className="mt-3 space-y-3">
              {request.quotes.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">아직 견적이 없습니다.</p>}
              {request.quotes.map((q) => {
                const milestones = q.milestones as Array<{ title: string; amountKrw: number; deliverables: string }>;
                return (
                  <div key={q.id} className="rounded-lg border border-[var(--color-line)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">
                        {q.seller.displayName}
                        {q.status === "SELECTED" && <Badge tone="green">선택됨</Badge>}
                      </div>
                      <div className="text-[1rem] font-extrabold text-[var(--color-navy)]">{formatKrw(q.totalAmount)}</div>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-[0.8125rem] text-[#3c4a60]">{q.scope}</p>
                    <div className="mt-2 text-[0.75rem] text-[#5a6a80]">제외: {q.outOfScope || "-"}</div>
                    <ol className="mt-3 space-y-1">
                      {milestones.map((m, i) => (
                        <li key={i} className="flex justify-between rounded bg-[var(--color-tint)] px-2 py-1 text-[0.75rem]">
                          <span>
                            {i + 1}단계 · {m.title}
                          </span>
                          <span>{formatKrw(m.amountKrw)}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-2 text-[0.6875rem] text-[#8c98aa]">검수 기준: {q.inspectionCriteria}</div>
                    {isOwner && q.status === "SUBMITTED" && (
                      <form action={selectQuoteAction} className="mt-3">
                        <input type="hidden" name="quoteId" value={q.id} />
                        <input type="hidden" name="back" value={`/requests/${request.id}`} />
                        <button className="btn btn-primary btn-sm" type="submit">
                          이 견적 선택하고 계약 생성
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside>
          {isSeller && request.status !== "CONTRACTED" && request.status !== "CLOSED" && (
            <form action={submitQuoteAction} className="card space-y-2 p-4">
              <input type="hidden" name="requestId" value={request.id} />
              <h2 className="text-[0.875rem] font-bold text-[var(--color-navy)]">견적 제출</h2>
              <textarea name="scope" required className="input h-20" placeholder="작업 범위" />
              <textarea name="outOfScope" className="input h-16" placeholder="제외 범위" />
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded border border-[var(--color-line)] p-2">
                  <div className="text-[0.6875rem] font-semibold text-[#8c98aa]">{i}단계</div>
                  <input name="stageTitle" className="input mb-1" placeholder="단계명 (예: 요구사항·화면 설계)" />
                  <input name="stageDeliverables" className="input mb-1" placeholder="산출물" />
                  <input name="stageAmount" className="input" inputMode="numeric" placeholder="금액(원)" />
                </div>
              ))}
              <textarea name="inspectionCriteria" required className="input h-16" placeholder="검수 기준" />
              <input name="support" className="input" placeholder="지원 조건(선택)" />
              <button className="btn btn-primary" type="submit">
                견적 제출
              </button>
              <p className="text-[0.6875rem] text-[#8c98aa]">
                금액이 0인 단계는 계약 단계에 포함되지만 결제 대상이 아닙니다. 전체 견적은 단계 합계로 계산됩니다.
              </p>
            </form>
          )}
          <div className="card mt-4 p-4 text-[0.75rem] leading-relaxed text-[#5a6a80]">
            <div className="font-bold text-[var(--color-navy)]">단계별 안전거래</div>
            <p className="mt-2">
              조건 확정 → 단계 결제 → 작업 → 납품 → 검수 → 승인·수정 요청 → 정산 순서로 진행됩니다. 현재 단계의
              결제가 확인된 뒤 작업을 시작하며, 화면 캡처나 시연 영상만으로 소스 납품을 완료 처리하지 않습니다.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] text-[#8c98aa]">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
