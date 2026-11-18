/**
 * 압축 파일 사전 검사 — 압축 폭탄과 경로 탈출을 방어한다.
 * 외부 라이브러리 없이 ZIP 중앙 디렉터리를 직접 읽어, 압축을 풀기 전에 판단한다.
 */

export interface ZipIssue {
  kind:
    | "PATH_TRAVERSAL"
    | "ABSOLUTE_PATH"
    | "SYMLINK"
    | "ENCRYPTED"
    | "TOO_MANY_ENTRIES"
    | "BOMB_RATIO"
    | "BOMB_TOTAL_SIZE"
    | "CORRUPT";
  detail: string;
  entry?: string;
}

export interface ZipInspection {
  isZip: boolean;
  entries: number;
  totalUncompressed: number;
  compressedSize: number;
  issues: ZipIssue[];
  /** 압축 폭탄·경로 탈출은 무조건 차단 */
  blocking: boolean;
  fileNames: string[];
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

const MAX_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_RATIO = 200;
const RATIO_MIN_SIZE = 20 * 1024 * 1024; // 20MB 이상일 때만 비율 폭탄 판정

export function isZip(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function findEocd(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 66_000);
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

export function inspectZip(buffer: Buffer): ZipInspection {
  const result: ZipInspection = {
    isZip: isZip(buffer),
    entries: 0,
    totalUncompressed: 0,
    compressedSize: 0,
    issues: [],
    blocking: false,
    fileNames: [],
  };
  if (!result.isZip) return result;

  const eocd = findEocd(buffer);
  if (eocd < 0) {
    result.issues.push({ kind: "CORRUPT", detail: "ZIP 중앙 디렉터리를 찾을 수 없습니다." });
    result.blocking = true;
    return result;
  }

  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  result.entries = count;

  if (count > MAX_ENTRIES) {
    result.issues.push({
      kind: "TOO_MANY_ENTRIES",
      detail: `압축 파일 내 항목이 ${count}개로 허용치(${MAX_ENTRIES}개)를 초과했습니다.`,
    });
    result.blocking = true;
  }

  let offset = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIG) break;
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const externalAttrs = buffer.readUInt32LE(offset + 38);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    offset += 46 + nameLen + extraLen + commentLen;

    result.totalUncompressed += uncompressed;
    result.compressedSize += compressed;
    result.fileNames.push(name);

    if (flags & 0x1) {
      result.issues.push({
        kind: "ENCRYPTED",
        entry: name,
        detail: "암호가 걸린 압축 항목은 내용 검사가 불가능합니다.",
      });
      result.blocking = true;
    }

    const normalized = name.replace(/\\/g, "/");
    if (
      normalized.startsWith("/") ||
      /^[a-zA-Z]:\//.test(normalized) ||
      normalized.split("/").includes("..") ||
      name.includes("\\") ||
      name.includes("\u0000")
    ) {
      result.issues.push({
        kind: normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)
          ? "ABSOLUTE_PATH"
          : "PATH_TRAVERSAL",
        entry: name,
        detail: "압축을 풀면 지정 폴더 밖으로 벗어나는 경로가 포함되어 있습니다.",
      });
      result.blocking = true;
    }

    const unixMode = (externalAttrs >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) {
      result.issues.push({
        kind: "SYMLINK",
        entry: name,
        detail: "심볼릭 링크 항목이 포함되어 있습니다.",
      });
      result.blocking = true;
    }

    if (method !== 0 && uncompressed > RATIO_MIN_SIZE && compressed > 0) {
      if (uncompressed / compressed > MAX_RATIO) {
        result.issues.push({
          kind: "BOMB_RATIO",
          entry: name,
          detail: `압축률이 비정상적으로 높습니다(${Math.round(uncompressed / compressed)}배).`,
        });
        result.blocking = true;
      }
    }
  }

  if (result.totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
    result.issues.push({
      kind: "BOMB_TOTAL_SIZE",
      detail: `압축 해제 후 총 용량이 ${Math.round(result.totalUncompressed / 1024 / 1024)}MB로 허용치를 초과했습니다.`,
    });
    result.blocking = true;
  }

  return result;
}
