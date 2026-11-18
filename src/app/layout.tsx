import './globals.css';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { me, F } from './lib.tsx';
import { config } from '../server/config.ts';
import { db, one } from '../server/db.ts';

export const metadata = { title: '이음마켓 — 소프트웨어·소스코드·맞춤 개발 거래', description: '소프트웨어와 소스코드를 사고팔고, 맞춤 개발을 의뢰하고, 지식재산권을 거래하는 곳. 돈과 납품물의 상태를 거래마다 그대로 보여줍니다.' };
export const dynamic = 'force-dynamic';

export default async function Layout({ children }: { children: ReactNode }) {
  const u = await me();
  const unread = u ? (await one(db, 'SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL', [u.id])).n : 0;
  return (
    <html lang="ko"><body>
      {config.paymentProvider === 'test' && <div className="testbar">테스트 결제 환경입니다. 실제 결제, 결제대금 보호, 판매자 지급은 이루어지지 않습니다</div>}
      <header className="top"><div className="in">
        <Link href="/" className="brand">이음마켓<span>EUM MARKET</span></Link>
        <nav aria-label="주요 메뉴">
          <Link href="/market?kind=license">솔루션 마켓</Link><Link href="/market?kind=source">소스코드 마켓</Link><Link href="/requests">맞춤 개발 의뢰</Link>
          <Link href="/ip">지식재산권 거래</Link><Link href="/experts">전문가 찾기</Link><Link href="/safe-trade">안전거래 안내</Link><Link href="/support">고객지원</Link>
        </nav>
        <div className="user">
          {u ? <>
            <Link href="/me">내 거래{unread > 0 && ` · 알림 ${unread}`}</Link><Link href="/seller">판매 관리</Link>
            {u.operator_role && <Link href="/admin">운영</Link>}
            <F a="logout" back="/"><button className="link">로그아웃</button></F>
          </> : <><Link href="/login">로그인</Link><Link href="/register" className="btn">회원가입</Link></>}
        </div>
      </div></header>
      <main>{children}</main>
      <footer>이음마켓은 거래 당사자 사이의 중개 서비스입니다. 안전거래의 보호 범위와 한계는 <Link href="/safe-trade">안전거래 안내</Link>에서 확인하세요</footer>
    </body></html>
  );
}
