import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { newContractNo, newRequestNo } from "@/lib/ids";
import { formatKrw } from "@/lib/money";
import { audit, notify } from "./audit";
import type { Actor } from "./rbac";

export interface MilestoneInput {
  title: string;
  deliverables: string;
  amountKrw: number;
  days?: number;
}

export async function createDevRequest(
  actor: Actor,
  input: {
    title: string;
    purpose: string;
    features: string;
    environment: string;
    budgetKrw?: number;
    deadline?: string;
    sourceCondition?: string;
    rights?: string;
    maintenance?: string;
    visibility?: "PUBLIC" | "PRIVATE";
    attachments?: unknown;
  },
) {
  const req = await prisma.devRequest.create({
    data: {
      requestNo: newRequestNo(),
      buyerId: actor.id,
      title: input.title,
      purpose: input.purpose,
      features: input.features,
      environment: input.environment,
      budgetKrw: input.budgetKrw ?? null,
      deadline: input.deadline,
      sourceCondition: input.sourceCondition,
      rights: input.rights,
      maintenance: input.maintenance,
      visibility: input.visibility ?? "PUBLIC",
      attachments: (input.attachments ?? undefined) as never,
      status: "OPEN",
    },
  });
  await audit({ actor, action: "DEV_REQUEST_CREATED", targetType: "DevRequest", targetId: req.id });
  return req;
}

export async function submitQuote(
  actor: Actor,
  input: {
    requestId: string;
    scope: string;
    outOfScope: string;
    milestones: MilestoneInput[];
    inspectionCriteria: string;
    support?: string;
  },
) {
  if (!actor.sellerProfileId) throw new DomainError("FORBIDDEN", "판매자만 견적을 제출할 수 있습니다.", 403);
  const request = await prisma.devRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new DomainError("NOT_FOUND", "의뢰를 찾을 수 없습니다.", 404);
  if (request.status === "CLOSED" || request.status === "CONTRACTED") {
    throw new DomainError("STATE_NOT_ALLOWED", "이미 종료된 의뢰에는 견적을 제출할 수 없습니다.", 409);
  }
  if (!input.milestones.length) throw new DomainError("VALIDATION", "단계별 견적을 1개 이상 입력해 주세요.");
  const total = input.milestones.reduce((s, m) => s + m.amountKrw, 0);
  if (total <= 0) throw new DomainError("VALIDATION", "견적 금액을 입력해 주세요.");

  const quote = await prisma.quote.create({
    data: {
      requestId: request.id,
      sellerId: actor.sellerProfileId,
      scope: input.scope,
      outOfScope: input.outOfScope,
      milestones: input.milestones as never,
      inspectionCriteria: input.inspectionCriteria,
      support: input.support,
      totalAmount: total,
    },
  });
  await prisma.devRequest.update({ where: { id: request.id }, data: { status: "QUOTING" } });
  await notify({
    userId: request.buyerId,
    kind: "QUOTE_RECEIVED",
    title: "새 견적이 도착했습니다",
    body: `${request.title} · ${formatKrw(total)}`,
    link: `/requests/${request.id}`,
  });
  await audit({ actor, action: "QUOTE_SUBMITTED", targetType: "Quote", targetId: quote.id });
  return quote;
}

/** 견적 선택 → 계약(초안)과 단계 생성. 계약서는 법률 검토 전 초안으로 표시한다. */
export async function selectQuote(actor: Actor, quoteId: string) {
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { request: true, seller: true, contract: true },
  });
  if (!quote) throw new DomainError("NOT_FOUND", "견적을 찾을 수 없습니다.", 404);
  if (quote.request.buyerId !== actor.id) {
    throw new DomainError("FORBIDDEN", "의뢰한 구매자만 견적을 선택할 수 있습니다.", 403);
  }
  if (quote.contract) throw new DomainError("CONFLICT", "이미 계약이 생성된 견적입니다.", 409);

  const milestones = quote.milestones as unknown as MilestoneInput[];
  const contract = await prisma.$transaction(async (tx) => {
    await tx.quote.update({ where: { id: quote.id }, data: { status: "SELECTED" } });
    await tx.quote.updateMany({
      where: { requestId: quote.requestId, id: { not: quote.id } },
      data: { status: "REJECTED" },
    });
    const created = await tx.contract.create({
      data: {
        contractNo: newContractNo(),
        requestId: quote.requestId,
        quoteId: quote.id,
        buyerId: actor.id,
        sellerId: quote.sellerId,
        totalAmount: quote.totalAmount,
        status: "DRAFT",
        stages: {
          create: milestones.map((m, idx) => ({
            seq: idx + 1,
            title: m.title,
            deliverables: m.deliverables,
            amountKrw: m.amountKrw,
            status: idx === 0 ? "AWAITING_PAYMENT" : "PENDING",
          })),
        },
      },
    });
    await tx.devRequest.update({ where: { id: quote.requestId }, data: { status: "CONTRACTED" } });
    return created;
  });

  await notify({
    userId: quote.seller.userId,
    kind: "CONTRACT_CREATED",
    title: "계약 초안이 생성되었습니다",
    body: "양측 서명 후 1단계 결제가 시작됩니다.",
    link: `/dashboard/contracts/${contract.id}`,
  });
  await audit({ actor, action: "CONTRACT_CREATED", targetType: "Contract", targetId: contract.id });
  return contract;
}

export async function signContract(actor: Actor, contractId: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { quote: { include: { seller: true } } },
  });
  if (!contract) throw new DomainError("NOT_FOUND", "계약을 찾을 수 없습니다.", 404);
  const isBuyer = contract.buyerId === actor.id;
  const isSeller = contract.quote.sellerId === actor.sellerProfileId;
  if (!isBuyer && !isSeller) throw new DomainError("FORBIDDEN", "계약 당사자만 서명할 수 있습니다.", 403);
  if (contract.status === "ACTIVE") throw new DomainError("CONFLICT", "이미 발효된 계약입니다.", 409);

  const now = new Date();
  const updated = await prisma.contract.update({
    where: { id: contract.id },
    data: {
      signedByBuyerAt: isBuyer ? now : contract.signedByBuyerAt,
      signedBySellerAt: isSeller ? now : contract.signedBySellerAt,
    },
  });
  const bothSigned = !!updated.signedByBuyerAt && !!updated.signedBySellerAt;
  if (bothSigned) {
    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: "ACTIVE",
        agreementHash: `draft-${contract.contractNo}-v${contract.version}`,
      },
    });
  }
  await audit({ actor, action: "CONTRACT_SIGNED", targetType: "Contract", targetId: contract.id });
  return { signed: bothSigned, signedByMe: true };
}

/**
 * 단계 주문 생성 — 현재 단계의 결제가 확인된 뒤 작업을 시작한다.
 * 한 번에 전체 금액을 나눠 받는 임의 분할 결제가 아니라, 단계별 별도 주문으로 처리한다.
 */
export async function createStageOrder(actor: Actor, input: { stageId: string }) {
  const stage = await prisma.contractStage.findUnique({
    where: { id: input.stageId },
    include: { contract: { include: { request: true, quote: { include: { seller: true } } } } },
  });
  if (!stage) throw new DomainError("NOT_FOUND", "단계를 찾을 수 없습니다.", 404);
  const contract = stage.contract;
  if (contract.buyerId !== actor.id) {
    throw new DomainError("FORBIDDEN", "구매자만 단계 결제를 진행할 수 있습니다.", 403);
  }
  if (contract.status !== "ACTIVE") {
    throw new DomainError("STATE_NOT_ALLOWED", "양측 서명이 완료된 계약만 결제할 수 있습니다.", 409);
  }
  const earlier = await prisma.contractStage.findMany({
    where: { contractId: contract.id, seq: { lt: stage.seq } },
  });
  if (earlier.some((s) => s.status !== "SETTLED" && s.status !== "APPROVED")) {
    throw new DomainError("STATE_NOT_ALLOWED", "이전 단계가 완료되지 않아 이 단계를 시작할 수 없습니다.", 409);
  }
  if (stage.orderId) throw new DomainError("CONFLICT", "이미 결제 주문이 생성된 단계입니다.", 409);

  const breakdown = {
    gross: stage.amountKrw,
    commission: Math.floor(stage.amountKrw * 0.1),
  };
  const seller = contract.quote.seller;

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        orderNo: `TMP-${Date.now()}`,
        buyerId: actor.id,
        sellerId: contract.sellerId,
        type: "CUSTOM_STAGE",
        grossAmount: stage.amountKrw,
        commissionRateBp: 1000,
        commissionAmount: breakdown.commission,
        sellerNetAmount: stage.amountKrw - breakdown.commission,
        inspectionDays: 7,
        snapshot: {
          version: 1,
          capturedAt: new Date().toISOString(),
          product: {
            id: contract.id,
            type: "CUSTOM_STAGE",
            title: `${contract.request.title} - ${stage.seq}단계 ${stage.title}`,
            summary: stage.deliverables,
            category: "맞춤 개발",
            licenseType: "PERPETUAL",
            licenseMonths: null,
            seats: null,
            platforms: [],
            sourceIncluded: true,
            installSupport: false,
            thirdPartyDeps: null,
            externalCostNote: null,
            priceKrw: stage.amountKrw,
            inspectionDays: 7,
            refundPolicy: null,
            deliveryNote: stage.deliverables,
            seller: {
              id: seller.id,
              displayName: seller.displayName,
              sellerType: seller.sellerType,
              userId: seller.userId,
            },
          },
          files: [],
          fee: {
            policyId: null,
            commissionRateBp: 1000,
            paymentFeeRateBp: 0,
            paymentFeeBearer: "SELLER",
            discountRateBp: 0,
            sellerType: seller.sellerType,
            withholdingRateBp: seller.sellerType === "INDIVIDUAL" ? 330 : 0,
            breakdown,
            note: "기본 정책",
          },
          terms: {
            withdrawalConsentVersion: "2026-11-01",
            inspectionDays: 7,
            escrowScope: "platform_internal_hold",
          },
        } as never,
        escrow: { create: { holdState: "NOT_REQUESTED", provider: "mockpg" } },
      },
    });
    const { newOrderNo } = await import("@/lib/ids");
    await tx.contractStage.update({
      where: { id: stage.id },
      data: { orderId: created.id, status: "AWAITING_PAYMENT" },
    });
    return tx.order.update({ where: { id: created.id }, data: { orderNo: newOrderNo() } });
  });

  await audit({ actor, action: "STAGE_ORDER_CREATED", targetType: "Contract", targetId: contract.id });
  return order;
}

export async function proposeChange(
  actor: Actor,
  input: { contractId: string; description: string; addedAmount: number; addedDays: number },
) {
  const contract = await prisma.contract.findUnique({
    where: { id: input.contractId },
    include: { quote: true },
  });
  if (!contract) throw new DomainError("NOT_FOUND", "계약을 찾을 수 없습니다.", 404);
  const isParty = contract.buyerId === actor.id || contract.quote.sellerId === actor.sellerProfileId;
  if (!isParty) throw new DomainError("FORBIDDEN", "계약 당사자만 변경을 제안할 수 있습니다.", 403);

  const change = await prisma.contractChange.create({
    data: {
      contractId: contract.id,
      description: input.description,
      addedAmount: input.addedAmount,
      addedDays: input.addedDays,
    },
  });
  await notify({
    userId: contract.buyerId === actor.id ? contract.quote.sellerId : contract.buyerId,
    kind: "CONTRACT_CHANGE",
    title: "변경 계약이 제안되었습니다",
    body: input.description,
    link: `/dashboard/contracts/${contract.id}`,
  });
  return change;
}

export async function agreeChange(actor: Actor, changeId: string) {
  const change = await prisma.contractChange.findUnique({
    where: { id: changeId },
    include: { contract: { include: { quote: true } } },
  });
  if (!change) throw new DomainError("NOT_FOUND", "변경 계약을 찾을 수 없습니다.", 404);
  const contract = change.contract;
  const isBuyer = contract.buyerId === actor.id;
  const isSeller = contract.quote.sellerId === actor.sellerProfileId;
  if (!isBuyer && !isSeller) throw new DomainError("FORBIDDEN", "계약 당사자만 동의할 수 있습니다.", 403);

  const now = new Date();
  const updated = await prisma.contractChange.update({
    where: { id: change.id },
    data: {
      buyerAgreedAt: isBuyer ? now : change.buyerAgreedAt,
      sellerAgreedAt: isSeller ? now : change.sellerAgreedAt,
    },
  });
  if (updated.buyerAgreedAt && updated.sellerAgreedAt) {
    await prisma.contractChange.update({ where: { id: change.id }, data: { status: "AGREED" } });
    await prisma.contract.update({
      where: { id: contract.id },
      data: {
        version: { increment: 1 },
        totalAmount: { increment: change.addedAmount },
      },
    });
  }
  await audit({ actor, action: "CONTRACT_CHANGE_AGREED", targetType: "Contract", targetId: contract.id });
  return { agreed: !!(updated.buyerAgreedAt && updated.sellerAgreedAt) };
}
