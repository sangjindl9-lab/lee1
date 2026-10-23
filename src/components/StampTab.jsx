import React, { useState, useEffect, useRef } from 'react'
import { STAMP_FONTS, CENTER_FONTS, renderStamp } from '../lib/stamp.js'

const CENTERS = ['代表理事', '代表', '理事', '대표이사', '印']
const COLORS = [['#d1272e', '인주 빨강'], ['#a8181b', '진홍'], ['#1f3f8f', '파랑'], ['#1d1b17', '검정']]

function StampPreview({ opts, selected, onClick }) {
  const ref = useRef(null)
  useEffect(() => {
    let alive = true
    Promise.all([document.fonts.load(`900 40px ${opts.font}`), document.fonts.load(`700 40px ${opts.centerFont || "'Noto Serif KR'"}`)]).finally(() => { if (alive && ref.current) renderStamp(ref.current, opts) })
    return () => { alive = false }
  }, [opts])
  return (
    <button type="button" className={selected ? 'on' : ''} onClick={onClick}>
      <canvas ref={ref} width={240} height={240} />
    </button>
  )
}

export default function StampTab({ onFinish, toast }) {
  const [kind, setKind] = useState('corp')
  const [text, setText] = useState('주식회사에스에스전력')
  const [center, setCenter] = useState('代表理事')
  const [color, setColor] = useState('#d1272e')
  const [centerFont, setCenterFont] = useState(CENTER_FONTS[0][0])
  const [thin, setThin] = useState(1)
  const [innerR, setInnerR] = useState(0.55)
  const [centerScale, setCenterScale] = useState(1)
  const [ringScale, setRingScale] = useState(1)
  const [applied, setApplied] = useState(null)   // 만들기 눌렀을 때의 옵션
  const [sel, setSel] = useState(-1)

  const generate = () => { setApplied({ kind, text: text.trim(), center, color, centerFont, thin, innerR, centerScale, ringScale }); setSel(-1) }
  useEffect(() => { generate() }, []) // 첫 진입 시 예시 생성
  // 슬라이더·옵션은 만들기 없이 바로 반영
  useEffect(() => { if (applied) setApplied(a => ({ ...a, color, centerFont, thin, innerR, centerScale, ringScale, center })) }, [color, centerFont, thin, innerR, centerScale, ringScale, center])

  const make = () => {
    if (sel < 0 || !applied) return toast('도장 모양을 먼저 선택하세요')
    const c = document.createElement('canvas'); c.width = c.height = 800
    renderStamp(c, { ...applied, font: STAMP_FONTS[sel] })
    onFinish(c, 'stamp.png')
  }

  return (
    <div className="stamp">
      <div className="sbar">
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="도장 종류">
          <option value="corp">법인 직인</option>
          <option value="person">개인 인감 (원형)</option>
          <option value="square">개인 인감 (사각)</option>
        </select>
        <div className="sin">
          <input value={text} maxLength={14} onChange={e => setText(e.target.value)} placeholder={kind === 'corp' ? '회사명 (법인명)' : '이름'} />
          <span className="cnt"><b>{[...text].length}</b>/14</span>
        </div>
        <button type="button" className="btn" onClick={generate}>만들기</button>
      </div>

      {kind === 'corp' && (
        <div className="sliders">
          <label>안쪽 원 크기 <span>{Math.round(innerR * 100)}%</span><input type="range" min="0.35" max="0.72" step="0.01" value={innerR} onChange={e => setInnerR(+e.target.value)} /></label>
          <label>중앙 글자 크기 <span>{Math.round(centerScale * 100)}%</span><input type="range" min="0.5" max="1.4" step="0.02" value={centerScale} onChange={e => setCenterScale(+e.target.value)} /></label>
          <label>둘레 글자 크기 <span>{Math.round(ringScale * 100)}%</span><input type="range" min="0.5" max="1.2" step="0.02" value={ringScale} onChange={e => setRingScale(+e.target.value)} /></label>
        </div>
      )}
      {kind === 'corp' && (
        <div className="sopt">
          <label>중앙 문구
            <select value={center} onChange={e => setCenter(e.target.value)}>{CENTERS.map(c => <option key={c}>{c}</option>)}</select>
          </label>
          <label>한자 서체
            <select value={centerFont} onChange={e => setCenterFont(e.target.value)}>{CENTER_FONTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label>획 굵기
            <select value={thin} onChange={e => setThin(+e.target.value)}><option value={1}>아주 가늘게</option><option value={0.6}>가늘게</option><option value={0.3}>보통</option><option value={0}>굵게 (원본)</option></select>
          </label>
          <label>색상
            <select value={color} onChange={e => setColor(e.target.value)}>{COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
      )}
      {kind !== 'corp' && (
        <div className="sopt">
          <label>획 굵기
            <select value={thin} onChange={e => setThin(+e.target.value)}><option value={1}>아주 가늘게</option><option value={0.6}>가늘게</option><option value={0.3}>보통</option><option value={0}>굵게 (원본)</option></select>
          </label>
          <label>색상
            <select value={color} onChange={e => setColor(e.target.value)}>{COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
      )}

      <div className="sopt">
        <label className="upl">전서체 폰트 파일 (.ttf/.otf/.woff) 불러오기
          <input type="file" accept=".ttf,.otf,.woff,.woff2" onChange={async e => {
            const f = e.target.files[0]; if (!f) return
            try { const ff = new FontFace('SealKR', await f.arrayBuffer()); await ff.load(); document.fonts.add(ff); toast('폰트 적용: ' + f.name); generate() }
            catch { toast('폰트를 읽지 못했습니다') }
          }} />
        </label>
      </div>

      <div className="vgrid">
        {applied && STAMP_FONTS.map((f, i) => (
          <StampPreview key={f + JSON.stringify(applied)} opts={{ ...applied, font: f }} selected={sel === i} onClick={() => setSel(i)} />
        ))}
      </div>

      <button type="button" className="btn seal big" disabled={sel < 0} onClick={make}>만들기</button>
    </div>
  )
}
