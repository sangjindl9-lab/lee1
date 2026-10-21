import { useEffect, useState } from 'react';
import type { Account } from './Gate';
import { api, ApiError } from '../lib/api';
import { localProjects } from '../lib/storage';
import { Field, Modal } from '../components/ui';
import type { Project } from '../lib/types';

/** 상단 회원 메뉴: 이름, 비밀번호 변경, 이 브라우저 데이터 가져오기, 로그아웃 */
export function AccountMenu({ account, onImport, toast }: { account: Account; onImport: (ps: Project[]) => Promise<number>; toast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [dlg, setDlg] = useState<null | 'pw' | 'import'>(null);
  const [locals, setLocals] = useState<Project[]>([]);
  useEffect(() => {
    localProjects().then((ps) => setLocals(ps.filter((p) => !p.info.name.startsWith('[예시]'))));
  }, []);
  const u = account.me.user;
  return (
    <div className="relative">
      <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        {u.name || u.username} ▾
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-64 rounded border border-line bg-panel p-2 text-[13px] shadow-lg" onMouseLeave={() => setOpen(false)}>
          <div className="border-b border-line px-2 pb-2">
            <div className="font-semibold">{u.name || u.username}</div>
            <div className="text-[12px] text-mute">
              아이디 {u.username}
              {u.company ? ` · ${u.company}` : ''}
            </div>
            <div className="text-[12px] text-mute">사용 기간: {u.expires_at ? `${u.expires_at}까지` : '제한 없음'}</div>
            <div className="text-[12px] text-mute">
              등록 IP {account.me.ipState.used}/{account.me.ipState.max} (지금 {account.me.ipState.ip})
            </div>
          </div>
          <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-sunk" onClick={() => (setDlg('pw'), setOpen(false))}>
            비밀번호 변경
          </button>
          {locals.length > 0 && (
            <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-sunk" onClick={() => (setDlg('import'), setOpen(false))}>
              이 브라우저의 공정표 가져오기 ({locals.length}개)
            </button>
          )}
          <button className="block w-full rounded px-2 py-1.5 text-left text-late hover:bg-sunk" onClick={() => account.logout()}>
            로그아웃
          </button>
        </div>
      )}
      {dlg === 'pw' && <PasswordDialog onClose={() => setDlg(null)} toast={toast} />}
      {dlg === 'import' && (
        <Modal
          title="이 브라우저의 공정표 가져오기"
          onClose={() => setDlg(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDlg(null)}>
                취소
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const n = await onImport(locals);
                  toast(`${n}개 공정표를 내 계정으로 옮겼습니다.`);
                  setDlg(null);
                }}
              >
                {locals.length}개 가져오기
              </button>
            </>
          }
        >
          <p className="mb-2 text-[13.5px] text-ink2">로그인 전에 이 브라우저에 저장해 둔 공정표를 내 계정(서버)으로 옮깁니다. 같은 공정표가 이미 있으면 덮어씁니다.</p>
          <ul className="list-disc pl-5 text-[13px]">
            {locals.map((p) => (
              <li key={p.id}>{p.info.name || '(공사명 없음)'}</li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function PasswordDialog({ onClose, toast }: { onClose: () => void; toast: (m: string) => void }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [err, setErr] = useState('');
  return (
    <Modal
      title="비밀번호 변경"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn btn-primary"
            disabled={!cur || nw.length < 6 || nw !== nw2}
            onClick={async () => {
              try {
                await api('POST', '/api/password', { current: cur, next: nw });
                toast('비밀번호를 바꿨습니다.');
                onClose();
              } catch (e) {
                setErr((e as ApiError).message);
              }
            }}
          >
            변경
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="현재 비밀번호" htmlFor="pw-cur">
          <input id="pw-cur" type="password" className="inp" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="새 비밀번호 (6자 이상)" htmlFor="pw-new">
          <input id="pw-new" type="password" className="inp" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="새 비밀번호 확인" htmlFor="pw-new2">
          <input id="pw-new2" type="password" className="inp" value={nw2} onChange={(e) => setNw2(e.target.value)} autoComplete="new-password" />
        </Field>
        {nw2 && nw !== nw2 && <div className="text-[13px] text-late">새 비밀번호가 서로 다릅니다.</div>}
        {err && <div className="text-[13px] text-late">{err}</div>}
      </div>
    </Modal>
  );
}
