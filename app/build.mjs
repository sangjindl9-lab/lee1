// 화면 코드(src/)를 www/ 로 묶는다. node build.mjs
import { build } from 'esbuild';
import { cpSync, copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('www/cmaps', { recursive: true });
mkdirSync('www/standard_fonts', { recursive: true });

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  outfile: 'www/app.js',
  platform: 'browser',
  minify: false,
  target: 'es2020',
  external: ['module', 'fs', 'path', 'crypto', 'url', 'worker_threads'],
  sourcemap: false,
  logLevel: 'info',
});
await build({
  entryPoints: ['node_modules/pdfjs-dist/build/pdf.worker.mjs'],
  bundle: true,
  format: 'esm',
  outfile: 'www/pdf.worker.js',
  minify: true,
  logLevel: 'info',
});
copyFileSync('node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.wasm', 'www/libredwg-web.wasm');
cpSync('node_modules/pdfjs-dist/cmaps', 'www/cmaps', { recursive: true });
cpSync('node_modules/pdfjs-dist/standard_fonts', 'www/standard_fonts', { recursive: true });
