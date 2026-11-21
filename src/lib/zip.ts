import archiver from "archiver";
import { Readable } from "node:stream";
import { streamStored } from "./storage";

/** key = 저장소 경로 */
export type ZipEntry = { key: string; name: string };

export function zipResponse(entries: ZipEntry[], manifestCsv: string, downloadName: string): Response {
  // 사진·동영상은 이미 압축되어 있으므로 다시 압축하지 않는다 (CPU 절약)
  const archive = archiver("zip", { zlib: { level: 0 }, store: true });
  archive.on("warning", (err) => console.warn("[zip] warning", err));
  archive.on("error", (err) => console.error("[zip] error", err));
  void (async () => {
    // 한 파일씩 저장소에서 흘려받아 바로 압축 파일에 쓴다 (메모리에 전부 올리지 않음)
    for (const entry of entries) {
      const stream = await streamStored(entry.key);
      if (!stream) continue;
      archive.append(stream, { name: entry.name });
      await new Promise<void>((resolve) => archive.once("entry", () => resolve()));
    }
    archive.append(manifestCsv, { name: "MANIFEST.csv" });
    await archive.finalize();
  })();

  const webStream = Readable.toWeb(archive) as unknown as ReadableStream;
  return new Response(webStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(downloadName)}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "Cache-Control": "no-store",
    },
  });
}

export function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
