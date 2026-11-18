import Link from "next/link";
import { prisma } from "@/lib/db";
import { CATEGORIES, searchProducts } from "@/server/services/catalog";
import { ProductCard, SectionHeading } from "@/components/ui";

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function MarketPage({
  type,
  title,
  description,
  searchParams,
}: {
  type: "SOLUTION" | "SOURCE";
  title: string;
  description: string;
  searchParams: Params;
}) {
  const q = one(searchParams.q);
  const category = one(searchParams.category);
  const minPrice = one(searchParams.minPrice);
  const maxPrice = one(searchParams.maxPrice);
  const platform = one(searchParams.platform);
  const sort = (one(searchParams.sort) ?? "recent") as "recent" | "price_asc" | "price_desc" | "rating";

  const [products, totalActive] = await Promise.all([
    searchProducts({
      type,
      q,
      category,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      platform,
      sourceIncluded: searchParams.sourceIncluded === "1",
      installSupport: searchParams.installSupport === "1",
      customization: searchParams.customization === "1",
      noExternalCost: searchParams.noExternalCost === "1",
      minRating: one(searchParams.minRating) ? Number(one(searchParams.minRating)) : undefined,
      sort,
    }),
    prisma.product.count({ where: { type, status: "ACTIVE" } }),
  ]);

  return (
    <div className="container-dv py-10">
      <SectionHeading
        title={title}
        description={`${description} · 판매 중 ${totalActive}건`}
        action={
          <Link href="/trust" className="text-[0.8125rem] font-semibold text-[var(--color-accent)]">
            검증 범위 안내 →
          </Link>
        }
      />

      <form className="card mb-6 grid gap-3 p-4 md:grid-cols-12" method="get">
        <div className="md:col-span-4">
          <label className="label" htmlFor="q">
            검색
          </label>
          <input id="q" name="q" defaultValue={q} className="input" placeholder="상품명, 기능, 분야" />
        </div>
        <div className="md:col-span-3">
          <label className="label" htmlFor="category">
            분야
          </label>
          <select id="category" name="category" defaultValue={category ?? ""} className="input">
            <option value="">전체</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="minPrice">
            최소 가격
          </label>
          <input id="minPrice" name="minPrice" defaultValue={minPrice} className="input" inputMode="numeric" placeholder="0" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="maxPrice">
            최대 가격
          </label>
          <input id="maxPrice" name="maxPrice" defaultValue={maxPrice} className="input" inputMode="numeric" placeholder="제한 없음" />
        </div>
        <div className="flex items-end md:col-span-1">
          <button className="btn btn-primary w-full" type="submit">
            적용
          </button>
        </div>

        <div className="md:col-span-12 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--color-line)] pt-3 text-[0.8125rem] text-[#3c4a60]">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="sourceIncluded" value="1" defaultChecked={searchParams.sourceIncluded === "1"} />
            소스 제공
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="installSupport" value="1" defaultChecked={searchParams.installSupport === "1"} />
            설치 지원
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="customization" value="1" defaultChecked={searchParams.customization === "1"} />
            커스터마이징
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="noExternalCost" value="1" defaultChecked={searchParams.noExternalCost === "1"} />
            외부 유료 서비스 불필요
          </label>
          <label className="flex items-center gap-1.5">
            <span>사용 환경</span>
            <select name="platform" defaultValue={platform ?? ""} className="rounded border border-[var(--color-line)] px-2 py-1">
              <option value="">전체</option>
              <option value="PC">PC</option>
              <option value="WEB">웹</option>
              <option value="MOBILE">모바일</option>
            </select>
          </label>
          <label className="ml-auto flex items-center gap-1.5">
            <span>정렬</span>
            <select name="sort" defaultValue={sort} className="rounded border border-[var(--color-line)] px-2 py-1">
              <option value="recent">최신</option>
              <option value="price_asc">낮은 가격</option>
              <option value="price_desc">높은 가격</option>
              <option value="rating">평점</option>
            </select>
          </label>
        </div>
      </form>

      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] p-12 text-center">
          <div className="text-[0.9375rem] font-bold text-[var(--color-navy)]">조건에 맞는 상품이 없습니다</div>
          <p className="mt-2 text-[0.8125rem] text-[#5a6a80]">
            필터를 줄이거나 <Link href="/requests/new" className="font-semibold text-[var(--color-accent)]">맞춤 개발 의뢰</Link>로
            필요한 기능을 직접 요청해 보세요.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      <p className="mt-8 text-[0.6875rem] leading-relaxed text-[#8c98aa]">
        표시된 가격은 부가세 별도 판매자 책정가이며, 결제 화면에서 플랫폼 수수료·결제비용 부담 주체와 최종
        지불 금액을 확인할 수 있습니다. 파일 해시는 동일 파일 여부 확인용이며 기능 정상 작동이나 권리 검증을
        의미하지 않습니다.
      </p>
    </div>
  );
}
