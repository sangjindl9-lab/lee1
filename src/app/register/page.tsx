import { F, Flash, In } from '../lib.tsx';
export default async function Register({ searchParams }: { searchParams: Promise<any> }) {
  const sp = await searchParams;
  return (<div style={{ maxWidth: 420, margin: '0 auto' }}><h1>회원가입</h1><Flash sp={sp} />
    <div className="card"><F a="register" back="/me"><In label="이름" name="name" required /><In label="이메일" name="email" type="email" required /><In label="비밀번호" name="password" type="password" required hint="10자 이상" /><button className="pri">가입</button></F></div>
    <p className="muted">한 계정으로 구매와 판매를 모두 할 수 있습니다. 판매는 판매자 등록과 심사 후 가능합니다</p></div>);
}
