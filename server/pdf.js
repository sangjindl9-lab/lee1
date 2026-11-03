'use strict';
/* 고객용 CCTV 설치 제안서 PDF (pdfkit, 한글 글꼴 내장) */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const PC = require('../shared/fov');
const FONT = path.join(__dirname, '..', 'fonts', 'NotoSansKR-Regular.otf');
const FONTB = path.join(__dirname, '..', 'fonts', 'NotoSansKR-Bold.otf');
const MM = 72 / 25.4;
const PAPER = { A4: [210, 297], A3: [297, 420] };

async function render(ctx) {
  const { proposal: P, products, company: CO, notices: NT, staff, planImage, fileRow } = ctx;
  const d = P.data || {}; const o = { ...(d.options || {}), ...(ctx.opts || {}) };
  const [pw, ph] = PAPER[o.paper] || PAPER.A4; const land = (o.orient || 'landscape') === 'landscape';
  const W = (land ? ph : pw) * MM, H = (land ? pw : ph) * MM;
  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true, margin: 0, info: { Title: `${P.customer_name || ''} CCTV 설치 제안서`, Author: CO.name || '' } });
  doc.registerFont('r', FONT); doc.registerFont('b', FONTB);
  const chunks = []; doc.on('data', c => chunks.push(c)); const end = new Promise(r => doc.on('end', r));
  const AC = CO.color || '#1f4e79'; const GR = '#6b7480'; const LINE = '#d9dee4';
  const cams = PC.numbered(d); const pages = [];
  const M = 14 * MM;
  const T = (s, x, y, size, opt) => { doc.font(opt && opt.bold ? 'b' : 'r').fontSize(size).fillColor((opt && opt.color) || '#1d232a'); doc.text(String(s == null ? '' : s), x, y, { lineBreak: !!(opt && opt.width), width: opt && opt.width, align: (opt && opt.align) || 'left', height: opt && opt.height, ellipsis: opt && opt.height ? true : undefined }); };
  const logo = CO.logo_file_id && fileRow(CO.logo_file_id);
  const page = (title) => {
    doc.addPage({ size: [W, H], margin: 0 }); pages.push(title);
    if (title) {
      doc.rect(0, 0, W, 3 * MM).fill(AC);
      T(title, M, 9 * MM, 15, { bold: true });
      T(`${P.customer_name || '고객'} 님 · ${P.title || ''}`, M, 16.5 * MM, 8.5, { color: GR });
      if (logo) { try { doc.image(logo.abs, W - M - 30 * MM, 7 * MM, { fit: [30 * MM, 11 * MM], align: 'right' }); } catch { } } else T(CO.name || '', W - M - 80 * MM, 10 * MM, 10, { bold: true, color: AC, width: 80 * MM, align: 'right' });
      doc.moveTo(M, 22 * MM).lineTo(W - M, 22 * MM).lineWidth(0.5).strokeColor(LINE).stroke();
    }
  };
  const footer = () => { const n = doc.bufferedPageRange().count; for (let i = 0; i < n; i++) { doc.switchToPage(i); if (i === 0) continue; doc.moveTo(M, H - 11 * MM).lineTo(W - M, H - 11 * MM).lineWidth(0.5).strokeColor(LINE).stroke(); T([CO.name, CO.tel && '☎ ' + CO.tel, CO.email].filter(Boolean).join('   '), M, H - 9 * MM, 7.5, { color: GR }); T(`${i + 1} / ${n}`, W - M - 30 * MM, H - 9 * MM, 7.5, { color: GR, width: 30 * MM, align: 'right' }); } };
  const date = d.date || new Date().toISOString().slice(0, 10);
  const Q = PC.quote(d, products);

  // ===== 표지 =====
  doc.addPage({ size: [W, H], margin: 0 }); pages.push('표지');
  doc.rect(0, 0, 9 * MM, H).fill(AC);
  const cx = 26 * MM;
  T('CCTV 설치 제안서', cx, H * 0.2, 34, { bold: true, color: AC });
  T(P.title || '', cx, H * 0.2 + 15 * MM, 13, { color: '#333', width: W * 0.5 });
  const box = (y, label, val) => { T(label, cx, y, 9, { color: GR }); T(val || '-', cx + 28 * MM, y - 1, 12, { bold: true, width: W * 0.42 - 28 * MM }); doc.moveTo(cx, y + 8 * MM).lineTo(cx + W * 0.42, y + 8 * MM).lineWidth(0.4).strokeColor(LINE).stroke(); };
  let y = H * 0.2 + 34 * MM;
  box(y, '고객명', (P.customer_name || '') + ' 귀하'); y += 12 * MM;
  box(y, '설치 장소', P.customer_address); y += 12 * MM;
  box(y, '제안일', date); y += 12 * MM;
  box(y, '담당자', [staff && staff.name, staff && staff.phone].filter(Boolean).join('  ') || CO.tel); y += 16 * MM;
  const chip = (x, v, l) => { doc.roundedRect(x, y, 34 * MM, 18 * MM, 3 * MM).fill('#f1f4f8'); T(v, x, y + 2.5 * MM, 15, { bold: true, color: AC, width: 34 * MM, align: 'center' }); T(l, x, y + 11 * MM, 8, { color: GR, width: 34 * MM, align: 'center' }); };
  chip(cx, `${cams.length}대`, '설치 카메라'); chip(cx + 38 * MM, `${(d.plans || []).length}곳`, '설치 도면');
  if (o.show_quote !== false && Q.total) chip(cx + 76 * MM, PC.won(Q.total) + '원', Q.vatIncluded ? '예상 금액(부가세 포함)' : '예상 금액');
  // 표지 오른쪽: 첫 도면 미리보기
  const p0 = (d.plans || [])[0];
  if (p0) { const bx = W * 0.56, by = H * 0.17, bw = W * 0.38, bh = H * 0.56; doc.roundedRect(bx, by, bw, bh, 3 * MM).fill('#f6f8fa'); await drawPlan(p0, bx + 4 * MM, by + 4 * MM, bw - 8 * MM, bh - 8 * MM, { mini: true }); }
  // 회사
  const fy = H - 32 * MM; doc.moveTo(cx, fy).lineTo(W - M, fy).lineWidth(0.6).strokeColor(LINE).stroke();
  if (logo) { try { doc.image(logo.abs, cx, fy + 5 * MM, { fit: [40 * MM, 14 * MM] }); } catch { } }
  T(CO.name || '', cx + (logo ? 46 * MM : 0), fy + 5 * MM, 13, { bold: true });
  T([CO.address, CO.tel && 'Tel ' + CO.tel, CO.email, CO.biz_no && '사업자등록번호 ' + CO.biz_no].filter(Boolean).join('  ·  '), cx + (logo ? 46 * MM : 0), fy + 12 * MM, 8, { color: GR, width: W - cx - M - 50 * MM });
  if (CO.slogan) T(CO.slogan, cx + (logo ? 46 * MM : 0), fy + 18 * MM, 8.5, { color: AC });

  // ===== 도면(설치 위치도) =====
  async function drawPlan(pl, x0, y0, aw, ah, opt) {
    opt = opt || {};
    const img = pl.file_id ? await planImage(pl.file_id, pl.page) : null;
    const k = Math.min(aw / pl.width, ah / pl.height); const ox = x0 + (aw - pl.width * k) / 2, oy = y0 + (ah - pl.height * k) / 2;
    const X = x => ox + x * k, Y = yy => oy + yy * k;
    if (img) { try { doc.image(img, ox, oy, { width: pl.width * k, height: pl.height * k }); } catch { } } else doc.rect(ox, oy, pl.width * k, pl.height * k).fill('#fff');
    doc.rect(ox, oy, pl.width * k, pl.height * k).lineWidth(0.4).strokeColor('#c9ced5').stroke();
    // 화각·표시는 도면 영역 밖으로 나가지 않도록 잘라냄
    doc.save(); doc.rect(ox, oy, pl.width * k, pl.height * k).clip();
    const upm = PC.num(pl.upm); const pc = cams.filter(c => c.plan === pl.id);
    const unscaled = pl.width * 0.12;
    // 배선 경로
    (d.marks || []).filter(m => m.plan === pl.id && m.type === 'route' && (m.points || []).length > 1).forEach(m => { doc.save(); doc.moveTo(X(m.points[0][0]), Y(m.points[0][1])); m.points.slice(1).forEach(q => doc.lineTo(X(q[0]), Y(q[1]))); doc.lineWidth(opt.mini ? 0.8 : 1.4).dash(4, { space: 3 }).strokeColor('#7a8594').stroke(); doc.undash(); doc.restore(); });
    // 화각
    pc.forEach(c => {
      const I = PC.camInfo(c, products); if (I.hfov == null) return;
      const r = upm && I.range ? I.range * upm : unscaled;
      doc.save(); doc.fillOpacity(0.22).strokeOpacity(0.85).lineWidth(opt.mini ? 0.5 : 0.9);
      if (I.hfov >= 360) doc.circle(X(c.x), Y(c.y), r * k).fillAndStroke(c.color, c.color);
      else { const s = PC.sector(c.x, c.y, +c.dir || 0, I.hfov, r); doc.moveTo(X(s[0][0]), Y(s[0][1])); s.slice(1).forEach(q => doc.lineTo(X(q[0]), Y(q[1]))); doc.closePath().fillAndStroke(c.color, c.color); }
      doc.restore();
      if (!opt.mini && upm && I.ir && I.ir > (I.range || 0) && c.show_night !== false && I.hfov < 360) { const a = PC.arc(c.x, c.y, +c.dir || 0, I.hfov, I.ir * upm); doc.save(); doc.moveTo(X(a[0][0]), Y(a[0][1])); a.slice(1).forEach(q => doc.lineTo(X(q[0]), Y(q[1]))); doc.lineWidth(0.7).dash(2, { space: 2 }).strokeColor(c.color).strokeOpacity(0.8).stroke(); doc.undash(); doc.restore(); }
    });
    // 녹화기·모니터·문자
    (d.marks || []).filter(m => m.plan === pl.id && m.type !== 'route').forEach(m => {
      const px = X(m.x), py = Y(m.y);
      if (m.type === 'text') { T(m.text || '', px, py - 4, opt.mini ? 5 : 8, { color: '#333' }); return; }
      const lab = m.type === 'nvr' ? '녹화기' : m.type === 'monitor' ? '모니터' : (m.text || '장비');
      doc.font('b').fontSize(opt.mini ? 5 : 7.5); const tw = doc.widthOfString(lab) + 6;
      doc.roundedRect(px - tw / 2, py - 6, tw, 12, 2).fillAndStroke('#263442', '#263442'); T(lab, px - tw / 2, py - 4.6, opt.mini ? 5 : 7.5, { bold: true, color: '#fff', width: tw, align: 'center' });
    });
    // 카메라 표시
    pc.forEach(c => {
      const px = X(c.x), py = Y(c.y), R = opt.mini ? 2.6 * MM : 3.6 * MM, a = (+c.dir || 0) * Math.PI / 180;
      const I = PC.camInfo(c, products);
      if (I.hfov == null || I.hfov < 360) { doc.save(); doc.moveTo(px + Math.sin(a) * R * 1.7, py - Math.cos(a) * R * 1.7).lineTo(px + Math.sin(a + 0.55) * R * 0.95, py - Math.cos(a + 0.55) * R * 0.95).lineTo(px + Math.sin(a - 0.55) * R * 0.95, py - Math.cos(a - 0.55) * R * 0.95).closePath().fill(c.color); doc.restore(); }
      doc.circle(px, py, R).lineWidth(1.2).fillAndStroke(c.color, '#ffffff');
      T(String(c.no), px - R, py - R * 0.62, opt.mini ? 7 : 10, { bold: true, color: '#fff', width: 2 * R, align: 'center' });
      if (!opt.mini && c.place) { doc.font('b').fontSize(7.5); const tw = doc.widthOfString(c.place) + 5; const lx = px + R + 2, ly = py - R - 8; doc.save(); doc.fillOpacity(0.88).roundedRect(lx, ly, tw, 10.5, 2).fill('#ffffff'); doc.restore(); T(c.place, lx + 2.5, ly + 1.2, 7.5, { bold: true, color: c.color }); }
    });
    doc.restore();
    return { k, unscaled: !upm };
  }
  for (const pl of (d.plans || [])) {
    page(`설치 위치도 · ${pl.name || ''}`);
    const listW = 74 * MM; const top = 26 * MM, bottom = H - 22 * MM;
    const pc = cams.filter(c => c.plan === pl.id);
    const info = await drawPlan(pl, M, top, W - 2 * M - listW - 6 * MM, bottom - top);
    // 오른쪽 목록
    const lx = W - M - listW; let ly = top;
    T(`이 도면의 카메라 ${pc.length}대`, lx, ly, 10, { bold: true }); ly += 7 * MM;
    const rowH = Math.min(17 * MM, Math.max(11 * MM, (bottom - ly - 14 * MM) / Math.max(pc.length, 1)));
    pc.forEach(c => {
      const I = PC.camInfo(c, products);
      doc.circle(lx + 3.6 * MM, ly + 3.6 * MM, 3.4 * MM).fill(c.color); T(String(c.no), lx, ly + 1.2 * MM, 10, { bold: true, color: '#fff', width: 7.2 * MM, align: 'center' });
      T(c.place || `카메라 ${c.no}`, lx + 9.5 * MM, ly, 9.5, { bold: true, width: listW - 10 * MM, height: 12 });
      T(I.name, lx + 9.5 * MM, ly + 4.6 * MM, 7.5, { color: '#333', width: listW - 10 * MM, height: 10 });
      T([I.hfov != null ? `화각 ${I.hfov}°` : '', I.range != null ? `감시 약 ${I.range}m` : '', I.ir ? `야간 ${I.ir}m` : '', c.height ? `높이 ${c.height}m` : ''].filter(Boolean).join(' · '), lx + 9.5 * MM, ly + 8.6 * MM, 7.2, { color: GR, width: listW - 10 * MM, height: 10 });
      ly += rowH;
    });
    // 범례·안내
    let ny = bottom - 13 * MM; doc.save(); doc.fillOpacity(0.22).rect(lx, ny, 6 * MM, 3.2 * MM).fill('#e53935'); doc.restore(); T('카메라가 보는 범위(낮)', lx + 8 * MM, ny - 0.3 * MM, 7.2, { color: GR });
    doc.moveTo(lx, ny + 6 * MM).lineTo(lx + 6 * MM, ny + 6 * MM).lineWidth(0.8).dash(2, { space: 2 }).strokeColor('#e53935').stroke(); doc.undash(); T('야간 적외선 촬영 거리', lx + 8 * MM, ny + 4.3 * MM, 7.2, { color: GR });
    doc.moveTo(lx, ny + 10.5 * MM).lineTo(lx + 6 * MM, ny + 10.5 * MM).lineWidth(1.2).dash(4, { space: 3 }).strokeColor('#7a8594').stroke(); doc.undash(); T('배선 경로', lx + 8 * MM, ny + 8.8 * MM, 7.2, { color: GR });
    T(info.unscaled ? '※ 도면 축척이 없어 화각 방향만 표시했습니다(거리 비례 아님). ' + (NT.fov || '') : '※ ' + (NT.fov || ''), M, bottom + 2 * MM, 7, { color: GR, width: W - 2 * M - listW - 6 * MM });
  }

  // ===== 카메라 상세 =====
  if (o.show_detail !== false && cams.length) {
    const cols = land ? 3 : 2, rows = 2; const per = cols * rows;
    const gw = (W - 2 * M - (cols - 1) * 5 * MM) / cols, gh = (H - 26 * MM - 16 * MM - 5 * MM) / rows;
    for (let i = 0; i < cams.length; i++) {
      if (i % per === 0) page('카메라별 설치 안내');
      const c = cams[i]; const I = PC.camInfo(c, products); const j = i % per;
      const x = M + (j % cols) * (gw + 5 * MM), y = 26 * MM + Math.floor(j / cols) * (gh + 5 * MM);
      doc.roundedRect(x, y, gw, gh, 2.5 * MM).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.circle(x + 7 * MM, y + 7 * MM, 4 * MM).fill(c.color); T(String(c.no), x + 3 * MM, y + 4.6 * MM, 11, { bold: true, color: '#fff', width: 8 * MM, align: 'center' });
      T(c.place || `카메라 ${c.no}`, x + 13 * MM, y + 3.6 * MM, 11, { bold: true, width: gw - 16 * MM, height: 14 });
      T(`${(d.plans.find(p => p.id === c.plan) || {}).name || ''}`, x + 13 * MM, y + 9 * MM, 7.5, { color: GR });
      // 사진 또는 화각 그림
      const iw = gw * 0.42, ih = gh - 22 * MM, ix = x + 4 * MM, iy = y + 16 * MM;
      const photo = (c.photo_file_id && fileRow(c.photo_file_id)) || (I.product.data && I.product.data.photo_file_id && fileRow(I.product.data.photo_file_id));
      if (photo && photo.mime.startsWith('image/')) { doc.roundedRect(ix, iy, iw, ih, 2 * MM).fill('#f3f5f7'); try { doc.image(photo.abs, ix, iy, { fit: [iw, ih], align: 'center', valign: 'center' }); } catch { } T(c.photo_file_id ? '설치 위치 사진' : '제품 사진', ix, iy + ih + 1, 6.5, { color: GR, width: iw, align: 'center' }); }
      else { doc.roundedRect(ix, iy, iw, ih, 2 * MM).fill('#f3f5f7'); const fx = ix + iw / 2, fy = iy + ih * 0.78, r = Math.min(iw, ih) * 0.62; if (I.hfov != null) { doc.save(); doc.fillOpacity(0.3); if (I.hfov >= 360) doc.circle(fx, iy + ih / 2, r * 0.6).fill(c.color); else { const s = PC.sector(fx, fy, 0, I.hfov, r); doc.moveTo(s[0][0], s[0][1]); s.slice(1).forEach(q => doc.lineTo(q[0], q[1])); doc.closePath().fill(c.color); } doc.restore(); T(`화각 ${I.hfov}°`, ix, iy + ih - 5 * MM, 8, { bold: true, color: c.color, width: iw, align: 'center' }); } }
      const tx = ix + iw + 4 * MM, tw = gw - iw - 12 * MM; let ty = iy;
      const row = (k, v) => { if (v == null || v === '') return; T(k, tx, ty, 7, { color: GR }); T(v, tx, ty + 3.3 * MM, 8.5, { bold: true, width: tw, height: 12 }); ty += 8.5 * MM; };
      row('카메라', I.name); row('해상도', I.resolution); row('렌즈 / 화각', [I.lens, I.hfov != null ? I.hfov + '°' : ''].filter(Boolean).join(' / '));
      row('감시 거리', [I.range != null ? `낮 약 ${I.range}m` : '', I.ir ? `야간 약 ${I.ir}m` : ''].filter(Boolean).join(' · ')); row('설치 높이', c.height ? c.height + 'm' : '');
      if (ty < iy + ih - 6 * MM) { T(c.note || I.features || '', tx, ty, 7.5, { color: '#333', width: tw, height: iy + ih - ty }); }
    }
  }

  // ===== 견적 =====
  if (o.show_quote !== false && Q.lines.length) {
    page('견적 내역');
    const cw = [W * 0.06, W * 0.27, W * 0.22, W * 0.06, W * 0.07, W * 0.12, W * 0.13].map(v => v * (W - 2 * M) / W);
    const head = ['No', '품목', '규격', '단위', '수량', '단가(원)', '금액(원)'];
    let ty = 28 * MM; let x = M;
    doc.rect(M, ty, W - 2 * M, 8 * MM).fill(AC); head.forEach((h, i) => { T(h, x, ty + 2.2 * MM, 8.5, { bold: true, color: '#fff', width: cw[i], align: 'center' }); x += cw[i]; }); ty += 8 * MM;
    Q.lines.forEach((l, n) => { x = M; if (n % 2) doc.rect(M, ty, W - 2 * M, 7.5 * MM).fill('#f6f8fa'); [n + 1, l.name, l.spec, l.unit, l.qty, PC.won(l.price), PC.won(l.amount)].forEach((v, i) => { T(v, x + 2, ty + 2 * MM, 8, { width: cw[i] - 4, align: i >= 4 ? 'right' : i === 0 || i === 3 ? 'center' : 'left', height: 10 }); x += cw[i]; }); ty += 7.5 * MM; });
    doc.moveTo(M, ty).lineTo(W - M, ty).lineWidth(0.6).strokeColor(LINE).stroke(); ty += 3 * MM;
    const sx = W - M - 85 * MM; const sum = (k, v, big) => { T(k, sx, ty, big ? 11 : 9, { bold: big, color: big ? AC : '#333' }); T(v + ' 원', sx + 30 * MM, ty, big ? 12 : 9, { bold: true, color: big ? AC : '#1d232a', width: 55 * MM, align: 'right' }); ty += big ? 8 * MM : 6 * MM; };
    if (Q.discount) sum('할인', '-' + PC.won(Q.discount));
    sum('공급가액', PC.won(Q.supply)); if (Q.vatIncluded) sum('부가세(10%)', PC.won(Q.vat)); sum('합계 금액', PC.won(Q.total), true);
    ty += 4 * MM; T('※ ' + (NT.quote || ''), M, ty, 8, { color: GR, width: W - 2 * M });
  }
  // ===== 안내 사항 =====
  if (o.show_notice !== false) {
    const items = [['화각 표시 안내', NT.fov], ['견적 안내', o.show_quote !== false ? NT.quote : ''], ['A/S 안내', NT.service], ['개인정보 보호', NT.privacy], ['상담 메모', d.memo]].filter(x => x[1]);
    if (items.length) {
      page('안내 사항'); let ty = 30 * MM;
      items.forEach(([k, v]) => { T(k, M, ty, 11, { bold: true, color: AC }); ty += 6 * MM; doc.font('r').fontSize(9.5); const hh = doc.heightOfString(v, { width: W - 2 * M }); T(v, M, ty, 9.5, { width: W - 2 * M }); ty += hh + 7 * MM; });
      ty += 6 * MM; T(`문의: ${CO.name || ''}  ${staff && staff.name ? '담당 ' + staff.name : ''}  ${(staff && staff.phone) || CO.tel || ''}`, M, ty, 10, { bold: true });
    }
  }
  footer();
  doc.end(); await end;
  return Buffer.concat(chunks);
}
module.exports = { render };
