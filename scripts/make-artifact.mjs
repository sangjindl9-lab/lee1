// dist-single/index.html → claude.ai 아티팩트용 본문(doctype/html/head/body 래퍼 제거, <title> 맨 앞)
import fs from 'node:fs';
const html = fs.readFileSync('dist-single/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*)<\/body>/)[1];
const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
const metaCover = head.match(/<meta name="claude:viewport-fit-sides"[^>]*>/)?.[0] || '';
const links = (head.match(/<link[^>]*>/g) || []).join('\n');
const styles = (head.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');
const scripts = (head.match(/<script[^>]*>[\s\S]*?<\/script>/g) || []).join('\n');
const out0 = [title, metaCover, links, styles, body.replace(/<script[\s\S]*?<\/script>/g, '').trim(), scripts].join('\n');
fs.mkdirSync('artifact', { recursive: true });
// 라이브러리 문자열 안의 U+FFFD 문자를 이스케이프로 치환(동작 동일)
const out = out0.replace(/\uFFFD/g, '\\uFFFD');
fs.writeFileSync('artifact/gongjung.html', out);
console.log('artifact/gongjung.html', (out.length / 1024).toFixed(0) + 'KB');
