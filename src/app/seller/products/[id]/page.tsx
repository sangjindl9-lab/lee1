import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { submitProductAction, uploadProductFileAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SellerProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(`/seller/products/${id}`);
  const product = await prisma.product.findUnique({
    where: { id },
    include: { files: { orderBy: { version: "desc" } }, orders: true },
  });
  if (!product) notFound();
  if (product.sellerId !== actor.sellerProfileId) notFound();

  return (
    <div className="container-dv py-9">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={product.status === "ACTIVE" ? "green" : product.status === "PENDING_REVIEW" ? "amber" : "gray"}>
              {product.status}
            </Badge>
            <span className="text-[0.6875rem] text-[#8c98aa]">상품 ID {product.id.slice(0, 8)}</span>
          </div>
          <h1 className="mt-2 text-[1.375rem] font-black text-[var(--color-navy)]">{product.title}</h1>
          <p className="text-[0.8125rem] text-[#5a6a80]">
            {product.category} · {formatKrw(product.priceKrw)} · 검수 {product.inspectionDays}일 · 주문 {product.orders.length}건
          </p>
        </div>
        <div className="flex gap-2">
          {product.status === "ACTIVE" && (
            <Link href={`/products/${product.id}`} className="btn btn-outline btn-sm">
              상품 페이지
            </Link>
          )}
          <Link href="/dashboard/sales" className="btn btn-outline btn-sm">
            판매 관리
          </Link>
        </div>
      </div>

      {(sp.error || sp.ok) && (
        <div className="mt-4">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <form action={uploadProductFileAction} className="card space-y-3 p-5">
          <input type="hidden" name="productId" value={product.id} />
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">납품 파일 등록</h2>
          <p className="text-[0.75rem] leading-relaxed text-[#5a6a80]">
            실행 파일·소스·설치 문서·의존성 목록·환경변수 예시·DB 스키마·라이선스 고지를 모두 포함해 주세요. 운영
            비밀번호·실사용 API 키·개인정보가 포함된 DB는 올리면 안 됩니다.
          </p>
          <input type="file" name="file" required className="input" />
          <button className="btn btn-primary" type="submit">
            업로드 및 검사
          </button>
          <p className="text-[0.6875rem] text-[#8c98aa]">
            파일은 AES-256-GCM으로 암호화되어 비공개 저장소에 보관됩니다. 압축 파일은 폭탄·경로 탈출 여부를, 텍스트는
            개인키·개인정보 패턴을 검사합니다.
          </p>
        </form>

        <div className="card p-5">
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">등록된 납품물</h2>
          <ul className="mt-3 space-y-2">
            {product.files.map((f) => (
              <li key={f.id} className="rounded-lg border border-[var(--color-line)] p-3 text-[0.75rem]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{f.fileName}</span>
                  <Badge tone={f.scanStatus === "PASSED" ? "green" : f.scanStatus === "ISSUE_FOUND" ? "red" : "amber"}>
                    {f.scanStatus}
                  </Badge>
                </div>
                <div className="mt-1 text-[#8c98aa]">
                  v{f.version} · {(f.sizeBytes / 1024).toFixed(1)}KB · sha256 {f.sha256.slice(0, 16)}…
                </div>
                {f.scanFindings ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[0.6875rem] font-semibold text-[var(--color-accent)]">
                      검사 결과 보기
                    </summary>
                    <pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--color-tint)] p-2 text-[0.625rem] text-[#5a6a80]">
                      {JSON.stringify(f.scanFindings, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
            {product.files.length === 0 && <li className="text-[0.75rem] text-[#8c98aa]">등록된 파일이 없습니다.</li>}
          </ul>

          <form action={submitProductAction} className="mt-4 border-t border-[var(--color-line)] pt-3">
            <input type="hidden" name="productId" value={product.id} />
            <button className="btn btn-accent" type="submit">
              운영자 심사 요청
            </button>
            <p className="mt-1 text-[0.6875rem] text-[#8c98aa]">
              검사에서 문제가 발견된 파일이 있으면 심사 요청과 판매 승인이 차단됩니다.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
