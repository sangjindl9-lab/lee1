'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/shell';
import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

/** 단선결선도에서 따온 배경 그림 — 수전 → 변압기 → 차단기 → 분기 */
function SingleLineDiagram() {
  return (
    <svg viewBox="0 0 420 520" fill="none" className="h-full w-full" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
        <path d="M210 0v62" />
        <circle cx="210" cy="78" r="16" />
        <circle cx="210" cy="102" r="16" />
        <path d="M210 118v34" />
        <rect x="198" y="152" width="24" height="24" />
        <path d="M204 158l12 12" />
        <path d="M210 176v40" />
        <path d="M70 216h280" strokeWidth="2.4" />
        {[90, 160, 260, 330].map((x, i) => (
          <g key={x}>
            <path d={`M${x} 216v36`} />
            <path d={`M${x - 8} 252l16 -14`} />
            <path d={`M${x} 262v58`} />
            {i % 2 === 0 ? (
              <>
                <circle cx={x} cy={334} r="12" />
                <path d={`M${x - 6} 334h12M${x} 328v12`} />
              </>
            ) : (
              <path d={`M${x - 12} 320h24l-12 22z`} />
            )}
            <path d={`M${x} 346v70`} strokeDasharray="2 5" />
          </g>
        ))}
        <path d="M70 440h280" strokeDasharray="1 6" />
      </g>
      <g fill="currentColor" fontSize="10" fontFamily="inherit" opacity="0.9">
        <text x="226" y="40">22.9kV 수전</text>
        <text x="234" y="94">TR 1,000kVA</text>
        <text x="232" y="168">ACB</text>
        <text x="74" y="208">LV BUS 380/220V</text>
        <text x="64" y="372">전등</text>
        <text x="136" y="372">통신</text>
        <text x="236" y="372">동력</text>
        <text x="306" y="372">비상</text>
      </g>
    </svg>
  );
}

type Step = 'login' | 'mfa' | 'change';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<Step>(params.get('change') ? 'change' : 'login');
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [code, setCode] = useState('');
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const notice = params.get('expired') ? '오랫동안 사용하지 않아 로그아웃되었습니다. 다시 로그인해 주세요.' : null;

  useEffect(() => setError(null), [step]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.body.message : '로그인하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  const onLogin = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ mfaRequired: boolean; mustChangePassword: boolean }>('/auth/login', { method: 'POST', json: { loginId, password }, noCompany: true });
      if (r.mfaRequired) return setStep('mfa');
      if (r.mustChangePassword) {
        setCurrent(password);
        return setStep('change');
      }
      router.replace('/dashboard');
    });
  };
  const onMfa = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      await api('/auth/mfa/verify', { method: 'POST', json: { code }, noCompany: true });
      const me = await api<{ user: { mustChangePassword: boolean } }>('/auth/me', { noCompany: true });
      if (me.user.mustChangePassword) {
        setCurrent(password);
        return setStep('change');
      }
      router.replace('/dashboard');
    });
  };
  const onChange = (e: FormEvent) => {
    e.preventDefault();
    if (pw1 !== pw2) return setError('새 비밀번호가 서로 다릅니다');
    run(async () => {
      await api('/auth/password', { method: 'POST', json: { currentPassword: current, newPassword: pw1 }, noCompany: true });
      router.replace('/dashboard');
    });
  };

  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-nav lg:block">
        <div className="absolute inset-0 flex items-center justify-center p-16 text-[#33465c]">
          <div className="h-full max-h-[560px] w-full max-w-[420px]"><SingleLineDiagram /></div>
        </div>
        <div className="relative flex h-full flex-col justify-between p-10">
          <BrandMark />
          <div className="max-w-sm">
            <p className="text-[26px] leading-[1.35] font-semibold tracking-[-0.02em] text-nav-ink-strong">계약부터 지급까지,<br />현장마다 손익이 보입니다.</p>
            <p className="mt-3 text-nav-ink">전기 · 정보통신 · 건축공사 통합 회계</p>
          </div>
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-8 lg:hidden"><BrandMark tone="paper" /></div>

          {step === 'login' && (
            <form onSubmit={onLogin} noValidate>
              <h1 className="text-title font-semibold">로그인</h1>
              <p className="mt-1 text-muted">회사에서 받은 아이디로 로그인하세요.</p>
              {notice && <p className="mt-4 rounded-[4px] bg-warn-soft px-3 py-2 text-warn">{notice}</p>}
              <div className="mt-6 space-y-4">
                <Field label="아이디" htmlFor="loginId">
                  <Input id="loginId" autoComplete="username" autoCapitalize="none" spellCheck={false} value={loginId} onChange={(e) => setLoginId(e.target.value)} className="h-10" autoFocus required />
                </Field>
                <Field label="비밀번호" htmlFor="password">
                  <div className="relative">
                    <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 pr-10" required />
                    <button type="button" onClick={() => setShow((v) => !v)} className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center text-faint hover:text-ink" aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}>
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </Field>
              </div>
              {error && <p role="alert" className="mt-4 rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{error}</p>}
              <Button type="submit" variant="primary" loading={busy} disabled={!loginId || !password} className="mt-6 h-10! w-full text-[14px]">로그인</Button>
              <p className="mt-6 text-meta text-faint">비밀번호를 잊었다면 회사 관리자에게 초기화를 요청하세요. 5회 연속 틀리면 15분간 잠깁니다.</p>
            </form>
          )}

          {step === 'mfa' && (
            <form onSubmit={onMfa}>
              <ShieldCheck className="mb-3 size-8 text-steel" strokeWidth={1.5} />
              <h1 className="text-title font-semibold">2단계 인증</h1>
              <p className="mt-1 text-muted">인증 앱에 표시된 6자리 숫자를 입력하세요.</p>
              <Input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="num mt-6 h-12 text-center text-[22px] tracking-[0.4em]"
                aria-label="인증번호 6자리"
              />
              {error && <p role="alert" className="mt-4 rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{error}</p>}
              <Button type="submit" variant="primary" loading={busy} disabled={code.length !== 6} className="mt-6 h-10! w-full">확인</Button>
              <button type="button" onClick={() => setStep('login')} className="mt-3 w-full text-center text-muted hover:text-ink">다른 계정으로 로그인</button>
            </form>
          )}

          {step === 'change' && (
            <form onSubmit={onChange}>
              <h1 className="text-title font-semibold">비밀번호 변경</h1>
              <p className="mt-1 text-muted">처음 로그인하셨거나 관리자가 초기화했습니다. 새 비밀번호를 정해 주세요.</p>
              <div className="mt-6 space-y-4">
                {!current && (
                  <Field label="현재(임시) 비밀번호" htmlFor="cur">
                    <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="h-10" />
                  </Field>
                )}
                <Field label="새 비밀번호" htmlFor="pw1" hint="10자 이상, 영문 대·소문자·숫자·특수문자 중 3종류 이상">
                  <Input id="pw1" type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} className="h-10" autoFocus />
                </Field>
                <Field label="새 비밀번호 확인" htmlFor="pw2" error={pw2 && pw1 !== pw2 ? '위와 같게 입력해 주세요' : undefined}>
                  <Input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="h-10" aria-invalid={!!pw2 && pw1 !== pw2} />
                </Field>
              </div>
              {error && <p role="alert" className="mt-4 rounded-[4px] bg-seal-soft px-3 py-2 text-seal">{error}</p>}
              <Button type="submit" variant="primary" loading={busy} disabled={!pw1 || pw1 !== pw2 || !current} className="mt-6 h-10! w-full">비밀번호 변경하고 시작하기</Button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
