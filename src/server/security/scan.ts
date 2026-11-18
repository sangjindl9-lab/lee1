import { inspectZip, isZip } from "./zip";

export type FindingSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface ScanFinding {
  type: string;
  label: string;
  severity: FindingSeverity;
  /** 원문 값을 그대로 남기지 않고 일부만 가린다. */
  sample: string;
  location: string;
  blocking: boolean;
}

export interface ScanResult {
  status: "PASSED" | "ISSUE_FOUND" | "UNSCANNABLE";
  findings: ScanFinding[];
  notes: string[];
  scannedBytes: number;
  zip?: {
    entries: number;
    totalUncompressed: number;
    issues: string[];
  };
}

const MAX_TEXT_SCAN = 5 * 1024 * 1024;

function mask(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return `${v.slice(0, 2)}****`;
  return `${v.slice(0, 4)}${"*".repeat(Math.min(8, v.length - 8))}${v.slice(-2)}`;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

interface Rule {
  type: string;
  label: string;
  severity: FindingSeverity;
  blocking: boolean;
  re: RegExp;
  group?: number;
  validate?: (m: string) => boolean;
}

const RULES: Rule[] = [
  {
    type: "PRIVATE_KEY",
    label: "개인키/인증서 PEM 블록",
    severity: "HIGH",
    blocking: true,
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    type: "AWS_ACCESS_KEY",
    label: "AWS 액세스 키",
    severity: "HIGH",
    blocking: true,
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    type: "GOOGLE_API_KEY",
    label: "Google API 키",
    severity: "HIGH",
    blocking: true,
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    type: "SLACK_TOKEN",
    label: "Slack 토큰",
    severity: "HIGH",
    blocking: true,
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g,
  },
  {
    type: "GITHUB_TOKEN",
    label: "GitHub 토큰",
    severity: "HIGH",
    blocking: true,
    re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g,
  },
  {
    type: "KOREAN_RRN",
    label: "주민등록번호 형태",
    severity: "HIGH",
    blocking: true,
    re: /\b(\d{6})[- ]?([1-8]\d{6})\b/g,
    group: 0,
  },
  {
    type: "CARD_NUMBER",
    label: "카드번호 형태",
    severity: "HIGH",
    blocking: true,
    re: /\b(?:\d[ -]?){13,18}\d\b/g,
    validate: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 14 && digits.length <= 19 && luhnValid(digits);
    },
  },
  {
    type: "GENERIC_SECRET",
    label: "비밀키·비밀번호로 보이는 값",
    severity: "MEDIUM",
    blocking: false,
    re: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|password|passwd|db[_-]?pass)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    group: 1,
  },
  {
    type: "PHONE_NUMBER",
    label: "휴대전화번호 형태",
    severity: "LOW",
    blocking: false,
    re: /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g,
  },
  {
    type: "EMAIL",
    label: "이메일 주소",
    severity: "LOW",
    blocking: false,
    re: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g,
  },
];

const SAFE_PLACEHOLDER = /(your[-_]?|example|sample|changeme|placeholder|xxxx|<[^>]+>|\$\{|process\.env)/i;

/**
 * 납품 파일 사전 검사.
 * - 압축 폭탄·경로 탈출은 차단(blocking)
 * - 개인키·클라우드 키·주민번호·카드번호 패턴은 차단
 * - 예시값(your-api-key, ${process.env.X})은 차단하지 않는다.
 */
export function scanDeliveryFile(input: {
  fileName: string;
  buffer: Buffer;
  mimeType?: string | null;
}): ScanResult {
  const findings: ScanFinding[] = [];
  const notes: string[] = [];
  const isEnvExample = /(^|\/)\.env\.example$/i.test(input.fileName) || /\.env\.sample$/i.test(input.fileName);

  const zipInfo = isZip(input.buffer) ? inspectZip(input.buffer) : null;
  if (zipInfo) {
    if (zipInfo.blocking) {
      for (const issue of zipInfo.issues) {
        findings.push({
          type: `ZIP_${issue.kind}`,
          label: "압축 파일 안전 검사 위반",
          severity: "HIGH",
          sample: issue.entry ? mask(issue.entry) : issue.detail,
          location: issue.entry ?? "압축 파일",
          blocking: true,
        });
      }
    } else if (zipInfo.issues.length > 0) {
      notes.push(...zipInfo.issues.map((i) => i.detail));
    }
    notes.push(`압축 항목 ${zipInfo.entries}개, 압축 해제 후 ${zipInfo.totalUncompressed.toLocaleString()}바이트`);
  }

  const scanTarget = input.buffer.subarray(0, Math.min(input.buffer.length, MAX_TEXT_SCAN));
  const text = scanTarget.toString("utf8");
  const truncated = input.buffer.length > MAX_TEXT_SCAN;
  if (truncated) notes.push("파일이 커서 앞부분 5MB만 검사했습니다. 전체 검사는 별도 격리 검사가 필요합니다.");

  for (const rule of RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = re.exec(text)) !== null && count < 5) {
      const value = rule.group != null ? match[rule.group] : match[0];
      if (!value) continue;
      if (rule.validate && !rule.validate(value)) continue;
      if (rule.severity !== "HIGH" && SAFE_PLACEHOLDER.test(value)) continue;
      if (rule.type === "GENERIC_SECRET" && isEnvExample) continue;
      findings.push({
        type: rule.type,
        label: rule.label,
        severity: rule.severity,
        sample: mask(value),
        location: input.fileName,
        blocking: rule.blocking,
      });
      count += 1;
    }
  }

  const blocking = findings.some((f) => f.blocking);
  const status: ScanResult["status"] = blocking ? "ISSUE_FOUND" : "PASSED";

  if (blocking) {
    notes.push(
      "운영 비밀번호·실사용 API 키·개인정보로 보이는 값이 발견되었습니다. 해당 값을 제거한 뒤 다시 등록해 주세요.",
    );
  }
  notes.push(
    "이 검사는 알려진 패턴 기반 사전 점검입니다. 악성코드 검사나 기능 정상 작동을 보증하지 않습니다.",
  );

  return {
    status,
    findings,
    notes,
    scannedBytes: scanTarget.length,
    zip: zipInfo
      ? {
          entries: zipInfo.entries,
          totalUncompressed: zipInfo.totalUncompressed,
          issues: zipInfo.issues.map((i) => `${i.kind}: ${i.detail}`),
        }
      : undefined,
  };
}
