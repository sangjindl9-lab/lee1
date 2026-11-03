// 라이선스 안내 띠 + 라이선스 화면 (설계·제안서 공용)
import { api, toast, h, modal, formGrid } from './ui.js';

const MODE = { licensed: '사용 중', trial: '무료 체험', expired: '만료 (보기 전용)', suspended: '사용 중지 (보기 전용)', trial_ended: '체험 종료 (보기 전용)' };
let isAdmin = false;

export async function licenseBar(admin) {
  isAdmin = !!admin;
  let s; try { s = await api('/api/license'); } catch { return null; }
  let bar = document.getElementById('licBar');
  if (!bar) { bar = h('div', { id: 'licBar', style: { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 800, padding: '7px 14px', fontSize: '13px', textAlign: 'center', cursor: 'pointer' }, onclick: () => licenseDialog() }); document.body.appendChild(bar); }
  const warn = s.mode === 'trial' || (s.mode === 'licensed' && s.daysLeft <= 30);
  const block = !s.writable;
  bar.style.display = warn || block ? '' : 'none';
  bar.style.background = block ? '#c62828' : '#fff2dd'; bar.style.color = block ? '#fff' : '#7a4a00';
  bar.textContent = block ? `${MODE[s.mode]} — 저장·수정·출력이 막혀 있습니다. 눌러서 라이선스를 등록하세요.`
    : s.mode === 'trial' ? `무료 체험 중 · ${s.daysLeft}일 남음 (${s.expiresAt}까지) — 눌러서 라이선스 등록` : `라이선스 만료 ${s.daysLeft}일 전 (${s.expiresAt}) — 연장이 필요합니다`;
  return s;
}

export async function licenseDialog() {
  const body = h('div', { style: { width: 'min(560px, 92vw)' } });
  const draw = async () => {
    const s = await api('/api/license'); body.innerHTML = '';
    body.appendChild(h('div', { class: 'box', style: { lineHeight: '1.8' } },
      h('b', null, s.productName), ' · ', h('span', { style: { color: s.writable ? '#2e7d32' : '#c62828', fontWeight: 700 } }, MODE[s.mode]), h('br'),
      s.licensee ? [`사용자: ${s.licensee}`, h('br')] : null,
      `만료일 ${s.expiresAt} (${s.daysLeft < 0 ? '지남' : s.daysLeft + '일 남음'}) · 사용 중 계정 ${s.activeUsers} / ${s.maxUsers}명`, h('br'),
      s.checkedAt ? `마지막 확인 ${new Date(s.checkedAt).toLocaleString('ko-KR')}` : '아직 라이선스 서버와 연결하지 않았습니다.',
      s.lastError ? h('div', { style: { color: '#c62828' } }, s.lastError) : null,
      s.invalid ? h('div', { style: { color: '#c62828' } }, '저장된 라이선스가 이 제품용이 아니거나 올바르지 않습니다.') : null));
    if (!isAdmin) { body.appendChild(h('p', { class: 'small muted' }, '라이선스 등록은 관리자 계정으로 할 수 있습니다.')); return; }
    const o = { code: s.code, bizNo: s.bizNo };
    body.append(h('h4', { style: { margin: '14px 0 6px' } }, '온라인 등록 (자동 갱신)'),
      h('p', { class: 'small muted', style: { margin: '0 0 6px' } }, '공급사에서 받은 설치 코드와 회사 사업자등록번호를 넣으세요. 연장·변경된 라이선스는 6시간마다 자동으로 받아옵니다.'),
      formGrid([{ k: 'code', label: '설치 코드', ph: 'CC-XXXX-XXXX-XXXX' }, { k: 'bizNo', label: '사업자등록번호', ph: '000-00-00000' }], o),
      h('div', { class: 'row', style: { marginTop: '8px', gap: '6px' } },
        h('button', { class: 'primary', onclick: async () => { try { await api('/api/license', { method: 'PUT', body: o }); toast('라이선스를 확인했습니다.'); } catch (e) { toast(e.message, true); } draw(); licenseBar(isAdmin); } }, '저장하고 확인'),
        s.code ? h('button', { onclick: async () => { try { await api('/api/license/check', { body: {} }); toast('최신 라이선스를 받았습니다.'); } catch (e) { toast(e.message, true); } draw(); licenseBar(isAdmin); } }, '지금 확인') : null));
    const ta = h('textarea', { rows: 3, placeholder: '공급사가 보낸 라이선스 문자열(또는 .lic 파일 내용)을 붙여 넣으세요', style: { width: '100%', fontFamily: 'monospace', fontSize: '11px' } });
    body.append(h('h4', { style: { margin: '16px 0 6px' } }, '인터넷이 안 되는 곳 (직접 붙여넣기)'), ta,
      h('button', { style: { marginTop: '6px' }, onclick: async () => { try { await api('/api/license/text', { body: { text: ta.value } }); toast('라이선스를 등록했습니다.'); } catch (e) { toast(e.message, true); } draw(); licenseBar(isAdmin); } }, '문자열 등록'));
  };
  await draw();
  await modal('라이선스', body, null, { noFocus: true });
}
