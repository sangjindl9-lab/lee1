import { api, toast, h, modal, formGrid, esc, confirmBox } from './ui.js';
import { openEditor } from './editor.js';
import { productManager } from './products.js';
import { licenseBar, licenseDialog } from './license.js';

const $ = id => document.getElementById(id);
export const APP = { me: null };
const ROLE = { admin: '관리자', designer: '설계자', reviewer: '검토자', viewer: '조회자' };
export { ROLE };

function show(id) { ['login', 'projects', 'editor'].forEach(x => $(x).classList.toggle('hidden', x !== id)); }
window.addEventListener('need-login', () => { show('login'); });

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = new FormData(e.target);
  try { await api('/api/login', { body: { username: f.get('username'), password: f.get('password') }, noAuthRedirect: true }); $('loginErr').textContent = ''; boot(); }
  catch (er) { $('loginErr').textContent = er.message; }
});
$('btnLogout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.hash = ''; show('login'); };
$('btnLicense').onclick = () => licenseDialog();
$('btnPw').onclick = () => { const o = {}; modal('비밀번호 변경', formGrid([{ k: 'current', label: '현재 비밀번호', type: 'password' }, { k: 'next', label: '새 비밀번호(8자 이상)', type: 'password' }], o), [{ label: '변경', primary: true, action: async () => { await api('/api/me/password', { body: o }); toast('비밀번호를 변경했습니다.'); } }]); };
$('btnProducts').onclick = () => productManager(APP.me);
$('showSample').onchange = () => loadProjects();

async function boot() {
  try { APP.me = await api('/api/me', { noAuthRedirect: true }); } catch { show('login'); return; }
  $('meName').textContent = `${APP.me.user.name} (${ROLE[APP.me.user.role]}) · ${APP.me.company ? APP.me.company.name : ''}`;
  $('btnAdmin').classList.toggle('hidden', APP.me.user.role !== 'admin');
  $('btnNewProject').classList.toggle('hidden', !['admin', 'designer'].includes(APP.me.user.role));
  $('btnRestore').classList.toggle('hidden', !['admin', 'designer'].includes(APP.me.user.role));
  licenseBar(APP.me.user.role === 'admin');
  route();
}
window.addEventListener('hashchange', () => APP.me && route());
function route() {
  const m = location.hash.match(/^#\/p\/([0-9a-f-]+)(?:\/s\/([0-9a-f-]+))?/);
  if (m) { show('editor'); openEditor(m[1], m[2], APP.me).catch(e => { toast(e.message, true); location.hash = ''; }); }
  else { show('projects'); loadProjects(); }
}
async function loadProjects() {
  const list = await api('/api/projects');
  const sample = $('showSample').checked;
  $('plistBody').innerHTML = '';
  list.filter(p => sample || !p.is_sample).forEach(p => $('plistBody').appendChild(h('tr', { onclick: () => location.hash = '#/p/' + p.id },
    h('td', null, p.name, ' ', p.is_sample ? h('span', { class: 'badge sample' }, '샘플') : null), h('td', null, p.address || ''), h('td', null, p.client || ''), h('td', null, p.system_type), h('td', null, p.counts.s), h('td', null, p.counts.c), h('td', null, ROLE[p.role] || '-'), h('td', { class: 'small muted' }, (p.updated_at || '').slice(0, 16)))));
  if (!list.length) $('plistBody').appendChild(h('tr', null, h('td', { colspan: 8, class: 'muted' }, '접근 가능한 프로젝트가 없습니다. 관리자에게 프로젝트 권한을 요청하거나 새 프로젝트를 만드세요.')));
}
export const PROJECT_FIELDS = [{ k: 'name', label: '공사명' }, { k: 'address', label: '현장주소' }, { k: 'client', label: '발주처' }, { k: 'designer', label: '설계사' }, { k: 'contractor', label: '시공사' }, { k: 'author', label: '작성자' }, { k: 'written_at', label: '작성일', type: 'date' }, { k: 'drawing_no', label: '도면번호' }, { k: 'revision', label: '개정번호' }, { k: 'system_type', label: '시스템 방식', type: 'select', options: ['IP형', '동축형', '혼합형'] }];
$('btnNewProject').onclick = () => {
  const o = { system_type: '혼합형', written_at: new Date().toISOString().slice(0, 10), author: APP.me.user.name };
  modal('새 프로젝트', formGrid(PROJECT_FIELDS, o), [{ label: '취소' }, { label: '만들기', primary: true, action: async () => { if (!o.name) throw new Error('공사명을 입력하세요.'); const r = await api('/api/projects', { body: o }); location.hash = '#/p/' + r.id; } }]);
};
$('btnRestore').onclick = () => {
  const inp = h('input', { type: 'file', accept: '.zip' });
  modal('백업 복원', h('div', null, h('p', { class: 'small muted' }, '백업 파일(zip)을 선택하면 새 프로젝트로 복원됩니다. 기존 프로젝트는 변경되지 않습니다.'), inp), [{ label: '복원', primary: true, action: async () => { if (!inp.files[0]) throw new Error('파일을 선택하세요.'); const fd = new FormData(); fd.append('file', inp.files[0]); const r = await api('/api/backup/restore', { body: fd }); toast('복원 완료'); location.hash = '#/p/' + r.id; } }]);
};

// ----- 관리자 -----
$('btnAdmin').onclick = async () => {
  const body = h('div', { style: { width: '760px' } });
  const render = async () => {
    const [users, companies, dwg, mapc] = await Promise.all([api('/api/users'), api('/api/companies'), api('/api/settings/dwg'), api('/api/settings/map')]);
    body.innerHTML = '';
    body.appendChild(h('h3', { style: { fontSize: '14px', margin: '0 0 6px' } }, '사용자'));
    const t = h('table', { class: 'grid' }, h('tr', null, ['아이디', '이름', '권한', '회사', '상태', ''].map(x => h('th', null, x))));
    users.forEach(u => t.appendChild(h('tr', null, h('td', null, u.username), h('td', null, u.name), h('td', null, (() => { const s = h('select', { onchange: async e => { try { await api('/api/users/' + u.id, { method: 'PUT', body: { role: e.target.value } }); toast('권한 변경'); } catch (er) { toast(er.message, true); render(); } } }, Object.entries(ROLE).map(([k, v]) => h('option', { value: k, selected: u.role === k }, v))); return s; })()), h('td', null, (companies.find(c => c.id === u.company_id) || {}).name || ''), h('td', null, u.active ? '사용' : '중지'),
      h('td', null, h('button', { onclick: async () => { await api('/api/users/' + u.id, { method: 'PUT', body: { active: !u.active } }).catch(e => toast(e.message, true)); render(); } }, u.active ? '중지' : '사용'), ' ', h('button', { onclick: () => { const o = {}; modal('비밀번호 재설정', formGrid([{ k: 'password', label: '새 비밀번호', type: 'password' }], o), [{ label: '저장', primary: true, action: () => api('/api/users/' + u.id, { method: 'PUT', body: o }).then(() => toast('변경됨')) }]); } }, '비밀번호')))));
    body.appendChild(t);
    const nu = { role: 'designer', company_id: APP.me.user.company_id };
    body.appendChild(h('div', { style: { margin: '8px 0 14px', padding: '8px', background: '#f6f7f8' } }, formGrid([{ k: 'username', label: '아이디' }, { k: 'name', label: '이름' }, { k: 'password', label: '비밀번호(8자+)', type: 'password' }, { k: 'role', label: '권한', type: 'select', options: Object.entries(ROLE) }, { k: 'company_id', label: '회사', type: 'select', options: companies.map(c => [c.id, c.name]) }], nu), h('button', { class: 'primary', style: { marginTop: '6px' }, onclick: async () => { try { await api('/api/users', { body: nu }); toast('사용자 추가'); render(); } catch (e) { toast(e.message, true); } } }, '사용자 추가')));
    body.appendChild(h('h3', { style: { fontSize: '14px', margin: '0 0 6px' } }, '회사'));
    companies.forEach(c => body.appendChild(h('div', { class: 'row', style: { marginBottom: '4px' } }, h('span', { class: 'grow' }, c.name, c.logo_file_id ? ' (로고 등록됨)' : ''), h('label', { class: 'small' }, '로고 ', h('input', { type: 'file', accept: 'image/*', onchange: async e => { const fd = new FormData(); fd.append('file', e.target.files[0]); try { await api(`/api/companies/${c.id}/logo`, { body: fd }); toast('로고 등록'); render(); } catch (er) { toast(er.message, true); } } })))));
    const nc = {}; body.appendChild(h('div', { class: 'row', style: { marginBottom: '14px' } }, formGrid([{ k: 'name', label: '새 회사명' }], nc), h('button', { onclick: async () => { await api('/api/companies', { body: nc }).catch(e => toast(e.message, true)); render(); } }, '추가')));
    body.appendChild(h('h3', { style: { fontSize: '14px', margin: '0 0 6px' } }, 'DWG 변환 엔진'));
    const eng = dwg.engine || { type: 'libredwg', path: '' };
    body.appendChild(h('div', { class: 'small', style: { marginBottom: '6px' } }, dwg.configured ? h('span', { class: 'ok' }, '설정됨') : h('span', { class: 'warn' }, '설정 필요 – DWG 업로드가 불가하며 DXF·PDF 업로드를 이용해야 합니다.'),
      h('div', { class: 'muted' }, 'LibreDWG(dwg2dxf, GPLv3) 또는 ODA File Converter(ODA 라이선스 동의 필요) 실행 파일 경로를 지정합니다. 지원 버전·제한 사항은 docs/DWG_엔진.md 참고.')));
    body.appendChild(formGrid([{ k: 'type', label: '엔진', type: 'select', options: [['libredwg', 'LibreDWG dwg2dxf'], ['oda', 'ODA File Converter']] }, { k: 'path', label: '실행 파일 경로', ph: '/opt/libredwg/bin/dwg2dxf' }], eng));
    body.appendChild(h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { onclick: async () => { const r = await api('/api/settings/dwg/test', { body: eng }); toast((r.ok ? '정상: ' : '실패: ') + r.message, !r.ok); } }, '연결 시험'), h('button', { class: 'primary', onclick: async () => { try { await api('/api/settings/dwg', { method: 'PUT', body: eng }); toast('DWG 엔진 저장'); render(); } catch (e) { toast(e.message, true); } } }, '저장'), h('button', { onclick: async () => { await api('/api/settings/dwg', { method: 'PUT', body: { path: '' } }); render(); } }, '해제')));
    const oe = { path: dwg.oda_export_path || '' };
    body.appendChild(h('div', { class: 'small', style: { marginTop: '8px' } }, 'DWG 내보내기용 ODA File Converter 경로 (선택) – LibreDWG의 DWG 쓰기 기능은 검증에서 객체 손실이 확인되어 사용하지 않습니다.'));
    body.appendChild(h('div', { class: 'row' }, formGrid([{ k: 'path', label: 'ODA 경로', ph: '/usr/bin/ODAFileConverter' }], oe), h('button', { onclick: async () => { try { await api('/api/settings/dwg-export', { method: 'PUT', body: oe }); toast('저장'); render(); } catch (e) { toast(e.message, true); } } }, '저장')));
    body.appendChild(h('h3', { style: { fontSize: '14px', margin: '14px 0 6px' } }, '외부 지도 타일 (선택 기능)'));
    body.appendChild(h('div', { class: 'small muted', style: { marginBottom: '6px' } }, '지도 보기·기준점 지정에 사용합니다. 기본값은 OpenStreetMap 공개 타일(이용 정책상 대량 사용 불가). VWorld 등은 발급받은 키를 넣은 주소를 입력하세요. 예: https://api.vworld.kr/req/wmts/1.0.0/{키}/Base/{z}/{y}/{x}.png'));
    body.appendChild(formGrid([{ k: 'enabled', label: '사용', type: 'check' }, { k: 'url', label: '타일 주소' }, { k: 'attribution', label: '출처 표기' }, { k: 'maxZoom', label: '최대 확대', type: 'number' }, { k: 'note', label: '안내 문구' }], mapc));
    body.appendChild(h('button', { class: 'primary', style: { marginTop: '6px' }, onclick: async () => { try { await api('/api/settings/map', { method: 'PUT', body: mapc }); toast('지도 설정 저장'); } catch (e) { toast(e.message, true); } } }, '지도 설정 저장'));
  };
  await render();
  modal('관리자 설정', body, null, { noFocus: true });
};

boot();
