import React, { useState } from 'react'

const FONTS = [['Nanum Pen Script', '나눔펜'], ['Nanum Brush Script', '나눔붓'], ['East Sea Dokdo', '독도'], ['Hi Melody', '하이멜로디'], ['Gaegu', '개구'], ['Gugi', '구기'], ['Song Myung', '송명'], ['Great Vibes', 'Great Vibes'], ['Dancing Script', 'Dancing']]
const COLORS = ['#1d1b17', '#1f3f8f', '#c8302a']

export default function TypeTab({ onFinish, toast }) {
  const [name, setName] = useState('홍길동')
  const [font, setFont] = useState(FONTS[0][0])
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(110)
  const [tilt, setTilt] = useState(true)

  const make = async () => {
    const n = name.trim(); if (!n) return toast('이름을 입력하세요')
    await document.fonts.load(`${size}px '${font}'`)
    const c = document.createElement('canvas'); c.width = 1000; c.height = 360
    const x = c.getContext('2d')
    x.font = `${size}px '${font}'`; x.fillStyle = color; x.textBaseline = 'middle'; x.textAlign = 'center'
    x.save(); x.translate(500, 180); if (tilt) x.rotate(-0.06); x.fillText(n, 0, 0); x.restore()
    onFinish(c, 'signature.png')
  }

  return (
    <div className="panel">
      <div className="side">
        <div className="field"><label>이름</label><input value={name} maxLength={20} onChange={e => setName(e.target.value)} /></div>
        <div className="field"><label>색상</label>
          <div className="chips">{COLORS.map(c => <button key={c} type="button" className={'sw' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
        </div>
        <div className="field"><label>크기 {size}</label><input type="range" min="60" max="160" value={size} onChange={e => setSize(+e.target.value)} /></div>
        <div className="field"><label><input type="checkbox" checked={tilt} onChange={e => setTilt(e.target.checked)} /> 살짝 기울이기</label></div>
      </div>
      <div className="fonts">
        {FONTS.map(([f, l]) => (
          <button key={f} type="button" className={'fcard' + (font === f ? ' on' : '')} onClick={() => setFont(f)}>
            <span className="sample" style={{ fontFamily: `'${f}'`, color }}>{name || '홍길동'}</span><small>{l}</small>
          </button>
        ))}
      </div>
      <button type="button" className="btn primary big full" onClick={make}>만들기</button>
    </div>
  )
}
