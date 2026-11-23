// 도장·서명 만들기 — SS 전자서명·도장 메이커(esign-maker)의 도장 렌더러를 옮겨 온 것.
// window.StampMaker.open({ name, ceo }) → Promise<{ dataUrl, kind } | null>
"use strict";
(function () {
  const CENTER_FONTS = [["'SealTT2'", "예서 (隸書)"], ["'SealTT1001'", "전서 (篆書)"], ["'SealTT9'", "해서 (楷書)"], ["'SealTT1'", "행서 (行書)"], ["'SealTT44'", "초서 (草書)"], ["'Noto Serif KR'", "명조"]];
  const STAMP_FONTS = ["'HJSealA'", "'HJSealB'", "'Gugi'", "'Song Myung'", "'Noto Serif KR'", "'Nanum Myeongjo'", "'Hahmlet'", "'Stylish'"];
  const CENTERS = ["代表理事", "代表理事印", "代表", "理事", "대표이사", "대표이사인", "印", ""];
  const COLORS = [["#d1272e", "인주 빨강"], ["#a8181b", "진홍"], ["#1f3f8f", "파랑"], ["#1d1b17", "검정"]];
  const PENS = ["#1d1b17", "#1f3f8f", "#c8302a"];

  /* ── 도장 그리기 (esign-maker src/lib/stamp.js) ── */
  function renderStamp(cv, o) {
    const W = cv.width, base = cv.getContext("2d"), cx = W / 2, cy = W / 2, R = W / 2 - W * 0.027;
    base.clearRect(0, 0, W, W);
    const layer = document.createElement("canvas"); layer.width = layer.height = W;
    const x = layer.getContext("2d");
    const erode = Math.round(W * 0.0035 * (o.thin ?? 1));
    const draw = (ch, tx, ty) => x.fillText(ch, tx, ty);
    x.fillStyle = o.color; x.strokeStyle = o.color; x.textAlign = "center"; x.textBaseline = "middle"; x.lineCap = "round";
    base.fillStyle = o.color; base.strokeStyle = o.color; base.lineCap = "round";
    const font = `${o.font},'Noto Serif KR'`;
    const text = o.text || (o.kind === "corp" ? "주식회사" : "홍길동");
    if (o.kind === "corp") {
      const R2 = W * 0.455;
      base.lineWidth = W * 0.02; base.beginPath(); base.arc(cx, cy, R2, 0, Math.PI * 2); base.stroke();
      const ri = R2 * (o.innerR ?? 0.55); base.lineWidth = W * 0.015; base.beginPath(); base.arc(cx, cy, ri, 0, Math.PI * 2); base.stroke();
      const rr = R2 * 0.78, chars = [...text.replace(/\s/g, "")], n = chars.length;
      const step = (Math.PI * 2) / (n + 1), top = -Math.PI / 2;
      const mark = o.mark ?? "dot";
      if (mark === "dot") { base.beginPath(); base.arc(cx + rr * Math.cos(top), cy + rr * Math.sin(top), W * 0.022, 0, Math.PI * 2); base.fill(); }
      const band = R2 - ri, fs = band * 0.88 * (o.ringScale ?? 1), slot = rr * step * 0.88 * (o.ringScale ?? 1);
      x.font = `700 ${fs}px ${font}`;
      chars.forEach((ch, i) => {
        const a = top + (i + 1) * step, mw = x.measureText(ch).width || fs;
        const sx = Math.max(0.55, Math.min(1.6, slot / mw));
        x.save(); x.translate(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); x.rotate(a + Math.PI / 2); x.scale(sx, 1); draw(ch, 0, fs * 0.04); x.restore();
      });
      if (/^\d+$/.test(mark)) { x.font = `800 ${fs * 0.95}px 'Noto Sans KR',sans-serif`; x.save(); x.translate(cx, cy - rr); draw(mark, 0, fs * 0.04); x.restore(); }
      const c = [...(o.center || "")], cs = o.centerScale ?? 1;
      const cfont = `${o.centerFont || "'Noto Serif KR'"},'Noto Serif KR'`;
      if (c.length >= 5) { const rows2 = Math.ceil(c.length / 2), g = ri * 1.5 / rows2 * cs, gx = ri * 0.62 * cs; x.font = `700 ${Math.min(g, ri * 0.6) * 0.95}px ${cfont}`; let k = 0; for (let col = 1; col >= 0; col--) for (let row = 0; row < rows2; row++) { if (k >= c.length) break; draw(c[k++], cx + (col - .5) * gx, cy + (row - (rows2 - 1) / 2) * g + ri * 0.02); } }
      else if (c.length === 4) { const g = ri * 0.7 * cs; x.font = `700 ${ri * 0.7 * cs}px ${cfont}`; [[1, 0], [1, 1], [0, 0], [0, 1]].forEach(([col, row], i) => draw(c[i], cx + (col - .5) * g, cy + (row - .5) * g + ri * 0.02)); }
      else if (c.length >= 3) { const g = ri * 0.52 * cs; x.font = `700 ${ri * 0.5 * cs}px ${cfont}`; c.forEach((ch, i) => draw(ch, cx, cy + (i - (c.length - 1) / 2) * g + 2)); }
      else if (c.length) { const g = ri * 0.8 * cs; x.font = `700 ${ri * 0.78 * cs}px ${cfont}`; c.forEach((ch, i) => draw(ch, cx, cy + (i - (c.length - 1) / 2) * g + ri * 0.03)); }
    } else if (o.kind === "corpsq") {
      const cfont = `${o.centerFont || "'Noto Serif KR'"},'Noto Serif KR'`;
      const side = R * 1.84, x0 = cx - side / 2, y0 = cy - side / 2;
      base.lineWidth = W * 0.03; base.strokeRect(x0, y0, side, side);
      const chars = [...(text.replace(/\s/g, "") + (o.center || ""))], n = chars.length;
      const lines = Math.max(1, Math.round(Math.sqrt(n)));
      const vertical = o.dir === "v";
      const baseCnt = Math.floor(n / lines), extra = n % lines, maxCnt = baseCnt + (extra ? 1 : 0);
      const pad = side * 0.06, inner = side - pad * 2, cs = o.centerScale ?? 1;
      const lineSize = inner / lines, cellSize = inner / maxCnt;
      const cw = vertical ? lineSize : cellSize, rh = vertical ? cellSize : lineSize;
      const fs = Math.min(cw, rh) * cs;
      const scaleFor = (f, ref) => { x.font = `700 ${fs}px ${f}`; x.textBaseline = "alphabetic"; const m = x.measureText(ref); const h = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || fs; return { sx: Math.min(2.2, (cw * 0.9 * cs) / fs), sy: Math.min(2.4, (rh * 0.9 * cs) / h), midY: (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 }; };
      const S = { ko: scaleFor(font, "국"), hj: scaleFor(cfont, "國") };
      let i = 0;
      for (let k = 0; k < lines; k++) {
        const cnt = baseCnt + (k < extra ? 1 : 0); if (!cnt) continue;
        const along = vertical ? rh : cw;
        const pos = (j) => cnt === 1 ? inner / 2 : along / 2 + j * (inner - along) / (cnt - 1);
        for (let j = 0; j < cnt; j++) {
          const ch = chars[i++], hanja = /[一-鿿]/.test(ch), sc = hanja ? S.hj : S.ko;
          const px = vertical ? x0 + pad + (lines - 1 - k + 0.5) * lineSize : x0 + pad + pos(j);
          const py = vertical ? y0 + pad + pos(j) : y0 + pad + (k + 0.5) * lineSize;
          x.font = `700 ${fs}px ${hanja ? cfont : font}`; x.textBaseline = "alphabetic";
          const mw = x.measureText(ch).width || fs, sx = Math.min(sc.sx, (cw * 0.96) / mw);
          x.save(); x.translate(px, py); x.scale(sx, sc.sy); draw(ch, 0, sc.midY); x.restore();
        }
      }
      x.textBaseline = "middle";
    } else {
      let chars = [...text.replace(/\s/g, "")].slice(0, 4);
      if (chars.length === 3 || chars.length === 1) chars.push("인");
      if (o.kind === "person") { base.lineWidth = W * 0.02; base.beginPath(); base.arc(cx, cy, R, 0, Math.PI * 2); base.stroke(); }
      else { base.lineWidth = W * 0.022; base.strokeRect(cx - R * 0.92, cy - R * 0.92, R * 1.84, R * 1.84); }
      const round = o.kind === "person", cs = o.centerScale ?? 1;
      const fit = (ch, px, py, box) => { const mw = x.measureText(ch).width || box; const sx = Math.min(1, box / mw); x.save(); x.translate(px, py); x.scale(sx, 1); draw(ch, 0, box * 0.05); x.restore(); };
      if (chars.length === 2) { const fs = R * (round ? 0.62 : 0.74) * cs, g = R * (round ? 0.72 : 0.8) * cs; x.font = `700 ${fs}px ${font}`; fit(chars[0], cx - g / 2, cy, fs); fit(chars[1], cx + g / 2, cy, fs); }
      else { const fs = R * (round ? 0.58 : 0.68) * cs, g = R * (round ? 0.66 : 0.86) * cs; x.font = `700 ${fs}px ${font}`; chars.forEach((ch, i) => fit(ch, cx + ((i % 2) - .5) * g, cy + (Math.floor(i / 2) - .5) * g, fs)); }
    }
    if (erode > 0) erodeAlpha(layer, erode);
    base.drawImage(layer, 0, 0);
  }
  function erodeAlpha(cv, r) {
    const x = cv.getContext("2d"), w = cv.width, h = cv.height, img = x.getImageData(0, 0, w, h), d = img.data;
    const a = new Uint8ClampedArray(w * h), t = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3];
    for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) { let m = 255; for (let k = -r; k <= r; k++) { const xx = X + k; const v = xx < 0 || xx >= w ? 0 : a[y * w + xx]; if (v < m) m = v; } t[y * w + X] = m; }
    for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) { let m = 255; for (let k = -r; k <= r; k++) { const yy = y + k; const v = yy < 0 || yy >= h ? 0 : t[yy * w + X]; if (v < m) m = v; } d[(y * w + X) * 4 + 3] = m; }
    x.putImageData(img, 0, 0);
  }
  // 투명 여백을 잘라 내고, 긴 변이 max 픽셀이 되게 줄인 PNG
  function exportPng(c, max) {
    const x = c.getContext("2d"), w = c.width, h = c.height, d = x.getImageData(0, 0, w, h).data;
    let t = h, b = 0, l = w, r = 0;
    for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) if (d[(y * w + X) * 4 + 3] > 8) { if (y < t) t = y; if (y > b) b = y; if (X < l) l = X; if (X > r) r = X; }
    if (b < t) return null;
    const pad = 6, cw = r - l + 1, ch = b - t + 1, s = Math.min(1, max / Math.max(cw, ch));
    const o = document.createElement("canvas"); o.width = Math.round(cw * s) + pad * 2; o.height = Math.round(ch * s) + pad * 2;
    o.getContext("2d").drawImage(c, l, t, cw, ch, pad, pad, Math.round(cw * s), Math.round(ch * s));
    return o.toDataURL("image/png");
  }

  /* ── 화면 ── */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const opt = (list, v) => list.map(([val, label]) => `<option value="${esc(val)}" ${val === v ? "selected" : ""}>${esc(label)}</option>`).join("");

  function open(info) {
    info = info || {};
    const corpName = (info.name || "").replace(/\(주\)|㈜/g, "주식회사").replace(/\s/g, "") || "주식회사";
    const st = { tab: "stamp", kind: /주식회사|\(주\)|㈜|법인|유한회사/.test(info.name || "") ? "corp" : "person",
      corpText: corpName, personText: (info.ceo || "").replace(/\s/g, "") || "홍길동",
      center: "代表理事", centerFont: CENTER_FONTS[0][0], thin: 0.3, color: "#d1272e",
      innerR: 0.55, centerScale: 1, ringScale: 1, mark: "dot", dir: "h", sel: 0 };
    const root = document.createElement("div");
    root.className = "sm-wrap"; root.setAttribute("role", "dialog"); root.setAttribute("aria-label", "도장·서명 만들기");
    document.body.appendChild(root);
    const strokes = []; let cur = null, pen = PENS[0];

    return new Promise(resolve => {
      const close = v => { root.remove(); document.removeEventListener("keydown", onKey); resolve(v); };
      const onKey = e => { if (e.key === "Escape") close(null); };
      document.addEventListener("keydown", onKey);
      const text = () => st.kind.startsWith("corp") ? st.corpText : st.personText;
      const opts = () => ({ kind: st.kind, text: text(), center: st.kind === "corpsq" ? (st.center === "代表理事" ? "" : st.center) : st.center,
        centerFont: st.centerFont, thin: st.thin, color: st.color, innerR: st.innerR, centerScale: st.centerScale, ringScale: st.ringScale, mark: st.mark, dir: st.dir });

      function render() {
        const corp = st.kind.startsWith("corp");
        root.innerHTML = `<div class="sm">
          <div class="sm-head"><strong>도장·서명 만들기</strong><button type="button" class="btn sm" data-sm="close">닫기</button></div>
          <div class="doctype"><button type="button" data-sm="tab-stamp" aria-pressed="${st.tab === "stamp"}">도장</button><button type="button" data-sm="tab-sign" aria-pressed="${st.tab === "sign"}">서명</button></div>
          ${st.tab === "stamp" ? `
          <div class="grid">
            <label class="f">종류<select id="sm-kind">${opt([["corp", "법인 직인 (원형)"], ["corpsq", "법인 직인 (사각)"], ["person", "개인 인감 (원형)"], ["square", "개인 인감 (사각)"]], st.kind)}</select></label>
            <label class="f">${corp ? "회사명" : "이름"}<input id="sm-text" maxlength="14" value="${esc(text())}"></label>
            ${corp ? `<label class="f">${st.kind === "corp" ? "가운데 문구" : "끝 문구"}<select id="sm-center">${opt(CENTERS.map(c => [c, c || "(없음)"]), st.center)}</select></label>
            <label class="f">한자 서체<select id="sm-cfont">${opt(CENTER_FONTS, st.centerFont)}</select></label>` : ""}
            ${st.kind === "corp" ? `<label class="f">위쪽 표시<select id="sm-mark">${opt([["dot", "● 점"], ["none", "없음"]], st.mark)}</select></label>` : ""}
            ${st.kind === "corpsq" ? `<label class="f">글자 방향<select id="sm-dir">${opt([["h", "가로쓰기"], ["v", "세로쓰기"]], st.dir)}</select></label>` : ""}
            <label class="f">획 굵기<select id="sm-thin">${opt([["1", "아주 가늘게"], ["0.6", "가늘게"], ["0.3", "보통"], ["0", "굵게"]], String(st.thin))}</select></label>
            <label class="f">색상<select id="sm-color">${opt(COLORS, st.color)}</select></label>
            <label class="f">${corp && st.kind === "corp" ? "가운데 글자 크기" : "글자 크기"} ${Math.round(st.centerScale * 100)}%<input id="sm-cs" type="range" min="0.5" max="1.4" step="0.02" value="${st.centerScale}"></label>
            ${st.kind === "corp" ? `<label class="f">둘레 글자 크기 ${Math.round(st.ringScale * 100)}%<input id="sm-rs" type="range" min="0.5" max="1.2" step="0.02" value="${st.ringScale}"></label>
            <label class="f full">안쪽 원 크기 ${Math.round(st.innerR * 100)}%<input id="sm-ir" type="range" min="0.35" max="0.72" step="0.01" value="${st.innerR}"></label>` : ""}
          </div>
          <p class="note">마음에 드는 모양을 눌러 고르세요.</p>
          <div class="sm-grid">${STAMP_FONTS.map((f, i) => `<button type="button" class="sm-pick" data-sm="pick" data-i="${i}" aria-pressed="${st.sel === i}"><canvas width="240" height="240"></canvas></button>`).join("")}</div>
          ` : `
          <div class="row">${PENS.map(c => `<button type="button" class="sm-pen" data-sm="pen" data-c="${c}" aria-pressed="${pen === c}" style="background:${c}" aria-label="펜 색 ${c}"></button>`).join("")}
            <button type="button" class="btn sm" data-sm="undo">되돌리기</button><button type="button" class="btn sm" data-sm="clear">지우기</button></div>
          <div class="sm-pad"><canvas id="sm-sign" width="800" height="360"></canvas><span class="sm-hint" ${strokes.length ? "hidden" : ""}>여기에 서명하세요</span></div>
          `}
          <div class="row sm-foot"><button type="button" class="btn pri" data-sm="use">${st.tab === "stamp" ? "이 도장 쓰기" : "이 서명 쓰기"}</button><button type="button" class="btn" data-sm="close">취소</button></div>
        </div>`;
        if (st.tab === "stamp") drawPreviews(); else setupPad();
      }

      let gen = 0;
      async function drawPreviews() {
        const my = ++gen, o = opts();
        const cvs = [...root.querySelectorAll(".sm-pick canvas")];
        try { await Promise.all([...STAMP_FONTS.map(f => document.fonts.load(`700 40px ${f}`, "가國")), document.fonts.load(`700 40px ${o.centerFont}`, "代表理事")]); } catch (e) {}
        if (my !== gen) return;
        cvs.forEach((c, i) => renderStamp(c, Object.assign({}, o, { font: STAMP_FONTS[i] })));
      }
      let pvTimer = 0;
      const update = (full) => { if (full) render(); else { clearTimeout(pvTimer); pvTimer = setTimeout(drawPreviews, 60); } };

      function redrawPad() {
        const c = root.querySelector("#sm-sign"); if (!c) return;
        const x = c.getContext("2d"); x.clearRect(0, 0, c.width, c.height); x.lineCap = "round"; x.lineJoin = "round";
        for (const s of strokes) { x.strokeStyle = s.c; x.lineWidth = 6; x.beginPath(); s.pts.forEach((p, i) => { if (!i) x.moveTo(p.x, p.y); else { const q = s.pts[i - 1]; x.quadraticCurveTo(q.x, q.y, (q.x + p.x) / 2, (q.y + p.y) / 2); } }); x.stroke(); }
        const hint = root.querySelector(".sm-hint"); if (hint) hint.hidden = strokes.length > 0;
      }
      function setupPad() {
        const c = root.querySelector("#sm-sign");
        const pos = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
        c.addEventListener("pointerdown", e => { e.preventDefault(); c.setPointerCapture(e.pointerId); cur = { c: pen, pts: [pos(e)] }; strokes.push(cur); redrawPad(); });
        c.addEventListener("pointermove", e => { if (!cur) return; cur.pts.push(pos(e)); redrawPad(); });
        ["pointerup", "pointercancel", "pointerleave"].forEach(ev => c.addEventListener(ev, () => { cur = null; }));
        redrawPad();
      }

      root.addEventListener("input", e => {
        const id = e.target.id, v = e.target.value;
        if (id === "sm-text") { if (st.kind.startsWith("corp")) st.corpText = v; else st.personText = v; update(); }
        else if (id === "sm-cs") { st.centerScale = +v; e.target.parentElement.firstChild.textContent = e.target.parentElement.firstChild.textContent.replace(/\d+%/, Math.round(+v * 100) + "%"); update(); }
        else if (id === "sm-rs") { st.ringScale = +v; e.target.parentElement.firstChild.textContent = e.target.parentElement.firstChild.textContent.replace(/\d+%/, Math.round(+v * 100) + "%"); update(); }
        else if (id === "sm-ir") { st.innerR = +v; e.target.parentElement.firstChild.textContent = e.target.parentElement.firstChild.textContent.replace(/\d+%/, Math.round(+v * 100) + "%"); update(); }
      });
      root.addEventListener("change", e => {
        const id = e.target.id, v = e.target.value;
        if (id === "sm-kind") { st.kind = v; st.centerScale = 1; update(true); }
        else if (id === "sm-center") { st.center = v; update(); }
        else if (id === "sm-cfont") { st.centerFont = v; update(); }
        else if (id === "sm-mark") { st.mark = v; update(); }
        else if (id === "sm-dir") { st.dir = v; update(); }
        else if (id === "sm-thin") { st.thin = +v; update(); }
        else if (id === "sm-color") { st.color = v; update(); }
      });
      root.addEventListener("click", e => {
        if (e.target === root) return close(null);
        const b = e.target.closest("[data-sm]"); if (!b) return;
        const a = b.dataset.sm;
        if (a === "close") close(null);
        else if (a === "tab-stamp" || a === "tab-sign") { st.tab = a === "tab-stamp" ? "stamp" : "sign"; render(); }
        else if (a === "pick") { st.sel = +b.dataset.i; root.querySelectorAll(".sm-pick").forEach((p, i) => p.setAttribute("aria-pressed", String(i === st.sel))); }
        else if (a === "pen") { pen = b.dataset.c; root.querySelectorAll(".sm-pen").forEach(p => p.setAttribute("aria-pressed", String(p.dataset.c === pen))); }
        else if (a === "undo") { strokes.pop(); redrawPad(); }
        else if (a === "clear") { strokes.length = 0; redrawPad(); }
        else if (a === "use") {
          if (st.tab === "stamp") {
            const c = document.createElement("canvas"); c.width = c.height = 800;
            renderStamp(c, Object.assign(opts(), { font: STAMP_FONTS[st.sel] }));
            close({ dataUrl: exportPng(c, 360), kind: "stamp" });
          } else {
            if (!strokes.length) return;
            const c = root.querySelector("#sm-sign");
            close({ dataUrl: exportPng(c, 420), kind: "sign" });
          }
        }
      });
      render();
    });
  }

  window.StampMaker = { open, renderStamp };
})();
