import Link from "next/link";
import { prisma } from "@/lib/db";
import { BRAND, ESCROW_NOTICE } from "@/lib/brand";
import { formatKrw } from "@/lib/money";
import { CATEGORIES } from "@/server/services/catalog";
import { Badge, ProductCard, SectionHeading } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [productCount, sellerCount, orderCount, featured] = await Promise.all([
    prisma.product.count({ where: { status: "ACTIVE" } }),
    prisma.sellerProfile.count({ where: { status: "ACTIVE" } }),
    prisma.order.count({ where: { paymentStatus: "PAID" } }),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      include: { seller: true },
      orderBy: [{ purchaseCount: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
  ]);

  const gross = await prisma.order.aggregate({
    where: { paymentStatus: "PAID" },
    _sum: { grossAmount: true },
  });

  return (
    <div>
      <section className="border-b border-[var(--color-line)] bg-gradient-to-b from-[#f7f9fd] to-white">
        <div className="container-dv grid gap-10 py-16 md:grid-cols-[1.15fr_0.85fr] md:py-20">
          <div>
            <Badge tone="blue">소프트웨어·지식재산권 안전거래</Badge>
            <h1 className="mt-4 text-[2rem] font-black leading-[1.25] tracking-tight text-[var(--color-navy)] md:text-[2.75rem]">
              완성된 프로그램부터
              <br />
              소스코드·맞춤개발·권리 양도까지
              <br />
              <span className="text-[var(--color-accent)]">계약 조건과 함께</span> 거래합니다.
            </h1>
            <p className="mt-5 max-w-xl text-[0.9375rem] leading-relaxed text-[#4b5b72]">
              {BRAND.nameKo}는 무엇을 받는지, 어떤 권리를 받는지, 언제 받고 언제까지 검수하는지를 계약
              시점에 고정합니다. 결제·납품·검수·정산 상태를 각각 분리해 보여주고, 지급 전 확인 절차를
              거칩니다.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              <Link href="/solutions" className="btn btn-primary">
                솔루션 둘러보기
              </Link>
              <Link href="/requests/new" className="btn btn-accent">
                맞춤 개발 의뢰하기
              </Link>
              <Link href="/trust" className="btn btn-outline">
                안전거래 범위 확인
              </Link>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t border-[var(--color-line)] pt-6">
              <div>
                <dt className="text-[0.6875rem] font-semibold text-[#8c98aa]">등록 상품</dt>
                <dd className="text-[1.125rem] font-extrabold text-[var(--color-navy)]">{productCount}건</dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] font-semibold text-[#8c98aa]">판매자</dt>
                <dd className="text-[1.125rem] font-extrabold text-[var(--color-navy)]">{sellerCount}명</dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] font-semibold text-[#8c98aa]">결제 완료 거래</dt>
                <dd className="text-[1.125rem] font-extrabold text-[var(--color-navy)]">{orderCount}건</dd>
              </div>
            </dl>
            <p className="mt-3 text-[0.6875rem] text-[#8c98aa]">
              누적 결제액 {formatKrw(gross._sum.grossAmount ?? 0)} · 테스트 환경 기준
            </p>
          </div>

          <div className="card bg-white p-6">
            <div className="text-[0.75rem] font-bold uppercase tracking-wider text-[#8c98aa]">
              안전거래 3요소
            </div>
            <ul className="mt-4 space-y-4">
              {[
                {
                  n: "01",
                  title: "결제대금 보호 상태 확인",
                  body: "결제 사업자의 실제 상태를 그대로 표시합니다. 연결되지 않은 경우 '내부 정산 보류'로만 표시합니다.",
                },
                {
                  n: "02",
                  title: "비공개 납품물 보관",
                  body: "판매 전 파일을 플랫폼 비공개 저장소에 암호화 보관하고, 주문 시점 버전을 고정합니다.",
                },
                {
                  n: "03",
                  title: "검수 후 정산",
                  body: "납품·검수·분쟁·환불 상태를 모두 확인한 뒤 판매자 지급을 요청합니다.",
                },
              ].map((item) => (
                <li key={item.n} className="flex gap-3">
                  <span className="mt-0.5 text-[0.75rem] font-black text-[var(--color-accent)]">{item.n}</span>
                  <div>
                    <div className="text-[0.875rem] font-bold text-[var(--color-navy)]">{item.title}</div>
                    <p className="mt-1 text-[0.75rem] leading-relaxed text-[#5a6a80]">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-5 rounded-lg bg-[var(--color-tint)] p-3 text-[0.6875rem] leading-relaxed text-[#5a6a80]">
              {ESCROW_NOTICE.limitation}
            </div>
          </div>
        </div>
      </section>

      <section className="container-dv py-14">
        <SectionHeading
          title="거래 유형"
          description="사용권 · 소스코드 · 맞춤개발 · 지식재산권은 권리 범위와 자금 흐름이 다릅니다."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              href: "/solutions",
              title: "완성형 사용권",
              desc: "PC·웹·모바일 프로그램을 기간제 또는 영구로 사용",
              tags: ["PC/웹/모바일", "기간·영구", "사용자 수 조건"],
            },
            {
              href: "/sources",
              title: "소스코드 구매",
              desc: "전체 또는 일부 모듈, 수정·상업적 이용·재배포 범위 구분",
              tags: ["제3자 라이선스", "설치 문서", "재배포 범위"],
            },
            {
              href: "/requests",
              title: "맞춤 개발",
              desc: "단계별 산출물·금액·검수 기준을 계약으로 고정",
              tags: ["단계별 결제", "변경 계약", "검수 기준"],
            },
            {
              href: "/ip",
              title: "지식재산권 거래",
              desc: "양도·독점/비독점 이용허락, 비공개 자료실 운영",
              tags: ["권리 범위", "NDA", "독점 잠금"],
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="card p-5 transition hover:border-[var(--color-navy)]"
            >
              <div className="text-[1rem] font-bold text-[var(--color-navy)]">{item.title}</div>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-[#5a6a80]">{item.desc}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                {item.tags.map((t) => (
                  <Badge key={t} tone="gray">
                    {t}
                  </Badge>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-[var(--color-line)] bg-[var(--color-tint)] py-14">
        <div className="container-dv">
          <SectionHeading
            title="분야별로 찾기"
            description="ERP·회계·문서 자동화부터 AI 도구까지, 실무에서 쓰이는 소프트웨어를 모았습니다."
            action={
              <Link href="/solutions" className="text-[0.8125rem] font-semibold text-[var(--color-accent)]">
                전체 보기 →
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {CATEGORIES.map((c) => (
              <Link
                key={c}
                href={`/solutions?category=${encodeURIComponent(c)}`}
                className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-3 text-[0.8125rem] font-semibold text-[#3c4a60] hover:border-[var(--color-navy)]"
              >
                {c}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="container-dv py-14">
        <SectionHeading
          title="최근 등록 상품"
          description="판매 전 실제 납품 파일과 검사 결과를 등록한 상품만 노출됩니다."
          action={
            <Link href="/sources" className="text-[0.8125rem] font-semibold text-[var(--color-accent)]">
              소스코드 마켓 →
            </Link>
          }
        />
        {featured.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--color-line)] p-10 text-center text-[0.875rem] text-[#5a6a80]">
            아직 등록된 상품이 없습니다. 판매자로 등록해 첫 상품을 올려 보세요.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>

      <section className="container-dv pb-16">
        <div className="rounded-2xl bg-[var(--color-navy)] px-6 py-10 text-white md:px-10">
          <h2 className="text-[1.375rem] font-extrabold md:text-[1.625rem]">
            구매자와 판매자 모두에게 필요한 확인 절차를 넣었습니다
          </h2>
          <div className="mt-7 grid gap-6 md:grid-cols-3">
            <div>
              <div className="text-[0.75rem] font-bold uppercase tracking-wider text-[#8fa9cc]">구매자 보호</div>
              <ul className="mt-2 space-y-1 text-[0.8125rem] leading-relaxed text-[#d7e2f2]">
                <li>· 결제 전 검수 기준·환경 조건 고지</li>
                <li>· 납품 기한 지연 알림</li>
                <li>· 누락 파일·기능 불일치 문제 제기</li>
                <li>· 분쟁 접수 시 정산 보류</li>
              </ul>
            </div>
            <div>
              <div className="text-[0.75rem] font-bold uppercase tracking-wider text-[#8fa9cc]">판매자 보호</div>
              <ul className="mt-2 space-y-1 text-[0.8125rem] leading-relaxed text-[#d7e2f2]">
                <li>· 청약철회 제한 사전 동의 기록</li>
                <li>· 파일 접근·다운로드 이력 보관</li>
                <li>· 수정 요청의 계약 범위 분류</li>
                <li>· 검수 기한 알림과 종료 심사 요청</li>
              </ul>
            </div>
            <div>
              <div className="text-[0.75rem] font-bold uppercase tracking-wider text-[#8fa9cc]">운영자 추적</div>
              <ul className="mt-2 space-y-1 text-[0.8125rem] leading-relaxed text-[#d7e2f2]">
                <li>· 7개 상태 분리 저장</li>
                <li>· 6자리(7종) 상태별 이력과 감사 로그</li>
                <li>· PG 대사(Reconciliation)</li>
                <li>· 지급·환불 경쟁 상황 방어</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 flex flex-wrap gap-2">
            <Link href="/trust" className="btn bg-white text-[var(--color-navy)]">
              안전거래 안내 자세히
            </Link>
            <Link href="/register" className="btn border border-[#4f6c94] text-white">
              무료로 시작하기
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
