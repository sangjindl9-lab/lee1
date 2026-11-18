import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { prisma } from "@/lib/db";
import { getFile, resolveStoragePath } from "@/server/storage/vault";
import { issueDownload } from "@/server/services/downloads";
import { loadOrderForActor } from "@/server/services/access";
import { requestPayout } from "@/server/services/payout";
import { startPayment } from "@/server/services/checkout";
import { deliverOrder } from "@/server/services/delivery";
import {
  expectDomainError,
  makeOrderWithProduct,
  makeUser,
  payOrder,
  resetDb,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});

describe("필수 테스트 1. 결제하지 않은 사용자의 파일 접근 차단", () => {
  it("결제 전 주문은 다운로드 티켓이 발급되지 않고 다운로드 기록도 남지 않는다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);

    const file = await prisma.orderFile.findFirstOrThrow({ where: { orderId: order.id } });
    await expectDomainError(
      () => issueDownload(buyer, { orderId: order.id, orderFileId: file.id }),
      "PAYMENT_REQUIRED",
    );

    const grants = await prisma.downloadGrant.count({ where: { orderId: order.id } });
    expect(grants).toBe(0);
  });
});

describe("필수 테스트 2. 타인 주문과 정산 정보 접근 차단", () => {
  it("제3자는 주문 열람·다운로드·정산 요청을 할 수 없다", async () => {
    const seller = await makeUser({ seller: { type: "INDIVIDUAL" } });
    const buyer = await makeUser();
    const stranger = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);
    await deliverOrder(seller, { orderId: order.id });

    await expectDomainError(() => loadOrderForActor(stranger, order.id, "VIEW"), "FORBIDDEN");
    await expectDomainError(() => loadOrderForActor(stranger, order.id, "SETTLEMENT"), "FORBIDDEN");
    const file = await prisma.orderFile.findFirstOrThrow({ where: { orderId: order.id } });
    await expectDomainError(
      () => issueDownload(stranger, { orderId: order.id, orderFileId: file.id }),
      "FORBIDDEN",
    );
    await expectDomainError(() => requestPayout(stranger, { orderId: order.id }), "FORBIDDEN");
  });

  it("판매자는 구매자의 결제 정보를 정산 목적 외로 조작할 수 없다(판매자 지급 요청은 가능)", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);

    const sellerView = await loadOrderForActor(seller, order.id, "SETTLEMENT");
    expect(sellerView.buyerId).toBe(buyer.id);
    expect(sellerView.paymentStatus).toBe("PAID");
  });
});

describe("필수 테스트 3. 결제 완료 후 파일 전달 실패 시 복구", () => {
  it("저장소 장애로 전달이 실패해도 결제는 유지되고, 복구 후 같은 주문에서 다시 받을 수 있다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);
    await deliverOrder(seller, { orderId: order.id });

    const orderFile = await prisma.orderFile.findFirstOrThrow({ where: { orderId: order.id } });
    const path = resolveStoragePath(orderFile.storageKey);
    const original = await fs.readFile(path);

    // 저장소가 깨진 상황
    await fs.writeFile(path, Buffer.from("corrupted"));
    await expectDomainError(
      () => issueDownload(buyer, { orderId: order.id, orderFileId: orderFile.id }),
      "FILE_INTEGRITY",
    );

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.paymentStatus).toBe("PAID");

    // 복구
    await fs.writeFile(path, original);
    const ticket = await issueDownload(buyer, { orderId: order.id, orderFileId: orderFile.id });
    expect(ticket.url).toContain("/api/downloads/");
    const restored = await getFile(orderFile.storageKey);
    expect(restored.toString("utf8")).toContain("devvault test bundle");
  });
});

describe("필수 테스트 4. 빈 파일 및 누락 파일 납품 처리", () => {
  it("빈 파일은 납품물로 등록할 수 없다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { product } = await makeOrderWithProduct(seller, buyer);
    const { addProductFile } = await import("@/server/services/catalog");
    await expectDomainError(
      () => addProductFile(seller, { productId: product.id, fileName: "empty.zip", buffer: Buffer.alloc(0) }),
      "VALIDATION",
    );
  });

  it("누락 파일이 있는 상태로는 납품이 완료되지 않고 검수 기간도 시작되지 않는다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);

    const orderFile = await prisma.orderFile.findFirstOrThrow({ where: { orderId: order.id } });
    await fs.unlink(resolveStoragePath(orderFile.storageKey));

    await expectDomainError(() => deliverOrder(seller, { orderId: order.id }), "FILES_UNSAFE");

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.deliveryStatus).toBe("INCOMPLETE");
    expect(after.inspectionStatus).toBe("NOT_STARTED");
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: order.id } });
    expect(delivery.status).toBe("INCOMPLETE");
  });
});

describe("필수 테스트 5. 계약과 다른 파일로 몰래 교체 시도", () => {
  it("판매자가 새 버전을 올려도 기존 주문의 납품물 스냅샷은 바뀌지 않는다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { product, order } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);

    const snapshotBefore = (order.snapshot as { files: Array<{ sha256: string }> }).files[0];
    const { addProductFile } = await import("@/server/services/catalog");
    await addProductFile(seller, {
      productId: product.id,
      fileName: "erp-source-v2.txt",
      buffer: Buffer.from("// 교체된 파일(다른 내용)\n", "utf8"),
    });

    const orderFile = await prisma.orderFile.findFirstOrThrow({ where: { orderId: order.id } });
    expect(orderFile.sha256).toBe(snapshotBefore.sha256);

    const { redeemDownload } = await import("@/server/services/downloads");
    const ticket = await issueDownload(buyer, { orderId: order.id, orderFileId: orderFile.id });
    const downloaded = await redeemDownload(ticket.token, { ip: "10.0.0.9", userAgent: "vitest" });
    expect(downloaded.buffer.toString("utf8")).toContain("devvault test bundle");
    expect(downloaded.buffer.toString("utf8")).not.toContain("교체된 파일");
  });
});

describe("필수 테스트 6. 판매자 탈퇴 후 기존 구매 접근", () => {
  it("판매자가 탈퇴해도 이미 결제한 주문의 납품물 접근은 유지된다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order, product } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);
    await deliverOrder(seller, { orderId: order.id });

    await prisma.sellerProfile.update({
      where: { id: seller.sellerProfileId! },
      data: { status: "WITHDRAWN" },
    });
    await prisma.user.update({ where: { id: seller.id }, data: { status: "WITHDRAWN" } });
    await prisma.product.update({ where: { id: product.id }, data: { status: "SUSPENDED" } });

    const orderFile = await prisma.orderFile.findFirstOrThrow({ where: { orderId: order.id } });
    const ticket = await issueDownload(buyer, { orderId: order.id, orderFileId: orderFile.id });
    expect(ticket.fileName).toBe(orderFile.fileName);

    const stillThere = await prisma.orderFile.count({ where: { orderId: order.id } });
    expect(stillThere).toBeGreaterThan(0);
  });
});

describe("필수 테스트 7. 미납품 상태의 검수·정산 차단", () => {
  it("납품 전에는 검수 시작과 정산이 모두 차단된다", async () => {
    const seller = await makeUser({ seller: { type: "BUSINESS" } });
    const buyer = await makeUser();
    const { order } = await makeOrderWithProduct(seller, buyer);
    await payOrder(buyer, order.id);

    const { startInspection, submitInspection, DEFAULT_CHECKLIST } = await import(
      "@/server/services/inspection"
    );
    await expectDomainError(() => startInspection(buyer, order.id), "STATE_NOT_ALLOWED");
    await expectDomainError(
      () =>
        submitInspection(buyer, {
          orderId: order.id,
          decision: "APPROVED",
          checklist: DEFAULT_CHECKLIST.map((c) => ({ key: c.key, label: c.label, checked: true })),
        }),
      "STATE_NOT_ALLOWED",
    );
    await expectDomainError(() => requestPayout(seller, { orderId: order.id }), "STATE_NOT_ALLOWED");
  });
});
