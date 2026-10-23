import React from 'react'

export default function Result({ r, toast }) {
  const copyImg = async () => {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': r.blob })]); toast('이미지를 복사했습니다') }
    catch { toast('이 환경에서는 이미지 복사가 막혀 있습니다') }
  }
  const copyB64 = async () => {
    try { await navigator.clipboard.writeText(r.dataUrl); toast('Base64 코드를 복사했습니다') } catch { toast('복사 실패') }
  }
  const today = new Date().toLocaleDateString('ko-KR')
  return (
    <section className="result" id="result">
      <div className="rgrid">
        <div>
          <div className="rimg"><img src={r.url} alt="생성된 서명/도장" /></div>
          <p className="note">투명 배경 PNG · {r.w}×{r.h}px · {(r.blob.size / 1024).toFixed(0)}KB</p>
          <div className="doc">
            <div className="t">문서에 넣었을 때 미리보기 — 검측 요청서</div>
            <div className="sig"><span>위와 같이 검측을 요청합니다.<br />{today} &nbsp; 시공사 ㈜에스에스전력</span><img src={r.url} alt="" /></div>
          </div>
        </div>
        <div className="side">
          <a className="btn primary" href={r.url} download={r.filename}>PNG 다운로드</a>
          <button type="button" className="btn" onClick={copyImg}>이미지 복사</button>
          <button type="button" className="btn" onClick={copyB64}>Base64 코드 복사</button>
          <p className="note">외부 전송 없이 이 기기에서만 생성됩니다.</p>
        </div>
      </div>
    </section>
  )
}
