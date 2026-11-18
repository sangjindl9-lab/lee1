/**
 * 브랜드 설정 — 서비스명을 바꾸려면 이 파일 하나만 수정하면 된다.
 * 화면 타이틀, 로고, 푸터, 약관, 메타데이터, 이메일 문구, 테스트가 모두 이 값을 참조한다.
 */
export const BRAND = {
  nameKo: "데브볼트",
  nameEn: "DevVault",
  /** 예: 데브볼트 (DevVault) */
  get full() {
    return `${BRAND.nameKo} (${BRAND.nameEn})`;
  },
  tagline: "소프트웨어·소스코드·맞춤개발·지식재산권 거래를 한 곳에서",
  description:
    "완성형 솔루션과 소스코드, 맞춤 개발, 지식재산권을 계약 조건과 함께 거래하는 B2B 소프트웨어 마켓입니다.",
  domain: "devvault.kr",
  email: "help@devvault.kr",
  operatorName: "주식회사 데브볼트",
  bizRegNo: "000-00-00000",
  address: "강원특별자치도 원주시 시청로 264",
  /** 고객센터 운영 시간 */
  supportHours: "평일 10:00 ~ 18:00 (점심 12:30 ~ 13:30)",
  copyrightYear: 2026,
  /** 상태 표기 등에 쓰는 짧은 이름 (문장 중간 삽입용) */
  short: "데브볼트",
} as const;

export const BRAND_COLORS = {
  navy: "#0B1F3A",
  navySoft: "#16355C",
  accent: "#1E63D0",
  tint: "#F5F7FB",
  line: "#E3E8F0",
} as const;

/** 정책·동의 문서 버전. 문구를 바꾸면 버전을 올리고 동의 로그에 남긴다. */
export const POLICY_VERSIONS = {
  terms: "2026-11-01",
  privacy: "2026-11-01",
  withdrawalConsent: "2026-11-01",
  nda: "2026-11-01",
} as const;

export const WITHDRAWAL_CONSENT_TEXT =
  "본 상품은 구매 즉시 다운로드가 가능한 디지털 콘텐츠입니다. 「전자상거래 등에서의 소비자보호에 관한 법률」 제17조 제2항에 따라 " +
  "다운로드를 시작하면 청약철회(단순 변심 환불)가 제한됨을 확인하였으며, 이에 동의합니다. " +
  "다만 상품의 내용이 표시·광고와 다르거나 계약 내용과 다르게 이행된 경우에는 법령이 정한 기간 내 청약철회 및 환불을 요청할 수 있습니다.";

export const ESCROW_NOTICE = {
  title: "대금 보호 상태 안내",
  /** 실제 보장 범위를 정확히 표시한다. 과장 금지. */
  short:
    "본 화면의 대금 보호 표시는 연결된 결제 사업자의 실제 상태를 그대로 보여줍니다. 대금 보호 서비스가 연결되지 않은 거래는 '플랫폼 내부 정산 보류'로만 표시하며 실제 대금 보호로 표현하지 않습니다.",
  limitation:
    "플랫폼이 납품물을 비공개로 보관하고 검수 후 정산하는 구조는 소스코드 에스크로 전문 계약과 동일하지 않습니다. 이미 구매자에게 전달된 소스코드는 완전히 회수할 수 없습니다.",
} as const;

export const SERVICE_NAV = [
  { href: "/solutions", label: "솔루션 마켓" },
  { href: "/sources", label: "소스코드 마켓" },
  { href: "/requests", label: "맞춤 개발 의뢰" },
  { href: "/ip", label: "지식재산권 거래" },
  { href: "/experts", label: "전문가 찾기" },
  { href: "/trust", label: "안전거래 안내" },
  { href: "/support", label: "고객지원" },
] as const;

export const MEMBER_NAV = [
  { href: "/dashboard/purchases", label: "구매 관리" },
  { href: "/dashboard/sales", label: "판매 관리" },
  { href: "/dashboard/requests", label: "견적·의뢰 관리" },
  { href: "/dashboard/workspace", label: "거래별 작업실" },
  { href: "/dashboard/inspection", label: "계약·검수" },
  { href: "/dashboard/messages", label: "메시지" },
  { href: "/dashboard/settlement", label: "정산" },
  { href: "/dashboard/disputes", label: "신고·분쟁" },
] as const;
