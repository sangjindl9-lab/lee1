import { prisma } from "@/lib/db";
import { BRAND } from "@/lib/brand";
import { getCurrentActor } from "@/lib/session";
import { Notice } from "@/components/ui";
import { createTicketAction } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "고객지원" };

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const actor = await getCurrentActor();
  const tickets = actor
    ? await prisma.supportTicket.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "desc" }, take: 10 })
    : [];

  return (
    <div className="container-dv py-10">
      <h1 className="text-[1.75rem] font-black text-[var(--color-navy)]">고객지원</h1>
      <p className="mt-2 text-[0.875rem] text-[#5a6a80]">
        {BRAND.email} · {BRAND.supportHours}
      </p>

      {(sp.error || sp.ok) && (
        <div className="mt-5">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="card p-5">
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">문의 접수</h2>
          {actor ? (
            <form action={createTicketAction} className="mt-3 space-y-3">
              <select name="category" className="input">
                <option value="PAYMENT">결제·환불</option>
                <option value="DELIVERY">납품·다운로드</option>
                <option value="DISPUTE">분쟁·신고</option>
                <option value="SETTLEMENT">정산·세금</option>
                <option value="ACCOUNT">계정·판매자 심사</option>
                <option value="ETC">기타</option>
              </select>
              <input name="title" required className="input" placeholder="제목" />
              <textarea name="body" required className="input h-32" placeholder="상황과 주문번호를 함께 적어 주세요" />
              <button className="btn btn-primary" type="submit">
                문의 접수
              </button>
            </form>
          ) : (
            <p className="mt-3 text-[0.8125rem] text-[#5a6a80]">로그인 후 문의를 접수할 수 있습니다.</p>
          )}

          <div className="mt-6 border-t border-[var(--color-line)] pt-4">
            <h3 className="text-[0.875rem] font-bold text-[var(--color-navy)]">내 문의</h3>
            <ul className="mt-2 space-y-2">
              {tickets.length === 0 && <li className="text-[0.8125rem] text-[#8c98aa]">접수된 문의가 없습니다.</li>}
              {tickets.map((t) => (
                <li key={t.id} className="rounded-lg border border-[var(--color-line)] p-3 text-[0.8125rem]">
                  <div className="flex justify-between">
                    <span className="font-semibold">{t.title}</span>
                    <span className="text-[0.6875rem] text-[#8c98aa]">{t.status}</span>
                  </div>
                  <p className="mt-1 text-[0.75rem] text-[#5a6a80]">{t.body}</p>
                  {t.answer && <p className="mt-2 rounded bg-[var(--color-tint)] p-2 text-[0.75rem]">답변: {t.answer}</p>}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          {[
            {
              q: "다운로드가 안 됩니다",
              a: "결제 완료 상태인지, 환불·분쟁으로 링크가 회수되지 않았는지 확인해 주세요. 링크는 10분간 최대 3회 사용할 수 있으며, 만료되면 다시 발급하면 됩니다.",
            },
            {
              q: "환불은 언제 되나요?",
              a: "환불 요청 접수와 실제 환불 완료는 다릅니다. 정산 담당자가 결제사업자 취소 성공을 확인한 뒤 완료로 표시됩니다. 부분 환불을 지원하지 않는 결제수단은 전액 환불 후 재결제 등 대체 절차를 안내합니다.",
            },
            {
              q: "이미 정산된 거래도 환불되나요?",
              a: "일반 보류 절차로 되돌리지 않습니다. 사후 환수 검토 절차로 접수되어 정산 담당자가 별도로 처리합니다.",
            },
            {
              q: "검수 기간은 얼마인가요?",
              a: "상품별로 판매자가 설정한 기간(기본 7일)이며, 결제 시 주문에 고정됩니다. 결제수단의 자동확정 예정일이 검수 기간보다 짧으면 결제가 차단됩니다.",
            },
          ].map((f) => (
            <div key={f.q} className="card p-4">
              <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">{f.q}</div>
              <p className="mt-1 text-[0.8125rem] leading-relaxed text-[#5a6a80]">{f.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
