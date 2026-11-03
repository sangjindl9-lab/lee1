// 단위 해석: 사진·고지서 추출 원문이나 사용자 입력에서 값과 단위를 정확히 구분한다.
// W/kW, kW/kWh, AF/AT, A/mA/kA 혼동을 막는 것이 목적이다.

const num = (s) => {
  if (s == null) return null;
  const v = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(v) ? v : null;
};

// "1,234 kWh" → { value: 1234, unit: 'kWh' }
export function parseQuantity(text) {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  const m = s.match(/(-?[\d,]*\.?\d+)\s*(kWh|MWh|Wh|kVA|VA|kW|MW|W|mA|kA|AF|AT|A|kV|V|Hz|mm²|mm2|sq|SQ|%)?/i);
  if (!m) return null;
  const value = num(m[1]);
  if (value == null) return null;
  let unit = m[2] || null;
  if (unit) {
    const u = unit.toLowerCase();
    const map = { kwh: 'kWh', mwh: 'MWh', wh: 'Wh', kva: 'kVA', va: 'VA', kw: 'kW', mw: 'MW', w: 'W',
      ma: 'mA', ka: 'kA', af: 'AF', at: 'AT', a: 'A', kv: 'kV', v: 'V', hz: 'Hz', 'mm²': 'mm2', mm2: 'mm2', sq: 'mm2', '%': '%' };
    unit = map[u] || unit;
  }
  return { value, unit };
}

// 전력(순간값)만 W로 변환. 에너지(kWh)는 거부한다.
export function powerToW(value, unit) {
  if (value == null || value === '') return null;
  const v = num(value);
  if (v == null) return null;
  switch (unit) {
    case 'W': return v;
    case 'kW': return v * 1000;
    case 'MW': return v * 1e6;
    case 'kWh': case 'Wh': case 'MWh':
      throw new Error(`${unit}는 전력량(에너지) 단위입니다. 순간 소비전력(W/kW)으로 사용할 수 없습니다.`);
    case 'kVA': case 'VA':
      throw new Error(`${unit}는 피상전력입니다. 역률을 알아야 유효전력(W)으로 바꿀 수 있습니다.`);
    default:
      throw new Error(`전력 단위가 필요합니다(W 또는 kW). 입력 단위: ${unit ?? '없음'}`);
  }
}

// 차단기 명판 문자열에서 AF·AT·감도전류(mA)·차단용량(kA)·극수·전압을 서로 다른 칸으로 분리.
// 예: "ELB 2P 50AF 30AT 30mA 2.5kA 220V"
export function parseBreakerText(text) {
  const out = { poles: null, af: null, at: null, sens_ma: null, ka: null, voltage: null, notes: [] };
  if (!text) return out;
  const s = String(text).replace(/,/g, '').toUpperCase();
  const grab = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
  out.poles = grab(/(\d)\s*P(?![A-Z])/);
  out.af = grab(/(\d+(?:\.\d+)?)\s*AF\b/) ?? grab(/\bAF\s*(\d+(?:\.\d+)?)/);
  out.at = grab(/(\d+(?:\.\d+)?)\s*AT\b/) ?? grab(/\bAT\s*(\d+(?:\.\d+)?)/);
  out.sens_ma = grab(/(\d+(?:\.\d+)?)\s*MA\b/);
  out.ka = grab(/(\d+(?:\.\d+)?)\s*KA\b/);
  out.voltage = grab(/(\d{3})\s*V\b/);
  // "In=30A"·"30A"처럼 AT 표기 없이 A만 있을 때: mA/kA로 끝나는 숫자는 제외
  if (out.at == null) {
    const m = s.match(/(?:IN\s*=?\s*)?(\d+(?:\.\d+)?)\s*A\b(?!F|T)/);
    if (m) { out.at = Number(m[1]); out.notes.push('정격전류를 "A" 표기에서 읽음(AT 표기 없음)'); }
  }
  return out;
}

// 추출값 상호 검증. 잘못 읽었을 가능성이 높은 조합을 표시한다.
export function checkBreaker(b) {
  const issues = [];
  if (b.af != null && b.at != null && b.at > b.af) issues.push('AT(정격전류)가 AF(프레임)보다 큽니다. AF와 AT가 바뀌어 읽혔을 수 있습니다.');
  if (b.at != null && b.sens_ma != null && b.at === b.sens_ma) issues.push('정격전류와 감도전류 숫자가 같습니다. mA 값을 정격전류(A)로 읽지 않았는지 확인하세요.');
  if (b.at == null && b.af != null) issues.push('AF(프레임 정격)만 확인됨 — 실제 정격전류(AT)를 확인해야 합니다.');
  if (b.adjustable && b.set_current == null) issues.push('조정형 차단기: 표시 정격과 실제 설정값이 다를 수 있습니다. 설정값을 확인하세요.');
  return issues;
}

// 기기 명판: 소비전력(전기 입력)과 냉방·난방능력, 모터 출력을 구분
export function classifyNameplateLine(label, valueText) {
  const l = String(label || '').replace(/\s/g, '');
  const q = parseQuantity(valueText);
  if (!q) return null;
  if (/냉방능력|냉방용량|COOLING\s*CAPACITY|냉력/i.test(l)) return { field: 'cooling_capacity_kw', ...toKwField(q) };
  if (/난방능력|난방용량|HEATING\s*CAPACITY/i.test(l)) return { field: 'heating_capacity_kw', ...toKwField(q) };
  if (/정격출력|모터출력|출력|OUTPUT/i.test(l) && !/입력/.test(l)) return { field: 'motor_output_kw', ...toKwField(q) };
  if (/소비전력|정격입력|입력|POWER\s*INPUT|INPUT|소비전류/i.test(l)) {
    if (q.unit === 'A') return { field: 'rated_current', value: q.value, unit: 'A' };
    return { field: 'power', value: q.value, unit: q.unit };
  }
  if (/정격전류|전류|CURRENT/i.test(l)) return { field: 'rated_current', value: q.value, unit: 'A' };
  if (/전압|VOLTAGE/i.test(l)) return { field: 'voltage', value: q.value, unit: 'V' };
  return null;
}
function toKwField(q) {
  if (q.unit === 'W') return { value: q.value / 1000, unit: 'kW' };
  return { value: q.value, unit: q.unit || 'kW' };
}
