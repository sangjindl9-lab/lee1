import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { newOrderNo } from "@/lib/ids";
import { formatKrw } from "@/lib/money";
import { POLICY_VERSIONS } from "@/lib/brand";
import { putFile, safeDisplayName } from "@/server/storage/vault";
import { scanDeliveryFile } from "@/server/security/scan";
import { audit, notify } from "./audit";
import type { Actor } from "./rbac";

export async function createIpAsset(
  actor: Actor,
  input: {
    title: string;
    rightsType: string;
    target: string;
    owner: string;
    authorityBasis?: string;
    coOwners?: string;
    transferMode: "ASSIGNMENT" | "EXCLUSIVE_LICENSE" | "NON_EXCLUSIVE_LICENSE" | "CONSULTATION";
    period?: string;
    territory?: string;
    field?: string;
    existingLicenses?: string;
    thirdParty?: string;
    includedAssets: string;
    excludedAssets?: string;
    priceKrw: number;
    publicIntro: string;
    confidentialNote?: string;
  },
) {
  if (!actor.sellerProfileId) throw new DomainError("FORBIDDEN", "판매자만 지식재산권을 등록할 수 있습니다.", 403);
  const asset = await prisma.ipAsset.create({
    data: {
      sellerId: actor.sellerProfileId,
      title: input.title,
      rightsType: input.rightsType,
      target: input.target,
      owner: input.owner,
      authorityBasis: input.authorityBasis,
      coOwners: input.coOwners,
      transferMode: input.transferMode,
      period: input.period,
      territory: input.territory,
      field: input.field,
      existingLicenses: input.existingLicenses,
      thirdParty: input.thirdParty,
      includedAssets: input.includedAssets,
      excludedAssets: input.excludedAssets,
      priceKrw: input.priceKrw,
      publicIntro: input.publicIntro,
      confidentialNote: input.confidentialNote,
      status: "PENDING_REVIEW",
    },
  });
  await audit({ actor, action: "IP_ASSET_CREATED", targetType: "IpAsset", targetId: asset.id });
  return asset;
}

export async function addIpVaultFile(
  actor: Actor,
  input: { ipAssetId: string; fileName: string; buffer: Buffer },
) {
  const asset = await prisma.ipAsset.findUnique({ where: { id: input.ipAssetId } });
  if (!asset) throw new DomainError("NOT_FOUND", "자산을 찾을 수 없습니다.", 404);
  if (asset.sellerId !== actor.sellerProfileId) throw new DomainError("FORBIDDEN", "권한이 없습니다.", 403);

  const name = safeDisplayName(input.fileName);
  const scan = scanDeliveryFile({ fileName: name, buffer: input.buffer });
  if (scan.status === "ISSUE_FOUND") {
    throw new DomainError(
      "FILES_UNSAFE",
      "비공개 자료실에 올릴 수 없는 값(개인키·개인정보 등)이 발견되었습니다. 해당 값을 제거해 주세요.",
      409,
    );
  }
  const stored = await putFile(input.buffer, name);
  return prisma.ipVaultFile.create({
    data: {
      ipAssetId: asset.id,
      fileName: name,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      storageKey: stored.storageKey,
      accessLevel: "CONFIDENTIAL",
      scanStatus: scan.status,
    },
  });
}

export async function reviewIpAsset(
  actor: Actor,
  input: { ipAssetId: string; decision: "ACTIVE" | "SUSPENDED"; note?: string },
) {
  const asset = await prisma.ipAsset.update({
    where: { id: input.ipAssetId },
    data: { status: input.decision },
  });
  await audit({
    actor,
    action: `IP_ASSET_${input.decision}`,
    targetType: "IpAsset",
    targetId: asset.id,
    after: { note: input.note },
  });
  return asset;
}

/** 비공개 자료실 열람 — NDA 동의 후 승인받은 사람만. */
export async function acceptNda(actor: Actor, ipAssetId: string) {
  const asset = await prisma.ipAsset.findUnique({ where: { id: ipAssetId } });
  if (!asset) throw new DomainError("NOT_FOUND", "자산을 찾을 수 없습니다.", 404);

  await prisma.$transaction([
    prisma.ndaAgreement.create({
      data: { ipAssetId, userId: actor.id, version: POLICY_VERSIONS.nda, ip: actor.ip },
    }),
    prisma.ipAccessGrant.upsert({
      where: { ipAssetId_userId: { ipAssetId, userId: actor.id } },
      update: { ndaAgreedAt: new Date(), revokedAt: null },
      create: {
        ipAssetId,
        userId: actor.id,
        ndaAgreedAt: new Date(),
        grantedById: asset.sellerId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    }),
  ]);
  await audit({ actor, action: "IP_NDA_AGREED", targetType: "IpAsset", targetId: ipAssetId });
  return { granted: true };
}

export async function listIpVaultFiles(actor: Actor, ipAssetId: string) {
  const grant = await prisma.ipAccessGrant.findUnique({
    where: { ipAssetId_userId: { ipAssetId, userId: actor.id } },
  });
  if (!grant || grant.revokedAt || !grant.ndaAgreedAt) {
    throw new DomainError("FORBIDDEN", "비공개 자료실은 비밀유지 동의 후 열람할 수 있습니다.", 403);
  }
  if (grant.expiresAt && grant.expiresAt.getTime() < Date.now()) {
    throw new DomainError("FORBIDDEN", "자료 열람 기한이 만료되었습니다.", 403);
  }
  return prisma.ipVaultFile.findMany({ where: { ipAssetId, accessLevel: "CONFIDENTIAL" } });
}

/**
 * 지식재산권 거래 주문.
 * 독점 거래는 결제·계약 진행 중 중복 판매를 막기 위해 잠금 처리한다.
 * 소스 파일 전달만으로 모든 권리가 이전되었다고 표시하지 않는다.
 */
export async function createIpOrder(actor: Actor, ipAssetId: string) {
  const asset = await prisma.ipAsset.findUnique({ where: { id: ipAssetId }, include: { seller: true } });
  if (!asset) throw new DomainError("NOT_FOUND", "자산을 찾을 수 없습니다.", 404);
  if (asset.status !== "ACTIVE") throw new DomainError("STATE_NOT_ALLOWED", "현재 거래할 수 없는 자산입니다.", 409);
  if (asset.exclusiveOrderId) {
    throw new DomainError("CONFLICT", "이미 다른 거래가 진행 중인 독점 자산입니다.", 409);
  }

  const commission = Math.floor(asset.priceKrw * 0.1);
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNo: newOrderNo(),
        buyerId: actor.id,
        sellerId: asset.sellerId,
        type: "IP_ASSIGNMENT",
        grossAmount: asset.priceKrw,
        commissionRateBp: 1000,
        commissionAmount: commission,
        sellerNetAmount: asset.priceKrw - commission,
        inspectionDays: 14,
        snapshot: {
          version: 1,
          capturedAt: new Date().toISOString(),
          product: {
            id: asset.id,
            type: "IP_ASSIGNMENT",
            title: asset.title,
            summary: asset.publicIntro.slice(0, 200),
            category: "지식재산권",
            licenseType: "PERPETUAL",
            licenseMonths: null,
            seats: null,
            platforms: [],
            sourceIncluded: true,
            installSupport: false,
            thirdPartyDeps: asset.thirdParty,
            externalCostNote: null,
            priceKrw: asset.priceKrw,
            inspectionDays: 14,
            refundPolicy: null,
            deliveryNote: "권리 이전 절차는 계약 조건에 따릅니다.",
            seller: {
              id: asset.seller.id,
              displayName: asset.seller.displayName,
              sellerType: asset.seller.sellerType,
              userId: asset.seller.userId,
            },
          },
          files: [],
          fee: {
            policyId: null,
            commissionRateBp: 1000,
            paymentFeeRateBp: 0,
            paymentFeeBearer: "SELLER",
            discountRateBp: 0,
            sellerType: asset.seller.sellerType,
            withholdingRateBp: asset.seller.sellerType === "INDIVIDUAL" ? 330 : 0,
            breakdown: { gross: asset.priceKrw, commission },
            note: "기본 정책",
          },
          terms: {
            withdrawalConsentVersion: POLICY_VERSIONS.withdrawalConsent,
            inspectionDays: 14,
            escrowScope: "platform_internal_hold",
          },
        } as never,
        escrow: { create: { holdState: "NOT_REQUESTED", provider: "mockpg" } },
      },
    });
    await tx.ipAsset.update({
      where: { id: asset.id },
      data: { exclusiveOrderId: created.id, status: "EXCLUSIVE_LOCKED" },
    });
    return created;
  });

  await notify({
    userId: asset.seller.userId,
    kind: "IP_ORDER_CREATED",
    title: "지식재산권 거래 주문이 생성되었습니다",
    body: `${asset.title} · ${formatKrw(asset.priceKrw)}`,
    link: `/orders/${order.id}`,
  });
  await audit({ actor, action: "IP_ORDER_CREATED", targetType: "IpAsset", targetId: asset.id });
  return order;
}
