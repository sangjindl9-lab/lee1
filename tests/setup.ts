import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 각 테스트가 끝나면 렌더링한 화면을 정리합니다.
afterEach(() => {
  cleanup();
});
