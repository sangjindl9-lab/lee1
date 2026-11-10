// 이음뷰어 — 홈(열기·최근 문서)과 뷰어 화면 전환.
import { $, el, toast, menu, confirmBox } from './ui.js';
import { createStage } from './stage.js';
import * as files from './files.js';
import { openPdf } from './pdfview.js';
import { openCad } from './cadview.js';
import { renderBanners } from './banners.js';

const stage = createStage($('stage'), $('content'));
let current = null; // 열린 문서 컨트롤러
let ctx = null;

function setHint(t) { $('hint').textContent = t; $('hint').hidden = !t; }
function showHome() {
  $('viewer').hidden = true; $('home').hidden = false;
  renderRecents();
  renderBanners({ top: $('ad-top'), bottom: $('ad-bottom') });
}
function renderRecents() {
  const list = $('recents');
  list.innerHTML = '';
  const rs = files.recents();
  $('recents-empty').hidden = rs.length > 0;
  for (const r of rs) {
    const row = el('button', 'recent');
    const pdf = /\.pdf$/i.test(r.name);
    row.appendChild(el('span', 'ricon ' + (pdf ? 'pdf' : 'cad'), pdf ? 'PDF' : 'CAD'));
    const box = el('span', 'rbox');
    box.appendChild(el('span', 'rname', r.name));
    box.appendChild(el('span', 'rtime', new Date(r.t).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })));
    row.appendChild(box);
    row.onclick = () => openUri(r.uri, r.name);
    row.oncontextmenu = (e) => { e.preventDefault(); forgetMenu(r); };
    let timer;
    row.onpointerdown = () => { timer = setTimeout(() => forgetMenu(r), 600); };
    row.onpointerup = row.onpointerleave = () => clearTimeout(timer);
    list.appendChild(row);
  }
}
async function forgetMenu(r) {
  const p = await menu([{ label: '목록에서 지우기', icon: '✕', danger: true }], r.name);
  if (p) { files.forget(r.uri); renderRecents(); }
}

async function openUri(uri, name) {
  if (current && current.dirty() && !(await confirmBox('저장하지 않은 변경 내용이 있습니다. 버리고 열까요?', '버리기'))) return;
  if (current) { current.destroy(); current = null; }
  stage.reset();
  $('home').hidden = true; $('viewer').hidden = false;
  $('title').textContent = name;
  $('kind').textContent = '';
  $('save').hidden = true;
  $('tools').innerHTML = '';
  $('content').innerHTML = ''; $('labels').innerHTML = '';
  setHint('파일을 읽는 중…');
  try {
    const bytes = await files.readFile(uri);
    // 파일 종류는 이름이 아니라 내용으로 판단한다(파일 관리자에서 넘어올 때 이름에 확장자가 없을 수 있음).
    const kind = detectKind(bytes, name);
    if (!kind) throw new Error('PDF, DWG, DXF 파일이 아닙니다.');
    if (kind === 'dxf' && !/\.dxf$/i.test(name)) name += '.dxf';
    if (kind === 'dwg' && !/\.dwg$/i.test(name)) name += '.dwg';
    ctx = { stage, content: $('content'), labelLayer: $('labels'), tools: $('tools'), setHint, name, uri };
    const isCad = kind !== 'pdf';
    $('stage').classList.toggle('dark', isCad);
    $('kind').textContent = isCad ? 'CAD 보기' : 'PDF 편집';
    $('kind').className = 'kind ' + (isCad ? 'cad' : 'pdf');
    current = isCad ? await openCad(bytes, ctx) : await openPdf(bytes, ctx);
    $('save').hidden = current.type !== 'pdf';
    files.remember(uri, name);
  } catch (e) {
    console.error(e);
    toast('열 수 없습니다: ' + (e.message || e), 5000);
    files.forget(uri);
    showHome();
  }
}

/** 파일 머리글로 종류 판단: PDF(%PDF), DWG(AC10xx), DXF(글자 파일에 SECTION/HEADER). 못 알아보면 확장자로. */
function detectKind(bytes, name) {
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (head.startsWith('%PDF')) return 'pdf';
  if (/^AC1\d{3}/.test(head)) return 'dwg';
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  if (/\b(SECTION|HEADER|ENTITIES|ACADVER)\b/.test(text) && /^\s*0\s*$/m.test(text)) return 'dxf';
  const m = /\.(pdf|dwg|dxf)$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

async function pickAndOpen() {
  const f = await files.pickOpen('*/*');
  if (!f) return;
  openUri(f.uri, f.name);
}

$('open').onclick = pickAndOpen;
$('open2').onclick = pickAndOpen;
$('back').onclick = goBack;
$('more').onclick = () => current && current.more();
$('save').onclick = () => current && current.save && current.save();

async function goBack() {
  if (!current) return showHome();
  if (current.dirty()) {
    const p = await menu([{ label: '저장하고 닫기', icon: '💾', id: 'save' }, { label: '저장하지 않고 닫기', icon: '✕', id: 'discard', danger: true }], '변경 내용이 있습니다. 문서를 닫을까요?');
    if (!p) return;
    if (p.id === 'save' && !(await current.save())) return;
  } else if (!(await confirmBox('문서를 닫고 홈으로 갈까요?', '닫기'))) return;
  current.destroy(); current = null;
  showHome();
}

// 휴대폰 뒤로 가기: 열린 창이 있으면 닫고, 문서 중이면 확인, 홈에서는 두 번 눌러야 종료
let lastBackAt = 0;
files.onBack(() => {
  const open = document.querySelector('.backdrop');
  if (open) { open.remove(); return; }
  if (!$('viewer').hidden) { goBack(); return; }
  if (Date.now() - lastBackAt < 2000) files.exitApp();
  else { lastBackAt = Date.now(); toast('한 번 더 누르면 앱을 종료합니다'); }
});
files.onLaunch((f) => openUri(f.uri, f.name));

showHome();
