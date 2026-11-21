(function () {
  const S = window.SHARED, I = window.I18N;
  const $ = s => document.querySelector(s);
  const view = $("#view"), titleEl = $("#title"), backBtn = $("#back");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("eh_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("eh_" + k, JSON.stringify(v)); } catch (e) { } }
  };
  const FORMULA = {
    ohm: "V = I × R   ·   P = V × I = I²R = V²/R", voltage: "V = I × R", current: "DC: I = P/V · 1φ: I = P/(V·PF) · 3φ: I = P/(√3·V·PF)",
    resistance: "R = V / I", active: "DC: P = V·I · 1φ: P = V·I·PF · 3φ: P = √3·V·I·PF", apparent: "1φ: S = V·I · 3φ: S = √3·V·I",
    reactive: "Q = S·sin φ = S·√(1 − PF²)", pf: "PF = cos φ = P / S", pfcorr: "Qc = P × (tan φ₁ − tan φ₂)",
    resComb: "Series: R = R₁+R₂+…  ·  Parallel: 1/R = 1/R₁+1/R₂+…", indComb: "Series: L = L₁+L₂+…  ·  Parallel: 1/L = 1/L₁+1/L₂+…",
    capComb: "Parallel: C = C₁+C₂+…  ·  Series: 1/C = 1/C₁+1/C₂+…", capVolt: "Q₂ = Q₁ × (V₂/V₁)² × (f₂/f₁)",
    reactance: "X_L = 2πfL  ·  X_C = 1/(2πfC)  ·  f₀ = 1/(2π√LC)", vdiv: "Vout = Vin × R₂/(R₁+R₂)", idiv: "I₁ = It × R₂/(R₁+R₂)",
    joule: "E = I² × R × t", vdrop: "ΔV = k × L × I × ρ / A   (k = 2 for 1φ/DC, √3 for 3φ)", wsize: "A = k × L × I × ρ / ΔV",
    motor: "I = P / (√3 × V × PF × η)", ups: "Ah = (W × h) / (V × η × DoD)", antenna: "λ = 300 / f(MHz) · dipole ≈ λ/2 × VF",
    led: "R = (Vs − Vf) / If", cost: "kWh = W × h × days / 1000"
  };

  function pickLang() {
    const saved = store.get("lang", null);
    if (saved && I[saved]) return saved;
    const nav = (navigator.languages || [navigator.language || "en"]);
    for (const n of nav) { const c = String(n).toLowerCase().split("-")[0]; if (I[c]) return c; }
    return "en";
  }
  let lang = pickLang();
  let L = I[lang];
  const t = (k) => (L.ui[k] != null ? L.ui[k] : I.en.ui[k]) || k;
  const fl = (k) => (L.f[k] != null ? L.f[k] : I.en.f[k]) || k;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- navigation ----------
  let stack = [];
  function go(route, push = true) {
    if (push) stack.push(route);
    render(route);
    window.scrollTo(0, 0);
  }
  window.appBack = function () {
    if (stack.length > 1) { stack.pop(); render(stack[stack.length - 1]); return true; }
    return false;
  };
  backBtn.onclick = () => { if (!window.appBack()) { } };
  $("#lang").onclick = () => go({ v: "lang" });

  function render(r) {
    document.documentElement.lang = lang;
    backBtn.classList.toggle("hide", stack.length <= 1);
    const fn = VIEWS[r.v] || VIEWS.home;
    view.innerHTML = "";
    fn(r);
  }
  function setTitle(s) { titleEl.textContent = s; document.title = s; }
  function el(html) { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; }
  function svgIcon(path, color) {
    return `<div class="ic" style="background:${color}1f"><svg viewBox="0 0 24 24" width="28" height="28"><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  }
  function fig(name) { return name ? `<div class="fig"><img src="img/${name}.svg" alt=""></div>` : ""; }

  // rich text: blank line -> paragraph, "• " bullet, "= " formula, "! " warning, "## " sub heading
  function rich(text) {
    const out = []; let ul = null;
    String(text || "").split("\n").forEach(line => {
      const s = line.trim();
      if (s.startsWith("• ")) { if (!ul) { ul = []; } ul.push(`<li>${esc(s.slice(2))}</li>`); return; }
      if (ul) { out.push(`<ul>${ul.join("")}</ul>`); ul = null; }
      if (!s) return;
      if (s.startsWith("= ")) out.push(`<div class="formula">${esc(s.slice(2))}</div>`);
      else if (s.startsWith("! ")) out.push(`<div class="warn">${esc(s.slice(2))}</div>`);
      else if (s.startsWith("## ")) out.push(`<h3>${esc(s.slice(3))}</h3>`);
      else out.push(`<p>${esc(s)}</p>`);
    });
    if (ul) out.push(`<ul>${ul.join("")}</ul>`);
    return out.join("");
  }
  const sectionCount = id => ({ theory: L.theory.length, install: L.install.length, calc: CALCS.length, tools: L.tools.length,
    safety: L.safety.length, terms: L.terms.length, solar: L.solar.length, quiz: L.quiz.length }[id]);

  const VIEWS = {
    home() {
      setTitle(t("app"));
      view.append(el(`<div class="hero"><svg viewBox="0 0 48 48" width="52" height="52"><rect width="48" height="48" rx="12" fill="#F5A400"/><path d="M27 6L12 27h10l-3 15 17-23H25z" fill="#0F2A47"/></svg>
        <div><b>${esc(t("app"))}</b><span>${esc(t("tagline"))}</span></div></div>`));
      const q = el(`<input class="search" type="search" placeholder="${esc(t("search"))}">`);
      q.onkeydown = e => { if (e.key === "Enter" && q.value.trim()) go({ v: "search", q: q.value.trim() }); };
      view.append(q);
      const g = el(`<div class="grid"></div>`);
      S.sections.forEach(s => {
        const n = el(`<div class="tile">${svgIcon(s.icon, s.color)}<div class="lb">${esc(t("s_" + s.id))}</div><div class="ct">${sectionCount(s.id)}</div></div>`);
        n.onclick = () => go({ v: s.id });
        g.append(n);
      });
      view.append(g);
      view.append(el(`<div class="foot">${esc(t("disclaimer"))}<br>v1.0.0</div>`));
    },
    theory() { listView("s_theory", L.theory.map(x => [x[0], firstLine(x[1])]), i => go({ v: "doc", sec: "theory", i })); },
    solar() { listView("s_solar", L.solar.map(x => [x[0], firstLine(x[1])]), i => go({ v: "doc", sec: "solar", i })); },
    install() { listView("s_install", L.install.map(x => [x[0], x[1]]), i => go({ v: "inst", i })); },
    calc() {
      setTitle(t("s_calc"));
      const box = el(`<div class="list"></div>`);
      CALCS.forEach((c, i) => {
        const r = el(`<div class="row"><div class="n">${i + 1}</div><div class="tx"><b>${esc(L.c[c.id] || I.en.c[c.id])}</b><small>${esc(FORMULA[c.id])}</small></div><span class="chev">›</span></div>`);
        r.onclick = () => go({ v: "calcone", id: c.id });
        box.append(r);
      });
      view.append(box);
    },
    tools() { emojiList("s_tools", L.tools, S.toolEmoji); },
    safety() { emojiList("s_safety", L.safety, S.safetyEmoji, true); },
    terms(r) {
      setTitle(t("s_terms"));
      const q = el(`<input class="search" type="search" placeholder="${esc(t("search"))}">`);
      const box = el(`<div class="list"></div>`);
      const draw = () => {
        const k = q.value.trim().toLowerCase();
        const items = L.terms.map((x, i) => [x, i]).filter(([x]) => !k || (x[0] + " " + x[1]).toLowerCase().includes(k))
          .sort((a, b) => a[0][0].localeCompare(b[0][0], lang));
        box.innerHTML = items.length ? items.map(([x]) => `<div class="term"><b>${esc(x[0])}</b><span>${esc(x[1])}</span></div>`).join("")
          : `<div class="empty">${esc(t("noresult"))}</div>`;
      };
      q.oninput = draw; draw();
      view.append(q, box);
    },
    doc(r) {
      const arr = L[r.sec], x = arr[r.i];
      const img = (r.sec === "theory" ? S.theoryImg : S.solarImg)[r.i];
      setTitle(x[0]);
      view.append(el(`<div class="card"><h2>${esc(x[0])}</h2>${fig(img)}${rich(x[1])}</div>`));
      pager(arr.length, r.i, i => ({ v: "doc", sec: r.sec, i }));
    },
    inst(r) {
      const x = L.install[r.i];
      setTitle(x[0]);
      let h = `<div class="card"><h2>${esc(x[0])}</h2><p>${esc(x[1])}</p>${fig(S.installImg[r.i])}`;
      h += `<div class="warn">${esc(t("powerOff"))}</div>`;
      if (x[2] && x[2].length) h += `<h3>${esc(t("needTools"))}</h3><ul>${x[2].map(s => `<li>${esc(s)}</li>`).join("")}</ul>`;
      h += `<h3>${esc(t("steps"))}</h3><ol>${x[3].map(s => `<li>${esc(s)}</li>`).join("")}</ol>`;
      if (x[4]) h += rich(x[4]);
      h += `</div>`;
      view.append(el(h));
      pager(L.install.length, r.i, i => ({ v: "inst", i }));
    },
    calcone(r) {
      const c = CALCS.find(x => x.id === r.id);
      setTitle(L.c[c.id] || I.en.c[c.id]);
      const saved = store.get("calc_" + c.id, {});
      const card = el(`<div class="card"><div class="formula">${esc(FORMULA[c.id])}</div></div>`);
      if (c.note) card.append(el(`<p class="note">${esc(t("hint_" + c.note))}</p>`));
      const vals = {};
      c.inputs.forEach(([k, u]) => {
        if (Array.isArray(u)) {
          vals[k] = saved[k] && u.includes(saved[k]) ? saved[k] : u[0];
          const seg = el(`<div><label class="f"><span>${esc(fl(k))}</span></label><div class="seg"></div></div>`);
          const sg = seg.querySelector(".seg");
          u.forEach(o => {
            const b = el(`<button type="button">${esc(L.o[o] || I.en.o[o])}</button>`);
            if (vals[k] === o) b.classList.add("on");
            b.onclick = () => { vals[k] = o; sg.querySelectorAll("button").forEach(z => z.classList.remove("on")); b.classList.add("on"); };
            sg.append(b);
          });
          card.append(seg);
        } else {
          const isText = c.text && c.text.includes(k);
          const f = el(`<label class="f"><span>${esc(fl(k))}</span><div class="inp"><input data-k="${k}" ${isText ? 'type="text" inputmode="decimal" placeholder="10, 22, 47"' : 'type="text" inputmode="decimal"'}><em>${esc(u)}</em></div></label>`);
          const inp = f.querySelector("input"); if (saved[k] != null) inp.value = saved[k];
          card.append(f);
        }
      });
      const btns = el(`<div class="btns"><button class="btn">${esc(t("calc"))}</button><button class="btn ghost">${esc(t("clear"))}</button></div>`);
      const res = el(`<div class="res"></div>`);
      const err = el(`<div class="err"></div>`);
      const [bc, bx] = btns.querySelectorAll("button");
      bc.onclick = () => {
        const v = { ...vals }, raw = { ...vals };
        card.querySelectorAll("input[data-k]").forEach(i => { raw[i.dataset.k] = i.value; v[i.dataset.k] = (c.text && c.text.includes(i.dataset.k)) ? i.value : parseNum(i.value); });
        err.textContent = ""; res.classList.remove("show");
        try {
          const out = c.run(v);
          res.innerHTML = `<h3>${esc(t("result"))}</h3>` + out.map(([k, x, u]) => `<div class="r"><span>${esc(fl(k))}</span><b>${fmt(x)} ${esc(u)}</b></div>`).join("");
          res.classList.add("show");
          store.set("calc_" + c.id, raw);
        } catch (e) { err.textContent = t("err_" + (typeof e === "string" ? e : "need")); }
      };
      bx.onclick = () => { card.querySelectorAll("input[data-k]").forEach(i => i.value = ""); res.classList.remove("show"); err.textContent = ""; store.set("calc_" + c.id, {}); };
      card.append(btns, err, res);
      view.append(card);
    },
    quiz() {
      setTitle(t("s_quiz"));
      const best = store.get("quiz_best_" + lang, null);
      const sizes = [10, 20, L.quiz.length];
      let h = `<div class="card"><h2>${esc(t("s_quiz"))}</h2><p>${esc(t("quizIntro"))}</p>`;
      if (best != null) h += `<p class="note">${esc(t("best"))}: ${best}%</p>`;
      h += `<div class="btns" style="flex-direction:column"></div></div>`;
      const card = el(h), b = card.querySelector(".btns");
      sizes.forEach(n => { const x = el(`<button class="btn">${n} ${esc(t("questions"))}</button>`); x.onclick = () => startQuiz(n); b.append(x); });
      view.append(card);
    },
    lang() {
      setTitle(t("language"));
      const box = el(`<div class="list"></div>`);
      S.langs.forEach(([code, name]) => {
        const r = el(`<div class="row"><div class="tx"><b>${esc(name)}</b></div><span class="chev">${code === lang ? "✓" : ""}</span></div>`);
        r.onclick = () => { lang = code; L = I[code]; store.set("lang", code); stack = [{ v: "home" }]; render(stack[0]); };
        box.append(r);
      });
      view.append(box);
    },
    search(r) {
      setTitle(t("search"));
      const k = r.q.toLowerCase(); const hits = [];
      L.theory.forEach((x, i) => { if ((x[0] + x[1]).toLowerCase().includes(k)) hits.push([t("s_theory"), x[0], { v: "doc", sec: "theory", i }]); });
      L.solar.forEach((x, i) => { if ((x[0] + x[1]).toLowerCase().includes(k)) hits.push([t("s_solar"), x[0], { v: "doc", sec: "solar", i }]); });
      L.install.forEach((x, i) => { if ((x[0] + x[1] + x[3].join(" ")).toLowerCase().includes(k)) hits.push([t("s_install"), x[0], { v: "inst", i }]); });
      CALCS.forEach(c => { const n = L.c[c.id] || ""; if (n.toLowerCase().includes(k)) hits.push([t("s_calc"), n, { v: "calcone", id: c.id }]); });
      L.terms.forEach(x => { if ((x[0] + x[1]).toLowerCase().includes(k)) hits.push([t("s_terms"), x[0] + " — " + x[1], { v: "terms" }]); });
      const box = el(`<div class="list"></div>`);
      if (!hits.length) box.append(el(`<div class="empty">${esc(t("noresult"))}</div>`));
      hits.forEach(([s, n, route]) => { const row = el(`<div class="row"><div class="tx"><b>${esc(n)}</b><small>${esc(s)}</small></div><span class="chev">›</span></div>`); row.onclick = () => go(route); box.append(row); });
      view.append(box);
    }
  };

  function firstLine(s) { return String(s).split("\n").find(l => l.trim() && !l.trim().startsWith("=")) || ""; }
  function listView(key, rows, onClick) {
    setTitle(t(key));
    const box = el(`<div class="list"></div>`);
    rows.forEach(([a, b], i) => {
      const r = el(`<div class="row"><div class="n">${i + 1}</div><div class="tx"><b>${esc(a)}</b><small>${esc(b)}</small></div><span class="chev">›</span></div>`);
      r.onclick = () => onClick(i); box.append(r);
    });
    view.append(box);
  }
  function emojiList(key, items, emoji, numbered) {
    setTitle(t(key));
    if (key === "s_safety") view.append(el(`<div class="warn">${esc(t("safetyTop"))}</div>`));
    const box = el(`<div class="list"></div>`);
    items.forEach((x, i) => box.append(el(`<div class="row" style="cursor:default;align-items:flex-start"><div class="em">${emoji[i] || "•"}</div><div class="tx"><b>${esc(x[0])}</b><span style="color:var(--sub);font-size:14px">${esc(x[1])}</span></div></div>`)));
    view.append(box);
  }
  function pager(n, i, route) {
    const b = el(`<div class="btns"><button class="btn ghost">‹ ${esc(t("prev"))}</button><button class="btn ghost">${esc(t("next"))} ›</button></div>`);
    const [p, nx] = b.querySelectorAll("button");
    if (i <= 0) p.disabled = true, p.style.opacity = .4;
    if (i >= n - 1) nx.disabled = true, nx.style.opacity = .4;
    p.onclick = () => { if (i > 0) { stack[stack.length - 1] = route(i - 1); render(stack[stack.length - 1]); scrollTo(0, 0); } };
    nx.onclick = () => { if (i < n - 1) { stack[stack.length - 1] = route(i + 1); render(stack[stack.length - 1]); scrollTo(0, 0); } };
    view.append(b);
  }

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function startQuiz(n) {
    // In data, option[0] is always the correct answer; options are shuffled for display.
    const qs = shuffle(L.quiz.map((q, i) => i)).slice(0, n);
    let k = 0, score = 0;
    stack.push({ v: "quizrun" });
    backBtn.classList.remove("hide");
    const step = () => {
      view.innerHTML = "";
      setTitle(`${t("s_quiz")} ${k + 1}/${qs.length}`);
      const q = L.quiz[qs[k]];
      const opts = shuffle(q[1].map((o, i) => [o, i === 0]));
      const card = el(`<div><div class="qprog"><i style="width:${k / qs.length * 100}%"></i></div><div class="card"><h2 style="font-size:17px">${esc(q[0])}</h2></div></div>`);
      const c = card.querySelector(".card");
      let done = false;
      opts.forEach(([o, ok]) => {
        const b = el(`<button class="opt">${esc(o)}</button>`);
        b.onclick = () => {
          if (done) return; done = true;
          if (ok) { score++; b.classList.add("ok"); } else { b.classList.add("no"); c.querySelectorAll(".opt").forEach((z, j) => { if (opts[j][1]) z.classList.add("ok"); }); }
          if (q[2]) c.append(el(`<p class="note">💡 ${esc(q[2])}</p>`));
          const nx = el(`<button class="btn">${esc(k + 1 < qs.length ? t("next") : t("finish"))}</button>`);
          nx.onclick = () => { k++; k < qs.length ? (step(), scrollTo(0, 0)) : finish(); };
          c.append(nx);
        };
        c.append(b);
      });
      view.append(card);
    };
    const finish = () => {
      const pct = Math.round(score / qs.length * 100);
      const best = store.get("quiz_best_" + lang, 0); if (pct > best) store.set("quiz_best_" + lang, pct);
      view.innerHTML = ""; setTitle(t("s_quiz"));
      const card = el(`<div class="card" style="text-align:center"><h2>${esc(t("yourScore"))}</h2><div class="score">${pct}%</div><p>${score} / ${qs.length}</p><div class="btns"><button class="btn">${esc(t("again"))}</button></div></div>`);
      card.querySelector("button").onclick = () => { stack.pop(); startQuiz(n); };
      view.append(card);
    };
    step();
  }

  stack = [{ v: "home" }];
  render(stack[0]);
})();
