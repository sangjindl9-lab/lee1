import Link from 'next/link';
import { F, Flash, In } from '../lib.tsx';
export default async function Login({ searchParams }: { searchParams: Promise<any> }) {
  const sp = await searchParams; const back = typeof sp.back === 'string' && sp.back.startsWith('/') ? sp.back : '/me';
  return (<div style={{ maxWidth: 420, margin: '0 auto' }}><h1>로그인</h1><Flash sp={sp} />
    <div className="card"><F a="login" back={back}><In label="이메일" name="email" type="email" required /><In label="비밀번호" name="password" type="password" required /><button className="pri">로그인</button></F></div>
    <p className="muted">계정이 없으면 <Link href="/register">회원가입</Link></p></div>);
}
