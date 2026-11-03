// 고객 공유 화면 (로그인 없음, 보기 전용)
import { h } from './ui.js';
import { renderPlan, el } from './planview.js';
const PC = window.PropCalc;
const token = location.pathname.split('/').pop();
const root = document.getElementById('root');
const fileUrl = (id, page) => `/api/share/${token}/file/${id}${page ? '?page=' + page : ''}`;

(async () => {
  let R;
  try { const r = await fetch('/api/share/' + token); R = await r.json(); if (!r.ok) throw new Error(R.error); }
  catch (e) { root.innerHTML = ''; root.appendChild(h('div', { class: 'sec' }, h('h2', null, '제안서를 열 수 없습니다'), h('p', null, e.message || '링크를 확인해 주세요.'))); return; }
  const { proposal: P, products, company: co, notices: nt, staff } = R; const D = P.data;
  if (co.color) document.documentElement.style.setProperty('--ac', co.color);
  document.title = `${P.customer_name || ''} 고객님 CCTV 설치 제안서`;
  const cams = PC.numbered(D); const Q = PC.quote(D, products);
  root.innerHTML = '';
  root.appendChild(h('div', { class: 'hero' }, co.logo_file_id ? h('img', { src: fileUrl(co.logo_file_id), alt: '' }) : null,
    h('div', { class: 'grow' }, h('h1', null, `${P.customer_name || ''} 고객님 CCTV 설치 제안서`), h('div', { class: 'sub' }, [P.customer_address, P.site_type, D.date].filter(Boolean).join(' · '))),
    h('div', { class: 'row noprint' }, h('a', { href: `/api/share/${token}/pdf`, target: '_blank' }, h('button', null, 'PDF로 보기·저장')))));
  root.appendChild(h('div', { class: 'sec' }, h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '18px' } },
    h('div', null, h('div', { class: 'small muted' }, '설치 카메라'), h('b', { style: { fontSize: '20px' } }, cams.length + '대')),
    D.quote && Q.total ? h('div', null, h('div', { class: 'small muted' }, '예상 금액'), h('b', { style: { fontSize: '20px' } }, PC.won(Q.total) + '원'), h('span', { class: 'small muted' }, Q.vatIncluded ? ' (부가세 포함)' : '')) : null,
    h('div', { class: 'grow' }), h('div', { class: 'small' }, h('b', null, co.name || ''), h('br'), [staff && staff.name ? '담당 ' + staff.name : '', (staff && staff.phone) || co.tel].filter(Boolean).join(' · '))),
    D.memo ? h('div', { class: 'box', style: { marginTop: '10px', whiteSpace: 'pre-wrap' } }, D.memo) : null));

  // 설치 위치도
  const sec = h('div', { class: 'sec' }, h('h2', null, '설치 위치도'));
  const tabs = h('div', { class: 'tabs' }); const box = h('div', { class: 'planbox' }); const lg = h('div', { class: 'legend' });
  const showPlan = pl => {
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === pl.id));
    box.innerHTML = ''; const s = el('svg', { viewBox: `0 0 ${pl.width} ${pl.height}`, xmlns: 'http://www.w3.org/2000/svg' }); box.appendChild(s);
    const u = pl.width / Math.max(320, Math.min(1100, root.clientWidth - 32));
    renderPlan(el('g', null, s), pl, D, products, { imgUrl: p => fileUrl(p.file_id, p.page || 1), unit: u });
    lg.textContent = '색칠된 부채꼴 = 카메라가 촬영하는 범위(화각), 점선 호 = 야간 적외선 촬영 거리' + (PC.num(pl.upm) ? '' : ' · 이 도면은 축척이 없어 거리 비율이 실제와 다를 수 있습니다');
  };
  (D.plans || []).forEach(pl => tabs.appendChild(h('button', { 'data-id': pl.id, onclick: () => showPlan(pl) }, pl.name || '도면')));
  if ((D.plans || []).length > 1) sec.appendChild(tabs);
  sec.append(box, lg); root.appendChild(sec);
  if (D.plans && D.plans[0]) showPlan(D.plans[0]); else box.appendChild(h('p', { class: 'muted', style: { padding: '16px' } }, '등록된 도면이 없습니다.'));

  // 카메라별 안내
  if (cams.length) {
    const g = h('div', { class: 'camgrid' });
    cams.forEach(c => { const I = PC.camInfo(c, products); const ph = c.photo_file_id || (I.product.data && I.product.data.photo_file_id);
      g.appendChild(h('div', { class: 'cc' }, h('div', { class: 'hd2' }, h('span', { class: 'dot', style: { background: c.color } }, c.no), c.place || '카메라 ' + c.no),
        ph ? h('img', { src: fileUrl(ph), alt: '' }) : null,
        h('div', { class: 'kv' }, h('span', null, '카메라'), h('span', null, I.name), I.resolution ? [h('span', null, '화질'), h('span', null, I.resolution)] : null,
          h('span', null, '화각'), h('span', null, I.hfov != null ? I.hfov + '°' : '-'), h('span', null, '촬영 거리'), h('span', null, I.range ? `낮 약 ${I.range}m` + (I.ir ? ` · 야간 약 ${I.ir}m` : '') : '-'),
          c.height ? [h('span', null, '설치 높이'), h('span', null, c.height + 'm')] : null),
        c.note ? h('div', { class: 'small' }, c.note) : null, I.features ? h('div', { class: 'small muted' }, I.features) : null)); });
    root.appendChild(h('div', { class: 'sec' }, h('h2', null, '카메라별 안내'), g));
  }
  // 견적
  if (Q.lines.length && (D.options || {}).show_quote !== false) {
    const t = h('table', { class: 'grid' }, h('tr', null, ['품목', '규격', '수량', '금액(원)'].map(x => h('th', null, x))));
    Q.lines.forEach(l => t.appendChild(h('tr', null, h('td', null, l.name), h('td', { class: 'small' }, l.spec || ''), h('td', null, `${l.qty} ${l.unit || ''}`), h('td', { class: 'num' }, PC.won(l.amount)))));
    if (Q.discount) t.appendChild(h('tr', null, h('td', { colspan: 3 }, '할인'), h('td', { class: 'num' }, '-' + PC.won(Q.discount))));
    t.appendChild(h('tr', null, h('td', { colspan: 3 }, '공급가액'), h('td', { class: 'num' }, PC.won(Q.supply))));
    if (Q.vatIncluded) t.appendChild(h('tr', null, h('td', { colspan: 3 }, '부가세(10%)'), h('td', { class: 'num' }, PC.won(Q.vat))));
    t.appendChild(h('tr', null, h('th', { colspan: 3 }, '합계'), h('th', { class: 'num' }, PC.won(Q.total))));
    root.appendChild(h('div', { class: 'sec' }, h('h2', null, '견적'), t, nt.quote ? h('p', { class: 'small muted', style: { whiteSpace: 'pre-wrap' } }, nt.quote) : null));
  }
  const ns = [['화각 안내', nt.fov], ['A/S 안내', nt.service], ['개인정보 안내', nt.privacy]].filter(x => x[1]);
  if (ns.length) root.appendChild(h('div', { class: 'sec notice' }, h('h2', null, '안내 사항'), ns.map(([k, v]) => [h('b', null, k), h('p', null, v)])));
  root.appendChild(h('p', { class: 'small muted', style: { textAlign: 'center', margin: '18px 0' } }, [co.name, co.tel, co.address].filter(Boolean).join(' · ')));
})();
