import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatKrw } from "@/lib/money";
import { requireActor } from "@/lib/session";
import { Badge, Notice } from "@/components/ui";
import { addIpVaultFileAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function SellerIpAssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const actor = await requireActor(`/seller/ip/${id}`);
  const asset = await prisma.ipAsset.findUnique({ where: { id }, include: { vault: true } });
  if (!asset) notFound();
  if (asset.sellerId !== actor.sellerProfileId) notFound();

  return (
    <div className="container-dv py-9">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={asset.status === "ACTIVE" ? "green" : "amber"}>{asset.status}</Badge>
            <span className="text-[0.6875rem] text-[#8c98aa]">{asset.rightsType}</span>
          </div>
          <h1 className="mt-2 text-[1.375rem] font-black text-[var(--color-navy)]">{asset.title}</h1>
          <p className="text-[0.8125rem] text-[#5a6a80]">
            {formatKrw(asset.priceKrw)} · 포함 자산 {asset.includedAssets.slice(0, 40)}…
          </p>
        </div>
        <Link href={`/ip/${asset.id}`} className="btn btn-outline btn-sm">
          공개 페이지
        </Link>
      </div>

      {(sp.error || sp.ok) && (
        <div className="mt-4">{sp.error ? <Notice tone="danger">{sp.error}</Notice> : <Notice tone="success">{sp.ok}</Notice>}</div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <form action={addIpVaultFileAction} className="card space-y-3 p-5">
          <input type="hidden" name="ipAssetId" value={asset.id} />
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">비공개 자료실 업로드</h2>
          <p className="text-[0.75rem] leading-relaxed text-[#5a6a80]">
            권리 증빙, 기존 이용허락 계약서, 소스 스냅샷 등 NDA 후 열람할 자료를 올립니다. 개인정보·비밀키 패턴이
            발견되면 업로드가 차단됩니다.
          </p>
          <input type="file" name="file" required className="input" />
          <button className="btn btn-primary" type="submit">
            업로드
          </button>
        </form>

        <div className="card p-5">
          <h2 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">자료실 파일 {asset.vault.length}건</h2>
          <ul className="mt-3 space-y-2 text-[0.8125rem]">
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
          <p className="mt-3 text-[0.6875rem] text-[#8c98aa]">
            공개 심사는 운영자 콘솔에서 진행됩니다. 심사 승인 전에는 마켓에 노출되지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
