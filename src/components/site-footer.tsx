import Link from "next/link";
import { BRAND, ESCROW_NOTICE, SERVICE_NAV } from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-[var(--color-line)] bg-[var(--color-tint)]">
      <div className="container-dv py-11">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="text-[1rem] font-extrabold text-[var(--color-navy)]">{BRAND.full}</div>
            <p className="mt-3 max-w-md text-[0.8125rem] leading-relaxed text-[#5a6a80]">{BRAND.description}</p>
            <p className="mt-4 text-[0.75rem] leading-relaxed text-[#7c8aa0]">
              {BRAND.operatorName} · 대표 이상진 · 사업자등록번호 {BRAND.bizRegNo}
              <br />
              {BRAND.address} · 고객센터 {BRAND.email} ({BRAND.supportHours})
            </p>
          </div>
          <div>
            <div className="text-[0.75rem] font-bold uppercase tracking-wider text-[#7c8aa0]">서비스</div>
            <ul className="mt-3 space-y-2 text-[0.8125rem] text-[#3c4a60]">
              {SERVICE_NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[0.75rem] font-bold uppercase tracking-wider text-[#7c8aa0]">정책·안내</div>
            <ul className="mt-3 space-y-2 text-[0.8125rem] text-[#3c4a60]">
              <li>
                <Link href="/legal/terms">이용약관</Link>
              </li>
              <li>
                <Link href="/legal/privacy">개인정보처리방침</Link>
              </li>
              <li>
                <Link href="/legal/withdrawal">청약철회·환불 정책</Link>
              </li>
              <li>
                <Link href="/trust">안전거래 안내</Link>
              </li>
              <li>
                <Link href="/admin">운영자 콘솔</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-9 rounded-lg border border-[var(--color-line)] bg-white p-4 text-[0.75rem] leading-relaxed text-[#5a6a80]">
          <strong className="text-[var(--color-navy)]">안전거래 고지</strong> — {ESCROW_NOTICE.short}
          <br />
          {ESCROW_NOTICE.limitation}
        </div>

        <div className="mt-6 text-[0.6875rem] text-[#8c98aa]">
          © {BRAND.copyrightYear} {BRAND.operatorName}. All rights reserved. 본 사이트의 결제·정산은 테스트
          환경(샌드박스)으로 동작하며 실제 금전 이동이 발생하지 않습니다.
        </div>
      </div>
    </footer>
  );
}
