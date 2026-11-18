import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw, computeFees } from "@/lib/money";
import { BRAND, ESCROW_NOTICE, WITHDRAWAL_CONSENT_TEXT } from "@/lib/brand";
import { getCurrentActor } from "@/lib/session";
import { resolveFeePolicy, sellerWithholdingRateBp } from "@/server/services/fee-policy";
import { Badge, Notice } from "@/components/ui";
import { createOrderAction, toggleFavoriteAction, askQuestionAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await getCurrentActor();

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      seller: true,
      files: { orderBy: { version: "desc" } },
      questions: { orderBy: { createdAt: "desc" }, take: 20 },
      reviews: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!product) notFound();

  const policy = await resolveFeePolicy({ sellerId: product.sellerId, category: product.category });
  const fees = computeFees({
    grossAmount: product.priceKrw,
    commissionRateBp: policy.commissionRateBp,
    paymentFeeRateBp: policy.paymentFeeRateBp,
    paymentFeeBearer: policy.paymentFeeBearer,
    sellerType: product.seller.sellerType,
    withholdingRateBp: sellerWithholdingRateBp(product.seller.sellerType),
    discountRateBp: policy.discountRateBp,
  });
  const favorited = actor
    ? !!(await prisma.favorite.findUnique({
        where: { userId_productId: { userId: actor.id, productId: product.id } },
      }))
    : false;

  const isOwner = actor?.sellerProfileId === product.sellerId;

  return (
    <div className="container-dv py-9">
      {(sp.error || sp.ok) && (
        <div className="mb-5">
          {sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}
        </div>
      )}

      <nav className="mb-4 text-[0.75rem] text-[#8c98aa]">
        <Link href="/">홈</Link> ·{" "}
        <Link href={product.type === "SOURCE" ? "/sources" : "/solutions"}>
          {product.type === "SOURCE" ? "소스코드 마켓" : "솔루션 마켓"}
        </Link>{" "}
        · <span className="text-[#5a6a80]">{product.category}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={product.type === "SOURCE" ? "blue" : "navy"}>
              {product.type === "SOURCE" ? "소스코드 구매" : "완성형 사용권"}
            </Badge>
            <Badge tone="gray">{product.category}</Badge>
            {product.status !== "ACTIVE" && <Badge tone="amber">판매 중지 또는 심사 중</Badge>}
            {product.licenseType === "PERIOD" ? (
              <Badge tone="amber">기간제 {product.licenseMonths ?? 12}개월</Badge>
            ) : (
              <Badge tone="green">영구 사용권</Badge>
            )}
          </div>

          <h1 className="mt-3 text-[1.75rem] font-black leading-snug tracking-tight text-[var(--color-navy)]">
            {product.title}
          </h1>
          <p className="mt-2 text-[0.9375rem] text-[#5a6a80]">{product.summary}</p>

          <div className="mt-5 flex flex-wrap items-center gap-4 text-[0.75rem] text-[#8c98aa]">
            <Link href={`/stores/${product.sellerId}`} className="font-semibold text-[var(--color-accent)]">
              {product.seller.displayName}
            </Link>
            <span>{product.seller.sellerType === "BUSINESS" ? "사업자 판매자" : "개인 판매자"}</span>
            <span>검수 기간 {product.inspectionDays}일</span>
            <span>조회 {product.viewCount}</span>
            {product.ratingCount > 0 && (
              <span>
                ★ {product.ratingAvg.toFixed(1)} · 후기 {product.ratingCount}건
              </span>
            )}
          </div>

          <section className="mt-8 space-y-6">
            <Block title="해결하는 업무 문제">
              <p className="whitespace-pre-line">{product.problem}</p>
            </Block>

            <Block title="주요 기능">
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {product.features.map((f, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" />
                    {f}
                  </li>
                ))}
              </ul>
            </Block>

            <div className="grid gap-4 sm:grid-cols-2">
              <Block title="포함 범위">
                <ul className="space-y-1">
                  {product.includes.map((f, i) => (
                    <li key={i}>· {f}</li>
                  ))}
                </ul>
              </Block>
              <Block title="제외 범위">
                <ul className="space-y-1 text-[#5a6a80]">
                  {product.excludes.length === 0 ? <li>· 없음</li> : product.excludes.map((f, i) => <li key={i}>· {f}</li>)}
                </ul>
              </Block>
            </div>

            <Block title="제공 조건">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <Row k="지원 환경" v={product.platforms.join(", ") || "-"} />
                <Row k="사용자 수" v={product.seats ? `${product.seats}명` : "제한 없음"} />
                <Row k="소스코드 제공" v={product.sourceIncluded ? "포함" : "미포함"} />
                <Row k="설치 지원" v={product.installSupport ? "포함" : "미포함"} />
                <Row k="커스터마이징" v={product.customization ? "가능(별도 견적)" : "불가"} />
                <Row k="제3자 라이선스" v={product.thirdPartyDeps || "없음"} />
                <Row k="외부 유료 비용" v={product.externalCostNote || "없음"} />
                <Row k="납품 방식" v={product.deliveryNote || "결제 확인 후 즉시 다운로드"} />
                <Row k="검수 기간" v={`${product.inspectionDays}일`} />
                <Row k="환불 정책" v={product.refundPolicy || "디지털 콘텐츠 청약철회 제한 안내에 따름"} />
              </dl>
            </Block>

            <Block title="납품 파일 (사전 보관)">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[0.8125rem]">
                  <thead className="border-b border-[var(--color-line)] text-[0.6875rem] uppercase tracking-wide text-[#8c98aa]">
                    <tr>
                      <th className="py-2">파일명</th>
                      <th className="py-2">버전</th>
                      <th className="py-2">크기</th>
                      <th className="py-2">SHA-256</th>
                      <th className="py-2">검사</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.files.map((f) => (
                      <tr key={f.id} className="border-b border-[var(--color-line)]">
                        <td className="py-2 font-medium">
                          {f.fileName}
                          {f.isCurrent && <span className="ml-1 text-[0.625rem] text-[var(--color-accent)]">현재</span>}
                        </td>
                        <td className="py-2">v{f.version}</td>
                        <td className="py-2">{(f.sizeBytes / 1024).toFixed(1)}KB</td>
                        <td className="py-2 font-mono text-[0.6875rem] text-[#8c98aa]">{f.sha256.slice(0, 16)}…</td>
                        <td className="py-2">
                          <Badge tone={f.scanStatus === "PASSED" ? "green" : f.scanStatus === "ISSUE_FOUND" ? "red" : "amber"}>
                            {f.scanStatus === "PASSED"
                              ? "통과"
                              : f.scanStatus === "ISSUE_FOUND"
                                ? "문제 발견"
                                : f.scanStatus === "UNSCANNABLE"
                                  ? "검사 불가"
                                  : "검사 대기"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[0.6875rem] leading-relaxed text-[#8c98aa]">
                파일은 플랫폼 비공개 저장소에 암호화 보관됩니다. 해시는 동일 파일 여부를 확인하는 용도이며, 기능
                정상 작동이나 판매 권한을 증명하지 않습니다. 파일 검사는 패턴 기반 사전 점검으로 악성코드 검사가
                아닙니다.
              </p>
            </Block>

            <Block title="구매 전 문의">
              <div className="space-y-3">
                {product.questions.length === 0 && <p className="text-[0.8125rem] text-[#8c98aa]">등록된 문의가 없습니다.</p>}
                {product.questions.map((q) => (
                  <div key={q.id} className="rounded-lg border border-[var(--color-line)] p-3">
                    <div className="text-[0.8125rem] font-semibold text-[var(--color-navy)]">Q. {q.body}</div>
                    {q.answer ? (
                      <div className="mt-2 rounded-md bg-[var(--color-tint)] p-2 text-[0.8125rem] text-[#3c4a60]">
                        A. {q.answer}
                      </div>
                    ) : (
                      <div className="mt-1 text-[0.6875rem] text-[#8c98aa]">답변 대기 중</div>
                    )}
                  </div>
                ))}
                {actor ? (
                  <form action={askQuestionAction} className="flex gap-2">
                    <input type="hidden" name="productId" value={product.id} />
                    <input name="body" required className="input" placeholder="구매 전 확인하고 싶은 내용" />
                    <button className="btn btn-outline shrink-0" type="submit">
                      문의
                    </button>
                  </form>
                ) : (
                  <Link href="/login" className="text-[0.8125rem] font-semibold text-[var(--color-accent)]">
                    로그인 후 문의할 수 있습니다 →
                  </Link>
                )}
              </div>
            </Block>

            {product.reviews.length > 0 && (
              <Block title="구매자 후기">
                <div className="space-y-2">
                  {product.reviews.map((r) => (
                    <div key={r.id} className="rounded-lg border border-[var(--color-line)] p-3 text-[0.8125rem]">
                      <div className="font-semibold text-[var(--color-navy)]">{"★".repeat(r.rating)}</div>
                      <p className="mt-1 text-[#3c4a60]">{r.body}</p>
                    </div>
                  ))}
                </div>
              </Block>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="card p-5">
            <div className="text-[0.75rem] text-[#8c98aa]">판매가</div>
            <div className="text-[1.75rem] font-black text-[var(--color-navy)]">{formatKrw(product.priceKrw)}</div>
            <div className="mt-1 text-[0.6875rem] text-[#8c98aa]">
              {product.licenseType === "PERIOD" ? `${product.licenseMonths ?? 12}개월 사용권` : "영구 사용권"} · 부가세 별도
            </div>

            <dl className="mt-4 space-y-1.5 border-t border-[var(--color-line)] pt-3 text-[0.75rem]">
              <div className="flex justify-between">
                <dt className="text-[#5a6a80]">구매자 지불 금액</dt>
                <dd className="font-bold">{formatKrw(fees.buyerPayableAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#5a6a80]">플랫폼 수수료(판매자 부담)</dt>
                <dd>{formatKrw(fees.commissionAmount)} ({policy.commissionRateBp / 100}%)</dd>
              </div>
              {product.seller.sellerType === "INDIVIDUAL" && (
                <div className="flex justify-between">
                  <dt className="text-[#5a6a80]">원천징수(3.3%)</dt>
                  <dd>{formatKrw(fees.withholdingTax)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-[#5a6a80]">판매자 예상 정산액</dt>
                <dd className="font-bold text-[var(--color-accent)]">{formatKrw(fees.sellerNetAmount)}</dd>
              </div>
            </dl>

            <div className="mt-4 space-y-2">
              {isOwner ? (
                <div className="rounded-lg bg-[var(--color-tint)] p-3 text-[0.75rem] text-[#5a6a80]">
                  본인이 등록한 상품입니다.
                </div>
              ) : actor ? (
                <form action={createOrderAction}>
                  <input type="hidden" name="productId" value={product.id} />
                  <button className="btn btn-primary w-full" type="submit">
                    구매하고 결제하기
                  </button>
                </form>
              ) : (
                <Link href={`/login?next=/products/${product.id}`} className="btn btn-primary w-full">
                  로그인 후 구매
                </Link>
              )}
              <form action={toggleFavoriteAction}>
                <input type="hidden" name="productId" value={product.id} />
                <button className="btn btn-outline w-full" type="submit">
                  {favorited ? "찜 해제" : "찜하기"}
                </button>
              </form>
              <Link href={`/compare?ids=${product.id}`} className="btn btn-outline w-full">
                비교함에 담기
              </Link>
            </div>

            <div className="mt-4 rounded-lg bg-[var(--color-tint)] p-3 text-[0.6875rem] leading-relaxed text-[#5a6a80]">
              <strong className="text-[var(--color-navy)]">결제 전 확인</strong>
              <br />
              다운로드를 시작하면 단순 변심 청약철회가 제한됩니다. 결제 화면에서 이 내용에 동의해야 결제가
              진행됩니다.
              <br />
              <br />
              {ESCROW_NOTICE.limitation}
            </div>
          </div>

          <div className="card mt-4 p-4">
            <div className="text-[0.75rem] font-bold text-[var(--color-navy)]">청약철회 제한 안내 (요약)</div>
            <p className="mt-2 line-clamp-6 text-[0.6875rem] leading-relaxed text-[#5a6a80]">
              {WITHDRAWAL_CONSENT_TEXT}
            </p>
            <Link href="/legal/withdrawal" className="mt-2 inline-block text-[0.6875rem] font-semibold text-[var(--color-accent)]">
              전문 보기 →
            </Link>
          </div>

          <div className="mt-4 text-center text-[0.6875rem] text-[#8c98aa]">
            고객센터 {BRAND.email} · {BRAND.supportHours}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-[0.9375rem] font-bold text-[var(--color-navy)]">{title}</h2>
      <div className="text-[0.875rem] leading-relaxed text-[#3c4a60]">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 border-b border-dashed border-[var(--color-line)] pb-1.5">
      <dt className="w-32 shrink-0 text-[0.75rem] text-[#8c98aa]">{k}</dt>
      <dd className="text-[0.8125rem]">{v}</dd>
    </div>
  );
}
