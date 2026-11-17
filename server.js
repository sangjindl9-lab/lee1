// 하도급 준공금 청구서 — 정적 페이지 하나를 내보내는 서버
const http = require('http'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'));
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}).listen(process.env.PORT || 3000, '0.0.0.0');
