// 이음사인 실행 파일: node server.js
process.removeAllListeners('warning');
require('./src/seed').bootstrap();
const { app } = require('./src/app');
const Q = require('./src/queue');
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`[이음사인] http://localhost:${port} 에서 실행 중`);
  if (process.env.DISABLE_WORKER !== '1') Q.start();
});
