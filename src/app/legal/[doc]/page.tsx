import { notFound } from "next/navigation";
import { BRAND, WITHDRAWAL_CONSENT_TEXT } from "@/lib/brand";

export const dynamic = "force-dynamic";

const DOCS: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "이용약관",
    body: [
      `${BRAND.full}(이하 "회사")가 운영하는 ${BRAND.nameKo} 서비스의 이용 조건을 정합니다.`,
      "1. 회원은 구매자와 판매자 역할을 함께 가질 수 있으며, 기업 계정은 관리자·구매 담당자·검수 담당자 권한을 구분합니다.",
      "2. 회사는 상품 등록 심사, 파일 사전 검사, 거래 상태 관리, 분쟁 검토, 정산 확인 업무를 수행합니다.",
      "3. 회사가 제공하는 안전거래 장치는 결제 사업자의 기능과 플랫폼의 보관·검수 절차로 구성되며, 그 실제 보호 범위는 안전거래 안내에 표시된 범위를 넘지 않습니다.",
      "4. 판매자는 판매 권한이 있는 상품·소스·권리만 등록해야 하며, 타인의 소스나 권리를 침해하는 자료를 등록해서는 안 됩니다.",
      "5. 회사는 허위 정보, 권리 침해 신고, 반복적 분쟁이 확인된 상품의 신규 판매를 제한할 수 있습니다.",
      "6. 본 약관은 법률 검토 전 초안이며, 정식 운영 전 법률 검토를 거쳐 확정됩니다.",
    ],
  },
  privacy: {
    title: "개인정보처리방침",
    body: [
      `${BRAND.operatorName}(이하 "회사")는 서비스 제공에 필요한 최소한의 개인정보를 처리합니다.`,
      "1. 수집 항목: 이름, 이메일, 휴대전화번호(선택), 정산 계좌 정보(판매자), 접속 IP·기기 정보, 거래·다운로드 기록.",
      "2. 정산 계좌번호는 암호화하여 보관하며, 화면에는 마스킹된 형태로만 표시합니다.",
      "3. 청약철회 제한 동의 기록(동의 시각·IP·문구 버전)은 전자상거래법상 분쟁 대응을 위해 보관합니다.",
      "4. 납품 파일은 개인정보·비밀키가 포함되지 않도록 검사하며, 검사 결과를 파일 메타데이터로 보관합니다.",
      "5. 회원 탈퇴 후에도 이미 결제된 주문의 납품물 접근과 거래 기록은 관련 법령 및 분쟁 대응을 위해 정해진 기간 보관됩니다.",
      "6. 본 방침은 법률 검토 전 초안이며, 정식 운영 전 개인정보 보호법 검토를 거쳐 확정됩니다.",
    ],
  },
  withdrawal: {
    title: "청약철회·환불 정책",
    body: [
      `본 정책은 ${BRAND.nameKo}에서 판매되는 디지털 콘텐츠(프로그램, 소스코드, 지식재산권 자료)에 적용됩니다.`,
      "1. 구매자는 결제 전 제공물·라이선스·검수 조건을 확인하고, 다운로드 시작 시 단순 변심에 의한 청약철회가 제한됨에 동의합니다.",
      `2. 동의 문구: ${WITHDRAWAL_CONSENT_TEXT}`,
      "3. 상품의 내용이 표시·광고와 다르거나 계약과 다르게 이행된 경우에는 법령이 정한 기간 내 청약철회·환불을 요청할 수 있습니다.",
      "4. 환불 요청 접수와 환불 완료는 구분됩니다. 결제 사업자 취소가 확인된 후에만 완료로 표시합니다.",
      "5. 부분 환불을 지원하지 않는 결제수단은 전액 환불 후 재결제 또는 별도 송금 등 대체 절차를 안내합니다.",
      "6. 이미 정산이 완료된 거래는 일반 보류 절차로 되돌리지 않고 사후 환수 검토 절차로 접수합니다.",
      "7. 이미 다운로드된 파일은 회수할 수 없으며, 환불 후에는 추가 다운로드와 링크 사용이 차단됩니다.",
      "8. 본 정책은 법률 검토 전 초안이며, 정식 운영 전 전자상거래법 검토를 거쳐 확정됩니다.",
    ],
  },
};

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  return { title: DOCS[doc]?.title ?? "정책" };
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const entry = DOCS[doc];
  if (!entry) notFound();

  return (
    <div className="container-dv py-10">
      <h1 className="text-[1.625rem] font-black text-[var(--color-navy)]">{entry.title}</h1>
      <p className="mt-1 text-[0.75rem] text-[#8c98aa]">
        {BRAND.full} · 시행일 2026-11-01 · 법률 검토 전 초안
      </p>
      <div className="prose-ko mt-6 max-w-3xl">
        {entry.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      <div className="mt-8 rounded-lg bg-[var(--color-tint)] p-4 text-[0.75rem] leading-relaxed text-[#5a6a80]">
        본 문서는 서비스 개발 단계의 초안으로, 정식 출시 전 법률 검토가 필요합니다. 문의: {BRAND.email}
      </div>
    </div>
  );
}
