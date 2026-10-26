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
// 나라장터 연결이 가끔 끊기므로 한 번 더 시도
async function fetchRetry(url, opt, tries = 2) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, { ...opt, signal: AbortSignal.timeout(25000) }); } catch (e) { err = e; await new Promise((r) => setTimeout(r, 800)); }
  }
  throw new Error('나라장터 연결 실패(잠시 후 다시 시도해 주세요): ' + (err && err.cause ? err.cause.code || err.cause.message : err && err.message));
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
  const r = await fetchRetry(SHOP + '/gm/gms/gmsd/newShopUntySrchApi.do', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': UA, Origin: SHOP, Referer: SHOP + '/' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('나라장터 응답 오류 ' + r.status);
  const j = await r.json();
  const list = (j.rsltList || []).map(norm);
  const facets = (j.dlGroupDtlsPrnmL || []).map((f) => ({ code: f.code, label: dec(f.label) }));
  return { total: j.totalSize || 0, page: +page || 1, list, facets, keyword };
}

function norm(x) {
  return {
    no: String(x.itemIdnfNo), nm: dec(x.itemIdnfNm), co: dec(x.mnftrEtpsNm || x.ctentUntyGrpNm),
    seller: dec(x.ctentUntyGrpNm || ''), loc: dec(x.hdofcLctnNm).split(/\s+/).slice(0, 2).join(' '),
    price: Number(x.ctrtUprc) || 0, unit: dec(x.ctrtUntVal),
    certs: String(x.groupItemCert || '').split(',').map((s) => dec(s.split('$')[1] || '')).filter(Boolean),
    img: x.imgSrc || x.sImgSrc || '', term: x.dlvgdsTermNody || '', ctrtEnd: x.ctrtEndYmd || '',
    type: dec(x.shopCtrtTyNm), cls: dec(x.dtlsPrnm || x.itemCfnm), clsNo: x.dtlsPrnmNo || '', ent: dec(x.entFormSeNm),
    mng: x.ctrtItemMngNo || '',
  };
}

async function shopPost(path, body) {
  const r = await fetchRetry(SHOP + path, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': UA, Origin: SHOP, Referer: SHOP + '/' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('나라장터 응답 오류 ' + r.status);
  return r.json();
}

// 나라장터 상품 주소(공유 → URL복사) 또는 번호 → 상품 정보
async function resolveOne(token) {
  const t = String(token).trim();
  let mng = (/ctrtItemMngNo=([0-9A-Za-z_\-]+)/.exec(t) || [])[1];
  if (!mng && /^[0-9A-Z]{6,}_?\d{6,}$/.test(t) && !/^\d{8}$/.test(t)) mng = t;
  const idnf = !mng ? (/(?:^|\D)(\d{8})(?:\D|$)/.exec(t) || [])[1] : '';
  if (!mng && !idnf) {
    if (/shop\.g2b\.go\.kr\/?$/.test(t) || /shop\.g2b\.go\.kr\/?#?$/.test(t))
      return { input: t, error: '주소창 주소(https://shop.g2b.go.kr/)에는 상품 정보가 없습니다. 상품 화면의 [공유] → [URL복사]로 복사한 주소를 넣어 주세요.' };
    return { input: t, error: '상품 주소나 번호를 찾지 못했습니다.' };
  }
  if (mng) {
    const b = await shopPost('/gm/gms/gmsf/GdsDtlInfo/selectPdctBaseInfo.do', { dlGdsDtlInfoSrchM: { srchCtrtItemMngNo: mng, srchCtrtNo: '', srchCtrtChgOrd: '', srchCtrtItemSqno: '', srchItemIdnfNo: '' } });
    const m = b.dlPdctBaseInfoM;
    if (!m) return { input: t, error: '나라장터에서 해당 상품을 찾지 못했습니다(판매 종료 가능).' };
    const name = dec(m.itemSpecVal || m.ntslItemNm || '');
    // 본사소재지·인증은 검색 결과에 있으므로 모델명으로 다시 찾아 합침
    const parts = name.split(',').map((x) => x.trim());
    const kws = [parts[2] && `${parts[1] || ''} ${parts[2]}`.trim(), parts[2], name].filter(Boolean);
    for (const kw of kws) {
      try {
        const s = await shopSearch({ keyword: kw, size: 100 });
        const hit = s.list.find((x) => x.mng === mng) || s.list.find((x) => x.no === String(m.itemIdnfNo) && x.price === Number(m.ctrtUprc));
        if (hit) return { input: t, item: hit };
      } catch (e) { /* 다음 검색어 */ }
    }
    const end = String(m.ctrtBgngYmd || '').split('~')[1] || '';
    return { input: t, item: {
      no: String(m.itemIdnfNo), nm: name, co: dec(m.makngComnm || m.ctentUntyGrpNm || ''), seller: dec(m.ctentUntyGrpNm || ''), loc: '',
      price: Number(m.ctrtUprc) || 0, unit: dec(m.ctrtUntVal || ''), certs: [], img: m.imgUrl || m.sImgUrl || '',
      term: String(m.dlvgdsTermNody || ''), ctrtEnd: end.replace(/\D/g, ''), type: m.masCtrtYn === 'Y' ? '다수공급자계약' : '',
      cls: dec(m.dtlsPrnm || m.itemCfnm || ''), clsNo: m.dtlsPrnmNo || '', ent: dec(m.entFormSeNm || ''), mng,
    }, partial: '본사소재지·인증을 찾지 못했습니다. 확인 후 직접 고쳐 주세요.' };
  }
  // 물품식별번호(8자리)만 넣은 경우: 검색으로 찾기
  for (let page = 1; page <= 3; page++) {
    const s = await shopSearch({ keyword: idnf, size: 100, page });
    const hit = s.list.find((x) => x.no === idnf);
    if (hit) return { input: t, item: hit };
    if (s.list.length < 100) break;
  }
  return { input: t, error: `물품식별번호 ${idnf}로는 찾지 못했습니다. 상품 화면의 [공유] → [URL복사] 주소를 넣어 주세요.` };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/search' && req.method === 'POST') {
      const q = JSON.parse((await readBody(req)) || '{}');
      return send(res, 200, await shopSearch(q));
    }
    if (u.pathname === '/api/resolve' && req.method === 'POST') {
      const q = JSON.parse((await readBody(req)) || '{}');
      const tokens = String(q.text || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
      const out = [];
      for (const tk of tokens) { try { out.push(await resolveOne(tk)); } catch (e) { out.push({ input: tk, error: e.message }); } }
      return send(res, 200, { results: out });
    }
    if (u.pathname === '/api/img') {
      const src = u.searchParams.get('src') || '';
      if (!/^\/static\/[\w\-./%]+\.(jpe?g|png|gif|bmp|webp)$/i.test(src)) return send(res, 400, { error: 'bad src' });
      const r = await fetchRetry(SHOP + src, { headers: { 'User-Agent': UA, Referer: SHOP + '/' } });
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
    const rv = await resolveOne('https://shop.g2b.go.kr/link/GMSF001_01/?ctrtItemMngNo=0024C0405_1450000525');
    console.log('[자가점검] 주소 등록 ' + (rv.item ? `OK — ${rv.item.co} ${rv.item.no} ${rv.item.price} / ${rv.item.loc} / 인증 ${rv.item.certs.length}개` : '실패: ' + rv.error));
    console.log(`[자가점검] 나라장터 검색 OK — 전체 ${r.total}건, 첫 결과: ${r.list[0] ? r.list[0].co + ' ' + r.list[0].price : '없음'}`);
  } catch (e) { console.log('[자가점검] 나라장터 검색 실패: ' + (e.cause ? e.cause.code || e.cause.message : e.message)); }
}, 1500);
