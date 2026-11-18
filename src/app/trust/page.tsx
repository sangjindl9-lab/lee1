import Link from "next/link";
import { BRAND, ESCROW_NOTICE, WITHDRAWAL_CONSENT_TEXT } from "@/lib/brand";
import { Notice } from "@/components/ui";

export const metadata = { title: "안전거래 안내" };

const FLOW = [
  ["1", "상품과 체험 확인", "제공물·라이선스·검수 조건을 구매 전에 확인합니다."],
  ["2", "결제", "테스트 PG(샌드박스)로 결제하며, 실제 승인은 발생하지 않습니다."],
  ["3", "결제·대금 보호 상태 확인", "웹훅 서명 검증으로 결제 상태를 확정하고, 사업자 보류 상태를 조회합니다."],
  ["4", "납품물 접근 허용", "결제 완료 후에만 주문별 접근 권한과 만료 링크가 발급됩니다."],
  ["5", "다운로드·설치·검수", "다운로드와 구매확정은 별개 행위입니다."],
  ["6", "구매확정 또는 문제 제기", "검수 체크리스트로 승인, 수정 요청, 분쟁 전환을 선택합니다."],
  ["7", "정산 조건 확인", "결제·납품·검수·분쟁·환불 상태를 모두 다시 확인합니다."],
  ["8", "판매자 지급 요청", "응답이 불명확하면 재요청하지 않고 조회로 확정합니다."],
  ["9", "지급 성공 확인", "사업자 지급 결과를 확인한 뒤 정산 완료로 표시합니다."],
];

export default function TrustPage() {
  return (
    <div className="container-dv py-10">
      <h1 className="text-[1.75rem] font-black text-[var(--color-navy)]">안전거래 안내</h1>
      <p className="mt-2 max-w-3xl text-[0.9375rem] leading-relaxed text-[#5a6a80]">
        {BRAND.nameKo}의 안전거래는 세 가지 장치를 분리해 운영합니다. 각 장치의 실제 보장 범위를 정확히
        표시하고, 보장할 수 없는 것은 보장한다고 말하지 않습니다.
      </p>

      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {[
          {
            title: "① 결제대금 보호",
            body: "연결된 결제 사업자의 계약·기능으로 구현합니다. 현재 데모는 테스트 PG의 모의 보류 상태이며 실제 대금 보호가 아닙니다.",
            tone: "warn" as const,
          },
          {
            title: "② 납품물 보관",
            body: "판매 전 파일을 비공개 저장소에 암호화 보관하고, 주문 시점 버전·해시를 고정합니다. 전문 소스코드 에스크로 계약과 동일하지 않습니다.",
            tone: "info" as const,
          },
          {
            title: "③ 검수 후 정산",
            body: "납품·검수 승인·분쟁 없음·환불 없음·실제 지급 가능 잔액을 확인한 뒤 지급을 요청합니다.",
            tone: "success" as const,
          },
        ].map((c) => (
          <div key={c.title} className="card p-5">
            <div className="text-[0.9375rem] font-bold text-[var(--color-navy)]">{c.title}</div>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-[#5a6a80]">{c.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <Notice tone="warn" title="표현하지 않는 것">
          “100% 안전”, “무조건 환불”, “모든 권리 검증 완료”처럼 실제로 보장할 수 없는 표현은 사용하지 않습니다.
          플랫폼 내부 정산 보류를 실제 대금 보호 서비스로 표현하지 않으며, 납품물 보관을 전문 소스코드 에스크로
          계약과 동일하다고 표현하지 않습니다. 파일 해시는 동일성 확인용이며 기능 정상 작동이나 판매 권한을
          증명하지 않습니다.
        </Notice>
      </div>

      <h2 className="mt-10 text-[1.125rem] font-bold text-[var(--color-navy)]">완성형 상품 거래 절차</h2>
      <ol className="mt-4 space-y-3">
        {FLOW.map(([n, title, body]) => (
          <li key={n} className="flex gap-3 rounded-lg border border-[var(--color-line)] p-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-navy)] text-[0.6875rem] font-bold text-white">
              {n}
            </span>
            <div>
              <div className="text-[0.875rem] font-semibold text-[var(--color-navy)]">{title}</div>
              <p className="mt-0.5 text-[0.8125rem] text-[#5a6a80]">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h3 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">구매자 보호</h3>
          <ul className="mt-2 space-y-1 text-[0.8125rem] leading-relaxed text-[#5a6a80]">
            <li>· 납품 기한·검수 기한 알림</li>
            <li>· 미납품·누락 파일 확인과 수정 요청</li>
            <li>· 계약 기준별 문제 제기와 분쟁 접수</li>
            <li>· 환불 요청(접수와 완료를 구분)</li>
            <li>· 권리 침해 신고 시 신규 판매 제한 검토</li>
          </ul>
        </div>
        <div className="card p-5">
          <h3 className="text-[0.9375rem] font-bold text-[var(--color-navy)]">판매자 보호</h3>
          <ul className="mt-2 space-y-1 text-[0.8125rem] leading-relaxed text-[#5a6a80]">
            <li>· 구매 전 검수 기준·환경 조건 고지</li>
            <li>· 청약철회 제한 사전 동의 기록(시각·IP·버전)</li>
            <li>· 파일 접근·다운로드·납품 이력 보관</li>
            <li>· 수정 요청의 계약 범위 분류, 추가 견적</li>
            <li>· 검수 기한 알림·종료 심사 요청</li>
          </ul>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Notice tone="danger" title="환불 이후 소스코드의 한계">
          이미 구매자가 내려받은 파일은 플랫폼이 회수하거나 원격 삭제할 수 없습니다. 환불 후에는 추가 다운로드와
          링크 사용만 차단되며, 이용 중단 안내가 제공됩니다. 원격 삭제를 보장하지 않습니다.
        </Notice>
        <Notice tone="info" title="청약철회 제한 동의">
          {WITHDRAWAL_CONSENT_TEXT}
        </Notice>
      </div>

      <div className="mt-8 rounded-xl bg-[var(--color-tint)] p-5 text-[0.8125rem] leading-relaxed text-[#3c4a60]">
        <strong className="text-[var(--color-navy)]">실결제 도입 전 확인 항목</strong> — 디지털 상품·개발 용역 취급
        가능 여부, 다수 판매자 입점 구조 지원, 지원 결제수단, 대금 보호·정산 구조, 최대 보류 기간, 구매확정·자동확정
        방식, 분쟁 시 지급 중지 범위, 부분 환불 조건, 단계별 결제 지원 여부, 판매자 확인 절차, 기지급 거래 환불
        처리 방식. 자세한 목록은 문서 <code>docs/REAL-PG-LEGAL-CHECKLIST.md</code>에 정리했습니다.
      </div>

      <div className="mt-8 text-[0.75rem] text-[#8c98aa]">{ESCROW_NOTICE.short}</div>

      <div className="mt-8">
        <Link href="/support" className="btn btn-outline">
          고객지원 문의
        </Link>
      </div>
    </div>
  );
}
