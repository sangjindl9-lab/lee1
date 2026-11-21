export const ROLES = {
  PARENT: "PARENT",
  GRANDPARENT: "GRANDPARENT",
  FAMILY: "FAMILY",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const UPLOAD_STATUS = {
  PENDING: "PENDING",
  UPLOADING: "UPLOADING",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;

export type UploadStatus = (typeof UPLOAD_STATUS)[keyof typeof UPLOAD_STATUS];

export const UPLOAD_STATUS_LABEL: Record<string, string> = {
  PENDING: "대기",
  UPLOADING: "전송 중",
  DONE: "완료",
  FAILED: "실패",
};

export const MEDIA_KIND = {
  IMAGE: "IMAGE",
  VIDEO: "VIDEO",
} as const;

export const VISIBILITY = {
  FAMILY: "FAMILY",
  PARENTS_ONLY: "PARENTS_ONLY",
  PRIVATE: "PRIVATE",
} as const;

export const VISIBILITY_LABEL: Record<string, string> = {
  FAMILY: "가족 전체 공개",
  PARENTS_ONLY: "부모만 공개",
  PRIVATE: "나만 보기",
};

export const CARE_TYPE = {
  SLEEP: "SLEEP",
  FEEDING: "FEEDING",
} as const;

export const CARE_LABEL: Record<string, string> = {
  SLEEP: "수면",
  FEEDING: "수유",
};

export type AdScope = "PERSONAL" | "FAMILY";

export type Product = {
  id: string;
  title: string;
  priceKRW: number;
  scope: AdScope;
  period: string;
  removes: string[];
  covers: string[];
};

/** 광고 제거 상품 — 결제 화면에서 적용 범위를 명확히 보여주기 위한 정의 */
export const PRODUCTS: Record<string, Product> = {
  "adfree.personal.monthly": {
    id: "adfree.personal.monthly",
    title: "광고 제거 · 개인",
    priceKRW: 2900,
    scope: "PERSONAL",
    period: "월",
    removes: ["하단 배너 광고", "업로드 화면 광고", "앨범 사이 광고"],
    covers: ["결제한 본인 계정만"],
  },
  "adfree.family.monthly": {
    id: "adfree.family.monthly",
    title: "광고 제거 · 가족 전체",
    priceKRW: 4900,
    scope: "FAMILY",
    period: "월",
    removes: ["하단 배너 광고", "업로드 화면 광고", "앨범 사이 광고", "조부모 간편 모드 광고"],
    covers: ["결제한 본인", "같은 가족에 초대된 가족 전원 (조부모 포함)"],
  },
};

export const AD_SLOTS = {
  DASHBOARD: "dashboard",
  UPLOAD: "upload",
  ALBUM: "album",
} as const;

export type AdSlot = (typeof AD_SLOTS)[keyof typeof AD_SLOTS];

/** 데모 광고 소재 — 실제 광고 네트워크 연동 전 자리표시자 */
export const ADS: Record<string, { id: string; title: string; body: string; cta: string; advertiser: string }> = {
  "ad-diaper-01": {
    id: "ad-diaper-01",
    title: "밤새 촉촉한 신생아 기저귀",
    body: "12시간 흡수력 테스트 완료. 첫째부터 둘째까지 함께 쓰는 기저귀.",
    cta: "자세히 보기",
    advertiser: "데모 광고 · 베이비케어",
  },
  "ad-formula-02": {
    id: "ad-formula-02",
    title: "분유 알레르기 걱정 없는 저자극 분유",
    body: "소아과 자주 가는 아이라면 성분표를 확인하세요.",
    cta: "자세히 보기",
    advertiser: "데모 광고 · 키즈밀",
  },
};

export const MAX_UPLOAD_BYTES = 60 * 1024 * 1024; // 서버 경유 업로드 한도
export const MAX_DIRECT_UPLOAD_BYTES = 500 * 1024 * 1024; // 저장소 직접 업로드 한도
