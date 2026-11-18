import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const prisma = new PrismaClient();

async function hash(password: string) {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, k) => (err ? reject(err) : resolve(k))),
  );
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

const PASSWORD = "devvault1234";

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: "buyer@devvault.kr" } });
  if (existing) {
    console.log("이미 시드 데이터가 있습니다. (buyer@devvault.kr)");
    return;
  }

  const pw = await hash(PASSWORD);

  const company = await prisma.company.create({
    data: { name: "㈜한빛전력", bizRegNo: "214-88-01234" },
  });

  const admin = await prisma.user.create({
    data: {
      email: "admin@devvault.kr",
      name: "운영 최고관리자",
      passwordHash: pw,
      roles: {
        create: [
          { role: "SUPER_ADMIN" },
          { role: "OPERATOR_REVIEW" },
          { role: "OPERATOR_SUPPORT" },
          { role: "OPERATOR_SETTLEMENT" },
        ],
      },
    },
  });

  const reviewer = await prisma.user.create({
    data: {
      email: "reviewer@devvault.kr",
      name: "심사 담당",
      passwordHash: pw,
      roles: { create: [{ role: "OPERATOR_REVIEW" }, { role: "OPERATOR_SUPPORT" }] },
    },
  });

  const settlement = await prisma.user.create({
    data: {
      email: "settlement@devvault.kr",
      name: "정산 담당",
      passwordHash: pw,
      roles: { create: [{ role: "OPERATOR_SETTLEMENT" }] },
    },
  });

  const buyer = await prisma.user.create({
    data: {
      email: "buyer@devvault.kr",
      name: "김구매",
      passwordHash: pw,
      roles: { create: [{ role: "MEMBER" }, { role: "ENTERPRISE_BUYER", companyId: company.id }] },
    },
  });

  await prisma.companyMember.create({
    data: { companyId: company.id, userId: buyer.id, role: "BUYER", approvalLimitKrw: 5_000_000 },
  });

  const reviewerMember = await prisma.user.create({
    data: {
      email: "corp-review@devvault.kr",
      name: "박검수",
      passwordHash: pw,
      roles: { create: [{ role: "MEMBER" }, { role: "ENTERPRISE_REVIEWER", companyId: company.id }] },
    },
  });
  await prisma.companyMember.create({
    data: { companyId: company.id, userId: reviewerMember.id, role: "REVIEWER" },
  });

  const sellerUser = await prisma.user.create({
    data: {
      email: "seller@devvault.kr",
      name: "이판매",
      passwordHash: pw,
      roles: { create: [{ role: "MEMBER" }, { role: "SELLER" }] },
      sellerProfile: {
        create: {
          sellerType: "BUSINESS",
          displayName: "볼트소프트",
          intro: "중소 제조·전기공사 현장용 ERP와 자동화 도구를 만듭니다.",
          bizName: "볼트소프트",
          bizRegNo: "123-45-67890",
          taxEmail: "tax@eumsoft.test",
          bankName: "국민은행",
          accountHolder: "이판매",
          accountMasked: "123-***-5678",
          accountVerifiedAt: new Date(),
          status: "ACTIVE",
        },
      },
    },
    include: { sellerProfile: true },
  });

  const seller2User = await prisma.user.create({
    data: {
      email: "seller2@devvault.kr",
      name: "최프리",
      passwordHash: pw,
      roles: { create: [{ role: "MEMBER" }, { role: "SELLER" }] },
      sellerProfile: {
        create: {
          sellerType: "INDIVIDUAL",
          displayName: "프리랜서 최프리",
          intro: "문서 자동화·PDF·엑셀 처리 전문 프리랜서입니다.",
          bankName: "카카오뱅크",
          accountHolder: "최프리",
          accountMasked: "3333-**-1234",
          status: "ACTIVE",
        },
      },
    },
    include: { sellerProfile: true },
  });

  await prisma.feePolicy.create({
    data: {
      scope: "DEFAULT",
      commissionRateBp: 1000,
      paymentFeeRateBp: 0,
      paymentFeeBearer: "SELLER",
      note: "기본 수수료 10%",
    },
  });
  await prisma.feePolicy.create({
    data: {
      scope: "CATEGORY",
      category: "문서·PDF·엑셀 자동화",
      commissionRateBp: 800,
      paymentFeeRateBp: 0,
      paymentFeeBearer: "SELLER",
      discountRateBp: 100,
      discountUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      note: "문서 자동화 분야 프로모션 8% → 30일간 1% 추가 할인",
    },
  });

  interface SeedProduct {
    sellerId: string;
    type: "SOLUTION" | "SOURCE";
    title: string;
    summary: string;
    category: string;
    problem: string;
    features: string[];
    includes: string[];
    excludes: string[];
    platforms: string[];
    sourceIncluded: boolean;
    installSupport: boolean;
    customization: boolean;
    thirdPartyDeps: string;
    externalCostNote?: string;
    priceKrw: number;
    inspectionDays: number;
    deliveryNote?: string;
    refundPolicy?: string;
    licenseType?: "PERIOD" | "PERPETUAL";
    licenseMonths?: number;
  }

  const productSeeds: SeedProduct[] = [
    {
      sellerId: sellerUser.sellerProfile!.id,
      type: "SOURCE" as const,
      title: "전기공사 현장 일보·자재 관리 ERP (전체 소스)",
      summary: "현장 일보, 자재 입출고, 노무 일당을 한 화면에서 관리하는 웹 ERP 전체 소스입니다.",
      category: "건설·전기·통신",
      problem: "현장마다 엑셀로 관리하던 일보·자재·노무 데이터를 통합하고, 본사에서 실시간 집계합니다.",
      features: ["현장 일보 작성", "자재 입출고·재고", "노무 일당 계산", "본사 집계 대시보드", "엑셀 내보내기"],
      includes: ["전체 소스코드", "설치·배포 문서", "DB 스키마·마이그레이션", "환경변수 예시", "라이선스 고지"],
      excludes: ["서버 호스팅", "현장별 커스터마이징"],
      platforms: ["PC", "WEB"],
      sourceIncluded: true,
      installSupport: true,
      customization: true,
      thirdPartyDeps: "PostgreSQL 16 (무료), Next.js (MIT)",
      priceKrw: 8_800_000,
      inspectionDays: 7,
      deliveryNote: "결제 확인 후 즉시 다운로드",
      refundPolicy: "다운로드 시작 시 청약철회 제한",
    },
    {
      sellerId: sellerUser.sellerProfile!.id,
      type: "SOLUTION" as const,
      title: "그룹웨어 전자결재·근태 모듈 (기간제 사용권)",
      summary: "전자결재, 근태, 휴가 관리를 포함한 그룹웨어 모듈을 연간 사용권으로 제공합니다.",
      category: "ERP·그룹웨어",
      problem: "소규모 기업이 별도 구축 없이 결재·근태를 디지털화할 수 있습니다.",
      features: ["전자결재 결재선", "근태·휴가 신청", "조직도 연동", "권한 관리"],
      includes: ["연간 사용권", "설치 지원", "관리자 매뉴얼"],
      excludes: ["소스코드", "2차 개발"],
      platforms: ["WEB", "MOBILE"],
      sourceIncluded: false,
      installSupport: true,
      customization: false,
      thirdPartyDeps: "없음",
      externalCostNote: "서버 호스팅 별도(월 5만원 예상)",
      priceKrw: 2_400_000,
      inspectionDays: 10,
      deliveryNote: "결제 확인 후 계정 발급",
      refundPolicy: "다운로드·계정 발급 후 청약철회 제한",
    },
    {
      sellerId: seller2User.sellerProfile!.id,
      type: "SOURCE" as const,
      title: "PDF·엑셀 견적서 자동 생성 모듈 (Node.js)",
      summary: "견적서 템플릿과 데이터만 넣으면 PDF·엑셀을 자동 생성하는 모듈 소스입니다.",
      category: "문서·PDF·엑셀 자동화",
      problem: "매번 수작업으로 만들던 견적서를 데이터 기반으로 자동 생성합니다.",
      features: ["PDF 생성", "엑셀 생성", "템플릿 교체", "한글 폰트 지원"],
      includes: ["모듈 소스", "사용 예제", "설치 문서"],
      excludes: ["전체 서비스 소스", "UI 디자인"],
      platforms: ["PC", "WEB"],
      sourceIncluded: true,
      installSupport: false,
      customization: true,
      thirdPartyDeps: "pdf-lib (MIT), exceljs (MIT)",
      priceKrw: 1_200_000,
      inspectionDays: 5,
      deliveryNote: "결제 확인 후 즉시 다운로드",
      refundPolicy: "다운로드 시작 시 청약철회 제한",
    },
    {
      sellerId: seller2User.sellerProfile!.id,
      type: "SOLUTION" as const,
      title: "쇼핑몰 재고 동기화 봇 (웹서비스)",
      summary: "여러 판매 채널의 재고를 30분마다 동기화하는 웹서비스 이용권입니다.",
      category: "쇼핑몰·예약·고객관리",
      problem: "채널별 재고 불일치로 생기는 품절·과판매를 줄입니다.",
      features: ["다중 채널 연동", "재고 동기화", "알림", "이력 조회"],
      includes: ["월 이용권", "연동 가이드"],
      excludes: ["소스코드", "채널 API 계약 비용"],
      platforms: ["WEB"],
      licenseType: "PERIOD",
      licenseMonths: 12,
      sourceIncluded: false,
      installSupport: false,
      customization: false,
      thirdPartyDeps: "각 판매 채널 OpenAPI",
      externalCostNote: "채널별 API 사용료 별도",
      priceKrw: 660_000,
      inspectionDays: 5,
    },
  ];

  const created: Array<{ id: string; title: string }> = [];
  for (const p of productSeeds) {
    const product = await prisma.product.create({
      data: {
        sellerId: p.sellerId,
        type: p.type,
        title: p.title,
        summary: p.summary,
        category: p.category,
        problem: p.problem,
        features: p.features,
        includes: p.includes,
        excludes: p.excludes,
        platforms: p.platforms,
        licenseType: (p.licenseType as "PERIOD" | "PERPETUAL") ?? "PERPETUAL",
        licenseMonths: p.licenseMonths ?? null,
        sourceIncluded: p.sourceIncluded,
        installSupport: p.installSupport,
        customization: p.customization,
        thirdPartyDeps: p.thirdPartyDeps,
        externalCostNote: p.externalCostNote ?? null,
        inspectionDays: p.inspectionDays,
        deliveryNote: p.deliveryNote ?? null,
        refundPolicy: p.refundPolicy ?? null,
        priceKrw: p.priceKrw,
        status: "ACTIVE",
        publishedAt: new Date(),
      },
    });
    created.push({ id: product.id, title: product.title });

    // 실제 납품물 (텍스트 기반 예시 패키지)
    const body = [
      `# ${p.title}`,
      "",
      "이 파일은 데모용 예시 납품물입니다. 실제 상품에서는 실행 파일·소스·문서가 포함됩니다.",
      "",
      "## 설치 방법",
      "1. 압축을 해제합니다.",
      "2. .env.example 을 복사해 .env 로 만들고 값을 채웁니다.",
      "3. npm install && npm run build && npm start",
      "",
      "## 포함 파일",
      ...p.includes.map((i) => `- ${i}`),
    ].join("\n");
    const buf = Buffer.from(body, "utf8");
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    const key = `${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${crypto
      .randomBytes(16)
      .toString("hex")}.txt`;

    const { putFile } = await import("../src/server/storage/vault");
    const stored = await putFile(buf, `${p.title.slice(0, 20)}-package.txt`);

    await prisma.productFile.create({
      data: {
        productId: product.id,
        version: 1,
        fileName: `${p.title.slice(0, 24)}-package.txt`,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        storageKey: stored.storageKey,
        mimeType: "text/plain",
        scanStatus: "PASSED",
        scanFindings: {
          findings: [],
          notes: ["패턴 기반 사전 점검 통과", "이 검사는 악성코드 검사가 아닙니다."],
        } as never,
        uploadedById: sellerUser.id,
        isCurrent: true,
      },
    });
    void sha;
    void key;
  }

  // ── 데모 거래: 결제 완료 + 납품 + 검수 중
  const product = await prisma.product.findFirstOrThrow({ where: { title: productSeeds[2].title } });
  const file = await prisma.productFile.findFirstOrThrow({ where: { productId: product.id } });
  const gross = product.priceKrw;
  const commission = Math.floor(gross * 0.08);

  const order = await prisma.order.create({
    data: {
      orderNo: "DV-DEMO-000001",
      buyerId: buyer.id,
      buyerCompanyId: company.id,
      sellerId: product.sellerId,
      productId: product.id,
      type: "SOURCE",
      grossAmount: gross,
      commissionRateBp: 800,
      commissionAmount: commission,
      paymentFeeAmount: 0,
      vatAmount: Math.floor(commission / 10),
      withholdingTax: 0,
      sellerNetAmount: gross - commission,
      inspectionDays: product.inspectionDays,
      snapshot: {
        version: 1,
        capturedAt: new Date().toISOString(),
        product: {
          id: product.id,
          type: product.type,
          title: product.title,
          summary: product.summary,
          category: product.category,
          licenseType: product.licenseType,
          licenseMonths: product.licenseMonths,
          seats: null,
          platforms: product.platforms,
          sourceIncluded: product.sourceIncluded,
          installSupport: product.installSupport,
          thirdPartyDeps: product.thirdPartyDeps,
          externalCostNote: product.externalCostNote,
          priceKrw: product.priceKrw,
          inspectionDays: product.inspectionDays,
          refundPolicy: product.refundPolicy,
          deliveryNote: product.deliveryNote,
          seller: {
            id: product.sellerId,
            displayName: seller2User.sellerProfile!.displayName,
            sellerType: "INDIVIDUAL",
            userId: seller2User.id,
          },
        },
        files: [
          {
            productFileId: file.id,
            fileName: file.fileName,
            version: file.version,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            storageKey: file.storageKey,
          },
        ],
        fees: {},
        terms: { withdrawalConsentVersion: "2026-11-01", inspectionDays: product.inspectionDays },
      } as never,
      files: {
        create: [
          {
            productFileId: file.id,
            fileName: file.fileName,
            version: file.version,
            sizeBytes: file.sizeBytes,
            sha256: file.sha256,
            storageKey: file.storageKey,
          },
        ],
      },
      paymentStatus: "PAID",
      escrowStatus: "HELD",
      deliveryStatus: "DELIVERED",
      inspectionStatus: "IN_PROGRESS",
      payoutStatus: "NOT_ELIGIBLE",
      consentVersion: "2026-11-01",
      consentWithdrawalAt: new Date(),
      consentIp: "203.0.113.10",
      paidAt: new Date(),
      deliveryDueAt: new Date(Date.now() + 7 * 86400000),
      inspectionStartedAt: new Date(),
      inspectionEndsAt: new Date(Date.now() + 5 * 86400000),
      escrow: {
        create: {
          provider: "mockpg",
          providerRef: "mockh_demo",
          holdState: "HELD",
          note: "테스트 PG 모의 대금 보류입니다. 실제 대금 보호 서비스가 아닙니다.",
          requestedAt: new Date(),
        },
      },
      payments: {
        create: {
          provider: "mockpg",
          providerTxId: "mock_demo_tx_0001",
          method: "CARD",
          amount: gross,
          status: "PAID",
          idempotencyKey: "pay:demo:0001",
          approvedAt: new Date(),
        },
      },
      deliveries: {
        create: {
          attempt: 1,
          fileIds: [file.id] as never,
          status: "DELIVERED",
          deliveredById: seller2User.id,
          note: "데모 납품",
        },
      },
      consents: {
        create: {
          userId: buyer.id,
          kind: "WITHDRAWAL_LIMIT",
          version: "2026-11-01",
          ip: "203.0.113.10",
          userAgent: "seed",
          textHash: crypto.createHash("sha256").update("seed-consent").digest("hex"),
        },
      },
      ledger: {
        create: [
          { type: "PAYMENT_IN", amount: gross, idempotencyKey: "payment-in:demo", memo: "결제 승인 금액", sellerId: product.sellerId },
          { type: "COMMISSION", amount: commission, idempotencyKey: "commission:demo", memo: "플랫폼 수수료", sellerId: product.sellerId },
        ],
      },
    },
  });

  await prisma.messageThread.create({
    data: {
      orderId: order.id,
      subject: `${product.title} 거래`,
      buyerId: buyer.id,
      sellerId: seller2User.id,
      messages: {
        create: [
          { senderId: buyer.id, body: "납품 확인했습니다. 설치 문서대로 진행해 보겠습니다." },
          { senderId: seller2User.id, body: "네, 한글 폰트 경로만 .env에서 지정하시면 됩니다." },
        ],
      },
    },
  });

  // ── 지식재산권 자산
  const ipAsset = await prisma.ipAsset.create({
    data: {
      sellerId: sellerUser.sellerProfile!.id,
      title: "전기공사 현장관리 솔루션 사업 자산 일괄 양도",
      rightsType: "저작재산권 양도",
      target: "현장관리 솔루션 소스·상표·도메인·고객 계약",
      owner: "볼트소프트",
      authorityBasis: "자체 개발, 공동 권리자 없음",
      transferMode: "ASSIGNMENT",
      period: "영구",
      territory: "대한민국",
      field: "전기·건설 현장관리 소프트웨어",
      includedAssets: "소스 저장소, 빌드 문서, 디자인 원본, 도메인 1건, 상표 1건",
      excludedAssets: "기존 이용허락 2건의 유지 의무",
      priceKrw: 45_000_000,
      status: "ACTIVE",
      publicIntro:
        "10년간 운영한 현장관리 솔루션의 소스·상표·도메인·고객 계약을 일괄 양도합니다. 비공개 자료실에 권리 증빙과 계약서 초안이 있습니다.",
      confidentialNote: "권리 증빙·기존 이용허락 계약서는 NDA 후 열람",
    },
  });

  const ipBuf = Buffer.from(
    "권리 증빙 목록\n- 저작권 등록증 사본(예시)\n- 기존 이용허락 계약서 2건\n- 도메인 이전 동의서 양식\n",
    "utf8",
  );
  const { putFile } = await import("../src/server/storage/vault");
  const ipStored = await putFile(ipBuf, "권리증빙-목록.txt");
  await prisma.ipVaultFile.create({
    data: {
      ipAssetId: ipAsset.id,
      fileName: "권리증빙-목록.txt",
      sizeBytes: ipStored.sizeBytes,
      sha256: ipStored.sha256,
      storageKey: ipStored.storageKey,
      scanStatus: "PASSED",
    },
  });

  console.log("시드 완료", {
    admin: admin.email,
    reviewer: reviewer.email,
    settlement: settlement.email,
    buyer: buyer.email,
    seller: sellerUser.email,
    seller2: seller2User.email,
    products: created.length,
    order: order.orderNo,
  });
  console.log(`모든 데모 계정 비밀번호: ${PASSWORD}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
