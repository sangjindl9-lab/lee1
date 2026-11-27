import type { Metadata, Viewport } from "next";
import Shell from "@/components/Shell";
import "./globals.css";

export const metadata: Metadata = { title: "Shorts Factory AI", description: "주제 한 줄로 유튜브 쇼츠를 조사·제작·검수까지", manifest: "/manifest.json", icons: { icon: "/icon.svg" } };
export const viewport: Viewport = { themeColor: "#141415", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
