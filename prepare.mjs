// 웹 단일파일 빌드(dist-single/index.html)를 데스크톱 앱 폴더(app/)로 옮기고, 글꼴을 내장한다.
import fs from 'fs';
import path from 'path';
const src = process.argv[2] || '../gongjung/dist-single/index.html';
const out = 'app';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true });
const pkgs = { 'nanum-gothic': ['400', '700', '800'], 'ibm-plex-sans-kr': ['400', '500', '600', '700'], 'ibm-plex-mono': ['400', '600'] };
const links = [];
for (const [pkg, ws] of Object.entries(pkgs)) {
  const base = path.join('node_modules', '@fontsource', pkg);
  const dst = path.join(out, 'fonts', pkg);
  fs.mkdirSync(path.join(dst, 'files'), { recursive: true });
  for (const w of ws) {
    const css = fs.readFileSync(path.join(base, `${w}.css`), 'utf8');
    fs.writeFileSync(path.join(dst, `${w}.css`), css);
    for (const m of css.matchAll(/url\(\.\/files\/([^)]+)\)/g)) {
      const f = m[1];
      if (f.endsWith('.woff2') && !fs.existsSync(path.join(dst, 'files', f))) fs.copyFileSync(path.join(base, 'files', f), path.join(dst, 'files', f));
    }
    links.push(`<link rel="stylesheet" href="fonts/${pkg}/${w}.css" />`);
  }
}
let html = fs.readFileSync(src, 'utf8');
const before = html.length;
html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, links.join('\n    '));
if (html.includes('fonts.googleapis.com')) throw new Error('Google Fonts 링크가 남아 있음');
html = html.replace(/<title>[^<]*<\/title>/, '<title>예정공정표</title>');
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('app/index.html', before, '→', html.length, 'fonts', links.length);
