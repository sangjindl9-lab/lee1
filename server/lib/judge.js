// 측정 자동 판정: 현장별로 설정된 기준만 사용. 기준이 없거나 조건이 맞지 않으면 판정하지 않음.
const { db } = require('../db');

const COND_LABEL = { test_voltage: '시험전압', wavelength: '파장', direction: '방향' };

function judge(siteId, assetCategory, m) {
  const date = (m.measured_at || '').slice(0, 10);
  const all = db.prepare(`SELECT * FROM test_criteria WHERE site_id=? AND test_type=? AND active=1
      AND target_category IN (?, '*') AND effective_date <= ? ORDER BY (target_category='*'), effective_date DESC, version DESC`)
    .all(siteId, m.test_type, assetCategory, date || '9999-12-31');
  if (!all.length) return { result: '판정기준 미설정', reason: '이 현장에 해당 시험의 판정기준이 등록되어 있지 않습니다.', criteria: null };

  if (m.value === null || m.value === undefined || m.value === '' || Number.isNaN(Number(m.value))) {
    return { result: '판정 불가', reason: '숫자 측정값이 없어 자동 판정을 하지 않았습니다.', criteria: null };
  }

  // 조건이 모두 일치하는 기준 찾기
  const reasons = [];
  for (const c of all) {
    const cond = JSON.parse(c.conditions || '{}');
    const mismatch = Object.entries(cond).filter(([k, v]) => v !== '' && v !== null && String(m[k] ?? '') !== String(v));
    if (mismatch.length) {
      reasons.push(`기준 "${c.name}" 조건 불일치: ` + mismatch.map(([k, v]) => `${COND_LABEL[k] || k} 기준 ${v}, 측정 ${m[k] ?? '미입력'}`).join(', '));
      continue;
    }
    if ((c.unit || '').trim() !== (m.unit || '').trim()) {
      return { result: '판정 불가', reason: `단위 불일치: 기준 단위 ${c.unit}, 측정 단위 ${m.unit || '미입력'}. 단위를 맞춰 다시 등록하세요.`, criteria: c };
    }
    const v = Number(m.value), b = Number(c.value);
    const ok = { '>=': v >= b, '>': v > b, '<=': v <= b, '<': v < b, '=': v === b }[c.comparator];
    return { result: ok ? '적합' : '부적합', reason: `${v} ${m.unit} ${c.comparator} ${b} ${c.unit} (${c.name} v${c.version})`, criteria: c };
  }
  return { result: '판정 불가', reason: reasons.join(' / '), criteria: null };
}

module.exports = { judge };
