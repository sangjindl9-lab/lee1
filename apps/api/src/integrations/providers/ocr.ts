/**
 * 문서 인식(OCR/AI) 어댑터 — 교체 가능한 인터페이스
 *  - BUILTIN_PDF: 내장. 전자 PDF(글자가 들어 있는 PDF)의 글자 위치로 표를 읽는다. 외부 전송 없음. 사진·스캔 이미지는 못 읽음
 *  - ANTHROPIC: Claude 문서 이해 API — 사진·스캔본·PDF 모두. 고객사 API 키 필요
 *  - CLOVA: 네이버 CLOVA OCR (General) — 글자 위치를 받아 내장 표 해석기로 품목을 만든다. 고객사 Invoke URL·Secret 필요
 *  - SAMPLE: 테스트 환경 전용 샘플 결과 (시연·자동 테스트용, 운영 모드에서는 사용 불가)
 * 어떤 결과도 사용자 검토 없이 확정 자료가 되지 않는다 (문서 스캔 화면에서 확인 후 등록).
 */
import { httpJson } from '../retry';
import { Extraction, ExtractedLine, OcrProvider, ProviderContext, ProviderError } from '../types';

export interface TextItem { str: string; x: number; y: number; w: number; page: number }

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const numOf = (s: string | null | undefined) => {
  if (!s) return null;
  const neg = /△|▲|^-/.test(s.trim());
  const d = s.replace(/[^0-9.]/g, '');
  if (!d || !/\d/.test(d)) return null;
  return (neg ? '-' : '') + d.replace(/\.(?=.*\.)/g, '');
};

const HEAD: Record<string, RegExp> = {
  no: /^(no\.?|번호|순번|연번)$/i,
  name: /^(품\s*명|품\s*목|자재명|명\s*칭|품목명|내\s*역|공종)$/,
  spec: /^(규\s*격|사\s*양|규격\/사양)$/,
  unit: /^(단\s*위)$/,
  qty: /^(수\s*량)$/,
  unitPrice: /^(단\s*가)$/,
  supplyAmount: /^(공급\s*가액|금\s*액|공급가)$/,
  vatAmount: /^(세\s*액|부가세|부가가치세)$/,
  memo: /^(비\s*고)$/,
};

const LABELS = [/^상\s*호$/, /^사업자\s*(등록)?\s*번호$/, /^대표자?$/, /^납품\s*기한$/, /^납품\s*장소$/, /^담당자?$/, /^주\s*소$/, /^연락처$/, /^결제\s*조건$/, /^부가세$/, /^승인$/];
const NUMERIC_COLS = new Set(['no', 'qty', 'unitPrice', 'supplyAmount', 'vatAmount']);

/** 글자 조각을 줄 단위로 묶기 (같은 페이지·비슷한 y) */
export function toRows(items: TextItem[]) {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: { page: number; y: number; items: TextItem[] }[] = [];
  for (const it of sorted) {
    const r = rows.find((x) => x.page === it.page && Math.abs(x.y - it.y) <= 3.5);
    if (r) r.items.push(it);
    else rows.push({ page: it.page, y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/** 표 머리글을 찾아 열 위치를 정하고 품목 행을 읽는다 */
export function parseGrid(items: TextItem[], pages = 1): Extraction {
  const rows = toRows(items);
  const fullText = rows.map((r) => r.items.map((i) => i.str).join(' ')).join('\n');
  const warnings: string[] = [];
  let cols: { key: string; x: number }[] | null = null;
  const lines: ExtractedLine[] = [];
  for (const r of rows) {
    const keys = r.items.map((i) => ({ i, key: Object.entries(HEAD).find(([, re]) => re.test(clean(i.str)))?.[0] }));
    const found = keys.filter((k) => k.key);
    if (found.some((k) => k.key === 'name') && found.some((k) => k.key === 'qty' || k.key === 'supplyAmount')) {
      cols = found.map((k) => ({ key: k.key!, x: k.i.x + k.i.w / 2 }));
      continue; // 머리글 행 (페이지마다 반복될 수 있음)
    }
    if (!cols) continue;
    const text = clean(r.items.map((i) => i.str).join(' '));
    if (/^(합\s*계|소\s*계|총\s*계|공급가액\s*계|세액\s*계|계)\b/.test(text) || /합계금액|특기사항|위와\s*같이/.test(text)) {
      if (/특기사항|위와\s*같이/.test(text)) cols = null;
      continue;
    }
    const cell: Record<string, string[]> = {};
    for (const it of r.items) {
      const cx = it.x + it.w / 2;
      // 숫자 칸(번호·수량·단가·금액)에는 숫자만 — 글자는 가장 가까운 글자 칸(품명·규격·단위·비고)으로
      const numeric = /^[\d,.\-△▲()]+$/.test(it.str.trim());
      const pool = numeric ? cols : cols.filter((c) => !NUMERIC_COLS.has(c.key));
      let best = pool[0] ?? cols[0];
      for (const c of pool) if (Math.abs(c.x - cx) < Math.abs(best.x - cx)) best = c;
      // 품명 칸은 왼쪽 정렬이라 중심보다 왼쪽에서 시작하므로, 글자 시작점이 품명 칸 범위에 있으면 품명으로
      const nameCol = cols.find((c) => c.key === 'name');
      if (nameCol && best.key !== 'name' && it.x < nameCol.x && it.x + it.w > nameCol.x - 2 && !/^[\d,.]+$/.test(it.str.trim())) best = nameCol;
      (cell[best.key] ??= []).push(it.str);
    }
    const get = (k: string) => (cell[k] ? clean(cell[k].join(' ')) : null);
    const name = get('name');
    const qty = numOf(get('qty'));
    const supply = numOf(get('supplyAmount'));
    if (!name || (!qty && !supply)) continue;
    const unitPrice = numOf(get('unitPrice'));
    let conf = 0.95;
    if (qty && unitPrice && supply) {
      const calc = Math.floor(Number(qty) * Number(unitPrice));
      if (Math.abs(calc - Number(supply)) > 1) {
        conf = 0.6;
        warnings.push(`'${name}' 수량×단가(${calc.toLocaleString('ko-KR')})와 금액(${Number(supply).toLocaleString('ko-KR')})이 다릅니다`);
      }
    } else conf = 0.75;
    lines.push({ name, spec: get('spec'), unit: get('unit'), qty, unitPrice, supplyAmount: supply, vatAmount: numOf(get('vatAmount')), memo: get('memo'), confidence: conf });
  }

  const bizNos = [...fullText.matchAll(/(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})/g)].map((m) => m[1] + m[2] + m[3]);
  const dates = [...fullText.matchAll(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/g)].map((m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  const after = (label: RegExp) => {
    for (const r of rows) {
      const idx = r.items.findIndex((i) => label.test(clean(i.str)));
      if (idx >= 0) {
        const restItems: string[] = [];
        for (const i of r.items.slice(idx + 1)) {
          if (Object.values(LABELS).some((re) => re.test(clean(i.str)))) break; // 다음 칸 이름에서 멈춤
          restItems.push(i.str);
        }
        const rest = clean(restItems.join(' '));
        if (rest) return rest;
      }
    }
    return null;
  };
  const totalMatch = fullText.match(/(?:합계\s*금액|총\s*합계|합\s*계)[^\d₩]*(?:₩|\\)?\s*([\d,]{3,})/);
  const supplyMatch = fullText.match(/공급\s*가액\s*(?:계|합계)\s*([\d,]{3,})/);
  const vatMatch = fullText.match(/세\s*액\s*(?:계|합계)\s*([\d,]{3,})/);
  const docNo = fullText.match(/(?:발주\s*번호|문서\s*번호|No\.?)\s*[:：]?\s*([A-Z]{1,5}\d{2,4}[-_]\d{2,6}(?:[-_]\d+)?)/i)?.[1] ?? null;
  const supplyFromLines = lines.reduce((a, l) => a + Number(l.supplyAmount ?? 0), 0);
  const supplyTotal = supplyMatch ? numOf(supplyMatch[1]) : supplyFromLines ? String(supplyFromLines) : null;
  if (supplyMatch && Math.abs(Number(numOf(supplyMatch[1])) - supplyFromLines) > 1) warnings.push(`품목 금액 합계(${supplyFromLines.toLocaleString('ko-KR')})와 문서의 공급가액 계(${Number(numOf(supplyMatch[1])).toLocaleString('ko-KR')})가 다릅니다`);
  const recvBlock = fullText.match(/수\s*신[^\n]*\n?[^\n]*상\s*호\s*([^\n]+?)(?:\s{2,}|\n|사업자)/);
  const vendorName = after(/^상\s*호$/) ?? recvBlock?.[1]?.trim() ?? null;
  const fieldHits = [vendorName, bizNos[0], docNo, dates[0], supplyTotal].filter(Boolean).length;
  const lineConf = lines.length ? lines.reduce((a, l) => a + (l.confidence ?? 0.8), 0) / lines.length : 0;
  return {
    vendorName, vendorBizNo: bizNos[0] ?? null, docNo, docDate: dates[0] ?? null, deliveryDate: dates[1] ?? null,
    deliveryPlace: after(/^납품\s*장소$/), contactName: after(/^담당자?$/),
    supplyAmount: supplyTotal, vatAmount: vatMatch ? numOf(vatMatch[1]) : null, totalAmount: totalMatch ? numOf(totalMatch[1]) : null,
    lines, pages, warnings,
    confidence: lines.length ? Math.round((lineConf * 0.7 + (fieldHits / 5) * 0.3) * 100) / 100 : 0,
    fieldConfidence: { vendorName: vendorName ? 0.8 : 0, vendorBizNo: bizNos[0] ? 0.95 : 0, docNo: docNo ? 0.9 : 0, docDate: dates[0] ? 0.85 : 0, totalAmount: totalMatch ? 0.9 : 0 },
    allBizNos: bizNos,
  };
}

const importEsm = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

export async function pdfTextItems(buffer: Buffer): Promise<{ items: TextItem[]; pages: number }> {
  const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise;
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items as { str: string; transform: number[]; width: number }[]) {
      if (!it.str?.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, page: p });
    }
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { items, pages };
}

export class BuiltinPdfOcr implements OcrProvider {
  readonly name = 'BUILTIN_PDF';
  async test() {
    return '내장 PDF 인식 사용 가능 — 전자 PDF는 외부 전송 없이 읽습니다 (사진·스캔본은 AI 연동 필요)';
  }
  async extract(_pc: ProviderContext, file: { buffer: Buffer; mimeType: string }) {
    if (file.mimeType !== 'application/pdf') throw new ProviderError('내장 인식기는 글자가 들어 있는 PDF만 읽을 수 있습니다. 사진·스캔 이미지는 관리 > 외부 연동에서 AI 문서인식(OCR)을 연결하세요', 'UNSUPPORTED');
    const { items, pages } = await pdfTextItems(file.buffer);
    if (items.length < 5) throw new ProviderError('PDF에 글자 정보가 없습니다 (스캔 이미지로 만든 PDF). AI 문서인식(OCR) 연동이 필요합니다', 'NO_TEXT_LAYER');
    return parseGrid(items, pages);
  }
}

const SCHEMA_PROMPT = `이 문서는 한국 건설·전기공사 업체가 주고받는 발주서/거래명세표/세금계산서/영수증/견적서입니다.
문서의 내용을 아래 JSON 형식으로만 답하세요 (설명 문장 금지). 모르는 값은 null.
{"docType":"ISSUED_PO|RECEIVED_PO|STATEMENT|TAX_INVOICE|RECEIPT|QUOTE|DELIVERY","vendorName":"공급자(거래처) 상호","vendorBizNo":"사업자번호 숫자 10자리","docNo":"문서/발주번호","docDate":"YYYY-MM-DD","deliveryDate":"YYYY-MM-DD","deliveryPlace":"","contactName":"","contactPhone":"","supplyAmount":"숫자","vatAmount":"숫자","totalAmount":"숫자","memo":"",
"lines":[{"name":"품명","spec":"규격","unit":"단위","qty":"숫자","unitPrice":"숫자","supplyAmount":"숫자","vatAmount":"숫자","memo":"","confidence":0.0~1.0}],
"confidence":0.0~1.0,"warnings":["읽기 어려웠던 부분 설명"]}
여러 쪽이면 모든 쪽의 품목을 빠짐없이 넣으세요. 금액은 쉼표 없이 숫자만.`;

export class AnthropicOcr implements OcrProvider {
  readonly name = 'ANTHROPIC';
  private model(pc: ProviderContext) {
    return String(pc.settings.model || 'claude-sonnet-5-5');
  }
  async test(pc: ProviderContext) {
    if (!pc.secrets.apiKey) throw new ProviderError('Anthropic API 키가 설정되지 않았습니다', 'NOT_CONFIGURED');
    const r = await httpJson('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': pc.secrets.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model(pc), max_tokens: 16, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (!r.ok) throw new ProviderError(`Anthropic API 오류 (HTTP ${r.status}) ${r.text.slice(0, 200)}`, `HTTP_${r.status}`);
    return `AI 문서인식 연결 성공 (${this.model(pc)})`;
  }
  async extract(pc: ProviderContext, file: { buffer: Buffer; mimeType: string }) {
    if (!pc.secrets.apiKey) throw new ProviderError('Anthropic API 키가 설정되지 않았습니다', 'NOT_CONFIGURED');
    const isPdf = file.mimeType === 'application/pdf';
    const media = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: file.mimeType, data: file.buffer.toString('base64') } };
    const r = await httpJson('https://api.anthropic.com/v1/messages', {
      method: 'POST', timeoutMs: 180_000,
      headers: { 'content-type': 'application/json', 'x-api-key': pc.secrets.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: this.model(pc), max_tokens: 8000, messages: [{ role: 'user', content: [media, { type: 'text', text: SCHEMA_PROMPT }] }] }),
    });
    if (!r.ok) throw new ProviderError(`AI 문서인식 실패 (HTTP ${r.status})`, `HTTP_${r.status}`, r.status === 529, r.text.slice(0, 300));
    const j = JSON.parse(r.text) as { content: { type: string; text?: string }[] };
    const text = j.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    try {
      const x = JSON.parse(json) as Extraction;
      return { ...x, lines: (x.lines ?? []).map((l) => ({ ...l, qty: numOf(l.qty), unitPrice: numOf(l.unitPrice), supplyAmount: numOf(l.supplyAmount), vatAmount: numOf(l.vatAmount) })), confidence: Number(x.confidence ?? 0.8), vendorBizNo: x.vendorBizNo?.replace(/\D/g, '') || null };
    } catch {
      throw new ProviderError('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요', 'BAD_RESPONSE', true);
    }
  }
}

export class ClovaOcr implements OcrProvider {
  readonly name = 'CLOVA';
  async test(pc: ProviderContext) {
    if (!pc.settings.invokeUrl || !pc.secrets.secretKey) throw new ProviderError('CLOVA OCR Invoke URL·Secret Key 가 필요합니다', 'NOT_CONFIGURED');
    return 'CLOVA OCR 설정 확인 (실제 인식은 문서를 올려 확인하세요)';
  }
  async extract(pc: ProviderContext, file: { buffer: Buffer; mimeType: string; name: string }) {
    if (!pc.settings.invokeUrl || !pc.secrets.secretKey) throw new ProviderError('CLOVA OCR Invoke URL·Secret Key 가 필요합니다', 'NOT_CONFIGURED');
    const format = file.mimeType === 'application/pdf' ? 'pdf' : file.mimeType.split('/')[1].replace('jpeg', 'jpg');
    const r = await httpJson(String(pc.settings.invokeUrl), {
      method: 'POST', timeoutMs: 120_000, headers: { 'Content-Type': 'application/json', 'X-OCR-SECRET': pc.secrets.secretKey },
      body: JSON.stringify({ version: 'V2', requestId: `erp-${Date.now()}`, timestamp: Date.now(), lang: 'ko', images: [{ format, name: file.name.slice(0, 50), data: file.buffer.toString('base64') }] }),
    });
    if (!r.ok) throw new ProviderError(`CLOVA OCR 오류 (HTTP ${r.status})`, `HTTP_${r.status}`);
    const j = JSON.parse(r.text) as { images: { fields?: { inferText: string; boundingPoly: { vertices: { x: number; y: number }[] } }[] }[] };
    const items: TextItem[] = [];
    j.images.forEach((img, pi) => {
      for (const f of img.fields ?? []) {
        const xs = f.boundingPoly.vertices.map((v) => v.x), ys = f.boundingPoly.vertices.map((v) => v.y);
        // 이미지 좌표는 y 가 아래로 커지므로 PDF 기준(위로 커짐)과 맞추기 위해 부호를 뒤집는다
        items.push({ str: f.inferText, x: Math.min(...xs), y: -((Math.min(...ys) + Math.max(...ys)) / 2), w: Math.max(...xs) - Math.min(...xs), page: pi + 1 });
      }
    });
    const ex = parseGrid(items, j.images.length);
    return { ...ex, confidence: Math.min(ex.confidence, 0.85) };
  }
}

/** 테스트 환경 전용 — 실제 문서 내용과 무관한 고정 샘플. 운영 모드에서는 쓸 수 없다 */
export class SampleOcr implements OcrProvider {
  readonly name = 'SAMPLE';
  async test(pc: ProviderContext) {
    if (pc.mode === 'LIVE') throw new ProviderError('샘플 인식은 테스트 모드에서만 쓸 수 있습니다', 'TEST_ONLY');
    return '샘플 인식 (테스트 전용) — 어떤 문서를 올려도 같은 샘플 결과가 나옵니다';
  }
  async extract(pc: ProviderContext): Promise<Extraction> {
    if (pc.mode === 'LIVE') throw new ProviderError('샘플 인식은 테스트 모드에서만 쓸 수 있습니다', 'TEST_ONLY');
    const items: [string, string, string, string, string][] = [
      ['F-CV 케이블', '6sq 2C', 'm', '500', '1850'], ['F-CV 케이블', '16sq 4C', 'm', '120', '9800'], ['HFIX 전선', '2.5sq', 'm', '2000', '350'],
      ['전선관(HI-PVC)', '28C', '본', '150', '3200'], ['풀박스', '200×200×100', 'EA', '30', '8500'], ['LED 평판등', '640×640 50W', 'EA', '80', '42000'],
    ];
    const lines = items.map(([name, spec, unit, qty, price]) => ({ name, spec, unit, qty, unitPrice: price, supplyAmount: String(Number(qty) * Number(price)), vatAmount: String(Math.floor(Number(qty) * Number(price) / 10)), confidence: 0.9 }));
    const supply = lines.reduce((a, l) => a + Number(l.supplyAmount), 0);
    return { docType: 'STATEMENT', vendorName: '대한전기자재㈜', vendorBizNo: '1248100998', docNo: 'DS-2610-001', docDate: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10), supplyAmount: String(supply), vatAmount: String(Math.floor(supply / 10)), totalAmount: String(supply + Math.floor(supply / 10)), lines, confidence: 0.9, warnings: ['샘플 인식 결과입니다 (테스트 모드)'] };
  }
}
