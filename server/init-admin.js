// 최초 관리자 계정 생성: ADMIN_USERNAME / ADMIN_PASSWORD 환경변수 사용
const { db, migrate } = require('./db');
migrate();
const { hashPassword } = require('./auth');

const u = process.env.ADMIN_USERNAME || 'admin';
const p = process.env.ADMIN_PASSWORD;
if (!p || p.length < 8) {
  console.error('ADMIN_PASSWORD 환경변수(8자 이상)를 설정한 뒤 실행하세요. 예) ADMIN_PASSWORD=비밀번호 npm run init');
  process.exit(1);
}
const ex = db.prepare('SELECT id FROM users WHERE username=?').get(u);
if (ex) {
  db.prepare("UPDATE users SET password_hash=?, role='admin', active=1 WHERE id=?").run(hashPassword(p), ex.id);
  console.log(`관리자 ${u} 비밀번호를 재설정했습니다.`);
} else {
  db.prepare("INSERT INTO users(username,password_hash,name,role) VALUES (?,?,?,'admin')").run(u, hashPassword(p), '관리자');
  console.log(`관리자 ${u} 계정을 만들었습니다.`);
}
