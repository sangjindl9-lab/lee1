import { Readable } from 'node:stream';

export function fileResponse(file: any, stream: any) {
  return new Response(Readable.toWeb(stream) as any, { headers: {
    'Content-Type': 'application/octet-stream', 'Content-Length': String(file.size_bytes), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` } });
}
