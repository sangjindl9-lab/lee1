// Background scene + particle effects. Themes may supply drawBg(ctx, W, H, t, state).
window.SlotFX = (() => {
  const bg = document.getElementById('bg'), fx = document.getElementById('fx');
  const b = bg.getContext('2d'), f = fx.getContext('2d');
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, t = 0, last = performance.now(), theme = null;
  const state = { feature: 0 };
  const parts = [], ridges = [];
  function size() {
    const dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    [bg, fx].forEach((c) => { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; });
    b.setTransform(dpr, 0, 0, dpr, 0, 0); f.setTransform(dpr, 0, 0, dpr, 0, 0);
    ridges.length = 0;
    for (let l = 0; l < 4; l++) { const pts = []; let y = H * (.48 + l * .12); for (let x = -40; x <= W + 40; x += 24) { y += (Math.random() - .5) * 26 - (y - H * (.5 + l * .12)) * .08; pts.push([x, y]); } ridges.push(pts); }
    if (theme && theme.onResize) theme.onResize(W, H);
  }
  function defaultBg(dt) {
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05080c'); g.addColorStop(.55, state.feature ? '#06201a' : '#0b1418'); g.addColorStop(1, '#030507');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    const mx = W * .82, my = H * .16, mr = Math.min(W, H) * .07;
    const mg = b.createRadialGradient(mx, my, mr * .2, mx, my, mr * 4); mg.addColorStop(0, 'rgba(240,230,200,.18)'); mg.addColorStop(1, 'rgba(240,230,200,0)');
    b.fillStyle = mg; b.fillRect(0, 0, W, H);
    b.fillStyle = 'rgba(239,228,200,.85)'; b.beginPath(); b.arc(mx, my, mr, 0, 7); b.fill();
    ridges.forEach((pts, l) => {
      b.fillStyle = `rgba(${6 + l * 2},${14 + l * 3},${16 + l * 3},${.35 + l * .18})`;
      b.beginPath(); b.moveTo(-40, H); pts.forEach(([x, y]) => b.lineTo(x, y)); b.lineTo(W + 40, H); b.fill();
      const off = (t * (8 + l * 6)) % (W + 400), y2 = pts[0][1] + 20, m2 = b.createLinearGradient(0, y2 - 40, 0, y2 + 40);
      m2.addColorStop(0, 'rgba(160,190,185,0)'); m2.addColorStop(.5, `rgba(160,190,185,${.05 + state.feature * .05})`); m2.addColorStop(1, 'rgba(160,190,185,0)');
      b.fillStyle = m2; b.fillRect(-400 + off, y2 - 40, W * 1.2, 80);
    });
  }
  function burst(x, y, n, kind = 'spark', spread = 1, hue = 45) {
    if (REDUCED) n = Math.min(n, 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = (kind === 'coin' ? 4 + Math.random() * 7 : 1.5 + Math.random() * 5) * spread;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'coin' ? 6 : 1), life: 1, decay: .008 + Math.random() * .014, kind,
        r: kind === 'coin' ? 7 + Math.random() * 6 : 1.2 + Math.random() * 2.6, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, hue: kind === 'accent' ? hue : 42 + Math.random() * 10 });
    }
  }
  function rain(n) { for (let i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: -20 - Math.random() * H * .4, vx: (Math.random() - .5) * 2, vy: 2 + Math.random() * 4, life: 1, decay: .004, kind: 'coin', r: 8 + Math.random() * 7, rot: Math.random() * 6, vr: (Math.random() - .5) * .3, hue: 45 }); }
  function drawParts() {
    f.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]; p.x += p.vx; p.y += p.vy; p.vy += p.kind === 'coin' ? .28 : .05; p.vx *= .99; p.rot += p.vr; p.life -= p.decay;
      if (p.life <= 0 || p.y > H + 40) { parts.splice(i, 1); continue; }
      f.globalAlpha = Math.min(1, p.life * 1.5);
      if (p.kind === 'coin') {
        f.save(); f.translate(p.x, p.y); f.scale(Math.max(.15, Math.abs(Math.cos(p.rot))), 1);
        const g = f.createRadialGradient(-p.r * .3, -p.r * .3, 0, 0, 0, p.r); g.addColorStop(0, '#fff6d0'); g.addColorStop(.5, '#e9c46a'); g.addColorStop(1, '#6b4810');
        f.fillStyle = g; f.beginPath(); f.arc(0, 0, p.r, 0, 7); f.fill(); f.fillStyle = '#5a3a08'; f.fillRect(-p.r * .28, -p.r * .28, p.r * .56, p.r * .56); f.restore();
      } else {
        f.fillStyle = `hsl(${p.hue},95%,${60 + p.life * 30}%)`; f.shadowColor = `hsl(${p.hue},90%,60%)`; f.shadowBlur = 10;
        f.beginPath(); f.arc(p.x, p.y, p.r * p.life + .4, 0, 7); f.fill(); f.shadowBlur = 0;
      }
    }
    f.globalAlpha = 1;
  }
  function loop(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; t += dt;
    if (theme && theme.drawBg) theme.drawBg(b, W, H, t, state); else defaultBg(dt);
    drawParts(); requestAnimationFrame(loop);
  }
  addEventListener('resize', size);
  return {
    start(th) { theme = th; size(); requestAnimationFrame(loop); },
    resize: size, burst, rain, state, REDUCED,
    get W() { return W; }, get H() { return H; },
  };
})();
