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
    const ri = R2 * 0.55; base.lineWidth = W * 0.015; base.beginPath(); base.arc(cx, cy, ri, 0, Math.PI * 2); base.stroke()
    const rr = R2 * 0.78, chars = [...text.replace(/\s/g, '')], n = chars.length
    const step = (Math.PI * 2) / (n + 1), top = -Math.PI / 2
    base.beginPath(); base.arc(cx + rr * Math.cos(top), cy + rr * Math.sin(top), W * 0.022, 0, Math.PI * 2); base.fill()
    // 글자를 띠(내원~외곽선)에 꽉 차게: 높이는 띠의 88%, 폭은 각 칸의 88%에 맞춰 가로 늘림/줄임
    const band = R2 - ri, fs = band * 0.88, slot = rr * step * 0.88
    x.font = `700 ${fs}px ${font}`
    chars.forEach((ch, i) => {
      const a = top + (i + 1) * step, mw = x.measureText(ch).width || fs
      const sx = Math.max(0.55, Math.min(1.6, slot / mw))
      x.save(); x.translate(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); x.rotate(a + Math.PI / 2); x.scale(sx, 1); draw(ch, 0, fs * 0.04); x.restore()
    })
    const c = [...o.center]
    const cfont = `${o.centerFont || "'Noto Serif KR'"},'Noto Serif KR'`
    if (c.length === 4) { const g = ri * 0.7; x.font = `700 ${ri * 0.7}px ${cfont}`; [[1, 0], [1, 1], [0, 0], [0, 1]].forEach(([col, row], i) => draw(c[i], cx + (col - .5) * g, cy + (row - .5) * g + ri * 0.02)) }
    else if (c.length >= 3) { const g = ri * 0.52; x.font = `700 ${ri * 0.5}px ${cfont}`; c.forEach((ch, i) => draw(ch, cx, cy + (i - (c.length - 1) / 2) * g + 2)) }
    else { const g = ri * 0.8; x.font = `700 ${ri * 0.78}px ${cfont}`; c.forEach((ch, i) => draw(ch, cx, cy + (i - (c.length - 1) / 2) * g + ri * 0.03)) }
  } else {
    let chars = [...text.replace(/\s/g, '')].slice(0, 4)
    if (chars.length === 3 || chars.length === 1) chars.push('인')
    if (o.kind === 'person') { base.lineWidth = W * 0.02; base.beginPath(); base.arc(cx, cy, R, 0, Math.PI * 2); base.stroke() }
    else { base.lineWidth = W * 0.022; base.strokeRect(cx - R * 0.92, cy - R * 0.92, R * 1.84, R * 1.84) }
    if (chars.length === 2) { x.font = `700 ${R * 0.72}px ${font}`; draw(chars[0], cx - R * 0.4, cy + R * 0.04); draw(chars[1], cx + R * 0.4, cy + R * 0.04) }
    else { const g = R * 0.86; x.font = `700 ${R * 0.66}px ${font}`; chars.forEach((ch, i) => draw(ch, cx + ((i % 2) - .5) * g, cy + (Math.floor(i / 2) - .5) * g + R * 0.04)) }
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
