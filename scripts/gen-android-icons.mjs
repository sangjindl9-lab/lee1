/**
 * 안드로이드 런처 아이콘(PNG)을 만든다.
 * API 26 미만 기기와 일부 런처는 mipmap-*dpi/ic_launcher.png 를 쓴다.
 *
 *   node scripts/gen-android-icons.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RES = path.resolve("android/app/src/main/res");
const SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const photo = `
  <rect x="128" y="128" width="256" height="256" rx="48" fill="#FFFFFF" />
  <path d="M144 368 L208 288 L256 336 L288 296 L368 368 Z" fill="#DB2777" />
  <circle cx="200" cy="200" r="26" fill="#DB2777" />`;

const square = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#DB2777" />${photo}
</svg>`;

const round = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <circle cx="256" cy="256" r="256" fill="#DB2777" />${photo}
</svg>`;

async function render(svg, size, outFile) {
  await mkdir(path.dirname(outFile), { recursive: true });
  const png = await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outFile, png);
  return outFile;
}

const written = [];
for (const [density, size] of Object.entries(SIZES)) {
  const dir = path.join(RES, `mipmap-${density}`);
  written.push(await render(square, size, path.join(dir, "ic_launcher.png")));
  written.push(await render(round, size, path.join(dir, "ic_launcher_round.png")));
}

console.log(written.map((p) => path.relative(process.cwd(), p)).join("\n"));
