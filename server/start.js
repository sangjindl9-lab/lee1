// 배포용 시작 스크립트
// - ADMIN_PASSWORD 가 있으면 관리자 계정 생성/재설정
// - SEED_DEMO=true 이고 시연 현장이 없으면 시연 데이터 생성 (저장소가 초기화되는 무료 호스팅용)
const { execFileSync } = require('child_process');
const path = require('path');
const run = f => execFileSync('node', [path.join(__dirname, f)], { stdio: 'inherit', env: process.env });

if (process.env.ADMIN_PASSWORD) run('init-admin.js');
if (process.env.SEED_DEMO === 'true') {
  try { run('seed-demo.js'); } catch (e) { console.error('시연 데이터 생성 실패:', e.message); }
}
require('./index.js');
