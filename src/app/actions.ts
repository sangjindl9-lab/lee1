"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toUserMessage } from "@/lib/errors";
import { getCurrentActor, requireActor, setSession } from "@/lib/session";
import { registerUser, authenticate, upsertSellerProfile } from "@/server/services/auth";
import * as catalog from "@/server/services/catalog";
import * as orders from "@/server/services/orders";
import * as checkout from "@/server/services/checkout";
import * as delivery from "@/server/services/delivery";
import * as inspection from "@/server/services/inspection";
import * as dispute from "@/server/services/dispute";
import * as refund from "@/server/services/refund";
import * as payout from "@/server/services/payout";
import * as customDev from "@/server/services/custom-dev";
import * as ip from "@/server/services/ip";
import * as recon from "@/server/services/reconciliation";
import { approveSandboxPayment } from "@/server/payments/webhooks";

function fail(path: string, e: unknown): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}error=${encodeURIComponent(toUserMessage(e))}`);
}

function ok(path: string, message?: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(message ? `${path}${sep}ok=${encodeURIComponent(message)}` : path);
}

// ── 인증
export async function registerAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  let userId = "";
  try {
    const user = await registerUser({ email, password, name, phone });
    userId = user.id;
  } catch (e) {
    fail("/register", e);
  }
  await setSession(userId);
  ok("/dashboard/purchases");
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/dashboard/purchases");
  let userId = "";
  try {
    const user = await authenticate({ email, password });
    userId = user.id;
  } catch (e) {
    fail(`/login?next=${encodeURIComponent(next)}`, e);
  }
  await setSession(userId);
  ok(next.startsWith("/") ? next : "/dashboard/purchases");
}

// ── 판매자
export async function becomeSellerAction(formData: FormData) {
  const actor = await requireActor("/dashboard/seller");
  try {
    await upsertSellerProfile(actor, {
      sellerType: (String(formData.get("sellerType")) as "BUSINESS" | "INDIVIDUAL") || "INDIVIDUAL",
      displayName: String(formData.get("displayName") ?? ""),
      bizName: String(formData.get("bizName") ?? "") || undefined,
      bizRegNo: String(formData.get("bizRegNo") ?? "") || undefined,
      taxEmail: String(formData.get("taxEmail") ?? "") || undefined,
      bankName: String(formData.get("bankName") ?? "") || undefined,
      accountNo: String(formData.get("accountNo") ?? "") || undefined,
      accountHolder: String(formData.get("accountHolder") ?? "") || undefined,
    });
  } catch (e) {
    fail("/dashboard/seller", e);
  }
  ok("/dashboard/seller", "판매자 정보가 등록되었습니다.");
}

// ── 상품
export async function createProductAction(formData: FormData) {
  const actor = await requireActor("/seller/products/new");
  let productId = "";
  try {
    const product = await catalog.createProduct(actor, {
      type: String(formData.get("type")) === "SOURCE" ? "SOURCE" : "SOLUTION",
      title: String(formData.get("title") ?? ""),
      summary: String(formData.get("summary") ?? ""),
      category: String(formData.get("category") ?? catalog.CATEGORIES[0]),
      problem: String(formData.get("problem") ?? ""),
      features: String(formData.get("features") ?? "").split("\n").filter(Boolean),
      includes: String(formData.get("includes") ?? "").split("\n").filter(Boolean),
      excludes: String(formData.get("excludes") ?? "").split("\n").filter(Boolean),
      platforms: formData.getAll("platforms").map(String),
      licenseType: String(formData.get("licenseType")) === "PERIOD" ? "PERIOD" : "PERPETUAL",
      licenseMonths: Number(formData.get("licenseMonths") ?? 12) || 12,
      seats: Number(formData.get("seats") ?? 0) || null,
      sourceIncluded: formData.get("sourceIncluded") === "on",
      installSupport: formData.get("installSupport") === "on",
      customization: formData.get("customization") === "on",
      thirdPartyDeps: String(formData.get("thirdPartyDeps") ?? "") || undefined,
      externalCostNote: String(formData.get("externalCostNote") ?? "") || undefined,
      inspectionDays: Number(formData.get("inspectionDays") ?? 7) || 7,
      deliveryNote: String(formData.get("deliveryNote") ?? "") || undefined,
      refundPolicy: String(formData.get("refundPolicy") ?? "") || undefined,
      priceKrw: Number(formData.get("priceKrw") ?? 0),
    });
    productId = product.id;
  } catch (e) {
    fail("/seller/products/new", e);
  }
  ok(`/seller/products/${productId}`, "상품 초안이 생성되었습니다. 납품 파일을 등록해 주세요.");
}

export async function uploadProductFileAction(formData: FormData) {
  const productId = String(formData.get("productId"));
  const actor = await requireActor(`/seller/products/${productId}`);
  const file = formData.get("file");
  try {
    if (!(file instanceof File)) throw new Error("파일을 선택해 주세요.");
    const buffer = Buffer.from(await file.arrayBuffer());
    await catalog.addProductFile(actor, {
      productId,
      fileName: file.name,
      buffer,
      mimeType: file.type,
    });
  } catch (e) {
    fail(`/seller/products/${productId}`, e);
  }
  revalidatePath(`/seller/products/${productId}`);
  ok(`/seller/products/${productId}`, "파일 검사 후 비공개 보관함에 저장했습니다.");
}

export async function submitProductAction(formData: FormData) {
  const productId = String(formData.get("productId"));
  const actor = await requireActor(`/seller/products/${productId}`);
  try {
    await catalog.submitProductForReview(actor, productId);
  } catch (e) {
    fail(`/seller/products/${productId}`, e);
  }
  ok(`/seller/products/${productId}`, "운영자 심사를 요청했습니다.");
}

export async function reviewProductAction(formData: FormData) {
  const actor = await requireActor("/admin/products");
  const productId = String(formData.get("productId"));
  try {
    await catalog.reviewProduct(actor, {
      productId,
      decision: String(formData.get("decision")) as "ACTIVE" | "BLOCKED" | "SUSPENDED",
      note: String(formData.get("note") ?? ""),
    });
  } catch (e) {
    fail("/admin/products", e);
  }
  ok("/admin/products", "상품 심사 결과를 반영했습니다.");
}

export async function toggleFavoriteAction(formData: FormData) {
  const productId = String(formData.get("productId"));
  const actor = await requireActor(`/products/${productId}`);
  await catalog.toggleFavorite(actor, productId);
  revalidatePath(`/products/${productId}`);
}

export async function askQuestionAction(formData: FormData) {
  const productId = String(formData.get("productId"));
  const actor = await requireActor(`/products/${productId}`);
  try {
    await catalog.askQuestion(actor, { productId, body: String(formData.get("body") ?? "") });
  } catch (e) {
    fail(`/products/${productId}`, e);
  }
  ok(`/products/${productId}`, "문의를 등록했습니다.");
}

export async function answerQuestionAction(formData: FormData) {
  const questionId = String(formData.get("questionId"));
  const back = String(formData.get("back") ?? "/dashboard/sales");
  const actor = await requireActor(back);
  try {
    await catalog.answerQuestion(actor, { questionId, answer: String(formData.get("answer") ?? "") });
  } catch (e) {
    fail(back, e);
  }
  ok(back, "답변을 등록했습니다.");
}

export async function writeReviewAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  try {
    await catalog.writeReview(actor, {
      orderId,
      rating: Number(formData.get("rating") ?? 5),
      body: String(formData.get("body") ?? ""),
    });
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  ok(`/orders/${orderId}`, "후기를 등록했습니다.");
}

// ── 주문·결제
export async function createOrderAction(formData: FormData) {
  const productId = String(formData.get("productId"));
  const actor = await requireActor(`/products/${productId}`);
  let orderId = "";
  try {
    const order = await orders.createOrder(actor, { productId });
    orderId = order.id;
  } catch (e) {
    fail(`/products/${productId}`, e);
  }
  redirect(`/checkout/${orderId}`);
}

export async function startPaymentAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/checkout/${orderId}`);
  let paymentId = "";
  try {
    const started = await checkout.startPayment(actor, {
      orderId,
      method: String(formData.get("method") ?? "CARD"),
      consentToWithdrawalLimit: formData.get("consent") === "agree",
      ip: String(formData.get("ip") ?? "0.0.0.0"),
      userAgent: "web",
    });
    paymentId = started.paymentId;
  } catch (e) {
    fail(`/checkout/${orderId}`, e);
  }
  redirect(`/pay/${paymentId}`);
}

export async function approveSandboxPaymentAction(formData: FormData) {
  const paymentId = String(formData.get("paymentId"));
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  void actor;
  try {
    await approveSandboxPayment(paymentId);
  } catch (e) {
    fail(`/pay/${paymentId}?orderId=${orderId}`, e);
  }
  revalidatePath(`/orders/${orderId}`);
  ok(`/orders/${orderId}`, "테스트 결제가 승인되었습니다. 납품물을 내려받을 수 있습니다.");
}

// ── 거래 진행
export async function deliverOrderAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  try {
    await delivery.deliverOrder(actor, { orderId, note: String(formData.get("note") ?? "") });
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  ok(`/orders/${orderId}`, "납품을 완료했습니다. 구매자 검수가 시작됩니다.");
}

export async function startInspectionAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  try {
    await inspection.startInspection(actor, orderId);
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  ok(`/orders/${orderId}`, "검수를 시작했습니다.");
}

export async function submitInspectionAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  const checklist = inspection.DEFAULT_CHECKLIST.map((item) => ({
    key: item.key,
    label: item.label,
    checked: formData.get(`chk_${item.key}`) === "on",
    note: String(formData.get(`note_${item.key}`) ?? "") || undefined,
  }));
  try {
    await inspection.submitInspection(actor, {
      orderId,
      checklist,
      decision: String(formData.get("decision")) as "APPROVED" | "REVISION_REQUESTED" | "DISPUTED",
      note: String(formData.get("note") ?? "") || undefined,
    });
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  ok(`/orders/${orderId}`, "검수 결과를 제출했습니다.");
}

export async function openDisputeAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  try {
    await dispute.openDispute(actor, {
      orderId,
      category: String(formData.get("category") ?? "OTHER"),
      body: String(formData.get("body") ?? ""),
    });
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  ok(`/orders/${orderId}`, "분쟁을 접수했습니다. 정산이 보류됩니다.");
}

export async function requestRefundAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  try {
    await refund.requestRefund(actor, {
      orderId,
      reason: String(formData.get("reason") ?? ""),
      amount: formData.get("amount") ? Number(formData.get("amount")) : undefined,
    });
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  ok(`/orders/${orderId}`, "환불을 요청했습니다. 운영자 확인 후 실제 취소가 진행됩니다.");
}

export async function requestPayoutAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const actor = await requireActor(`/orders/${orderId}`);
  let message = "";
  try {
    const r = await payout.requestPayout(actor, { orderId });
    message = r.message;
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  ok(`/orders/${orderId}`, message);
}

export async function resolvePayoutAction(formData: FormData) {
  const payoutId = String(formData.get("payoutId"));
  const back = String(formData.get("back") ?? "/admin/settlements");
  const actor = await requireActor(back);
  try {
    await payout.resolvePayout(payoutId, actor);
  } catch (e) {
    fail(back, e);
  }
  ok(back, "지급 결과를 사업자 조회로 확정했습니다.");
}

export async function processRefundAction(formData: FormData) {
  const refundId = String(formData.get("refundId"));
  const actor = await requireActor("/admin/settlements");
  let message = "";
  try {
    const r = await refund.processRefund(refundId, actor, {
      approve: formData.get("decision") === "approve",
      note: String(formData.get("note") ?? ""),
    });
    message = `처리 결과: ${r.status}`;
  } catch (e) {
    fail("/admin/settlements", e);
  }
  ok("/admin/settlements", message);
}

export async function decideDisputeAction(formData: FormData) {
  const disputeId = String(formData.get("disputeId"));
  const actor = await requireActor("/admin/disputes");
  try {
    await dispute.decideDispute(disputeId, actor, {
      resolution: String(formData.get("resolution")) as dispute.DisputeResolution,
      reason: String(formData.get("reason") ?? ""),
      refundAmount: formData.get("refundAmount") ? Number(formData.get("refundAmount")) : undefined,
    });
  } catch (e) {
    fail("/admin/disputes", e);
  }
  ok("/admin/disputes", "분쟁 판단을 기록했습니다.");
}

export async function runReconciliationAction() {
  const actor = await requireActor("/admin/reconciliation");
  void actor;
  let message = "";
  try {
    const run = await recon.runReconciliation("운영자 수동 대사");
    message = `대사 완료: ${run.checked}건 확인, 불일치 ${run.mismatchCount}건`;
  } catch (e) {
    fail("/admin/reconciliation", e);
  }
  ok("/admin/reconciliation", message);
}

// ── 맞춤 개발
export async function createDevRequestAction(formData: FormData) {
  const actor = await requireActor("/requests/new");
  let id = "";
  try {
    const req = await customDev.createDevRequest(actor, {
      title: String(formData.get("title") ?? ""),
      purpose: String(formData.get("purpose") ?? ""),
      features: String(formData.get("features") ?? ""),
      environment: String(formData.get("environment") ?? ""),
      budgetKrw: formData.get("budgetKrw") ? Number(formData.get("budgetKrw")) : undefined,
      deadline: String(formData.get("deadline") ?? "") || undefined,
      sourceCondition: String(formData.get("sourceCondition") ?? "") || undefined,
      rights: String(formData.get("rights") ?? "") || undefined,
      maintenance: String(formData.get("maintenance") ?? "") || undefined,
      visibility: String(formData.get("visibility")) === "PRIVATE" ? "PRIVATE" : "PUBLIC",
    });
    id = req.id;
  } catch (e) {
    fail("/requests/new", e);
  }
  ok(`/requests/${id}`, "의뢰를 등록했습니다.");
}

export async function submitQuoteAction(formData: FormData) {
  const requestId = String(formData.get("requestId"));
  const actor = await requireActor(`/requests/${requestId}`);
  const titles = formData.getAll("stageTitle").map(String);
  const deliverables = formData.getAll("stageDeliverables").map(String);
  const amounts = formData.getAll("stageAmount").map((v) => Number(v) || 0);
  const milestones = titles.map((title, i) => ({
    title,
    deliverables: deliverables[i] ?? "",
    amountKrw: amounts[i] ?? 0,
  }));
  try {
    await customDev.submitQuote(actor, {
      requestId,
      scope: String(formData.get("scope") ?? ""),
      outOfScope: String(formData.get("outOfScope") ?? ""),
      milestones,
      inspectionCriteria: String(formData.get("inspectionCriteria") ?? ""),
      support: String(formData.get("support") ?? "") || undefined,
    });
  } catch (e) {
    fail(`/requests/${requestId}`, e);
  }
  ok(`/requests/${requestId}`, "견적을 제출했습니다.");
}

export async function selectQuoteAction(formData: FormData) {
  const quoteId = String(formData.get("quoteId"));
  const back = String(formData.get("back") ?? "/dashboard/requests");
  const actor = await requireActor(back);
  let contractId = "";
  try {
    const contract = await customDev.selectQuote(actor, quoteId);
    contractId = contract.id;
  } catch (e) {
    fail(back, e);
  }
  redirect(`/dashboard/contracts/${contractId}`);
}

export async function signContractAction(formData: FormData) {
  const contractId = String(formData.get("contractId"));
  const actor = await requireActor(`/dashboard/contracts/${contractId}`);
  try {
    await customDev.signContract(actor, contractId);
  } catch (e) {
    fail(`/dashboard/contracts/${contractId}`, e);
  }
  ok(`/dashboard/contracts/${contractId}`, "서명했습니다.");
}

export async function stageOrderAction(formData: FormData) {
  const stageId = String(formData.get("stageId"));
  const actor = await requireActor("/dashboard/requests");
  let orderId = "";
  try {
    const order = await customDev.createStageOrder(actor, { stageId });
    orderId = order.id;
  } catch (e) {
    fail("/dashboard/requests", e);
  }
  redirect(`/checkout/${orderId}`);
}

export async function proposeChangeAction(formData: FormData) {
  const contractId = String(formData.get("contractId"));
  const actor = await requireActor(`/dashboard/contracts/${contractId}`);
  try {
    await customDev.proposeChange(actor, {
      contractId,
      description: String(formData.get("description") ?? ""),
      addedAmount: Number(formData.get("addedAmount") ?? 0),
      addedDays: Number(formData.get("addedDays") ?? 0),
    });
  } catch (e) {
    fail(`/dashboard/contracts/${contractId}`, e);
  }
  ok(`/dashboard/contracts/${contractId}`, "변경 계약을 제안했습니다.");
}

export async function agreeChangeAction(formData: FormData) {
  const changeId = String(formData.get("changeId"));
  const contractId = String(formData.get("contractId"));
  const actor = await requireActor(`/dashboard/contracts/${contractId}`);
  try {
    await customDev.agreeChange(actor, changeId);
  } catch (e) {
    fail(`/dashboard/contracts/${contractId}`, e);
  }
  ok(`/dashboard/contracts/${contractId}`, "변경 계약에 동의했습니다.");
}

// ── 지식재산권
export async function acceptNdaAction(formData: FormData) {
  const ipAssetId = String(formData.get("ipAssetId"));
  const actor = await requireActor(`/ip/${ipAssetId}`);
  try {
    await ip.acceptNda(actor, ipAssetId);
  } catch (e) {
    fail(`/ip/${ipAssetId}`, e);
  }
  ok(`/ip/${ipAssetId}`, "비밀유지에 동의했습니다. 비공개 자료를 열람할 수 있습니다.");
}

export async function createIpOrderAction(formData: FormData) {
  const ipAssetId = String(formData.get("ipAssetId"));
  const actor = await requireActor(`/ip/${ipAssetId}`);
  let orderId = "";
  try {
    const order = await ip.createIpOrder(actor, ipAssetId);
    orderId = order.id;
  } catch (e) {
    fail(`/ip/${ipAssetId}`, e);
  }
  redirect(`/checkout/${orderId}`);
}

// ── 고객지원
export async function createTicketAction(formData: FormData) {
  const actor = await requireActor("/support");
  try {
    await prisma.supportTicket.create({
      data: {
        userId: actor.id,
        category: String(formData.get("category") ?? "ETC"),
        title: String(formData.get("title") ?? ""),
        body: String(formData.get("body") ?? ""),
      },
    });
  } catch (e) {
    fail("/support", e);
  }
  ok("/support", "문의가 접수되었습니다.");
}

export async function markNotificationsReadAction() {
  const actor = await getCurrentActor();
  if (actor) {
    await prisma.notification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  }
  revalidatePath("/dashboard");
}

export async function sendMessageAction(formData: FormData) {
  const threadId = String(formData.get("threadId"));
  const body = String(formData.get("body") ?? "");
  const back = String(formData.get("back") ?? "/dashboard/messages");
  const actor = await requireActor(back);
  if (body.trim()) {
    await prisma.message.create({ data: { threadId, senderId: actor.id, body } });
  }
  revalidatePath(back);
  ok(back);
}

// ── 다운로드
export async function issueDownloadAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const orderFileId = String(formData.get("orderFileId"));
  const actor = await requireActor(`/orders/${orderId}`);
  let token = "";
  try {
    const { issueDownload } = await import("@/server/services/downloads");
    const ticket = await issueDownload(actor, { orderId, orderFileId, ip: "web", userAgent: "web" });
    token = ticket.token;
  } catch (e) {
    fail(`/orders/${orderId}`, e);
  }
  redirect(`/api/downloads/${token}`);
}

export async function reviewSellerAction(formData: FormData) {
  const actor = await requireActor("/admin/sellers");
  const sellerId = String(formData.get("sellerId"));
  try {
    const { reviewSeller } = await import("@/server/services/auth");
    await reviewSeller(actor, {
      sellerId,
      decision: String(formData.get("decision")) as "ACTIVE" | "SUSPENDED",
      note: String(formData.get("note") ?? ""),
    });
  } catch (e) {
    fail("/admin/sellers", e);
  }
  ok("/admin/sellers", "판매자 심사 결과를 반영했습니다.");
}

// ── 지식재산권 등록
export async function createIpAssetAction(formData: FormData) {
  const actor = await requireActor("/seller/ip/new");
  let assetId = "";
  try {
    const asset = await ip.createIpAsset(actor, {
      title: String(formData.get("title") ?? ""),
      rightsType: String(formData.get("rightsType") ?? "저작재산권 양도"),
      target: String(formData.get("target") ?? ""),
      owner: String(formData.get("owner") ?? ""),
      authorityBasis: String(formData.get("authorityBasis") ?? "") || undefined,
      coOwners: String(formData.get("coOwners") ?? "") || undefined,
      transferMode: String(formData.get("transferMode")) as
        | "ASSIGNMENT"
        | "EXCLUSIVE_LICENSE"
        | "NON_EXCLUSIVE_LICENSE"
        | "CONSULTATION",
      period: String(formData.get("period") ?? "") || undefined,
      territory: String(formData.get("territory") ?? "") || undefined,
      field: String(formData.get("field") ?? "") || undefined,
      existingLicenses: String(formData.get("existingLicenses") ?? "") || undefined,
      thirdParty: String(formData.get("thirdParty") ?? "") || undefined,
      includedAssets: String(formData.get("includedAssets") ?? ""),
      excludedAssets: String(formData.get("excludedAssets") ?? "") || undefined,
      priceKrw: Number(formData.get("priceKrw") ?? 0),
      publicIntro: String(formData.get("publicIntro") ?? ""),
      confidentialNote: String(formData.get("confidentialNote") ?? "") || undefined,
    });
    assetId = asset.id;
  } catch (e) {
    fail("/seller/ip/new", e);
  }
  ok(`/seller/ip/${assetId}`, "지식재산권 자산 초안이 등록되었습니다. 비공개 자료를 올려 주세요.");
}

export async function addIpVaultFileAction(formData: FormData) {
  const ipAssetId = String(formData.get("ipAssetId"));
  const actor = await requireActor(`/seller/ip/${ipAssetId}`);
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("파일을 선택해 주세요.");
    await ip.addIpVaultFile(actor, {
      ipAssetId,
      fileName: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
  } catch (e) {
    fail(`/seller/ip/${ipAssetId}`, e);
  }
  ok(`/seller/ip/${ipAssetId}`, "비공개 자료실에 저장했습니다.");
}
