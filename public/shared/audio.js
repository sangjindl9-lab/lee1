// Synthesized sound kit (no audio files). Themes can change root note, scale and tempo.
window.SlotAudio = (() => {
  let ctx, master, sfx, music, verb, on = true, timer = null, mode = 'base', nextT = 0, step = 0, drone;
  let opt = { root: 146.83, scale: [0, 3, 5, 7, 10], tempo: .42, featureTempo: .26, droneLevel: .05, bell: 880 };
  const cache = {};
  const noteF = (deg, oct = 0) => { const s = opt.scale, L = s.length; return opt.root * Math.pow(2, (s[((deg % L) + L) % L] + 12 * (oct + Math.floor(deg / L))) / 12); };
  const t0 = () => ctx.currentTime;
  try { on = localStorage.getItem('slot.sound') !== 'off'; } catch (e) {}

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = on ? .9 : 0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    sfx = ctx.createGain(); sfx.gain.value = .85; sfx.connect(master);
    music = ctx.createGain(); music.gain.value = .32; music.connect(master);
    verb = ctx.createConvolver(); const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
    verb.buffer = ir; const vg = ctx.createGain(); vg.gain.value = .35; verb.connect(vg); vg.connect(master);
  }
  function out(node, wet = .3, dest = sfx) { node.connect(dest); if (wet > 0) { const g = ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(verb); } }
  function pluckBuf(f) {
    const key = f.toFixed(1); if (cache[key]) return cache[key];
    const sr = ctx.sampleRate, n = Math.floor(sr * 2.2), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const p = Math.max(2, Math.round(sr / f)), ring = new Float32Array(p);
    for (let i = 0; i < p; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0, prev = 0;
    for (let i = 0; i < n; i++) { const cur = ring[idx]; ring[idx] = .996 * .5 * (cur + prev); prev = cur; idx = (idx + 1) % p; d[i] = cur * (i < 40 ? i / 40 : 1); }
    return (cache[key] = b);
  }
  const ok = () => ctx && on;
  function pluck(f, vol = .5, when = 0, dest = sfx, wet = .35) {
    if (!ok()) return; const s = ctx.createBufferSource(); s.buffer = pluckBuf(f);
    const g = ctx.createGain(); g.gain.value = vol; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
    s.connect(lp); lp.connect(g); out(g, wet, dest); s.start(t0() + when);
  }
  function tone(f, dur, vol, type = 'sine', when = 0, attack = .005, dest = sfx, wet = .25, fEnd) {
    if (!ok()) return; const o = ctx.createOscillator(), g = ctx.createGain(), t = t0() + when;
    o.type = type; o.frequency.setValueAtTime(f, t); if (fEnd) o.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); out(g, wet, dest); o.start(t); o.stop(t + dur + .05);
  }
  let noiseB; const noise = () => { if (noiseB) return noiseB; const n = ctx.sampleRate * 2; noiseB = ctx.createBuffer(1, n, ctx.sampleRate); const d = noiseB.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return noiseB; };
  function noiseHit(dur, vol, type, f, q = 1, when = 0, fEnd, wet = .2) {
    if (!ok()) return; const s = ctx.createBufferSource(); s.buffer = noise(); const fl = ctx.createBiquadFilter(); fl.type = type; fl.Q.value = q;
    const t = t0() + when; fl.frequency.setValueAtTime(f, t); if (fEnd) fl.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(fl); fl.connect(g); out(g, wet); s.start(t, Math.random()); s.stop(t + dur + .05);
  }
  const A = {
    init, configure(o) { Object.assign(opt, o || {}); }, get on() { return on; }, noteF, pluck, tone, noiseHit,
    toggle() { on = !on; try { localStorage.setItem('slot.sound', on ? 'on' : 'off'); } catch (e) {} if (ctx) master.gain.setTargetAtTime(on ? .9 : 0, t0(), .05); return on; },
    spin() { noiseHit(.45, .35, 'bandpass', 400, 1.2, 0, 2400); tone(90, .25, .35, 'sine', 0, .005, sfx, 0, 45); },
    stop(i) { tone(120, .18, .55, 'sine', 0, .002, sfx, .05, 50); noiseHit(.06, .25, 'lowpass', 1800); pluck(noteF(i * 2, 1), .22); },
    special(n) { const base = opt.bell * Math.pow(2, n / 6); [1, 2.76, 5.4].forEach((r, k) => tone(base * r, 1.8 - k * .4, .16 / (k + 1), 'sine', 0, .002, sfx, .6)); pluck(noteF(n + 7, 1), .35); },
    anticip() { if (!ok()) return; const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), t = t0();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(660, t + 1.6);
      lfo.frequency.value = 12; lg.gain.value = .06; lfo.connect(lg); lg.connect(g.gain);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.09, t + .2); g.gain.linearRampToValueAtTime(0, t + 1.7);
      o.connect(lp); lp.connect(g); out(g, .3); o.start(t); lfo.start(t); o.stop(t + 1.8); lfo.stop(t + 1.8); },
    lineWin(k) { for (let i = 0; i < 4; i++) pluck(noteF(k + i * 2, 1), .3, i * .07); },
    small() { [0, 2, 4].forEach((d, i) => pluck(noteF(d + 5, 1), .25, i * .05)); },
    tick() { tone(2400 + Math.random() * 600, .04, .05, 'square', 0, .001, sfx, 0); },
    coin() { const f = 2600 + Math.random() * 1400; tone(f, .18, .08, 'sine', 0, .001, sfx, .3); tone(f * 1.5, .12, .05, 'sine', .03, .001, sfx, .3); },
    gong(vol = .5) { const f = 68; [1, 1.47, 2.09, 2.56, 3.1, 4.2, 5.4].forEach((r, i) => tone(f * r, 5 - i * .5, vol / (1 + i * .6), 'sine', 0, .02 + i * .01, sfx, .7, f * r * .985)); noiseHit(1.2, .25, 'bandpass', 900, .8, 0, 300, .6); },
    drum(when = 0, vol = .8) { tone(110, .5, vol, 'sine', when, .002, sfx, .2, 40); noiseHit(.18, .3 * vol, 'lowpass', 600, 1, when); },
    sweep() { noiseHit(.9, .3, 'bandpass', 300, 4, 0, 5000, .5); for (let i = 0; i < 6; i++) pluck(noteF(i * 2, 1), .2, i * .06); },
    shuffle() { pluck(noteF(Math.floor(Math.random() * 10), 1), .18, 0, sfx, .1); },
    fanfare() { A.gong(.6); [0, 2, 4, 5, 7, 9].forEach((d, i) => pluck(noteF(d, 1), .4, .15 + i * .09)); A.drum(0, 1); A.drum(.3, .7); A.drum(.45, .7); },
    music(m) { mode = m; if (!ctx || timer) return; nextT = t0() + .1; step = 0; timer = setInterval(sched, 80); },
  };
  function sched() {
    if (!on) { nextT = t0() + .1; return; }
    if (!drone) { drone = ctx.createGain(); drone.gain.value = 0; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; drone.connect(lp); lp.connect(music);
      [opt.root / 2, opt.root / 2 * 1.5, opt.root / 2 * 1.005].forEach((f) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(drone); o.start(); });
      drone.gain.linearRampToValueAtTime(opt.droneLevel, t0() + 3); }
    const beat = mode === 'feature' ? opt.featureTempo : opt.tempo;
    while (nextT < t0() + .3) {
      const pos = step % 16, w = nextT - t0();
      if (mode === 'feature') {
        if (pos % 4 === 0) A.drum(w, .45); if (pos === 6 || pos === 14) A.drum(w, .25);
        if (Math.random() < .7) pluck(noteF([0, 2, 4, 3, 5, 7, 4, 2][pos % 8] + (pos > 7 ? 2 : 0), 1), .16, w, music, .4);
      } else {
        const r = Math.random();
        if (pos % 2 === 0 && r < .55) pluck(noteF(Math.floor(Math.random() * 8), r < .2 ? 2 : 1), .14, w, music, .6);
        if (pos === 0 && step % 64 === 0) pluck(noteF(0, 0), .22, w, music, .6);
      }
      nextT += beat; step++;
    }
  }
  return A;
})();
