// 황금 등롱 theme — crimson night market with drifting lanterns. Original SVG artwork.
(() => {
const defs = `
<radialGradient id="gl-gold" cx="38%" cy="30%"><stop offset="0" stop-color="#fff6d0"/><stop offset=".45" stop-color="#f2c14e"/><stop offset="1" stop-color="#7a4f0c"/></radialGradient>
<linearGradient id="gl-goldv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1c1"/><stop offset=".5" stop-color="#f2c14e"/><stop offset="1" stop-color="#8a5a10"/></linearGradient>
<radialGradient id="gl-red" cx="38%" cy="30%"><stop offset="0" stop-color="#ff9a8a"/><stop offset=".5" stop-color="#d6202e"/><stop offset="1" stop-color="#4f0610"/></radialGradient>
<radialGradient id="gl-tan" cx="35%" cy="30%"><stop offset="0" stop-color="#ffe0a3"/><stop offset=".5" stop-color="#ff8c1a"/><stop offset="1" stop-color="#9a3c00"/></radialGradient>
<radialGradient id="gl-pch" cx="40%" cy="35%"><stop offset="0" stop-color="#fff0ea"/><stop offset=".55" stop-color="#ff9db0"/><stop offset="1" stop-color="#b8325a"/></radialGradient>
<radialGradient id="gl-glow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
<linearGradient id="gl-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ee07a"/><stop offset="1" stop-color="#1f6b2a"/></linearGradient>
<filter id="gl-sh"><feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000" flood-opacity=".6"/></filter>
<symbol id="gl-WLD" viewBox="0 0 100 100"><circle cx="50" cy="52" r="46" fill="url(#gl-glow)"/><g filter="url(#gl-sh)">
  <rect x="38" y="10" width="24" height="8" rx="2" fill="#7a4f0c"/>
  <path d="M26 22h48c10 10 12 46 0 58H26C14 68 16 32 26 22z" fill="url(#gl-gold)" stroke="#6b3f05" stroke-width="2.5"/>
  <path d="M38 22c-6 14-6 44 0 58M62 22c6 14 6 44 0 58M50 22v58" stroke="#8a5a10" stroke-opacity=".6" stroke-width="2" fill="none"/>
  <rect x="34" y="80" width="32" height="7" rx="2" fill="#7a4f0c"/>
  <path d="M50 87v10M45 88l-2 9M55 88l2 9" stroke="#d6202e" stroke-width="2.4" stroke-linecap="round"/>
  <rect x="34" y="40" width="32" height="20" rx="3" fill="#d6202e" stroke="#6b3f05" stroke-width="1.5"/>
  <text x="50" y="56" text-anchor="middle" font-family="Noto Serif TC,serif" font-weight="900" font-size="16" fill="#fff1c1">WILD</text></g></symbol>
<symbol id="gl-SVN" viewBox="0 0 100 100"><g filter="url(#gl-sh)">
  <rect x="14" y="14" width="72" height="72" rx="12" fill="url(#gl-red)" stroke="#f2c14e" stroke-width="4"/>
  <rect x="22" y="22" width="56" height="56" rx="8" fill="none" stroke="#fff1c1" stroke-opacity=".5" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="50" y="68" text-anchor="middle" font-family="Noto Serif TC,serif" font-weight="900" font-size="50" fill="url(#gl-goldv)" stroke="#5a2a00" stroke-width="1.2">七</text></g></symbol>
<symbol id="gl-ING" viewBox="0 0 100 100"><g filter="url(#gl-sh)">
  <path d="M10 52c6 18 24 26 40 26s34-8 40-26c-8 4-16 4-22 0-4 8-30 8-36 0-6 4-14 4-22 0z" fill="url(#gl-gold)" stroke="#6b3f05" stroke-width="2.5"/>
  <ellipse cx="50" cy="46" rx="18" ry="14" fill="url(#gl-gold)" stroke="#6b3f05" stroke-width="2.5"/>
  <path d="M38 42c4-6 12-8 18-6" stroke="#fff" stroke-opacity=".75" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M20 60c10 8 50 8 60 0" stroke="#fff6d0" stroke-opacity=".5" stroke-width="2" fill="none"/></g></symbol>
<symbol id="gl-BAG" viewBox="0 0 100 100"><g filter="url(#gl-sh)">
  <path d="M34 30c-18 10-22 46-4 54 12 6 28 6 40 0 18-8 14-44-4-54z" fill="url(#gl-red)" stroke="#4f0610" stroke-width="2.5"/>
  <path d="M34 30l-6-14c8 2 14 6 22 6s14-4 22-6l-6 14z" fill="#b5121f" stroke="#4f0610" stroke-width="2"/>
  <path d="M32 31c10 4 26 4 36 0" stroke="url(#gl-goldv)" stroke-width="4" fill="none" stroke-linecap="round"/>
  <circle cx="50" cy="58" r="13" fill="none" stroke="#f2c14e" stroke-width="2.5"/>
  <text x="50" y="64" text-anchor="middle" font-family="Noto Serif TC,serif" font-weight="900" font-size="16" fill="#f2c14e">福</text></g></symbol>
<symbol id="gl-TAN" viewBox="0 0 100 100"><g filter="url(#gl-sh)">
  <circle cx="50" cy="56" r="32" fill="url(#gl-tan)" stroke="#7a2e00" stroke-width="2"/>
  <path d="M50 26c-2-6 0-10 4-12" stroke="#5a3a10" stroke-width="3" fill="none" stroke-linecap="round"/>
  <path d="M54 22c10-8 24-6 28 0-8 8-20 8-28 0z" fill="url(#gl-leaf)" stroke="#1f4a1a" stroke-width="1.5"/>
  <path d="M34 44c4-6 10-8 16-8" stroke="#fff" stroke-opacity=".7" stroke-width="3.5" fill="none" stroke-linecap="round"/></g></symbol>
<symbol id="gl-PCH" viewBox="0 0 100 100"><g filter="url(#gl-sh)">
  <path d="M50 24c22-4 36 16 32 34-4 18-20 28-32 30-12-2-28-12-32-30-4-18 10-38 32-34z" fill="url(#gl-pch)" stroke="#8a1f44" stroke-width="2"/>
  <path d="M50 26c-4 16-4 40 0 60" stroke="#c94a72" stroke-opacity=".6" stroke-width="2" fill="none"/>
  <path d="M48 26c-14-12-30-8-34 0 10 8 24 8 34 0z" fill="url(#gl-leaf)" stroke="#1f4a1a" stroke-width="1.5"/>
  <path d="M30 46c3-6 8-9 13-10" stroke="#fff" stroke-opacity=".7" stroke-width="3.5" fill="none" stroke-linecap="round"/></g></symbol>`;

// Floating lanterns in the background
const lanterns = [];
function seed(W, H) { lanterns.length = 0; for (let i = 0; i < 26; i++) lanterns.push({ x: Math.random() * W, y: Math.random() * H, r: 6 + Math.random() * 16, v: 6 + Math.random() * 16, ph: Math.random() * 6 }); }
window.SlotThemes = window.SlotThemes || {};
window.SlotThemes['golden-lantern'] = {
  seal: '金燈',
  tagline: '3릴 · 5라인 · 황금 등롱은 와일드',
  accentHue: 355,
  vars: { '--ink': '#0d0306', '--lacquer': '#4a0a14', '--lacquer-hi': '#8a1424', '--accent': '#ff4d5e', '--accent-deep': '#6b0a16',
    '--reel-bg': '#2a0b12', '--reel-edge': '#160509', '--mist': '#d9a9a0', '--frame-glow': 'rgba(255,77,94,.15)' },
  lineColors: ['#f2c14e', '#ff4d5e', '#ffd27a', '#ff8c1a', '#fff1c1'],
  defs,
  symbol(id) { return `<div class="s"><svg viewBox="0 0 100 100"><use href="#gl-${id}"/></svg></div>`; },
  audio: { root: 196.0, scale: [0, 2, 4, 7, 9], tempo: .36, featureTempo: .24, bell: 1046, droneLevel: .035 },
  tiers: [[15, '대박'], [40, '초대박'], [100, '황금 대박']],
  introHTML: '<p>야시장의 등불이 켜지면 행운이 굴러든다.</p><p style="color:var(--mist);font-size:14px">3릴 5라인 클래식. 황금 등롱 와일드가 다른 심볼을 대신하고, 셋이 모이면 라인 베팅의 250배.</p>',
  rulesHTML: '<h3>황금 등롱</h3>와일드로 다른 모든 심볼을 대신합니다. 3개가 한 라인에 모이면 해당 라인 베팅의 250배를 지급합니다. 보너스 기능이 없는 저변동성 게임입니다.',
  onResize: seed,
  drawBg(c, W, H, t, st) {
    if (!lanterns.length) seed(W, H);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#12030a'); g.addColorStop(.6, '#2a0710'); g.addColorStop(1, '#090204');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (const L of lanterns) {
      L.y -= L.v * .016; if (L.y < -40) { L.y = H + 40; L.x = Math.random() * W; }
      const x = L.x + Math.sin(t * .6 + L.ph) * 12, a = .35 + .25 * Math.sin(t * 2 + L.ph);
      const rg = c.createRadialGradient(x, L.y, 0, x, L.y, L.r * 3); rg.addColorStop(0, `rgba(255,190,90,${a})`); rg.addColorStop(1, 'rgba(255,120,60,0)');
      c.fillStyle = rg; c.fillRect(x - L.r * 3, L.y - L.r * 3, L.r * 6, L.r * 6);
      c.fillStyle = `rgba(255,${120 + L.r * 4},70,${.55 + a * .4})`; c.beginPath(); c.ellipse(x, L.y, L.r * .7, L.r, 0, 0, 7); c.fill();
    }
  },
};
})();
