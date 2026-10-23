import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Component } from 'react'
import App from './App.jsx'

// 화면 오류가 나도 하얀 화면 대신 안내 + 초기화 버튼
class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ padding: 24, fontFamily: 'sans-serif', lineHeight: 1.6 }}>
        <h2>화면을 여는 중 문제가 생겼습니다</h2>
        <p style={{ color: '#666' }}>{String(this.state.err?.message || this.state.err)}</p>
        <button style={{ padding: '10px 18px', fontSize: 16 }} onClick={() => { try { localStorage.clear() } catch { /* 무시 */ } location.reload() }}>
          저장된 설정 초기화하고 다시 열기
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Boundary><App /></Boundary>
  </StrictMode>,
)
