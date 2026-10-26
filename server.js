// 관급자재 구매요청서 자동작성 — 웹 서버
// 화면(public/)을 보여주고, 나라장터 쇼핑몰 검색·제품사진을 대신 가져온다(브라우저에서 직접 부르면 차단되기 때문).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SHOP = process.env.SHOP_BASE || 'https://shop.g2b.go.kr';
const PUB = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((ok, no) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => ok(d)); req.on('error', no); });
}
const dec = (s) => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

async function shopSearch({ keyword, page = 1, size = 100, sort = 'CTRT_UPRC_ASC', dtlsPrnmNo = '', etpsNm = '' }) {
  keyword = String(keyword || '').replace(/(\d)\s*[xX*]\s*(\d)/g, '$1×$2').trim();
  if (!keyword) throw new Error('검색어가 없습니다.');
  const body = { searchVO: {
    searchKeyword: keyword, sortCndt: sort, recordCountPerPage: String(size), currentPage: +page || 1,
    target: '계300001,계300002,계309999', prchsMthdSeCd: '본010001', srchSeCd: '검030006', rdoIndex: 5,
    dgtlSrvcMallYn: 'N', dscplnEvntYn: 'Y', dtlsPrnmNo, etpsNm,
  } };
  const r = await fetch(SHOP + '/gm/gms/gmsd/newShopUntySrchApi.do', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': UA, Origin: SHOP, Referer: SHOP + '/' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error('나라장터 응답 오류 ' + r.status);
  const j = await r.json();
  const list = (j.rsltList || []).map((x) => ({
    no: String(x.itemIdnfNo), nm: dec(x.itemIdnfNm), co: dec(x.mnftrEtpsNm || x.ctentUntyGrpNm),
    seller: dec(x.ctentUntyGrpNm || ''), loc: dec(x.hdofcLctnNm).split(/\s+/).slice(0, 2).join(' '),
    price: Number(x.ctrtUprc) || 0, unit: dec(x.ctrtUntVal),
    certs: String(x.groupItemCert || '').split(',').map((s) => dec(s.split('$')[1] || '')).filter(Boolean),
    img: x.imgSrc || x.sImgSrc || '', term: x.dlvgdsTermNody || '', ctrtEnd: x.ctrtEndYmd || '',
    type: dec(x.shopCtrtTyNm), cls: dec(x.dtlsPrnm || x.itemCfnm), clsNo: x.dtlsPrnmNo || '', ent: dec(x.entFormSeNm),
  }));
  const facets = (j.dlGroupDtlsPrnmL || []).map((f) => ({ code: f.code, label: dec(f.label) }));
  return { total: j.totalSize || 0, page: +page || 1, list, facets, keyword };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/search' && req.method === 'POST') {
      const q = JSON.parse((await readBody(req)) || '{}');
      return send(res, 200, await shopSearch(q));
    }
    if (u.pathname === '/api/img') {
      const src = u.searchParams.get('src') || '';
      if (!/^\/static\/[\w\-./%]+\.(jpe?g|png|gif|bmp|webp)$/i.test(src)) return send(res, 400, { error: 'bad src' });
      const r = await fetch(SHOP + src, { headers: { 'User-Agent': UA, Referer: SHOP + '/' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return send(res, r.status, { error: 'img ' + r.status });
      return send(res, 200, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || 'image/jpeg', { 'Cache-Control': 'public, max-age=86400' });
    }
    if (u.pathname === '/api/health') return send(res, 200, { ok: true });
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const f = path.join(PUB, p);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, '없는 페이지', 'text/plain; charset=utf-8');
    send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch (e) {
    console.error(e);
    send(res, 502, { error: e.message || String(e) });
  }
});
server.listen(PORT, () => console.log('관급자재 자동작성 서버 실행: ' + PORT));

// 시작 시 나라장터 연결 자가점검 (Render 로그에 결과 기록)
setTimeout(async () => {
  try {
    const r = await shopSearch({ keyword: '케이블트레이 150×60', size: 20 });
    console.log(`[자가점검] 나라장터 검색 OK — 전체 ${r.total}건, 첫 결과: ${r.list[0] ? r.list[0].co + ' ' + r.list[0].price : '없음'}`);
  } catch (e) { console.log('[자가점검] 나라장터 검색 실패: ' + (e.cause ? e.cause.code || e.cause.message : e.message)); }
}, 1500);
