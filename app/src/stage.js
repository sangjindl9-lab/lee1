// 한 손가락 이동, 두 손가락 확대·축소, 탭, 그리기 모드를 처리하는 화면 무대.
// content 요소에 translate/scale 을 걸고, 좌표를 "내용 좌표"로 바꿔 준다.
export function createStage(stage, content) {
  const t = { tx: 0, ty: 0, s: 1 };
  let size = { w: 1000, h: 1000 };
  const pointers = new Map();
  let drawHandler = null; // { start(pt), move(pt), end(pt), cancel() }
  let tapHandler = null;
  let changeHandlers = [];
  let gesture = null; // { kind: 'pan'|'pinch'|'draw', ... }
  let lastTap = 0;
  let docMode = false; // 문서(PDF): 세로로만 똑바로 움직이고, 화면 밖으로 끌려가지 않게 한다. 도면(CAD)은 자유롭게.
  let fling = null; // 손을 뗀 뒤 관성 스크롤
  let lastMoves = []; // 속도 계산용 [{x,y,time}]

  // 오른쪽 세로 스크롤바(문서 모드): 움직일 때만 잠깐 보인다
  const bar = document.createElement('div');
  bar.className = 'vbar';
  stage.appendChild(bar);
  let barTimer;
  function showBar() {
    if (!docMode) return;
    const r = stage.getBoundingClientRect();
    const total = size.h * t.s;
    if (total <= r.height) { bar.style.opacity = 0; return; }
    const h = Math.max(24, r.height * r.height / total);
    const y = Math.min(r.height - h, Math.max(0, -t.ty / total * r.height));
    bar.style.height = h + 'px'; bar.style.top = y + 'px'; bar.style.opacity = 1;
    clearTimeout(barTimer); barTimer = setTimeout(() => { bar.style.opacity = 0; }, 900);
  }
  /** 문서 모드: 내용이 화면 밖으로 빠져나가지 않게 가둔다. 내용이 화면보다 작은 축은 가운데 정렬. */
  function clamp() {
    if (!docMode) return;
    const r = stage.getBoundingClientRect();
    const w = size.w * t.s, h = size.h * t.s;
    if (w <= r.width) t.tx = (r.width - w) / 2; else t.tx = Math.min(0, Math.max(r.width - w, t.tx));
    if (h <= r.height) t.ty = Math.min(t.ty, 12) < 0 ? 0 : Math.min(t.ty, 12); else t.ty = Math.min(0, Math.max(r.height - h, t.ty));
  }
  function stopFling() { if (fling) { cancelAnimationFrame(fling); fling = null; } }
  function startFling(vx, vy) {
    stopFling();
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(50, now - last); last = now;
      t.tx += vx * dt; t.ty += vy * dt;
      const k = Math.pow(0.994, dt); vx *= k; vy *= k;
      clamp(); apply(); showBar();
      if (Math.hypot(vx, vy) > 0.02) fling = requestAnimationFrame(step);
      else { fling = null; notify(true); }
    };
    fling = requestAnimationFrame(step);
  }

  content.style.transformOrigin = '0 0';
  stage.style.touchAction = 'none';

  function apply() {
    content.style.transform = `translate(${t.tx}px,${t.ty}px) scale(${t.s})`;
  }
  function notify(final) {
    for (const h of changeHandlers) h({ ...t }, final);
  }
  function toContent(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return { x: (clientX - r.left - t.tx) / t.s, y: (clientY - r.top - t.ty) / t.s };
  }
  function zoomAt(factor, cx, cy) {
    const r = stage.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    const ns = Math.min(200, Math.max(0.02, t.s * factor));
    const k = ns / t.s;
    t.tx = px - (px - t.tx) * k;
    t.ty = py - (py - t.ty) * k;
    t.s = ns;
    apply();
  }

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stopFling();
    lastMoves = [{ x: e.clientX, y: e.clientY, time: performance.now() }];
    if (pointers.size === 1) {
      const p0 = { x: e.clientX, y: e.clientY };
      if (drawHandler) {
        gesture = { kind: 'draw', start: p0, moved: false };
        drawHandler.start(toContent(e.clientX, e.clientY));
      } else {
        gesture = { kind: 'pan', start: p0, tx: t.tx, ty: t.ty, moved: false, time: Date.now() };
      }
    } else if (pointers.size === 2) {
      if (gesture && gesture.kind === 'draw' && drawHandler) drawHandler.cancel();
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s: t.s, tx: t.tx, ty: t.ty };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = stage.getBoundingClientRect();
      const ns = Math.min(200, Math.max(0.02, gesture.s * dist / gesture.dist));
      const k = ns / gesture.s;
      const mx = gesture.mid.x - r.left, my = gesture.mid.y - r.top;
      t.s = ns;
      t.tx = (mx - (mx - gesture.tx) * k) + (mid.x - gesture.mid.x);
      t.ty = (my - (my - gesture.ty) * k) + (mid.y - gesture.mid.y);
      clamp();
      apply();
      showBar();
      notify(false);
    } else if (gesture.kind === 'pan') {
      let dx = e.clientX - gesture.start.x, dy = e.clientY - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) > 6) {
        gesture.moved = true;
        // 문서 모드: 처음 움직인 방향이 세로면 세로로만(손이 조금 비뚤어져도 좌우로 흔들리지 않게)
        if (docMode) gesture.axis = Math.abs(dy) >= Math.abs(dx) * 0.7 ? 'y' : 'x';
      }
      if (gesture.moved) {
        if (gesture.axis === 'y') dx = 0; else if (gesture.axis === 'x') dy = 0;
        t.tx = gesture.tx + dx;
        t.ty = gesture.ty + dy;
        clamp();
        apply();
        showBar();
        notify(false);
        lastMoves.push({ x: e.clientX, y: e.clientY, time: performance.now() });
        if (lastMoves.length > 6) lastMoves.shift();
      }
    } else if (gesture.kind === 'draw' && drawHandler) {
      gesture.moved = true;
      drawHandler.move(toContent(e.clientX, e.clientY));
    }
  });
  function up(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.kind === 'pan' && pointers.size === 0) {
      if (gesture.moved) {
        notify(true);
        // 관성: 마지막 100ms 의 속도로 미끄러진다
        const now = performance.now();
        const past = lastMoves.find((m) => now - m.time < 120);
        if (past && e.type !== 'pointercancel' && now - past.time > 0) {
          const dt = now - past.time;
          let vx = (e.clientX - past.x) / dt, vy = (e.clientY - past.y) / dt;
          if (gesture.axis === 'y') vx = 0; else if (gesture.axis === 'x') vy = 0;
          if (Math.hypot(vx, vy) > 0.3) startFling(vx, vy);
        }
      }
      else if (Date.now() - gesture.time < 500 && e.type !== 'pointercancel') {
        const now = Date.now();
        const consumed = tapHandler && tapHandler(toContent(e.clientX, e.clientY), e);
        if (consumed) lastTap = 0;
        else if (now - lastTap < 300) { zoomAt(2.5, e.clientX, e.clientY); clamp(); apply(); notify(true); lastTap = 0; }
        else lastTap = now;
      }
      gesture = null;
    } else if (gesture.kind === 'draw' && drawHandler) {
      if (e.type === 'pointercancel') drawHandler.cancel();
      else drawHandler.end(toContent(e.clientX, e.clientY), !gesture.moved);
      gesture = null;
    } else if (gesture.kind === 'pinch' && pointers.size < 2) {
      clamp(); apply(); notify(true);
      gesture = pointers.size === 1 ? { kind: 'pan', start: [...pointers.values()][0], tx: t.tx, ty: t.ty, moved: true, time: 0 } : null;
    }
  }
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (docMode && !e.ctrlKey) { t.ty -= e.deltaY; clamp(); apply(); showBar(); notify(true); return; }
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    clamp(); apply();
    notify(true);
  }, { passive: false });

  return {
    get transform() { return { ...t }; },
    toContent,
    setContentSize(w, h) { size = { w, h }; content.style.width = w + 'px'; content.style.height = h + 'px'; },
    /** 내용 전체가 화면에 들어오도록 맞춘다. */
    fit(padding = 12) {
      const r = stage.getBoundingClientRect();
      t.s = Math.min((r.width - padding * 2) / size.w, (r.height - padding * 2) / size.h) || 1;
      t.tx = (r.width - size.w * t.s) / 2;
      t.ty = Math.max(padding, (r.height - size.h * t.s) / 2);
      clamp(); apply();
      notify(true);
    },
    /** 내용 폭을 화면 폭에 맞춘다(문서 읽기용). */
    fitWidth(padding = 8) {
      const r = stage.getBoundingClientRect();
      t.s = (r.width - padding * 2) / size.w;
      t.tx = padding;
      t.ty = padding;
      clamp(); apply();
      notify(true);
    },
    set(nt) { Object.assign(t, nt); clamp(); apply(); notify(true); },
    zoomBy(f) { const r = stage.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); clamp(); apply(); notify(true); },
    /** 문서 모드 켜기/끄기: PDF 는 세로로 똑바로 + 가두기 + 스크롤바, CAD 는 자유 이동. */
    setDocMode(on) { docMode = !!on; bar.style.opacity = 0; },
    setDrawHandler(h) { drawHandler = h; },
    setTapHandler(h) { tapHandler = h; },
    onChange(h) { changeHandlers.push(h); },
    /** 문서를 닫을 때: 이전 문서가 걸어 둔 처리기를 모두 떼어 낸다(다음 문서와 섞이지 않게). */
    reset() { changeHandlers = []; drawHandler = null; tapHandler = null; gesture = null; pointers.clear(); stopFling(); docMode = false; bar.style.opacity = 0; },
    /** 화면에 보이는 내용 영역(내용 좌표). */
    visibleRect() {
      const r = stage.getBoundingClientRect();
      return { x: -t.tx / t.s, y: -t.ty / t.s, w: r.width / t.s, h: r.height / t.s };
    },
  };
}
