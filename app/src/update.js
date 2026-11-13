// 새 버전 안내: 저장소의 version.json 을 읽어 설치된 버전보다 높으면 홈 위쪽에 띠를 띄운다.
// 플레이 스토어로 설치한 앱은 MainActivity 의 플레이 인앱 업데이트가 먼저 뜨고, 이 띠는 APK 로 설치한 경우를 위한 것.
import { el } from './ui.js';
import { t } from './i18n.js';
import * as files from './files.js';

const VERSION_URL = 'https://raw.githubusercontent.com/sangjindl9-lab/lee1/eum-viewer/store/version.json';
const PLAY_URL = 'market://details?id=kr.eumsoft.viewer';

export async function checkUpdate(slot) {
  try {
    const me = await files.appVersion();
    if (!me || !me.code) return;
    const r = await fetch(VERSION_URL + '?t=' + Math.floor(Date.now() / 600000), { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (!(v.code > me.code)) { slot.hidden = true; return; }
    slot.innerHTML = '';
    const box = el('div', 'update-box');
    box.appendChild(el('div', 'update-title', t('새 버전 {v}이(가) 나왔습니다', { v: v.name })));
    if (v.notes) box.appendChild(el('div', 'update-notes', v.notes));
    const b = el('button', 'btn primary', t('지금 업데이트'));
    b.onclick = () => files.openUrl(me.fromPlay || !v.apk ? PLAY_URL : v.apk);
    box.appendChild(b);
    slot.appendChild(box);
    slot.hidden = false;
  } catch { /* 인터넷 없음 등: 조용히 넘어간다 */ }
}
