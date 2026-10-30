'use strict';
/**
 * 고객관리 — 영업 단계, 이용 계약(전자서명), 과금·수납, 상담
 *   SS-ERP 계약은 체결 후 기존 라이선스 발급(/customers/:id/licenses)으로 이어진다.
 *   검측서류·예정공정표는 계약·과금만 관리한다.
 */
const crypto = require('crypto');
const L = require('./license');

const PRODUCTS = ['SS-ERP', '검측서류 자동작성', '예정공정표 작성'];
const STAGES = ['리드', '상담', '데모', '제안·견적', '계약', '운영중', '해지'];
const BILL_METHODS = { '연간 선납': 1, '반기 분납': 2, '분기 분납': 4, '월 분납': 12 };
const PAY_METHODS = ['계좌이체', 'CMS 자동이체', '카드 자동결제', '가상계좌', '기타'];
const TICKET_TYPES = ['상담', '도입문의', '장애', '기능요청', '커스터마이징', '교육', '기타'];
const TICKET_STATES = ['접수', '처리중', '완료'];

const DEFAULT_CONFIG = {
  provider: { name: '㈜에스에스전력', bizNo: '220-86-60440', ceo: '김세인', address: '', phone: '', email: '', bank: '' },
  plans: [
    { id: 'erp-basic', product: 'SS-ERP', name: '베이직', hosting: 1800000, install: 1500000, setup: 1000000, seats: 5, perSeat: 120000 },
    { id: 'erp-std', product: 'SS-ERP', name: '스탠다드', hosting: 3600000, install: 3000000, setup: 1500000, seats: 15, perSeat: 100000 },
    { id: 'erp-pro', product: 'SS-ERP', name: '프로', hosting: 6000000, install: 5000000, setup: 2000000, seats: 30, perSeat: 80000 },
    { id: 'gm-std', product: '검측서류 자동작성', name: '기본', hosting: 600000, install: 500000, setup: 300000, seats: 3, perSeat: 100000 },
    { id: 'gj-std', product: '예정공정표 작성', name: '기본', hosting: 480000, install: 400000, setup: 300000, seats: 3, perSeat: 80000 },
  ],
  options: [
    { id: 'taxinv', name: '전자세금계산서 발행 연동', price: 600000, once: false, product: 'SS-ERP' },
    { id: 'migrate', name: '기존 데이터 이전', price: 500000, once: true, product: '' },
    { id: 'train', name: '방문 교육(1회)', price: 300000, once: true, product: '' },
    { id: 'custom', name: '커스터마이징 개발', price: 0, once: true, product: '' },
  ],
  lateDays: 30,
  examplePrices: true,
};

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
const ymd = (d) => (d ? (d instanceof Date ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const t = (v, n = 200) => (v == null ? null : String(v).trim().slice(0, n) || null);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
function addMonths(s, m) {
  const [y, mo, d] = s.split('-').map(Number);
  const x = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d, last));
  return x.toISOString().slice(0, 10);
}

/** 이용료 계산 — 요금제 기본료 + 추가 사용자 + 옵션, 설치형은 구축비 1회 */
function calcFee(c, cfg) {
  const p = cfg.plans.find((x) => x.id === c.planId);
  if (!p) return { annual: 0, once: int(c.extraOnce), detail: [] };
  const base = int(c.deployment === 'ONPREM' ? p.install : p.hosting);
  const extra = Math.max(0, int(c.seats) - int(p.seats));
  const detail = [{ name: `기본 이용료 (${p.name}, ${c.deployment === 'ONPREM' ? '설치형' : '호스팅형'})`, amount: base, once: false }];
  if (extra) detail.push({ name: `추가 사용자 ${extra}명`, amount: extra * int(p.perSeat), once: false });
  for (const id of c.options) {
    const o = cfg.options.find((x) => x.id === id);
    if (o) detail.push({ name: o.name, amount: int(o.price), once: !!o.once });
  }
  if (c.deployment === 'ONPREM' && int(p.setup)) detail.push({ name: '설치형 초기 구축비', amount: int(p.setup), once: true });
  if (int(c.extraOnce)) detail.push({ name: '별도 1회 비용', amount: int(c.extraOnce), once: true });
  let annual = detail.filter((x) => !x.once).reduce((a, x) => a + x.amount, 0);
  if (c.discount) annual = Math.round((annual * (100 - c.discount)) / 100 / 1000) * 1000;
  return { annual, once: detail.filter((x) => x.once).reduce((a, x) => a + x.amount, 0), detail, planName: p.name };
}

/** 청구 상태 — 날짜로 판단하므로 저장하지 않는다 */
function invState(i, today = L.kstToday()) {
  if (i.canceled) return '취소';
  const paid = Number(i.paid), total = Number(i.total);
  if (total > 0 && paid >= total) return '완납';
  if (ymd(i.due_date) < today) return paid > 0 ? '연체(부분)' : '연체';
  if (paid > 0) return '부분입금';
  return i.billed ? '청구' : '예정';
}
const unpaid = (i) => (['완납', '취소'].includes(invState(i)) ? 0 : Math.max(0, Number(i.total) - Number(i.paid)));

/** 계약 상태(표시용) — 체결 후 종료일이 지나면 '만료' */
function conState(c, today = L.kstToday()) {
  if (c.status === 'SIGNED' && ymd(c.ends_on) < today) return 'EXPIRED';
  return c.status;
}

module.exports = function mountCrm(admin, { q, audit, wrap, bad, loadCustomer }) {
  const config = async () => {
    const [r] = (await q(`select value from portal_setting where key = 'crm_config'`)).rows;
    return r ? JSON.parse(r.value) : DEFAULT_CONFIG;
  };
  const uuid = (id, what) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw bad(`${what}을(를) 찾을 수 없습니다`, 404); return id; };
  const nextNo = async (table, prefix) => {
    const p = `${prefix}-${L.kstToday().slice(0, 4)}-`;
    const [r] = (await q(`select max(substring(no from ${p.length + 1})::int) as n from ${table} where no like $1`, [p + '%'])).rows;
    return p + String((r.n ?? 0) + 1).padStart(3, '0');
  };

  // ── 요금제·공급자 설정 ──
  admin.get('/crm/config', wrap(async (req, res) => {
    const [r] = (await q(`select 1 from portal_setting where key = 'crm_config'`)).rows;
    res.json({ ...(await config()), saved: !!r, lists: { PRODUCTS, STAGES, BILL_METHODS, PAY_METHODS, TICKET_TYPES, TICKET_STATES } });
  }));
  admin.put('/crm/config', wrap(async (req, res) => {
    const b = req.body ?? {};
    const plans = (Array.isArray(b.plans) ? b.plans : []).map((p) => ({
      id: t(p.id, 40) ?? crypto.randomUUID().slice(0, 8), product: PRODUCTS.includes(p.product) ? p.product : 'SS-ERP', name: t(p.name, 40) ?? '요금제',
      hosting: int(p.hosting), install: int(p.install), setup: int(p.setup), seats: Math.max(1, int(p.seats, 1)), perSeat: int(p.perSeat),
    }));
    if (!plans.length) throw bad('요금제를 하나 이상 남겨 주세요');
    const options = (Array.isArray(b.options) ? b.options : []).map((o) => ({
      id: t(o.id, 40) ?? crypto.randomUUID().slice(0, 8), name: t(o.name, 60) ?? '옵션', price: int(o.price), once: !!o.once, product: PRODUCTS.includes(o.product) ? o.product : '',
    }));
    const pv = b.provider ?? {};
    const provider = Object.fromEntries(['name', 'bizNo', 'ceo', 'address', 'phone', 'email', 'bank'].map((k) => [k, t(pv[k], 200) ?? '']));
    const value = { provider, plans, options, lateDays: Math.max(1, int(b.lateDays, 30)), examplePrices: !!b.examplePrices };
    await q(`insert into portal_setting(key, value) values ('crm_config', $1) on conflict (key) do update set value = excluded.value, updated_at = now()`, [JSON.stringify(value)]);
    audit(req, 'CRM_CONFIG', '요금제·공급자 설정 저장');
    res.json({ ok: true });
  }));

  // ── 고객 영업 정보 ──
  const stageOf = (r) => r.stage ?? (r.has_license ? '운영중' : '리드');
  admin.get('/crm/customers', wrap(async (req, res) => {
    const rows = (await q(`select c.id, c.name, c.biz_reg_no, c.ceo_name, c.contact_name, c.phone, c.email, c.deployment, c.stage, c.address, c.industry, c.lead_source,
      exists(select 1 from license l where l.customer_id = c.id) as has_license from customer c order by c.name`)).rows;
    res.json(rows.map((r) => ({ id: r.id, name: r.name, bizRegNo: r.biz_reg_no, ceoName: r.ceo_name, contactName: r.contact_name, phone: r.phone, email: r.email,
      deployment: r.deployment, stage: stageOf(r), address: r.address, industry: r.industry, source: r.lead_source })));
  }));
  admin.put('/customers/:id/crm', wrap(async (req, res) => {
    const c = await loadCustomer(req.params.id);
    const b = req.body ?? {};
    if (b.stage && !STAGES.includes(b.stage)) throw bad('영업 단계가 올바르지 않습니다');
    await q('update customer set stage=$2, address=$3, industry=$4, lead_source=$5, updated_at=now() where id=$1', [c.id, b.stage || null, t(b.address, 300), t(b.industry, 100), t(b.source, 50)]);
    audit(req, 'CRM_CUSTOMER', `영업 정보 수정 ${c.name}${b.stage ? ' → ' + b.stage : ''}`);
    res.json({ ok: true });
  }));

  // ── 계약 ──
  const shapeContract = (r) => ({
    id: r.id, no: r.no, customerId: r.customer_id, customerName: r.customer_name, product: r.product, deployment: r.deployment, planId: r.plan_id, planName: r.plan_name,
    seats: r.seats, options: r.options, startsOn: ymd(r.starts_on), endsOn: ymd(r.ends_on), billMethod: r.bill_method, payMethod: r.pay_method, payDays: r.pay_days,
    autoRenew: r.auto_renew, discount: r.discount, extraOnce: Number(r.extra_once), annualFee: Number(r.annual_fee), onceFee: Number(r.once_fee), feeDetail: r.fee_detail,
    special: r.special, status: r.status, state: conState(r), signatures: r.signatures, docHash: r.doc_hash, signedAt: r.signed_at, terminatedOn: ymd(r.terminated_on),
    renewOf: r.renew_of, licenseRowId: r.license_row_id, invoiceCount: Number(r.invoice_count ?? 0), createdAt: r.created_at,
  });
  const CONTRACT_SQL = `select k.*, c.name as customer_name, (select count(*) from invoice i where i.contract_id = k.id) as invoice_count from contract k join customer c on c.id = k.customer_id`;
  const loadContract = async (id) => {
    const [r] = (await q(CONTRACT_SQL + ' where k.id = $1', [uuid(id, '계약')])).rows;
    if (!r) throw bad('계약을 찾을 수 없습니다', 404);
    return r;
  };

  const contractFields = async (b, cfg) => {
    const f = {
      product: PRODUCTS.includes(b.product) ? b.product : 'SS-ERP',
      deployment: b.deployment === 'ONPREM' ? 'ONPREM' : 'HOSTED',
      planId: t(b.planId, 40), seats: Math.max(1, int(b.seats, 1)),
      options: (Array.isArray(b.options) ? b.options : []).map(String).filter((id) => cfg.options.some((o) => o.id === id)),
      startsOn: b.startsOn, endsOn: b.endsOn,
      billMethod: BILL_METHODS[b.billMethod] ? b.billMethod : '연간 선납',
      payMethod: PAY_METHODS.includes(b.payMethod) ? b.payMethod : '계좌이체',
      payDays: Math.min(120, Math.max(0, int(b.payDays, 14))), autoRenew: b.autoRenew !== false,
      discount: Math.min(100, Math.max(0, int(b.discount))), extraOnce: Math.max(0, int(b.extraOnce)), special: t(b.special, 4000),
    };
    if (!isDate(f.startsOn) || !isDate(f.endsOn)) throw bad('계약 기간을 입력해 주세요');
    if (f.endsOn < f.startsOn) throw bad('종료일이 시작일보다 이릅니다');
    if (!cfg.plans.some((p) => p.id === f.planId && p.product === f.product)) throw bad('요금제를 골라 주세요');
    return { ...f, fee: calcFee(f, cfg) };
  };

  admin.get('/contracts', wrap(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.customerId) { params.push(uuid(String(req.query.customerId), '고객')); where = ' where k.customer_id = $1'; }
    res.json((await q(CONTRACT_SQL + where + ' order by k.no desc', params)).rows.map(({ signatures, ...r }) => ({ ...shapeContract({ ...r, signatures: {} }), signed: { provider: !!signatures.provider, customer: !!signatures.customer } })));
  }));

  admin.get('/contracts/:id', wrap(async (req, res) => {
    const k = shapeContract(await loadContract(req.params.id));
    const c = await loadCustomer(k.customerId);
    res.json({ ...k, customer: { name: c.name, bizRegNo: c.biz_reg_no, ceoName: c.ceo_name, address: c.address, deployment: c.deployment, hasLicense: !!c.license_id, licenseKind: c.lic_kind }, config: await config() });
  }));

  admin.post('/contracts', wrap(async (req, res) => {
    const b = req.body ?? {};
    const c = await loadCustomer(String(b.customerId ?? ''));
    const f = await contractFields(b, await config());
    const no = await nextNo('contract', 'SS-C');
    const { rows: [r] } = await q(
      `insert into contract(no, customer_id, product, deployment, plan_id, plan_name, seats, options, starts_on, ends_on, bill_method, pay_method, pay_days, auto_renew, discount, extra_once, annual_fee, once_fee, fee_detail, special, renew_of)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning id`,
      [no, c.id, f.product, f.deployment, f.planId, f.fee.planName, f.seats, JSON.stringify(f.options), f.startsOn, f.endsOn, f.billMethod, f.payMethod, f.payDays, f.autoRenew, f.discount, f.extraOnce, f.fee.annual, f.fee.once, JSON.stringify(f.fee.detail), f.special, b.renewOf && /^[0-9a-f-]{36}$/i.test(b.renewOf) ? b.renewOf : null],
    );
    if (['리드', '상담', '데모'].includes(c.stage ?? (c.license_id ? '운영중' : '리드'))) await q(`update customer set stage = '제안·견적' where id = $1`, [c.id]);
    audit(req, 'CONTRACT_CREATE', `계약서 작성 ${no} ${c.name} ${f.product} 연 ${f.fee.annual.toLocaleString('ko-KR')}원`);
    res.status(201).json({ id: r.id, no });
  }));

  admin.put('/contracts/:id', wrap(async (req, res) => {
    const k = await loadContract(req.params.id);
    if (k.status === 'SIGNED' || k.status === 'TERMINATED') throw bad('체결된 계약은 고칠 수 없습니다. 갱신 계약을 새로 만들어 주세요');
    const f = await contractFields(req.body ?? {}, await config());
    // 내용이 바뀌면 받은 서명은 무효 — 처음부터 다시 서명
    await q(
      `update contract set product=$2, deployment=$3, plan_id=$4, plan_name=$5, seats=$6, options=$7, starts_on=$8, ends_on=$9, bill_method=$10, pay_method=$11, pay_days=$12, auto_renew=$13,
       discount=$14, extra_once=$15, annual_fee=$16, once_fee=$17, fee_detail=$18, special=$19, status='DRAFT', signatures='{}', updated_at=now() where id=$1`,
      [k.id, f.product, f.deployment, f.planId, f.fee.planName, f.seats, JSON.stringify(f.options), f.startsOn, f.endsOn, f.billMethod, f.payMethod, f.payDays, f.autoRenew, f.discount, f.extraOnce, f.fee.annual, f.fee.once, JSON.stringify(f.fee.detail), f.special],
    );
    audit(req, 'CONTRACT_UPDATE', `계약서 수정 ${k.no} (서명 초기화)`);
    res.json({ ok: true });
  }));

  admin.delete('/contracts/:id', wrap(async (req, res) => {
    const k = await loadContract(req.params.id);
    if (k.status === 'SIGNED' || k.status === 'TERMINATED') throw bad('체결된 계약은 지울 수 없습니다');
    await q('delete from contract where id = $1', [k.id]);
    audit(req, 'CONTRACT_DELETE', `계약서 삭제 ${k.no}`);
    res.json({ ok: true });
  }));

  /** 전자서명 — 양측 서명이 모이면 체결, 계약 내용과 서명으로 문서 해시를 남긴다 */
  admin.post('/contracts/:id/sign', wrap(async (req, res) => {
    const k = await loadContract(req.params.id);
    if (k.status === 'SIGNED' || k.status === 'TERMINATED') throw bad('이미 체결된 계약입니다');
    const b = req.body ?? {};
    const who = b.who === 'customer' ? 'customer' : b.who === 'provider' ? 'provider' : null;
    if (!who) throw bad('서명 당사자가 올바르지 않습니다');
    const name = t(b.name, 50);
    if (!name) throw bad('서명자 성명을 입력해 주세요');
    const image = String(b.image ?? '');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 60000) throw bad('서명 이미지가 올바르지 않습니다');
    if (b.agree !== true) throw bad('계약 내용 동의가 필요합니다');
    const sigs = { ...k.signatures, [who]: { name, image, method: t(b.method, 40) ?? '대면 서명', at: new Date().toISOString(), ip: req.ip ?? null } };
    let status = 'PENDING', hash = null, signedAt = null;
    if (sigs.provider && sigs.customer) {
      status = 'SIGNED';
      signedAt = new Date().toISOString();
      const terms = shapeContract({ ...k, signatures: {} });
      const body = JSON.stringify({ no: terms.no, customerId: terms.customerId, product: terms.product, deployment: terms.deployment, planName: terms.planName, seats: terms.seats,
        startsOn: terms.startsOn, endsOn: terms.endsOn, billMethod: terms.billMethod, payMethod: terms.payMethod, payDays: terms.payDays, autoRenew: terms.autoRenew,
        annualFee: terms.annualFee, onceFee: terms.onceFee, feeDetail: terms.feeDetail, special: terms.special, signatures: sigs, signedAt });
      hash = crypto.createHash('sha256').update(body).digest('hex');
    }
    await q('update contract set signatures=$2, status=$3, doc_hash=$4, signed_at=$5, updated_at=now() where id=$1', [k.id, sigs, status, hash, signedAt]);
    if (status === 'SIGNED') await q(`update customer set stage = '운영중' where id = $1`, [k.customer_id]);
    audit(req, 'CONTRACT_SIGN', `${who === 'provider' ? '공급자' : '이용자'} 서명 ${k.no} (${name})${status === 'SIGNED' ? ' — 체결' : ''}`);
    res.json({ status, docHash: hash });
  }));

  admin.post('/contracts/:id/terminate', wrap(async (req, res) => {
    const k = await loadContract(req.params.id);
    if (k.status !== 'SIGNED') throw bad('체결된 계약만 해지할 수 있습니다');
    await q(`update contract set status='TERMINATED', terminated_on=$2, updated_at=now() where id=$1`, [k.id, L.kstToday()]);
    const [{ n }] = (await q(`select count(*)::int as n from contract where customer_id=$1 and status='SIGNED' and ends_on >= $2`, [k.customer_id, L.kstToday()])).rows;
    if (!n) await q(`update customer set stage = '해지' where id = $1`, [k.customer_id]);
    audit(req, 'CONTRACT_TERMINATE', `계약 해지 ${k.no} ${k.customer_name}`);
    res.json({ ok: true });
  }));

  /** 갱신 계약 — 같은 조건으로 다음 1년, 1회성 비용은 빼고 지금 요금표로 다시 계산 */
  admin.post('/contracts/:id/renew', wrap(async (req, res) => {
    const k = shapeContract(await loadContract(req.params.id));
    if (k.status !== 'SIGNED') throw bad('체결된 계약만 갱신할 수 있습니다');
    const cfg = await config();
    const startsOn = L.addDays(k.endsOn, 1);
    const f = await contractFields({ ...k, options: k.options.filter((id) => !cfg.options.find((o) => o.id === id)?.once), extraOnce: 0, startsOn, endsOn: L.oneYearFrom(startsOn) }, cfg);
    const no = await nextNo('contract', 'SS-C');
    const { rows: [r] } = await q(
      `insert into contract(no, customer_id, product, deployment, plan_id, plan_name, seats, options, starts_on, ends_on, bill_method, pay_method, pay_days, auto_renew, discount, extra_once, annual_fee, once_fee, fee_detail, special, renew_of)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,$16,0,$17,$18,$19) returning id`,
      [no, k.customerId, f.product, f.deployment, f.planId, f.fee.planName, f.seats, JSON.stringify(f.options), f.startsOn, f.endsOn, f.billMethod, f.payMethod, f.payDays, f.autoRenew, f.discount, f.fee.annual, JSON.stringify(f.fee.detail.filter((x) => !x.once)), f.special, k.id],
    );
    audit(req, 'CONTRACT_CREATE', `갱신 계약서 작성 ${no} (${k.no} 갱신)`);
    res.status(201).json({ id: r.id, no });
  }));

  /** 이 계약으로 발급한 라이선스를 기록 (발급은 기존 라이선스 발급 기능으로) */
  admin.post('/contracts/:id/license', wrap(async (req, res) => {
    const k = await loadContract(req.params.id);
    const lid = uuid(String(req.body?.licenseRowId ?? ''), '라이선스');
    const [l] = (await q('select id from license where id = $1 and customer_id = $2', [lid, k.customer_id])).rows;
    if (!l) throw bad('이 고객의 라이선스가 아닙니다');
    await q('update contract set license_row_id = $2, updated_at = now() where id = $1', [k.id, lid]);
    res.json({ ok: true });
  }));

  /** 청구 일정 생성 — 과금 방법에 따라 회차별로 나누고, 1회성 비용은 첫 회차에 */
  admin.post('/contracts/:id/invoices', wrap(async (req, res) => {
    const k = shapeContract(await loadContract(req.params.id));
    if (k.status !== 'SIGNED') throw bad('체결된 계약만 청구를 만들 수 있습니다');
    if (k.invoiceCount) throw bad('이미 청구 일정이 있습니다');
    const n = BILL_METHODS[k.billMethod] ?? 1;
    const step = 12 / n;
    const per = Math.round(k.annualFee / n);
    const made = [];
    for (let i = 0; i < n; i++) {
      const issue = addMonths(k.startsOn, i * step);
      let supply = i === n - 1 ? k.annualFee - per * (n - 1) : per;
      let period = `${k.product} 이용료 ${n > 1 ? `${i + 1}/${n}회차` : '연간'} (${issue} ~ ${L.addDays(addMonths(k.startsOn, (i + 1) * step), -1)})`;
      if (i === 0 && k.onceFee) { supply += k.onceFee; period += ' + 1회성 비용'; }
      const vat = Math.round(supply * 0.1);
      const no = await nextNo('invoice', 'SS-B');
      await q(`insert into invoice(no, customer_id, contract_id, period, issue_date, due_date, supply, vat, total, pay_method) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [no, k.customerId, k.id, period, issue, L.addDays(issue, k.payDays), supply, vat, supply + vat, k.payMethod]);
      made.push(no);
    }
    audit(req, 'INVOICE_SCHEDULE', `청구 일정 생성 ${k.no} ${n}회`);
    res.status(201).json({ count: made.length });
  }));

  // ── 청구·수납 ──
  const shapeInvoice = (r) => ({
    id: r.id, no: r.no, customerId: r.customer_id, customerName: r.customer_name, bizRegNo: r.biz_reg_no, contractId: r.contract_id, contractNo: r.contract_no,
    period: r.period, issueDate: ymd(r.issue_date), dueDate: ymd(r.due_date), supply: Number(r.supply), vat: Number(r.vat), total: Number(r.total), paid: Number(r.paid),
    paidAt: ymd(r.paid_at), payments: r.payments, payMethod: r.pay_method, taxInvoice: r.tax_invoice, billed: r.billed, canceled: r.canceled, memo: r.memo,
    state: invState(r), unpaid: unpaid(r), overdueDays: ['연체', '연체(부분)'].includes(invState(r)) ? daysBetween(ymd(r.due_date), L.kstToday()) : 0,
  });
  const INVOICE_SQL = `select i.*, c.name as customer_name, c.biz_reg_no, k.no as contract_no from invoice i join customer c on c.id = i.customer_id left join contract k on k.id = i.contract_id`;
  const loadInvoice = async (id) => {
    const [r] = (await q(INVOICE_SQL + ' where i.id = $1', [uuid(id, '청구')])).rows;
    if (!r) throw bad('청구를 찾을 수 없습니다', 404);
    return r;
  };

  admin.get('/invoices', wrap(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.customerId) { params.push(uuid(String(req.query.customerId), '고객')); where = ' where i.customer_id = $1'; }
    const rows = (await q(INVOICE_SQL + where + ' order by i.due_date, i.no', params)).rows.map(shapeInvoice);
    if (req.query.format === 'csv') {
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['청구번호', '고객', '사업자등록번호', '계약번호', '청구내용', '청구일', '납기', '공급가', 'VAT', '합계', '입금액', '최근입금일', '상태', '결제수단', '세금계산서'].map(esc).join(',')];
      for (const r of rows) lines.push([r.no, r.customerName, r.bizRegNo, r.contractNo, r.period, r.issueDate, r.dueDate, r.supply, r.vat, r.total, r.paid, r.paidAt, r.state, r.payMethod, r.taxInvoice ? '발행' : '미발행'].map(esc).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`과금현황_${L.kstToday()}.csv`)}`);
      return res.send('﻿' + lines.join('\r\n'));
    }
    res.json(rows);
  }));

  const invoiceFields = (b) => {
    const supply = Math.max(0, int(b.supply));
    const f = { period: t(b.period, 200), issueDate: b.issueDate, dueDate: b.dueDate, supply, vat: Math.round(supply * 0.1), payMethod: PAY_METHODS.includes(b.payMethod) ? b.payMethod : '계좌이체',
      taxInvoice: !!b.taxInvoice, billed: !!b.billed, canceled: !!b.canceled, memo: t(b.memo, 1000) };
    if (!f.period) throw bad('청구 내용을 입력해 주세요');
    if (!isDate(f.issueDate) || !isDate(f.dueDate)) throw bad('청구일과 납기를 입력해 주세요');
    return f;
  };
  admin.post('/invoices', wrap(async (req, res) => {
    const b = req.body ?? {};
    const c = await loadCustomer(String(b.customerId ?? ''));
    const f = invoiceFields(b);
    const contractId = b.contractId ? (await loadContract(String(b.contractId))).id : null;
    const no = await nextNo('invoice', 'SS-B');
    const { rows: [r] } = await q(`insert into invoice(no, customer_id, contract_id, period, issue_date, due_date, supply, vat, total, pay_method, tax_invoice, billed, canceled, memo)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`, [no, c.id, contractId, f.period, f.issueDate, f.dueDate, f.supply, f.vat, f.supply + f.vat, f.payMethod, f.taxInvoice, f.billed, f.canceled, f.memo]);
    audit(req, 'INVOICE_CREATE', `청구 추가 ${no} ${c.name} ${(f.supply + f.vat).toLocaleString('ko-KR')}원`);
    res.status(201).json({ id: r.id, no });
  }));
  admin.put('/invoices/:id', wrap(async (req, res) => {
    const i = await loadInvoice(req.params.id);
    const f = invoiceFields(req.body ?? {});
    await q(`update invoice set period=$2, issue_date=$3, due_date=$4, supply=$5, vat=$6, total=$7, pay_method=$8, tax_invoice=$9, billed=$10, canceled=$11, memo=$12, updated_at=now() where id=$1`,
      [i.id, f.period, f.issueDate, f.dueDate, f.supply, f.vat, f.supply + f.vat, f.payMethod, f.taxInvoice, f.billed, f.canceled, f.memo]);
    audit(req, 'INVOICE_UPDATE', `청구 수정 ${i.no}`);
    res.json({ ok: true });
  }));
  admin.delete('/invoices/:id', wrap(async (req, res) => {
    const i = await loadInvoice(req.params.id);
    if (Number(i.paid) > 0) throw bad('입금 기록이 있는 청구는 지울 수 없습니다. 취소로 바꿔 주세요');
    await q('delete from invoice where id = $1', [i.id]);
    audit(req, 'INVOICE_DELETE', `청구 삭제 ${i.no}`);
    res.json({ ok: true });
  }));
  admin.post('/invoices/:id/pay', wrap(async (req, res) => {
    const i = await loadInvoice(req.params.id);
    const b = req.body ?? {};
    const amount = int(b.amount);
    if (amount <= 0) throw bad('입금액을 입력해 주세요');
    const date = isDate(b.date) ? b.date : L.kstToday();
    const payments = [...i.payments, { amount, date, method: PAY_METHODS.includes(b.method) ? b.method : i.pay_method, payer: t(b.payer, 50) }];
    await q('update invoice set paid = paid + $2, paid_at = $3, payments = $4, billed = true, tax_invoice = $5, updated_at = now() where id = $1', [i.id, amount, date, JSON.stringify(payments), !!b.taxInvoice || i.tax_invoice]);
    audit(req, 'INVOICE_PAY', `입금 반영 ${i.no} ${i.customer_name} ${amount.toLocaleString('ko-KR')}원`);
    res.json({ ok: true });
  }));

  // ── 상담·지원 ──
  const shapeTicket = (r) => ({ id: r.id, customerId: r.customer_id, customerName: r.customer_name, type: r.type, title: r.title, body: r.body, openedOn: ymd(r.opened_on), dueOn: ymd(r.due_on), status: r.status, owner: r.owner });
  const ticketFields = (b) => {
    const f = { type: TICKET_TYPES.includes(b.type) ? b.type : '상담', title: t(b.title, 200), body: t(b.body, 4000), openedOn: isDate(b.openedOn) ? b.openedOn : L.kstToday(),
      dueOn: isDate(b.dueOn) ? b.dueOn : null, status: TICKET_STATES.includes(b.status) ? b.status : '접수', owner: t(b.owner, 50) };
    if (!f.title) throw bad('제목을 입력해 주세요');
    return f;
  };
  admin.get('/tickets', wrap(async (req, res) => {
    const params = [];
    let where = '';
    if (req.query.customerId) { params.push(uuid(String(req.query.customerId), '고객')); where = ' where t.customer_id = $1'; }
    res.json((await q(`select t.*, c.name as customer_name from ticket t join customer c on c.id = t.customer_id${where} order by t.opened_on desc, t.created_at desc limit 1000`, params)).rows.map(shapeTicket));
  }));
  admin.post('/tickets', wrap(async (req, res) => {
    const b = req.body ?? {};
    const c = await loadCustomer(String(b.customerId ?? ''));
    const f = ticketFields(b);
    const { rows: [r] } = await q(`insert into ticket(customer_id, type, title, body, opened_on, due_on, status, owner) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [c.id, f.type, f.title, f.body, f.openedOn, f.dueOn, f.status, f.owner]);
    audit(req, 'TICKET_CREATE', `상담 기록 ${c.name} · ${f.title}`);
    res.status(201).json({ id: r.id });
  }));
  admin.put('/tickets/:id', wrap(async (req, res) => {
    const f = ticketFields(req.body ?? {});
    const r = await q(`update ticket set type=$2, title=$3, body=$4, opened_on=$5, due_on=$6, status=$7, owner=$8, updated_at=now() where id=$1`,
      [uuid(req.params.id, '상담'), f.type, f.title, f.body, f.openedOn, f.dueOn, f.status, f.owner]);
    if (!r.rowCount) throw bad('상담을 찾을 수 없습니다', 404);
    res.json({ ok: true });
  }));
  admin.delete('/tickets/:id', wrap(async (req, res) => {
    await q('delete from ticket where id = $1', [uuid(req.params.id, '상담')]);
    res.json({ ok: true });
  }));

  // ── 영업·과금 현황 (대시보드) ──
  admin.get('/crm/summary', wrap(async (req, res) => {
    const today = L.kstToday();
    const ym = today.slice(0, 7);
    const cons = (await q(CONTRACT_SQL)).rows.map(shapeContract);
    const invs = (await q(INVOICE_SQL)).rows.map(shapeInvoice);
    const active = cons.filter((k) => k.state === 'SIGNED');
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(addMonths(ym + '-01', -i).slice(0, 7));
    const paidBy = months.map((m) => invs.reduce((a, i) => a + i.payments.filter((p) => String(p.date).startsWith(m)).reduce((s, p) => s + Number(p.amount), 0), 0));
    const stageRows = (await q(`select c.stage, exists(select 1 from license l where l.customer_id = c.id) as has_license from customer c`)).rows;
    const tickets = (await q(`select t.*, c.name as customer_name from ticket t join customer c on c.id = t.customer_id where t.status <> '완료' order by coalesce(t.due_on, '9999-12-31'), t.opened_on limit 6`)).rows.map(shapeTicket);
    const thisMonth = invs.filter((i) => i.dueDate.startsWith(ym) && !i.canceled);
    const overdue = invs.filter((i) => i.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays);
    res.json({
      arr: active.reduce((a, k) => a + k.annualFee, 0), activeContracts: active.length,
      dueThisMonth: { count: thisMonth.length, total: thisMonth.reduce((a, i) => a + i.total, 0) },
      receivable: invs.reduce((a, i) => a + i.unpaid, 0),
      overdue: { count: overdue.length, total: overdue.reduce((a, i) => a + i.unpaid, 0), list: overdue.slice(0, 6) },
      renewals: cons.filter((k) => (k.state === 'SIGNED' && daysBetween(today, k.endsOn) <= 90) || (k.state === 'EXPIRED' && !cons.some((x) => x.renewOf === k.id))).sort((a, b) => a.endsOn.localeCompare(b.endsOn)).map((k) => ({ id: k.id, no: k.no, customerId: k.customerId, customerName: k.customerName, product: k.product, endsOn: k.endsOn, daysLeft: daysBetween(today, k.endsOn), autoRenew: k.autoRenew })),
      pending: cons.filter((k) => k.status === 'PENDING' || k.status === 'DRAFT').length,
      pipeline: STAGES.map((s) => [s, stageRows.filter((r) => stageOf(r) === s).length]),
      byProduct: PRODUCTS.map((p) => ({ product: p, count: active.filter((k) => k.product === p).length, annual: active.filter((k) => k.product === p).reduce((a, k) => a + k.annualFee, 0) })),
      monthly: months.map((m, i) => ({ month: m, paid: paidBy[i] })),
      openTickets: tickets,
      lateDays: (await config()).lateDays,
    });
  }));
};

module.exports.calcFee = calcFee;
module.exports.addMonths = addMonths;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
