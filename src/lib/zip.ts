import archiver from "archiver";
import { Readable } from "node:stream";

export type ZipEntry = { path: string; name: string };

export function zipResponse(entries: ZipEntry[], manifestCsv: string, downloadName: string): Response {
  const archive = archiver("zip", { zlib: { level: 6 } });
  for (const entry of entries) {
    archive.file(entry.path, { name: entry.name });
  }
  archive.append(manifestCsv, { name: "MANIFEST.csv" });
  archive.on("warning", (err) => console.warn("[zip] warning", err));
  archive.on("error", (err) => console.error("[zip] error", err));
  void archive.finalize();

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
