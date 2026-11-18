import type { Metadata } from "next";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: {
    default: `${BRAND.full} — ${BRAND.tagline}`,
    template: `%s | ${BRAND.nameKo}`,
  },
  description: BRAND.description,
  metadataBase: new URL(`https://${BRAND.domain}`),
  openGraph: {
    title: BRAND.full,
    description: BRAND.description,
    siteName: BRAND.nameKo,
    locale: "ko_KR",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="flex min-h-screen flex-col bg-white">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
