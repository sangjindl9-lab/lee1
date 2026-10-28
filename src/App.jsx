import React, { useState, useCallback } from 'react'
import DrawTab from './components/DrawTab.jsx'
import TypeTab from './components/TypeTab.jsx'
import StampTab from './components/StampTab.jsx'
import Result from './components/Result.jsx'
import { trimCanvas } from './lib/stamp.js'

const TABS = [
  { id: 'draw', label: '서명하기' },
  { id: 'type', label: '서명 만들기' },
  { id: 'stamp', label: '도장 만들기' },
]

export default function App() {
  const [tab, setTab] = useState('stamp')
  const [result, setResult] = useState(null)
  const [toast, setToast] = useState('')

  const showToast = useCallback((m) => { setToast(m); setTimeout(() => setToast(''), 1800) }, [])

  const finish = useCallback((canvas, filename) => {
    const cv = trimCanvas(canvas)
    cv.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      setResult({ url, blob, filename, w: cv.width, h: cv.height, dataUrl: cv.toDataURL('image/png') })
      showToast('생성 완료')
      setTimeout(() => document.getElementById('result')?.scrollIntoView({ behavior: 'smooth' }), 50)
    }, 'image/png')
  }, [showToast])

  return (
    <div className="wrap">
      <header>
        <div className="brand"><i>印</i>SS 전자서명·도장 메이커</div>
        <span className="tag">회원가입 없음 · 서버 전송 없음 · 투명 PNG</span>
      </header>

      <section className="hero">
        <h1>무료 전자서명/도장 만들기.</h1>
        <p>나만의 전자 서명/도장을 만들고, 검측요청서·계약서·견적서에 바로 사용해보세요.</p>
      </section>

      <div className="box">
        <nav className="tabs" role="tablist">
          {TABS.map(t => (
            <button key={t.id} role="tab" className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
        {tab === 'draw' && <DrawTab onFinish={finish} toast={showToast} />}
        {tab === 'type' && <TypeTab onFinish={finish} toast={showToast} />}
        {tab === 'stamp' && <StampTab onFinish={finish} toast={showToast} />}
      </div>

      {result && <Result r={result} toast={showToast} />}

      <section className="feat">
        <div><b>투명 배경 PNG</b>한글·PDF·엑셀 서류에 겹쳐 넣어도 배경이 비치지 않습니다.</div>
        <div><b>인감·법인직인</b>원형 인감, 사각 인감, 둘레 문자형 법인 직인까지.</div>
        <div><b>현장 서류 특화</b>검측요청서·작업일보·견적서 서명란 크기에 맞춘 기본값.</div>
      </section>

      <div className={'toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  )
}
