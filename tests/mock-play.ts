/**
 * 가짜 Google Play Developer API. 실제 Google·실결제에 절대 닿지 않는다.
 * 테스트가 구독 상태를 직접 바꿔 가며 갱신·해지·만료·유예·보류·환불·장애를 재현한다.
 */
import { BillingError, type PlayApi, type SubscriptionV2 } from "@/lib/play-billing";

export type SubSpec = {
  productId?: string;
  basePlanId?: string;
  state?: string;
  expiry: Date;
  accountId?: string | null;
  profileId?: string | null;
  linked?: string | null;
  acked?: boolean;
  autoRenew?: boolean;
};

export class MockPlay implements PlayApi {
  subs = new Map<string, SubscriptionV2>();
  getCalls = 0;
  ackCalls = 0;
  /** true 면 모든 호출이 Google 장애(503)처럼 실패 */
  outage = false;
  /** 승인 요청 응답 방식 */
  ackMode: "ok" | "reject" | "reject-but-acked" | "outage" = "ok";
  /** 호출마다 지연(ms): 동시성 시험용 */
  delayMs = 0;

  put(token: string, s: SubSpec) {
    this.subs.set(token, {
      subscriptionState: s.state ?? "SUBSCRIPTION_STATE_ACTIVE",
      linkedPurchaseToken: s.linked ?? undefined,
      acknowledgementState: s.acked ? "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" : "ACKNOWLEDGEMENT_STATE_PENDING",
      externalAccountIdentifiers:
        s.accountId || s.profileId
          ? { obfuscatedExternalAccountId: s.accountId ?? undefined, obfuscatedExternalProfileId: s.profileId ?? undefined }
          : undefined,
      lineItems: [
        {
          productId: s.productId ?? "family_50",
          expiryTime: s.expiry.toISOString(),
          autoRenewingPlan: { autoRenewEnabled: s.autoRenew ?? s.state !== "SUBSCRIPTION_STATE_CANCELED" },
          offerDetails: { basePlanId: s.basePlanId ?? "monthly" },
        },
      ],
    });
  }

  /** 상태 일부만 바꾼다 (갱신·해지 등) */
  update(token: string, patch: Partial<SubSpec>) {
    const cur = this.subs.get(token);
    if (!cur) throw new Error(`no sub ${token}`);
    const li = cur.lineItems![0];
    this.put(token, {
      productId: li.productId,
      basePlanId: li.offerDetails?.basePlanId,
      state: patch.state ?? cur.subscriptionState,
      expiry: patch.expiry ?? new Date(li.expiryTime!),
      accountId: patch.accountId !== undefined ? patch.accountId : cur.externalAccountIdentifiers?.obfuscatedExternalAccountId,
      profileId: patch.profileId !== undefined ? patch.profileId : cur.externalAccountIdentifiers?.obfuscatedExternalProfileId,
      linked: patch.linked !== undefined ? patch.linked : cur.linkedPurchaseToken,
      acked: patch.acked ?? cur.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
      autoRenew: patch.autoRenew ?? li.autoRenewingPlan?.autoRenewEnabled,
    });
  }

  private async wait() {
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
  }

  async getSubscription(token: string): Promise<SubscriptionV2> {
    this.getCalls += 1;
    await this.wait();
    if (this.outage) throw new BillingError("PLAY_API_ERROR", "Google Play 구독 확인 실패 (503)", 503, true);
    const s = this.subs.get(token);
    if (!s) throw new BillingError("TOKEN_INVALID", "결제 정보를 찾을 수 없습니다.", 404, false);
    return JSON.parse(JSON.stringify(s)) as SubscriptionV2;
  }

  async acknowledge(_productId: string, token: string): Promise<void> {
    this.ackCalls += 1;
    await this.wait();
    if (this.outage || this.ackMode === "outage") throw new BillingError("PLAY_API_ERROR", "Google Play 결제 승인 실패 (503)", 503, true);
    if (this.ackMode === "reject") throw new BillingError("ACK_REJECTED", "결제 승인 요청이 거절되었습니다 (400)", 502, true);
    if (this.ackMode === "reject-but-acked") {
      this.update(token, { acked: true });
      throw new BillingError("ACK_REJECTED", "결제 승인 요청이 거절되었습니다 (400)", 502, true);
    }
    this.update(token, { acked: true });
  }
}

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const GB = 1024 ** 3;
export const MB = 1024 ** 2;

export function fromNow(ms: number) {
  return new Date(Date.now() + ms);
}

/** Pub/Sub 푸시 본문 만들기 */
export function rtdnBody(messageId: string, note: Record<string, unknown>) {
  const data = Buffer.from(JSON.stringify({ version: "1.0", packageName: "kr.eumsoft.familyalbum", ...note })).toString("base64");
  return { message: { data, messageId, publishTime: new Date().toISOString() }, subscription: "projects/x/subscriptions/y" };
}

export function subNote(token: string, type: number, eventTime: number) {
  return { eventTimeMillis: String(eventTime), subscriptionNotification: { version: "1.0", notificationType: type, purchaseToken: token } };
}
