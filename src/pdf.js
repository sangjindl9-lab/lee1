// 완료 PDF: 본문(입력값 반영) + 서명란 + 첨부(사진대장 2×2, 도면, PDF 원본) + 처리 이력 확인서
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLib } = require('pdf-lib');
const { all, get, run, J } = require('./db');
const C = require('./core');
const E = require('./engine');
const F = require('./files');

const FONT = path.join(__dirname, '..', 'fonts', 'NotoSansKR-Regular.otf');
const FONT_B = path.join(__dirname, '..', 'fonts', 'NotoSansKR-Bold.otf');
const KIND = { photo: '사진', drawing: '도면', other: '첨부' };

function fillBody(body, vals) {
  return String(body).replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => {
    const v = vals[k];
    if (v == null || v === '') return '__________';
    if (typeof v === 'boolean') return v ? '예(확인함)' : '아니오';
    return typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v);
  });
}
function allValues(d) {
  const vals = { ...J(d.vals, {}) };
  for (const p of all(`select vals from participants where document_id=?`, d.id)) Object.assign(vals, J(p.vals, {}));
  return vals;
}
function imgBuf(dataUrl) { return Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'); }
const kst = (s) => (s ? new Date(new Date(s.replace(' ', 'T') + (s.includes('T') ? '' : 'Z')).getTime() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19) + ' (KST)' : '-');

function render(d, { draft = false } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 56, left: 56, right: 56 }, info: { Title: d.title, Producer: '이음사인' } });
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.registerFont('R', FONT); doc.registerFont('B', FONT_B);
    const brand = E.brandOf(d.company_id);
    const W = doc.page.width - 112;
    const color = /^#[0-9a-f]{6}$/i.test(brand.color || '') ? brand.color : '#1f4e79';
    const footer = () => {
      // 아래 여백 안에 쓰므로 자동 페이지 넘김이 생기지 않게 여백을 잠시 0으로 둔다
      const { x, y } = doc, mb = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('R').fontSize(7.5).fillColor('#888')
        .text(`${brand.name} · 이음사인 문서번호 ${d.id} · v${d.version} · 내용해시 ${String(d.content_hash).slice(0, 16)}…`, 56, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
      doc.fillColor('#000'); doc.page.margins.bottom = mb; doc.x = x; doc.y = y;
    };
    doc.on('pageAdded', footer);
    footer();
    if (draft) doc.font('B').fontSize(40).fillColor('#e5e5e5').text('미리보기', 0, 360, { align: 'center' }).fillColor('#000');
    doc.font('B').fontSize(9).fillColor(color).text(brand.name, 56, 56).fillColor('#000');
    doc.moveDown(0.4).font('B').fontSize(18).text(d.title, { align: 'center' });
    doc.moveDown(0.6);
    const meta = [['현장', d.site], ['거래처', d.partner], ['계약금액', d.amount != null ? d.amount.toLocaleString('ko-KR') + '원' : null], ['계약기간', d.start_date || d.end_date ? `${d.start_date || ''} ~ ${d.end_date || ''}` : null]].filter((x) => x[1]);
    if (meta.length) { doc.font('R').fontSize(9).fillColor('#444').text(meta.map((m) => `${m[0]}: ${m[1]}`).join('   ·   '), { align: 'center' }).fillColor('#000'); doc.moveDown(0.8); }

    // 본문
    const tv = E.loadTV(d.template_version_id);
    const text = fillBody(tv.body, allValues(d));
    for (const line of text.split('\n')) {
      if (/^##\s/.test(line)) { doc.moveDown(0.4).font('B').fontSize(11.5).text(line.replace(/^##\s*/, '')); doc.moveDown(0.15); continue; }
      if (!line.trim()) { doc.moveDown(0.5); continue; }
      doc.font('R').fontSize(10.5).text(line, { width: W, lineGap: 3 });
    }
    // 서명란
    const ps = all(`select * from participants where document_id=? order by order_no,id`, d.id);
    doc.moveDown(1.2);
    if (doc.y > doc.page.height - 56 - 40 - Math.ceil(ps.length / 2) * 95) doc.addPage();
    doc.font('B').fontSize(11).text('서명');
    doc.moveDown(0.3);
    const colW = W / 2 - 6;
    let y = doc.y;
    ps.forEach((p, i) => {
      const x = 56 + (i % 2) * (colW + 12);
      if (i % 2 === 0 && i) y += 92;
      if (y + 88 > doc.page.height - 56) { doc.addPage(); y = 56; }
      doc.roundedRect(x, y, colW, 84, 4).strokeColor('#bbb').stroke().strokeColor('#000');
      doc.font('B').fontSize(9).text(`${p.role_label}`, x + 8, y + 7, { width: colW - 110 });
      doc.font('R').fontSize(9).text(p.name, x + 8, y + 21, { width: colW - 110 });
      doc.fontSize(7).fillColor('#555').text(
        p.signed_at ? `${kst(p.signed_at)}\n${p.sign_kind === 'preseal' ? '사전날인 정책에 따른 직인' : p.sign_kind === 'seal' ? '직인 날인' : '전자서명'} · ${p.confirm_method || (p.verified_at ? p.auth_method : '서명 링크')}` : '미서명',
        x + 8, y + 36, { width: colW - 110 }).fillColor('#000');
      if (p.sign_image) try { doc.image(imgBuf(p.sign_image), x + colW - 100, y + 6, { fit: [92, 72], align: 'center', valign: 'center' }); } catch { /* 이미지 오류는 건너뜀 */ }
    });
    doc.y = y + 96; doc.x = 56;

    // 첨부: 사진은 한 장에 가로 2장 × 세로 2장
    const atts = all(`select a.*, f.mime, f.name fname from doc_attachments a join files f on f.id=a.file_id where a.document_id=? order by a.sort,a.id`, d.id);
    const photos = atts.filter((a) => a.mime.startsWith('image/') && a.kind === 'photo');
    for (let i = 0; i < photos.length; i += 4) {
      doc.addPage(); doc.font('B').fontSize(13).text(`사진대장 (${Math.floor(i / 4) + 1}/${Math.ceil(photos.length / 4)})`, { align: 'center' });
      const top = 90, cw = W / 2 - 8, ch = (doc.page.height - top - 80) / 2 - 24;
      photos.slice(i, i + 4).forEach((a, k) => {
        const x = 56 + (k % 2) * (cw + 16), yy = top + Math.floor(k / 2) * (ch + 34);
        doc.rect(x, yy, cw, ch).strokeColor('#999').stroke().strokeColor('#000');
        try { doc.image(F.readFile(a.file_id).buf, x + 3, yy + 3, { fit: [cw - 6, ch - 6], align: 'center', valign: 'center' }); } catch { doc.font('R').fontSize(9).text('이미지를 열 수 없음', x + 10, yy + 10); }
        doc.font('R').fontSize(9).text(`${i + k + 1}. ${a.caption || a.fname}`, x, yy + ch + 5, { width: cw, align: 'center' });
      });
    }
    for (const a of atts.filter((x) => x.mime.startsWith('image/') && x.kind !== 'photo')) {
      doc.addPage(); doc.font('B').fontSize(12).text(`${KIND[a.kind] || '첨부'}: ${a.caption || a.fname}`);
      try { doc.image(F.readFile(a.file_id).buf, 56, 90, { fit: [W, doc.page.height - 160], align: 'center' }); } catch { /* skip */ }
    }
    const pdfAtts = atts.filter((a) => a.mime === 'application/pdf');
    // 처리 이력 확인서
    doc.addPage();
    doc.font('B').fontSize(14).text(draft ? '처리 이력 (미리보기)' : '전자문서 처리 이력 확인서', { align: 'center' }).moveDown(0.6);
    doc.font('R').fontSize(8.5);
    const info = [['문서번호', d.id], ['문서 제목', d.title], ['요청 회사', brand.name], ['계약 방식', { remote: '비대면계약', inperson: '대면계약', link: '링크계약', bulk: '대량계약' }[d.mode]],
      ['템플릿', `${tv.template_name} v${tv.version}`], ['문서 버전', d.version], ['내용 해시(SHA-256)', d.content_hash], ['완료 시각', kst(d.completed_at)],
      ['첨부', [d.base_file_id ? '원본 파일 1건' : null, atts.length ? `첨부 ${atts.length}건 (PDF ${pdfAtts.length}건은 이 확인서 뒤에 이어 붙임)` : null].filter(Boolean).join(', ') || '없음']];
    for (const [k, v] of info) doc.text(`${k}: ${v ?? '-'}`, { width: W });
    doc.moveDown(0.6).font('B').fontSize(10).text('참여자').font('R').fontSize(8.5);
    for (const p of ps) doc.text(`· ${p.role_label} ${p.name}${p.email ? ` <${p.email}>` : ''}${p.phone ? ` ${C.maskPhone(p.phone)}` : ''} — ${p.signed_at ? kst(p.signed_at) : '미서명'} / 확인 방식: ${p.confirm_method || (p.verified_at ? p.auth_method : p.kind === 'external' ? '서명 링크' : '로그인 직원')}${p.ip ? ` / IP ${p.ip}` : ''}`, { width: W });
    doc.moveDown(0.6).font('B').fontSize(10).text('처리 이력 (시각은 한국시간, 내용 해시는 감사 기록 해시 체인으로 보관)').font('R').fontSize(8);
    for (const l of all(`select * from audit_logs where document_id=? order by id`, d.id)) {
      if (doc.y > doc.page.height - 80) doc.addPage();
      const sm = C.auditSummary(l);
      doc.text(`${kst(l.at)}  ${C.ACTION_LABEL[l.action] || l.action}  ${l.actor_name || (l.actor_type === 'system' ? '시스템' : l.actor_type)}${sm ? '  (' + sm.slice(0, 140) + ')' : ''}`, { width: W });
    }
    doc.end();
  });
}

async function merge(main, d) {
  const extra = [];
  if (d.base_file_id) { const f = F.readFile(d.base_file_id); if (f.mime === 'application/pdf') extra.push(f.buf); }
  for (const a of all(`select a.file_id from doc_attachments a join files f on f.id=a.file_id where a.document_id=? and f.mime='application/pdf' order by a.sort,a.id`, d.id)) extra.push(F.readFile(a.file_id).buf);
  if (!extra.length) return main;
  const out = await PdfLib.load(main);
  for (const b of extra) {
    try { const src = await PdfLib.load(b, { ignoreEncryption: true }); (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); } catch { /* 열 수 없는 PDF 는 확인서에만 기록 */ }
  }
  return Buffer.from(await out.save());
}

async function buildPdf(docId, opts) { const d = E.getDoc(docId); return merge(await render(d, opts), d); }

async function finalize(docId) {
  const d = E.getDoc(docId);
  if (d.status !== 'completed' || d.pdf_file_id) return d.pdf_file_id;
  const buf = await buildPdf(docId);
  const fid = F.storeFile(d.company_id, buf, `${d.title}_완료.pdf`, { origin: 'generated', mime: 'application/pdf' });
  const upd = run(`update documents set pdf_file_id=? where id=? and pdf_file_id is null`, fid, d.id);
  if (!upd.changes) return get(`select pdf_file_id from documents where id=?`, d.id).pdf_file_id;
  C.audit({ companyId: d.company_id, documentId: d.id, action: 'PDF_CREATE', detail: { file: fid, sha256: get(`select sha256 from files where id=?`, fid).sha256 } });
  // 최종 문서 전달 (참여자별 전달 방법)
  const brand = E.brandOf(d.company_id);
  for (const p of all(`select * from participants where document_id=? and kind='external'`, d.id)) {
    const ch = p.delivery === 'sms' ? 'sms' : p.delivery === 'email' ? 'email' : null;
    if (!ch) continue;
    const to = ch === 'email' ? p.email : p.phone;
    const raw = E.issueToken(p.id, 30); // 완료본 열람 전용
    C.notify({ companyId: d.company_id, channel: ch, to, subject: `[완료] ${d.title}`, body: `${brand.done_msg || '계약이 완료되었습니다.'}\n완료 문서 보기: ${E.BASE_URL()}/s/${raw}`, dedupe: `final:${ch}:${p.id}`, documentId: d.id });
  }
  return fid;
}
module.exports = { finalize, buildPdf, fillBody, allValues };
