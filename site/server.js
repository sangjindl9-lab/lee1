// 이음 구매노트 안내 사이트(정적). 접속 기록을 따로 남기지 않는다.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "public");
const LANGS = ["ko", "en", "ja", "es"];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };
const HDR = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/health") { res.writeHead(200, HDR); return res.end("ok"); }
  if (url.pathname === "/") {
    const al = (req.headers["accept-language"] || "").toLowerCase();
    const want = al.split(",").map(s => s.trim().slice(0, 2)).find(l => LANGS.includes(l)) || "en";
    res.writeHead(302, { ...HDR, Location: `/${want}/` }); return res.end();
  }
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
  if (p.endsWith("/") || p === "" || LANGS.includes(p)) p = path.join(p, "index.html");
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(400, HDR); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { ...HDR, "Content-Type": TYPES[".html"] }); return res.end('<p>Not found. <a href="/">Home</a></p>'); }
    res.writeHead(200, { ...HDR, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "public, max-age=600" });
    res.end(data);
  });
}).listen(process.env.PORT || 8080);
