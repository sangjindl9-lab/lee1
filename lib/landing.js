// 공개 앱 소개 페이지 (검색엔진에 잡히는 주소)
const { esc } = require('./generate');

const CSS = `
:root{--bg:#fafafa;--card:#fff;--raised:#f4f4f5;--line:rgba(23,23,23,.08);--t1:#171717;--t2:#525252;--t3:#737373;--accent:#c2410c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t1);font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;font-size:15px;line-height:22px}
a{color:inherit}.wrap{max-width:880px;margin:0 auto;padding:0 24px}
header{display:flex;align-items:center;justify-content:space-between;height:56px}
header a{text-decoration:none;font-size:14px;color:var(--t2)}header .brand{font-weight:600;font-size:16px;color:var(--t1)}
.hero{display:grid;grid-template-columns:96px 1fr;gap:24px;align-items:center;padding:48px 0 32px}
.icon{width:96px;height:96px;border-radius:20px;background:var(--raised);border:1px solid var(--line);object-fit:cover;display:grid;place-items:center;font-size:36px;font-weight:500;color:var(--t2)}
h1{font-size:32px;line-height:1.15;font-weight:500;margin:0 0 8px}.tag{color:var(--t2);font-size:18px;line-height:28px;margin:0}
.meta{color:var(--t3);font-size:13px;margin-top:8px}
.btn{display:inline-flex;align-items:center;height:48px;padding:0 20px;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:500;margin:8px 0 40px}
.btn:hover{background:#9a3412}.btn:focus-visible{outline:2px solid var(--t1);outline-offset:2px}
.shots{display:flex;gap:12px;overflow-x:auto;padding-bottom:16px;margin-bottom:40px;scroll-snap-type:x mandatory}
.shots img{height:420px;border-radius:14px;border:1px solid var(--line);scroll-snap-align:start;background:var(--raised)}
h2{font-size:20px;line-height:28px;font-weight:500;margin:0 0 16px}section{margin-bottom:48px}
.feats{list-style:none;padding:0;margin:0;border-top:1px solid var(--line)}
.feats li{padding:16px 0;border-bottom:1px solid var(--line);display:grid;grid-template-columns:32px 1fr;gap:8px}
.feats .n{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--t3);padding-top:2px}
.feats b{font-weight:500}.feats span{color:var(--t2);display:block}
.desc{color:var(--t2);white-space:pre-line;max-width:640px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{display:grid;grid-template-columns:48px 1fr;gap:12px;align-items:center;padding:16px;background:var(--card);border:1px solid var(--line);border-radius:14px;text-decoration:none}
.card:hover{background:var(--raised)}.card img,.card .ph{width:48px;height:48px;border-radius:10px;background:var(--raised);object-fit:cover;display:grid;place-items:center;color:var(--t2)}
.card b{font-weight:500;display:block}.card span{color:var(--t2);font-size:13px;line-height:20px;display:block}
footer{border-top:1px solid var(--line);padding:24px 0 48px;color:var(--t3);font-size:13px}
@media(max-width:560px){.hero{grid-template-columns:72px 1fr;gap:16px;padding-top:32px}.icon{width:72px;height:72px;border-radius:16px}h1{font-size:28px}.tag{font-size:16px;line-height:24px}.shots img{height:320px}.btn{width:100%;justify-content:center}}
`;

function shell({ title, description, url, image, body, jsonLd, brand }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<style>${CSS}</style>${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
</head><body><div class="wrap"><header><a class="brand" href="/apps">${esc(brand)}</a><a href="/apps">앱 전체 보기</a></header>${body}
<footer>${esc(brand)} · 문의는 각 앱의 구글 플레이 페이지에 있는 개발자 이메일로 보내 주세요</footer></div></body></html>`;
}

function splitFeat(f) {
  const m = String(f).split(/\s*[:—–-]\s+|\s*:\s*/);
  return m.length > 1 ? [m[0].trim(), m.slice(1).join(' ').trim()] : [String(f).trim(), ''];
}
const iconHtml = (app, cls) => app.icon_url
  ? `<img class="${cls}" src="${esc(app.icon_url)}" alt="${esc(app.name)} 아이콘" loading="lazy">`
  : `<div class="${cls}" aria-hidden="true">${esc([...app.name][0] || '')}</div>`;

function appPage(app, others, { baseUrl, installUrl, brand }) {
  const feats = (app.features || []).map((f, i) => { const [h, b] = splitFeat(f); return `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><b>${esc(h)}</b>${b ? `<span>${esc(b)}</span>` : ''}</div></li>`; }).join('');
  const shots = (app.screenshots || []).map((s) => `<img src="${esc(s)}" alt="${esc(app.name)} 화면" loading="lazy">`).join('');
  const more = others.map((o) => `<a class="card" href="/a/${esc(o.slug)}">${iconHtml(o, o.icon_url ? '' : 'ph')}<div><b>${esc(o.name)}</b><span>${esc(o.tagline)}</span></div></a>`).join('');
  const body = `
<div class="hero">${iconHtml(app, 'icon')}<div><h1>${esc(app.name)}</h1><p class="tag">${esc(app.tagline)}</p><div class="meta">${esc([app.category, app.price, '안드로이드'].filter(Boolean).join(' · '))}</div></div></div>
${installUrl ? `<a class="btn" href="${esc(installUrl)}" rel="nofollow">구글 플레이에서 설치</a>` : ''}
${shots ? `<div class="shots">${shots}</div>` : ''}
${feats ? `<section><h2>할 수 있는 일</h2><ul class="feats">${feats}</ul></section>` : ''}
${app.description ? `<section><h2>앱 소개</h2><p class="desc">${esc(app.description)}</p></section>` : ''}
${app.audience ? `<section><h2>이런 분께 맞습니다</h2><p class="desc">${esc(app.audience)}</p></section>` : ''}
${more ? `<section><h2>같은 개발자가 만든 앱</h2><div class="grid">${more}</div></section>` : ''}`;
  return shell({
    title: `${app.name} — ${app.tagline}`.slice(0, 70), description: (app.description || app.tagline).slice(0, 160),
    url: `${baseUrl}/a/${app.slug}`, image: app.icon_url, body, brand,
    jsonLd: { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: app.name, description: app.description || app.tagline, operatingSystem: 'Android', applicationCategory: app.category || 'Application', ...(app.store_url ? { installUrl: app.store_url } : {}) },
  });
}

function listPage(apps, { baseUrl, brand }) {
  const cards = apps.map((o) => `<a class="card" href="/a/${esc(o.slug)}">${iconHtml(o, o.icon_url ? '' : 'ph')}<div><b>${esc(o.name)}</b><span>${esc(o.tagline)}</span></div></a>`).join('');
  const body = `<div style="padding:48px 0 32px"><h1>${esc(brand)}의 앱</h1><p class="tag">혼자 만들고 직접 고치는 안드로이드 앱 ${apps.length}개</p></div><section><div class="grid">${cards || '<p class="desc">아직 공개한 앱이 없습니다</p>'}</div></section>`;
  return shell({ title: `${brand}의 앱`, description: `${brand}에서 만든 안드로이드 앱 목록`, url: `${baseUrl}/apps`, body, brand });
}

module.exports = { appPage, listPage };
