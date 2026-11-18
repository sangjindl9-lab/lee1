import { prisma } from "@/lib/db";
import { DomainError } from "@/lib/errors";
import { encryptSecret, hashPassword, maskAccount, verifyPassword } from "@/lib/crypto";
import { audit } from "./audit";
import type { Actor } from "./rbac";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function registerUser(input: {
  email: string;
  password: string;
  name: string;
  phone?: string;
}) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new DomainError("VALIDATION", "이메일 형식이 올바르지 않습니다.");
  if (input.password.length < 8) throw new DomainError("VALIDATION", "비밀번호는 8자 이상이어야 합니다.");
  if (!input.name.trim()) throw new DomainError("VALIDATION", "이름을 입력해 주세요.");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new DomainError("CONFLICT", "이미 가입된 이메일입니다.", 409);

  return prisma.user.create({
    data: {
      email,
      name: input.name.trim(),
      phone: input.phone?.trim() || null,
      passwordHash: await hashPassword(input.password),
      roles: { create: [{ role: "MEMBER" }] },
    },
  });
}

export async function authenticate(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new DomainError("UNAUTHENTICATED", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw new DomainError("UNAUTHENTICATED", "이메일 또는 비밀번호가 올바르지 않습니다.", 401);
  if (user.status !== "ACTIVE") {
    throw new DomainError("FORBIDDEN", "이용이 정지된 계정입니다. 고객센터로 문의해 주세요.", 403);
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

/**
 * 판매자 등록 — 정산 유형(사업자/개인)에 따라 세금 처리 방식이 달라진다.
 * 계좌번호는 암호화해 보관하고, 변경 시 재인증·알림 대상으로 표시한다.
 */
export async function upsertSellerProfile(
  actor: Actor,
  input: {
    sellerType: "BUSINESS" | "INDIVIDUAL";
    displayName: string;
    bizName?: string;
    bizRegNo?: string;
    taxEmail?: string;
    bankName?: string;
    accountNo?: string;
    accountHolder?: string;
  },
) {
  if (!input.displayName.trim()) throw new DomainError("VALIDATION", "판매자 표시 이름을 입력해 주세요.");
  if (input.sellerType === "BUSINESS" && (!input.bizRegNo || !input.bizName)) {
    throw new DomainError("VALIDATION", "사업자 판매자는 사업자등록번호와 상호를 입력해야 합니다.");
  }

  const existing = await prisma.sellerProfile.findUnique({ where: { userId: actor.id } });
  const accountChanged =
    !!input.accountNo && !!existing?.accountCipher && !existing.accountVerifiedAt ? false : !!input.accountNo;

  const data = {
    sellerType: input.sellerType,
    displayName: input.displayName.trim(),
    bizName: input.bizName ?? null,
    bizRegNo: input.bizRegNo ?? null,
    taxEmail: input.taxEmail ?? null,
    bankName: input.bankName ?? null,
    accountHolder: input.accountHolder ?? null,
    ...(input.accountNo
      ? {
          accountCipher: encryptSecret(input.accountNo.replace(/\s/g, "")),
          accountMasked: maskAccount(input.accountNo),
          accountChangedAt: accountChanged ? new Date() : existing?.accountChangedAt,
        }
      : {}),
  };

  const profile = existing
    ? await prisma.sellerProfile.update({ where: { id: existing.id }, data })
    : await prisma.sellerProfile.create({
        data: { ...data, userId: actor.id, status: "PENDING" },
      });

  await prisma.roleAssignment.upsert({
    where: { userId_role_companyId: { userId: actor.id, role: "SELLER", companyId: null as never } },
    update: {},
    create: { userId: actor.id, role: "SELLER" },
  }).catch(() => undefined);

  await audit({
    actor,
    action: "SELLER_PROFILE_UPSERTED",
    targetType: "SellerProfile",
    targetId: profile.id,
    after: { sellerType: profile.sellerType, status: profile.status, accountChanged },
  });

  if (accountChanged) {
    await prisma.notification.create({
      data: {
        userId: actor.id,
        kind: "ACCOUNT_CHANGED",
        title: "정산 계좌가 변경되었습니다",
        body: "계좌 변경은 재인증이 필요합니다. 본인이 요청하지 않았다면 즉시 고객센터로 알려 주세요.",
        link: "/dashboard/seller",
      },
    });
  }

  return profile;
}

export async function reviewSeller(
  actor: Actor,
  input: { sellerId: string; decision: "ACTIVE" | "SUSPENDED"; note?: string },
) {
  const profile = await prisma.sellerProfile.update({
    where: { id: input.sellerId },
    data: { status: input.decision },
  });
  await prisma.notification.create({
    data: {
      userId: profile.userId,
      kind: "SELLER_REVIEW",
      title: input.decision === "ACTIVE" ? "판매자 심사가 승인되었습니다" : "판매자 판매가 중지되었습니다",
      body: input.note,
      link: "/dashboard/seller",
    },
  });
  await audit({
    actor,
    action: `SELLER_${input.decision}`,
    targetType: "SellerProfile",
    targetId: profile.id,
    after: { note: input.note },
  });
  return profile;
}
