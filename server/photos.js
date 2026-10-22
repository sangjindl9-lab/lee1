import sharp from 'sharp';
import multer from 'multer';
import { bad } from './util.js';

sharp.cache(false);
sharp.concurrency(1);

// 메모리 업로드 → 실제 이미지인지 디코딩해 보고 WebP로 다시 만든다.
// 재인코딩하므로 위장 파일·악성 페이로드가 그대로 저장되지 않고, EXIF(촬영 위치 GPS 등)도 제거된다.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 10, fields: 5 },
  fileFilter: (req, f, cb) =>
    /^image\/(jpeg|png|webp|heic|heif|avif)$/.test(f.mimetype) ? cb(null, true) : cb(bad('JPG, PNG, WEBP, HEIC 사진만 올릴 수 있어요.')),
});

export async function processPhoto(buf) {
  let img;
  try {
    img = sharp(buf, { failOn: 'error', limitInputPixels: 60e6 }).rotate();
    const meta = await img.metadata();
    if (!meta.width || meta.width < 400 || meta.height < 300) throw bad('사진은 가로 400px, 세로 300px 이상이어야 해요.');
  } catch (e) {
    if (e.status) throw e;
    throw bad('사진 파일을 읽을 수 없어요. 다른 파일로 시도해 주세요.');
  }
  const { data, info } = await img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const thumb = await img.clone().resize({ width: 640, height: 608, fit: 'cover' }).webp({ quality: 76 }).toBuffer();
  return { data, thumb, width: info.width, height: info.height };
}
