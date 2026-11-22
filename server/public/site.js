(() => {
  const here = location.pathname.replace(/\/$/, '') || '/';
  const links = [['/', '제품 소개'], ['/download', '다운로드'], ['/guide', '설치 안내'], ['/updates', '업데이트'], ['/support', '고객지원']];
  const h = document.createElement('header');
  h.className = 'top';
  h.innerHTML = `<div class="wrap"><a class="brand" href="/"><img src="/icon.png" alt=""><span>파일 관리자 2<br><small>PC CONNECT</small></span></a>
    <nav class="menu">${links.map(([u, t]) => `<a href="${u}" class="${u === here ? 'on' : ''}">${t}</a>`).join('')}</nav></div>`;
  document.body.prepend(h);
  const f = document.createElement('footer');
  f.innerHTML = `<div class="wrap"><div style="margin-bottom:10px"><a href="/privacy">개인정보처리방침</a><a href="/terms">이용약관</a><a href="/support">고객지원</a></div>
    이음소프트웨어 · 문의 pm999@naver.com<br>© ${new Date().getFullYear()} 파일 관리자 2</div>`;
  document.body.append(f);
  window.fmt = {
    size: (b) => { if (!b && b !== 0) return '-'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; },
    date: (s) => s ? new Date(s).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '-',
  };
  window.isAndroid = /Android/i.test(navigator.userAgent);
  window.isWindows = /Windows/i.test(navigator.userAgent);
})();
