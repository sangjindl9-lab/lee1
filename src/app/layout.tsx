import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "이음전력 진단",
  description: "가정·가게·사무실 전력 부족 가능성, 계약전력 증설, 설비 개선 범위 검토 서비스",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <a href="/" className="flex items-center gap-2 font-bold text-teal-800">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-700 text-white text-sm">이</span>
              이음전력 진단
            </a>
            <nav className="flex items-center gap-4 text-sm">
              <a href="/quick" className="text-slate-600 hover:text-teal-700">간편계산</a>
              <a href="/places" className="text-slate-600 hover:text-teal-700">내 장소</a>
              <a href="/login" className="text-slate-600 hover:text-teal-700">로그인</a>
              <a href="/admin" className="text-slate-600 hover:text-teal-700">관리</a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        <footer className="border-t border-slate-200 bg-white mt-12">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-slate-500 space-y-1">
            <p>이음전력 진단 — 계약전력 · 예상 사용전력 · 설비 수용능력을 구분하여 검토합니다.</p>
            <p>사진 분석은 보조 기능이며, 실제 부하·전선 허용전류·법적 적합성을 확정하지 않습니다. 한전 최종 산정 전 결과입니다.</p>
            <p>서비스명·로고·운영업체 정보는 관리자에서 변경할 수 있습니다.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
