/* 외형도 캡처 카드: 제품사진 + 쇼핑몰 상세정보를 한 장 이미지로 그림 (원본 양식의 캡처와 같은 비율 4.4:1) */
(function (root) {
  'use strict';
  const W = 1320, H = 300;
  const FONT = '"Malgun Gothic","맑은 고딕","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

  function wrap(ctx, text, maxW, maxLines) {
    const out = []; let line = '';
    for (const ch of String(text)) {
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; if (out.length === maxLines) break; }
      else line += ch;
    }
    if (out.length < maxLines && line) out.push(line);
    else if (out.length === maxLines && line) { let l = out[maxLines - 1]; while (ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); out[maxLines - 1] = l + '…'; }
    return out;
  }
  function pill(ctx, x, y, text, fg, bg) {
    ctx.font = `bold 17px ${FONT}`;
    const w = ctx.measureText(text).width + 20;
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, 28, 14) : ctx.rect(x, y, w, 28); ctx.fill();
    ctx.fillStyle = fg; ctx.fillText(text, x + 10, y + 20);
    return x + w + 8;
  }

  /**
   * info = { name, no, co, loc, price, unit, certs:[], term, ctrtEnd, contractType, checkedAt }
   * img  = ImageBitmap | HTMLImageElement | null
   * 반환: canvas
   */
  function drawCard(info, img) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#b8c4d6'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);

    // 사진
    const PX = 12, PY = 12, PS = H - 24;
    ctx.strokeStyle = '#d9dee6'; ctx.lineWidth = 1; ctx.strokeRect(PX + .5, PY + .5, PS, PS);
    if (img && img.width) {
      const s = Math.min((PS - 8) / img.width, (PS - 8) / img.height);
      const w = img.width * s, h = img.height * s;
      ctx.drawImage(img, PX + (PS - w) / 2, PY + (PS - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#9aa4b2'; ctx.font = `20px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText('이미지 없음', PX + PS / 2, PY + PS / 2); ctx.textAlign = 'left';
    }

    // 상단 꼬리표
    const X = PX + PS + 22, RW = W - X - 16;
    let px = pill(ctx, X, 14, '나라장터 쇼핑몰', '#1f4fa3', '#e6eefb');
    if (info.contractType) px = pill(ctx, px, 14, info.contractType, '#4a5568', '#eef1f5');

    // 품명
    ctx.fillStyle = '#111'; ctx.font = `bold 26px ${FONT}`;
    const lines = wrap(ctx, info.name || '', RW, 2);
    lines.forEach((l, i) => ctx.fillText(l, X, 76 + i * 32));

    // 정보표
    const top = 76 + lines.length * 32 + 4;
    const rows = [
      [['물품식별번호', info.no], ['계약단가', (info.price != null ? Number(info.price).toLocaleString('ko-KR') + '원' : '') + (info.unit ? ' / ' + info.unit : '')]],
      [['업체명', info.co], ['본사소재지', info.loc]],
      [['인증', (info.certs || []).join(' · ') || '-']],
      [['납품기한', info.term ? info.term + '일' : '-'], ['계약기간', info.ctrtEnd ? '~' + fmtDate(info.ctrtEnd) : '-']],
    ];
    const rh = Math.min(34, (H - 14 - top) / rows.length);
    const LW = 128, half = RW / 2;
    rows.forEach((row, i) => {
      const y = top + i * rh;
      ctx.strokeStyle = '#e3e7ee'; ctx.beginPath(); ctx.moveTo(X, y + .5); ctx.lineTo(X + RW, y + .5); ctx.stroke();
      row.forEach(([k, v], j) => {
        const x = X + j * half, vw = (row.length === 1 ? RW : half) - LW - 10;
        ctx.fillStyle = '#f4f6f9'; ctx.fillRect(x, y + 1, LW, rh - 1);
        ctx.fillStyle = '#5a6577'; ctx.font = `18px ${FONT}`; ctx.fillText(k, x + 10, y + rh / 2 + 6);
        ctx.fillStyle = k === '계약단가' ? '#c0392b' : '#1a202c'; ctx.font = `${k === '계약단가' ? 'bold ' : ''}20px ${FONT}`;
        ctx.fillText(wrap(ctx, v || '', vw, 1)[0] || '', x + LW + 10, y + rh / 2 + 7);
      });
    });
    ctx.strokeStyle = '#e3e7ee'; ctx.beginPath(); ctx.moveTo(X, top + rows.length * rh + .5); ctx.lineTo(X + RW, top + rows.length * rh + .5); ctx.stroke();

    // 조회일시
    if (info.checkedAt) {
      ctx.fillStyle = '#8a94a6'; ctx.font = `15px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillText('조회 ' + info.checkedAt, W - 16, 32); ctx.textAlign = 'left';
    }
    return c;
  }
  function fmtDate(s) { s = String(s); return s.length >= 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : s; }

  async function cardBytes(info, img) {
    const c = drawCard(info, img);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'jpeg', w: W, h: H };
  }

  root.GK_CARD = { drawCard, cardBytes, W, H };
})(typeof self !== 'undefined' ? self : this);
