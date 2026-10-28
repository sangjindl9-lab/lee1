// 도장 렌더러 — 도뉴 스타일: 가는 테두리, 둘레 회사명, 상단 점, 중앙 2x2 한자
// 전서체(篆書體) 폰트 파일을 public/fonts/seal.woff2 로 넣으면 "SealKR" 이름으로 첫 번째 후보가 됩니다.
// 중앙 한자용 서체 (사용자 제공 TTF → Unicode WOFF2 변환)
export const CENTER_FONTS = [["'SealTT2'", '예서 (隸書)'], ["'SealTT1001'", '전서 (篆書)'], ["'SealTT9'", '해서 (楷書)'], ["'SealTT1'", '행서 (行書)'], ["'SealTT44'", '초서 (草書)'], ["'Noto Serif KR'", '명조']]
export const STAMP_FONTS = ["'HJSealA'", "'HJSealB'", "'SealKR'", "'Gugi'", "'Song Myung'", "'Noto Serif KR'", "'Nanum Myeongjo'", "'Hahmlet'", "'Stylish'", "'Do Hyeon'", "'Jua'"]

export function renderStamp(cv, o) {
  const W = cv.width, base = cv.getContext('2d'), cx = W / 2, cy = W / 2, R = W / 2 - W * 0.027
  base.clearRect(0, 0, W, W)
  // 글자는 별도 레이어에 그린 뒤 획을 깎아(erode) 얇게 만든다. thin: 0(원본)~1(가장 가늘게)
  const layer = document.createElement('canvas'); layer.width = layer.height = W
  const x = layer.getContext('2d')
  const erode = Math.round(W * 0.0035 * (o.thin ?? 1))
  const draw = (ch, tx, ty) => x.fillText(ch, tx, ty)
  x.fillStyle = o.color; x.strokeStyle = o.color; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineCap = 'round'
  base.fillStyle = o.color; base.strokeStyle = o.color; base.lineCap = 'round'
  const font = `${o.font},'Noto Serif KR'`
  const text = o.text || (o.kind === 'corp' ? '주식회사' : '홍길동')
  if (o.kind === 'corp') {
    // 도뉴 샘플 실측(200px 기준): 외곽선 r=0.455W 두께 2%W, 내원 r=0.55R 두께 1.5%W,
    // 둘레 글자 중심 r=0.78R 크기 0.27R, 상단 점은 글자 한 칸을 차지
    const R2 = W * 0.455
    base.lineWidth = W * 0.02; base.beginPath(); base.arc(cx, cy, R2, 0, Math.PI * 2); base.stroke()
    const ri = R2 * (o.innerR ?? 0.55); base.lineWidth = W * 0.015; base.beginPath(); base.arc(cx, cy, ri, 0, Math.PI * 2); base.stroke()
    const rr = R2 * 0.78, chars = [...text.replace(/\s/g, '')], n = chars.length
    const step = (Math.PI * 2) / (n + 1), top = -Math.PI / 2
    const mark = o.mark ?? 'dot'   // 'dot' | 'none' | '1'~'9'
    if (mark === 'dot') { base.beginPath(); base.arc(cx + rr * Math.cos(top), cy + rr * Math.sin(top), W * 0.022, 0, Math.PI * 2); base.fill() }
    // 글자를 띠(내원~외곽선)에 꽉 차게: 높이는 띠의 88%, 폭은 각 칸의 88%에 맞춰 가로 늘림/줄임
    const band = R2 - ri, fs = band * 0.88 * (o.ringScale ?? 1), slot = rr * step * 0.88 * (o.ringScale ?? 1)
    x.font = `700 ${fs}px ${font}`
    chars.forEach((ch, i) => {
      const a = top + (i + 1) * step, mw = x.measureText(ch).width || fs
      const sx = Math.max(0.55, Math.min(1.6, slot / mw))
      x.save(); x.translate(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); x.rotate(a + Math.PI / 2); x.scale(sx, 1); draw(ch, 0, fs * 0.04); x.restore()
    })
    if (/^\d+$/.test(mark)) { x.font = `800 ${fs * 0.95}px 'Noto Sans KR',sans-serif`; x.save(); x.translate(cx, cy - rr); draw(mark, 0, fs * 0.04); x.restore() }
    const c = [...o.center], cs = o.centerScale ?? 1
    const cfont = `${o.centerFont || "'Noto Serif KR'"},'Noto Serif KR'`
    if (c.length >= 5) { const cols2 = 2, rows2 = Math.ceil(c.length / 2), g = ri * 1.5 / rows2 * cs, gx = ri * 0.62 * cs; x.font = `700 ${Math.min(g, ri * 0.6) * 0.95}px ${cfont}`; let k = 0; for (let col = 1; col >= 0; col--) for (let row = 0; row < rows2; row++) { if (k >= c.length) break; draw(c[k++], cx + (col - .5) * gx, cy + (row - (rows2 - 1) / 2) * g + ri * 0.02) } }
    else if (c.length === 4) { const g = ri * 0.7 * cs; x.font = `700 ${ri * 0.7 * cs}px ${cfont}`; [[1, 0], [1, 1], [0, 0], [0, 1]].forEach(([col, row], i) => draw(c[i], cx + (col - .5) * g, cy + (row - .5) * g + ri * 0.02)) }
    else if (c.length >= 3) { const g = ri * 0.52 * cs; x.font = `700 ${ri * 0.5 * cs}px ${cfont}`; c.forEach((ch, i) => draw(ch, cx, cy + (i - (c.length - 1) / 2) * g + 2)) }
    else { const g = ri * 0.8 * cs; x.font = `700 ${ri * 0.78 * cs}px ${cfont}`; c.forEach((ch, i) => draw(ch, cx, cy + (i - (c.length - 1) / 2) * g + ri * 0.03)) }
  } else if (o.kind === 'corpsq') {
    // 법인 사각직인: 모든 글자를 한 격자에 세로쓰기(오른쪽 열부터), 열마다 세로를 꽉 채우고 글자는 칸에 맞춰 늘림
    const cfont = `${o.centerFont || "'Noto Serif KR'"},'Noto Serif KR'`
    const side = R * 1.84, x0 = cx - side / 2, y0 = cy - side / 2
    base.lineWidth = W * 0.03; base.strokeRect(x0, y0, side, side)
    const chars = [...(text.replace(/\s/g, '') + (o.center || ''))], n = chars.length
    const lines = o.cols || Math.max(1, Math.round(Math.sqrt(n)))   // 줄(가로) 또는 열(세로) 수
    const vertical = o.dir === 'v'                       // 'h': 가로쓰기(윗줄부터 왼→오), 'v': 세로쓰기(오른쪽 열부터 위→아래)
    const baseCnt = Math.floor(n / lines), extra = n % lines, maxCnt = baseCnt + (extra ? 1 : 0)
    const pad = side * 0.06, inner = side - pad * 2, cs = o.centerScale ?? 1
    // 모든 글자를 같은 크기 칸에: 줄 방향 = inner/lines, 글자 방향 = inner/maxCnt (가장 긴 줄 기준)
    const lineSize = inner / lines, cellSize = inner / maxCnt
    const cw = vertical ? lineSize : cellSize, rh = vertical ? cellSize : lineSize
    const fs = Math.min(cw, rh) * cs
    // 글자마다가 아니라 기준 글자('국')로 한 번만 배율을 정해 모든 글자 크기를 통일
    const scaleFor = (f, ref) => { x.font = `700 ${fs}px ${f}`; x.textBaseline = 'alphabetic'; const m = x.measureText(ref); const h = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || fs; return { sx: Math.min(2.2, (cw * 0.9 * cs) / fs), sy: Math.min(2.4, (rh * 0.9 * cs) / h), midY: (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 } }
    const S = { ko: scaleFor(font, '국'), hj: scaleFor(cfont, '國') }
    let i = 0
    for (let k = 0; k < lines; k++) {
      const cnt = baseCnt + (k < extra ? 1 : 0); if (!cnt) continue   // 남는 글자는 앞쪽 줄에
      // 짧은 줄도 첫 글자는 왼쪽 끝, 마지막 글자는 오른쪽 끝에 맞추고 사이 간격만 넓힘(양쪽 정렬)
      const along = vertical ? rh : cw
      const pos = (j) => cnt === 1 ? inner / 2 : along / 2 + j * (inner - along) / (cnt - 1)
      for (let j = 0; j < cnt; j++) {
        const ch = chars[i++], hanja = /[\u4E00-\u9FFF]/.test(ch), sc = hanja ? S.hj : S.ko
        const px = vertical ? x0 + pad + (lines - 1 - k + 0.5) * lineSize : x0 + pad + pos(j)
        const py = vertical ? y0 + pad + pos(j) : y0 + pad + (k + 0.5) * lineSize
        x.font = `700 ${fs}px ${hanja ? cfont : font}`; x.textBaseline = 'alphabetic'
        const mw = x.measureText(ch).width || fs, sx = Math.min(sc.sx, (cw * 0.96) / mw)   // 칸보다 넓은 글자만 살짝 줄임
        x.save(); x.translate(px, py); x.scale(sx, sc.sy); draw(ch, 0, sc.midY); x.restore()
      }
    }
    x.textBaseline = 'middle'
  } else if (o.kind === 'approve') {
    // 승인 도장: 이중 원 + 위·아래 별 5개 + 비스듬한 띠 문구
    const Ro = W * 0.44, Ri = W * 0.355, Rc = W * 0.3
    base.lineWidth = W * 0.032; base.beginPath(); base.arc(cx, cy, Ro, 0, Math.PI * 2); base.stroke()
    base.lineWidth = W * 0.012; base.beginPath(); base.arc(cx, cy, Ri, 0, Math.PI * 2); base.stroke()
    base.lineWidth = W * 0.008; base.beginPath(); base.arc(cx, cy, Rc, 0, Math.PI * 2); base.stroke()
    const star = (px, py, r) => { base.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; base.lineTo(px + rr * Math.cos(a), py + rr * Math.sin(a)) } base.closePath(); base.fill() }
    const rs = (Ro + Ri) / 2 - W * 0.002, sr = W * 0.028
    for (const mid of [-Math.PI / 2, Math.PI / 2]) for (let k = -2; k <= 2; k++) { const a = mid + k * 0.27; star(cx + rs * Math.cos(a), cy + rs * Math.sin(a), sr) }
    // 띠 자리 비우기 → 띠 테두리 → 문구
    const ang = (o.tilt ?? -18) * Math.PI / 180, bw = W * 0.96, bh = W * 0.24
    base.save(); base.translate(cx, cy); base.rotate(ang)
    base.globalCompositeOperation = 'destination-out'; base.fillRect(-bw / 2, -bh / 2, bw, bh); base.globalCompositeOperation = 'source-over'
    base.lineWidth = W * 0.014; base.strokeRect(-bw / 2 + W * 0.01, -bh / 2 + W * 0.02, bw - W * 0.02, bh - W * 0.04)
    base.restore()
    const chars = [...text], n = Math.max(1, chars.length), cs = o.centerScale ?? 1
    const fs = Math.min(bh * 0.52, (bw * 0.86) / n * 1.25) * cs
    x.save(); x.translate(cx, cy); x.rotate(ang); x.font = `700 ${fs}px ${font}`
    const tw = x.measureText(text).width || fs, sx = Math.min(1, (bw * 0.86) / tw)
    x.scale(sx, 1); draw(text, 0, fs * 0.04); x.restore()
  } else if (o.kind === 'rect') {
    // 원본대조필 같은 가로 직사각 고무인: [ 문구 | 빈칸 ]
    const w = W * 0.96, h = W * 0.24, x0 = cx - w / 2, y0 = cy - h / 2
    const boxW = o.box === false ? 0 : h * 1.05
    base.lineWidth = W * 0.012; base.strokeRect(x0, y0, w, h)
    if (boxW) { base.beginPath(); base.moveTo(x0 + w - boxW, y0); base.lineTo(x0 + w - boxW, y0 + h); base.stroke() }
    const chars = [...text.replace(/\s/g, '')], n = Math.max(1, chars.length)
    const area = w - boxW, padX = h * 0.22, cw = (area - padX * 2) / n, cs = o.centerScale ?? 1
    const fs = Math.min(h * 0.62, cw * 1.05) * cs
    x.font = `700 ${fs}px ${font}`
    chars.forEach((ch, i) => {
      const mw = x.measureText(ch).width || fs, sx = Math.min(1, (cw * 0.95) / mw)
      x.save(); x.translate(x0 + padX + (i + 0.5) * cw, cy); x.scale(sx, 1); draw(ch, 0, fs * 0.04); x.restore()
    })
  } else {
    let chars = [...text.replace(/\s/g, '')].slice(0, 4)
    if (chars.length === 3 || chars.length === 1) chars.push('인')
    if (o.kind === 'person') { base.lineWidth = W * 0.02; base.beginPath(); base.arc(cx, cy, R, 0, Math.PI * 2); base.stroke() }
    else { base.lineWidth = W * 0.022; base.strokeRect(cx - R * 0.92, cy - R * 0.92, R * 1.84, R * 1.84) }
    // 글자를 칸(box) 안에 맞춰 그림: 폭이 넘치면 가로로 줄임 → 원 밖으로 벗어나지 않음
    const round = o.kind === 'person', cs = o.centerScale ?? 1
    const fit = (ch, px, py, box) => { const mw = x.measureText(ch).width || box; const sx = Math.min(1, box / mw); x.save(); x.translate(px, py); x.scale(sx, 1); draw(ch, 0, box * 0.05); x.restore() }
    if (chars.length === 2) { const fs = R * (round ? 0.62 : 0.74) * cs, g = R * (round ? 0.72 : 0.8) * cs; x.font = `700 ${fs}px ${font}`; fit(chars[0], cx - g / 2, cy, fs); fit(chars[1], cx + g / 2, cy, fs) }
    else { const fs = R * (round ? 0.58 : 0.68) * cs, g = R * (round ? 0.66 : 0.86) * cs; x.font = `700 ${fs}px ${font}`; chars.forEach((ch, i) => fit(ch, cx + ((i % 2) - .5) * g, cy + (Math.floor(i / 2) - .5) * g, fs)) }
  }
  if (erode > 0) erodeAlpha(layer, erode)
  base.drawImage(layer, 0, 0)
}

// 알파 채널 최소값 필터(가로→세로)로 획을 r픽셀씩 깎아 얇게 만든다
function erodeAlpha(cv, r) {
  const x = cv.getContext('2d'), w = cv.width, h = cv.height, img = x.getImageData(0, 0, w, h), d = img.data
  const a = new Uint8ClampedArray(w * h), t = new Uint8ClampedArray(w * h)
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3]
  for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) { let m = 255; for (let k = -r; k <= r; k++) { const xx = X + k; const v = xx < 0 || xx >= w ? 0 : a[y * w + xx]; if (v < m) m = v } t[y * w + X] = m }
  for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) { let m = 255; for (let k = -r; k <= r; k++) { const yy = y + k; const v = yy < 0 || yy >= h ? 0 : t[yy * w + X]; if (v < m) m = v } d[(y * w + X) * 4 + 3] = m }
  x.putImageData(img, 0, 0)
}

export function trimCanvas(c, pad = 16) {
  const x = c.getContext('2d'), w = c.width, h = c.height, d = x.getImageData(0, 0, w, h).data
  let t = h, b = 0, l = w, r = 0
  for (let y = 0; y < h; y++) for (let X = 0; X < w; X++) { if (d[(y * w + X) * 4 + 3] > 8) { if (y < t) t = y; if (y > b) b = y; if (X < l) l = X; if (X > r) r = X } }
  if (b < t) return c
  const o = document.createElement('canvas'); o.width = r - l + 1 + pad * 2; o.height = b - t + 1 + pad * 2
  o.getContext('2d').drawImage(c, l, t, r - l + 1, b - t + 1, pad, pad, r - l + 1, b - t + 1)
  return o
}
