import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('화면을 표시할 #root 요소를 찾을 수 없습니다.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
