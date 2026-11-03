// 사진·고지서 추출(보조 기능). 외부 AI(Anthropic)는 API 키가 서버에 설정되고, 장소별 외부 전송 동의가 있을 때만 사용.
// AI는 "보이는 글자와 위치"만 추출하고, 단위 구분·상호 검증은 서버 규칙(engine/units.js)이 다시 확인한다.
import fs from 'node:fs';
import sharp from 'sharp';
import { parseBreakerText, checkBreaker, classifyNameplateLine, parseQuantity } from './engine/units.js';

export const LOW_CONF = 0.8;
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.AI_MODEL || 'claude-sonnet-5-5';

const COMMON = `규칙:
- 사진/문서에 실제로 보이는 글자만 읽는다. 추측·일반값·모델별 기억값을 넣지 않는다.
- 읽히지 않거나 가려진 값은 넣지 말고 unreadable 배열에 항목 이름을 적는다.
- 각 값에는 원문(text), 신뢰도(confidence 0~1), 위치(bbox: [x,y,w,h], 이미지 크기 대비 0~1 비율, PDF면 page 포함)를 붙인다.
- 단위를 원문 그대로 보존한다(W, kW, kWh, A, AF, AT, mA, kA, V).
- JSON 하나만 출력한다. 설명 문장 금지.`;

const PROMPTS = {
  bill: `한국전력 전기요금 고지서에서 다음을 추출하라. ${COMMON}
출력: {"fields":[{"key":"contract_kind|contract_kw|period_start|period_end|usage_kwh|max_demand_kw|base_charge|energy_charge|total_charge|customer_no|other","label":"고지서 표기 항목명","text":"원문","value":숫자또는문자,"unit":"단위","confidence":0.0,"bbox":[0,0,0,0],"page":1}],"unreadable":[]}
주의: 사용량(kWh)과 최대수요전력(kW)은 다른 항목이다. 최대수요전력 표기가 없으면 max_demand_kw를 만들지 않는다. 날짜는 YYYY-MM-DD.`,
  panel: `분전반 사진에서 차단기와 외관을 추출하라. ${COMMON}
출력: {"breakers":[{"role":"main|branch|unknown","text":"명판에 보이는 원문 전체","label":"회로명 표기(있으면)","spare":false,"bbox":[0,0,0,0],"confidence":0.0,
"fields":{"maker":null,"model":null,"type":"MCCB|ELB|MCB|기타|null","poles":null,"af":null,"at":null,"sens_ma":null,"ka":null,"voltage":null,"adjustable":false,"set_current":null}}],
"findings":[{"desc":"변색|파손|그을음|노출 충전부 등 외관상 의심","bbox":[0,0,0,0],"confidence":0.0}],"unreadable":[]}
주의: AF(프레임)와 AT(정격전류)를 구분한다. mA는 감도전류, kA는 차단용량이며 정격전류가 아니다. 조정형이면 adjustable=true, 다이얼 설정값이 보이면 set_current. 전선 굵기는 판단하지 않는다.`,
  nameplate: `전기기기 명판에서 다음을 추출하라. ${COMMON}
출력: {"fields":[{"key":"maker|model|power|rated_current|voltage|phase|pf|cooling_capacity|heating_capacity|motor_output|efficiency|frequency|start_current|other","label":"명판 항목명 원문","text":"원문","value":숫자또는문자,"unit":"단위","confidence":0.0,"bbox":[0,0,0,0]}],"unreadable":[]}
주의: 냉방능력·난방능력은 소비전력이 아니다(각각 cooling_capacity, heating_capacity). 모터 정격출력은 motor_output이며 소비전력이 아니다. "소비전력", "정격입력"만 power다.`,
  meter: `전력량계 사진에서 보이는 값만 추출하라. ${COMMON}
출력: {"fields":[{"key":"meter_no|kwh_reading|max_demand_kw|voltage|current_rating|type|other","label":"","text":"","value":null,"unit":"","confidence":0.0,"bbox":[0,0,0,0]}],"unreadable":[]}`,
};

async function toContent(file) {
  if (file.mime === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(file.path).toString('base64') } };
  }
  const buf = await sharp(file.path).rotate().resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } };
}

export async function runExtraction(target, file) {
  if (!aiConfigured()) return { status: 'not_configured', error: '사진 분석(AI)이 설정되지 않았습니다. 값을 직접 입력하세요.' };
  const prompt = PROMPTS[target];
  if (!prompt) return { status: 'failed', error: '지원하지 않는 분석 대상' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, messages: [{ role: 'user', content: [await toContent(file), { type: 'text', text: prompt }] }] }),
      signal: AbortSignal.timeout(90000),
    });
    const body = await res.json();
    if (!res.ok) return { status: 'failed', error: `AI 응답 오류(${res.status}): ${body?.error?.message || ''}` };
    const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { status: 'failed', error: 'AI 응답에서 결과를 읽지 못했습니다. 재촬영하거나 직접 입력하세요.', raw: text };
    const parsed = JSON.parse(m[0]);
    return { status: 'done', provider: `anthropic:${MODEL()}`, raw: parsed, ...postProcess(target, parsed) };
  } catch (e) {
    return { status: 'failed', error: 'AI 분석 실패: ' + e.message };
  }
}

const field = (f, extra = {}) => ({
  key: f.key, label: f.label || null, text: f.text ?? null, value: f.value ?? null, unit: f.unit || null,
  confidence: Number(f.confidence ?? 0), bbox: Array.isArray(f.bbox) ? f.bbox.map(Number) : null, page: f.page || 1,
  original_value: f.value ?? null, status: 'pending', notes: [], ...extra,
});

// 규칙 기반 재검증 (AI 결과를 그대로 믿지 않는다) — 테스트 가능하도록 분리
export function postProcess(target, parsed) {
  const unreadable = parsed.unreadable || [];
  if (target === 'panel') {
    const breakers = (parsed.breakers || []).map((b, i) => {
      const f = b.fields || {};
      const fromText = parseBreakerText(b.text || '');
      const notes = [];
      for (const k of ['af', 'at', 'sens_ma', 'ka', 'poles']) {
        if (f[k] != null && fromText[k] != null && Number(f[k]) !== Number(fromText[k])) notes.push(`${k.toUpperCase()} 값이 원문(${b.text})과 다름 — 원문 기준 ${fromText[k]}`);
        if (f[k] == null && fromText[k] != null) f[k] = fromText[k];
      }
      notes.push(...checkBreaker({ ...f }));
      let conf = Number(b.confidence ?? 0);
      if (notes.length) conf = Math.min(conf, 0.5);
      return { idx: i, role: b.role || 'unknown', text: b.text || null, label: b.label || null, spare: !!b.spare,
        bbox: b.bbox || null, confidence: conf, fields: f, original: { ...(b.fields || {}) }, notes, status: 'pending',
        needs_confirm: conf < LOW_CONF || notes.length > 0 };
    });
    const findings = (parsed.findings || []).map((x) => ({ desc: x.desc, bbox: x.bbox || null, confidence: Number(x.confidence ?? 0) }));
    return { fields: breakers, findings, unreadable };
  }
  const fields = (parsed.fields || []).map((f) => {
    const out = field(f);
    if (target === 'nameplate') {
      const cls = classifyNameplateLine(f.label, f.text ?? `${f.value}${f.unit || ''}`);
      if (cls && f.key === 'power' && cls.field !== 'power') { out.notes.push(`항목명 "${f.label}" 기준으로 ${cls.field}로 재분류(소비전력 아님)`); out.key = cls.field.replace('_kw', ''); out.confidence = Math.min(out.confidence, 0.5); }
    }
    if (target === 'bill' || target === 'meter') {
      const q = parseQuantity(f.text);
      if (f.key === 'max_demand_kw' && q?.unit === 'kWh') { out.notes.push('kWh(사용량) 값은 최대수요전력(kW)이 아님 — 제외'); out.value = null; out.status = 'rejected'; }
      if (f.key === 'usage_kwh' && q?.unit === 'kW') { out.notes.push('kW 값은 월 사용량(kWh)이 아님 — 확인 필요'); out.confidence = Math.min(out.confidence, 0.4); }
      if (f.key === 'customer_no') out.sensitive = true;
    }
    out.needs_confirm = out.confidence < LOW_CONF || out.notes.length > 0;
    return out;
  });
  return { fields, findings: [], unreadable };
}
