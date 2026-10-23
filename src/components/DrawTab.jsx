import React, { useRef, useState, useEffect, useCallback } from 'react'

const PENS = ['#1d1b17', '#1f3f8f', '#c8302a']

export default function DrawTab({ onFinish, toast }) {
  const cv = useRef(null)
  const strokes = useRef([])
  const cur = useRef(null)
  const [color, setColor] = useState(PENS[0])
  const [width, setWidth] = useState(3)
  const [empty, setEmpty] = useState(true)

  const redraw = useCallback(() => {
    const c = cv.current, x = c.getContext('2d')
    x.clearRect(0, 0, c.width, c.height); x.lineCap = 'round'; x.lineJoin = 'round'
    for (const s of strokes.current) {
      x.strokeStyle = s.c; x.lineWidth = s.w * 1.4; x.beginPath()
      s.pts.forEach((p, i) => { if (i === 0) x.moveTo(p.x, p.y); else { const q = s.pts[i - 1]; x.quadraticCurveTo(q.x, q.y, (q.x + p.x) / 2, (q.y + p.y) / 2) } })
      x.stroke()
    }
  }, [])

  const pos = (e) => { const r = cv.current.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.current.width / r.width, y: (e.clientY - r.top) * cv.current.height / r.height } }

  useEffect(() => {
    const c = cv.current
    const down = (e) => { c.setPointerCapture(e.pointerId); cur.current = { c: color, w: width, pts: [pos(e)] }; strokes.current.push(cur.current); setEmpty(false); redraw() }
    const move = (e) => { if (!cur.current) return; cur.current.pts.push(pos(e)); redraw() }
    const up = () => { cur.current = null }
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move)
    ;['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => c.addEventListener(ev, up))
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => c.removeEventListener(ev, up)) }
  }, [color, width, redraw])

  const undo = () => { strokes.current.pop(); redraw(); setEmpty(strokes.current.length === 0) }
  const clear = () => { strokes.current = []; redraw(); setEmpty(true) }
  const make = () => { if (!strokes.current.length) return toast('먼저 서명을 그려주세요'); onFinish(cv.current, 'signature.png') }

  return (
    <div className="panel">
      <div className="side">
        <div className="field"><label>펜 색상</label>
          <div className="chips">{PENS.map(c => <button key={c} type="button" className={'sw' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
        </div>
        <div className="field"><label>펜 굵기 {width}px</label><input type="range" min="1" max="8" value={width} onChange={e => setWidth(+e.target.value)} /></div>
        <div className="row">
          <button type="button" className="btn" onClick={undo}>되돌리기</button>
          <button type="button" className="btn" onClick={clear}>지우기</button>
        </div>
      </div>
      <div className="stage">
        <canvas ref={cv} width={800} height={360} />
        {empty && <div className="hint">여기에 서명하세요.</div>}
      </div>
      <button type="button" className="btn primary big full" onClick={make}>만들기</button>
    </div>
  )
}
