'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Badge, Button, Field, Input, PageHeader, Panel, useToast } from '@/components/ui';
import { MyStampCard } from '@/components/seal-bits';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function AccountPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useSession();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [disablePw, setDisablePw] = useState('');

  async function changePw(e: FormEvent) {
    e.preventDefault();
    setPwErr(null);
    if (pw.next !== pw.confirm) return setPwErr('새 비밀번호가 서로 다릅니다');
    setBusy(true);
    try {
      await api('/auth/password', { method: 'POST', json: { currentPassword: pw.current, newPassword: pw.next }, noCompany: true });
      toast('ok', '비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 해제되었습니다');
      setPw({ current: '', next: '', confirm: '' });
    } catch (err) {
      setPwErr(err instanceof ApiError ? err.body.message : '바꾸지 못했습니다');
    } finally {
      setBusy(false);
    }
  }
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast('error', e instanceof ApiError ? e.body.message : '처리하지 못했습니다');
    }
  };

  return (
    <>
      <PageHeader title="내 계정" description={`${me.user.name} · ${me.user.loginId}`} />
      <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
        <Panel title="비밀번호 변경">
          <form onSubmit={changePw} className="space-y-4">
            <Field label="현재 비밀번호"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label="새 비밀번호" hint="10자 이상, 영문 대·소문자·숫자·특수문자 중 3종류 이상"><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label="새 비밀번호 확인"><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            {pwErr && <p role="alert" className="rounded-[4px] bg-seal-soft px-3 py-2 text-meta text-seal">{pwErr}</p>}
            <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy} disabled={!pw.current || !pw.next}>비밀번호 변경</Button></div>
          </form>
        </Panel>

        <Panel title="2단계 인증" actions={me.user.mfaEnabled ? <Badge tone="ok"><ShieldCheck className="size-3" />사용 중</Badge> : <Badge>사용 안 함</Badge>}>
          {me.user.mfaEnabled ? (
            <div className="space-y-4">
              <p className="text-ink-2">로그인할 때마다 인증 앱의 6자리 숫자를 함께 확인합니다.</p>
              <Field label="해제하려면 비밀번호 입력"><Input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} /></Field>
              <div className="flex justify-end">
                <Button variant="danger" icon={<ShieldOff className="size-3.5" />} disabled={!disablePw} onClick={() => run(async () => {
                  await api('/auth/mfa/disable', { method: 'POST', json: { password: disablePw }, noCompany: true });
                  setDisablePw('');
                  toast('ok', '2단계 인증을 해제했습니다');
                  qc.invalidateQueries({ queryKey: ['me'] });
                })}>2단계 인증 해제</Button>
              </div>
            </div>
          ) : setup ? (
            <div className="space-y-4">
              <ol className="list-decimal space-y-1 pl-5 text-ink-2">
                <li>Google Authenticator 등 인증 앱을 엽니다.</li>
                <li>아래 QR 코드를 스캔합니다.</li>
                <li>앱에 나온 6자리 숫자를 입력합니다.</li>
              </ol>
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={setup.qrDataUrl} alt="인증 앱 등록 QR 코드" width={140} height={140} className="rounded-[4px] border border-line bg-white p-1" />
                <div className="min-w-0 text-meta text-muted">스캔이 안 되면 직접 입력<br /><code className="num break-all text-ink">{setup.secret}</code></div>
              </div>
              <Field label="인증번호 6자리"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="num tracking-[0.3em]" /></Field>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setSetup(null)}>취소</Button>
                <Button variant="primary" disabled={code.length !== 6} onClick={() => run(async () => {
                  await api('/auth/mfa/enable', { method: 'POST', json: { code }, noCompany: true });
                  setSetup(null);
                  setCode('');
                  toast('ok', '2단계 인증을 켰습니다');
                  qc.invalidateQueries({ queryKey: ['me'] });
                })}>사용 시작</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-ink-2">비밀번호가 유출되어도 휴대폰 인증 앱이 없으면 로그인할 수 없게 합니다. 회계·자금 권한이 있는 계정은 켜 두기를 권장합니다.</p>
              <div className="flex justify-end"><Button variant="primary" icon={<ShieldCheck className="size-3.5" />} onClick={() => run(async () => setSetup(await api('/auth/mfa/setup', { method: 'POST', noCompany: true })))}>2단계 인증 설정</Button></div>
            </div>
          )}
        </Panel>

        <MyStampCard />
      </div>
    </>
  );
}
