const path = require('path');
const express = require('express');
const config = require('./config');
const { db, migrate } = require('./db');
migrate();
const { sessionMiddleware, loadUser, can, HttpError } = require('./auth');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(loadUser);
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use('/api', require('./routes/monitor').ingest); // 외부 상태 수신(토큰 인증)
app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/assets'));
app.use('/api', require('./routes/records'));
app.use('/api', require('./routes/drawings'));
app.use('/api', require('./routes/exports'));
app.use('/api', require('./routes/monitor'));
app.use('/api', (req, res) => res.status(404).json({ error: '없는 API 입니다.' }));

// QR 진입: 로그인 → 현장 권한 확인 → 모바일 이력 카드
app.get('/q/:token', (req, res) => {
  if (!req.user) return res.redirect(`/#/login?next=${encodeURIComponent('/q/' + req.params.token)}`);
  const a = db.prepare('SELECT id, site_id FROM assets WHERE qr_token=?').get(req.params.token);
  if (!a) return res.status(404).send(msgPage('등록되지 않은 QR 코드입니다.'));
  if (!can(req.user, a.site_id, 'view')) return res.status(403).send(msgPage('이 현장의 설비를 조회할 권한이 없습니다.'));
  res.redirect(`/#/m/asset/${a.id}`);
});
function msgPage(m) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>안내</title>
  <body style="font-family:sans-serif;padding:24px"><p>${m}</p><p><a href="/">처음 화면으로</a></p></body>`;
}

// 정적 파일 (pdf.js 는 로컬 node_modules 에서 제공, 외부 CDN 미사용)
app.use('/vendor/pdfjs', express.static(path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build')));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

// 오류 처리
app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `파일 크기는 ${config.maxUploadMb}MB 이하만 가능합니다.` });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (String(err.message).includes('FOREIGN KEY')) return res.status(400).json({ error: '존재하지 않는 대상과 연결할 수 없습니다.' });
  if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: '중복된 값이 있습니다: ' + err.message });
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module || process.argv[1]?.endsWith('start.js')) {
  // 종료 신호 처리 (PDF용 브라우저 정리 후 종료)
  const shutdown = async () => { try { await require('./lib/pdf').closeBrowser(); } catch {} try { db.close(); } catch {} process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  require('./lib/monitor').start();
  app.listen(config.port, () => console.log(`회로·케이블 이력 관리 시스템: http://localhost:${config.port}`));
}
module.exports = app;
