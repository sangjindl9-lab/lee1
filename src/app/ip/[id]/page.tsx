import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { POLICY_VERSIONS } from "@/lib/brand";
import { getCurrentActor } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { acceptNdaAction, createIpOrderAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function IpDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await getCurrentActor();
  const asset = await prisma.ipAsset.findUnique({
    where: { id },
    include: { seller: true, vault: true, grants: true },
  });
  if (!asset) notFound();

  const grant = actor
    ? await prisma.ipAccessGrant.findUnique({ where: { ipAssetId_userId: { ipAssetId: id, userId: actor.id } } })
    : null;
  const canViewVault = !!grant?.ndaAgreedAt && !grant.revokedAt;

  return (
    <div className="container-dv py-9">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="navy">
          {asset.transferMode === "ASSIGNMENT"
            ? "권리 양도"
            : asset.transferMode === "EXCLUSIVE_LICENSE"
              ? "독점 이용허락"
              : asset.transferMode === "NON_EXCLUSIVE_LICENSE"
                ? "비독점 이용허락"
                : "상담"}
        </Badge>
        <Badge tone="gray">{asset.rightsType}</Badge>
        <Badge tone={asset.status === "EXCLUSIVE_LOCKED" ? "red" : "green"}>{asset.status}</Badge>
      </div>
      <h1 className="mt-2 text-[1.625rem] font-black text-[var(--color-navy)]">{asset.title}</h1>
      <p className="mt-1 text-[0.8125rem] text-[#5a6a80]">
        권리자 {asset.owner} · 판매자 {asset.seller.displayName} · {formatKrw(asset.priceKrw)}
      </p>

      {(sp.error || sp.ok) && (
        <div className="mt-4">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">공개 소개</h2>
            <p className="mt-2 whitespace-pre-line text-[0.875rem] leading-relaxed text-[#3c4a60]">{asset.publicIntro}</p>
          </div>

          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">권리 조건</h2>
            <dl className="mt-3 space-y-1.5 text-[0.8125rem]">
              <Row k="권리 종류" v={asset.rightsType} />
              <Row k="대상" v={asset.target} />
              <Row k="판매 권한 근거" v={asset.authorityBasis ?? "-"} />
              <Row k="공동 권리자" v={asset.coOwners ?? "없음"} />
              <Row k="양도·허락 범위" v={asset.transferMode} />
              <Row k="기간" v={asset.period ?? "-"} />
              <Row k="지역" v={asset.territory ?? "-"} />
              <Row k="사용 분야" v={asset.field ?? "-"} />
              <Row k="기존 이용허락" v={asset.existingLicenses ?? "없음"} />
              <Row k="제3자 구성요소" v={asset.thirdParty ?? "없음"} />
              <Row k="포함 자산" v={asset.includedAssets} />
              <Row k="제외 자산" v={asset.excludedAssets ?? "없음"} />
            </dl>
          </div>

          <div className="card p-5">
            <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">비공개 자료실</h2>
            {canViewVault ? (
              <ul className="mt-3 space-y-1 text-[0.8125rem]">
                {asset.vault.map((f) => (
                  <li key={f.id} className="flex justify-between rounded bg-[var(--color-tint)] px-3 py-2">
                    <span>{f.fileName}</span>
                    <span className="text-[0.6875rem] text-[#8c98aa]">
                      {(f.sizeBytes / 1024).toFixed(1)}KB · {f.scanStatus}
                    </span>
                  </li>
                ))}
                {asset.vault.length === 0 && <li className="text-[#8c98aa]">등록된 자료가 없습니다.</li>}
              </ul>
            ) : (
              <div className="mt-3">
                <p className="text-[0.8125rem] text-[#5a6a80]">
                  비공개 자료 {asset.vault.length}건은 비밀유지(NDA) 동의 후 열람할 수 있습니다.
                </p>
                {actor ? (
                  <form action={acceptNdaAction} className="mt-3">
                    <input type="hidden" name="ipAssetId" value={asset.id} />
                    <button className="btn btn-outline" type="submit">
                      비밀유지 동의하고 자료 열람 (v{POLICY_VERSIONS.nda})
                    </button>
                  </form>
                ) : (
                  <Link href="/login" className="mt-3 inline-block text-[0.8125rem] font-semibold text-[var(--color-accent)]">
                    로그인 후 동의 →
                  </Link>
                )}
              </div>
            )}
            <p className="mt-3 text-[0.6875rem] text-[#8c98aa]">
              동의 기록(일시·버전·IP)이 저장되며, 열람 권한은 14일 후 만료됩니다. 자료는 외부로 유출할 수 없습니다.
            </p>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="card p-5">
            <div className="text-[0.75rem] text-[#8c98aa]">거래 금액</div>
            <div className="text-[1.5rem] font-black text-[var(--color-navy)]">{formatKrw(asset.priceKrw)}</div>
            <p className="mt-2 text-[0.75rem] leading-relaxed text-[#5a6a80]">
              거래 절차: 상담 → 비밀유지 → 자료 열람 → 권리 확인 → 조건 확정 → 계약·결제 → 자산 인도 → 권리 이전 확인 →
              완료·정산
            </p>
            {actor ? (
              <form action={createIpOrderAction} className="mt-4">
                <input type="hidden" name="ipAssetId" value={asset.id} />
                <button className="btn btn-primary w-full" type="submit" disabled={!!asset.exclusiveOrderId}>
                  {asset.exclusiveOrderId ? "다른 거래 진행 중(잠금)" : "거래 주문 생성"}
                </button>
              </form>
            ) : (
              <Link href="/login" className="btn btn-primary mt-4 w-full">
                로그인 후 거래
              </Link>
            )}
            <p className="mt-2 text-[0.6875rem] text-[#8c98aa]">
              독점 거래는 결제·계약 진행 중 중복 판매를 막기 위해 잠금 처리됩니다. 기존 이용허락 처리 조건은 계약에서
              별도로 확인합니다.
            </p>
          </div>
          <Notice tone="warn" title="권리 이전 안내">
            소스 파일 전달만으로 모든 지식재산권이 이전되지 않습니다. 특허·상표 등 등록 권리의 이전은 별도 공식 절차가
            필요하며, 플랫폼은 이전 완료를 대신 보증하지 않습니다.
          </Notice>
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2 border-b border-dashed border-[var(--color-line)] pb-1">
      <dt className="w-32 shrink-0 text-[0.75rem] text-[#8c98aa]">{k}</dt>
      <dd className="text-[0.8125rem]">{v}</dd>
    </div>
  );
}
