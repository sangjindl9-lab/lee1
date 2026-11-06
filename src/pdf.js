import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

// .pdf-root 안의 서류(.pr-page)를 A4 쪽으로 잘라 PDF로 만든다. 표 행 중간에서 자르지 않는다.
export async function buildPdf(root, company) {
  if (document.fonts?.ready) await document.fonts.ready;
  const scale = 2;
  const pages = [];
  for (const sec of root.querySelectorAll('.pr-page')) {
    const land = sec.classList.contains('pr-land');
    const W = land ? 1123 : 794, H = land ? 794 : 1123;
    const top = land ? 36 : 45, bottom = land ? 52 : 60;
    const usable = H - top - bottom;
    const base = sec.getBoundingClientRect().top;
    const cuts = [...sec.querySelectorAll('tr, .pr-head, .pr-amount, .pr-est-top, .pr-note, .pr-hangul')]
      .map((el) => el.getBoundingClientRect().bottom - base).sort((a, b) => a - b);
    const total = sec.getBoundingClientRect().height;
    const canvas = await html2canvas(sec, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
    let y = 0;
    while (y < total - 1) {
      let end = y + usable;
      if (end < total) {
        const fit = cuts.filter((c) => c > y + 40 && c <= end);
        if (fit.length) end = fit[fit.length - 1];
      } else end = total;
      pages.push({ canvas, land, W, H, top, y, h: end - y });
      y = end;
    }
  }
  const pdf = new jsPDF({ orientation: pages[0]?.land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  pages.forEach((pg, i) => {
    if (i) pdf.addPage('a4', pg.land ? 'landscape' : 'portrait');
    const c = document.createElement('canvas');
    c.width = pg.W * scale; c.height = pg.H * scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(pg.canvas, 0, pg.y * scale, pg.canvas.width, pg.h * scale, 0, pg.top * scale, pg.canvas.width, pg.h * scale);
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.font = `600 ${12 * scale}px 'IBM Plex Sans KR', 'Malgun Gothic', sans-serif`;
    ctx.fillText(company || '', c.width / 2, (pg.H - 24) * scale);
    ctx.textAlign = 'right';
    ctx.font = `${10 * scale}px 'IBM Plex Mono', monospace`;
    ctx.fillText(`${i + 1} / ${pages.length}`, (pg.W - 40) * scale, (pg.H - 24) * scale);
    const w = pg.land ? 297 : 210, h = pg.land ? 210 : 297;
    pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
  });
  return pdf.output('blob');
}
