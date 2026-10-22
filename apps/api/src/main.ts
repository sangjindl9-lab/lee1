import 'reflect-metadata';
import { start } from './bootstrap';

start().catch((e) => {
  console.error('서버 시작 실패:', e);
  process.exit(1);
});
