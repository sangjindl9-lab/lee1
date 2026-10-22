import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper p-6 text-center">
      <div>
        <p className="num text-[48px] font-semibold text-faint">404</p>
        <p className="mt-2 text-section font-medium">찾는 화면이 없습니다</p>
        <Link href="/dashboard" className="mt-4 inline-block text-steel-ink underline underline-offset-2">대시보드로 가기</Link>
      </div>
    </div>
  );
}
