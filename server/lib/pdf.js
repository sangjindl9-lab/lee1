// HTML → PDF (Chromium). 한글 폰트는 서버에 설치된 Noto Sans CJK KR / 나눔고딕 / 맑은 고딕 사용
const config = require('../config');
let browserPromise = null;

async function browser() {
  if (!browserPromise) {
    const { chromium } = require('playwright');
    browserPromise = chromium.launch(config.chromiumPath ? { executablePath: config.chromiumPath } : {}).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

async function renderPdf(html, { landscape = false, title = '' } = {}) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4', landscape, printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:7px;width:100%;padding:0 10mm;color:#666;font-family:'Noto Sans CJK KR',sans-serif;">${escapeHtml(title)}</div>`,
      footerTemplate: `<div style="font-size:7px;width:100%;padding:0 10mm;color:#666;text-align:right;font-family:'Noto Sans CJK KR',sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  } finally { await page.close(); }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function closeBrowser() { if (browserPromise) { (await browserPromise).close(); browserPromise = null; } }

module.exports = { renderPdf, escapeHtml, closeBrowser };
