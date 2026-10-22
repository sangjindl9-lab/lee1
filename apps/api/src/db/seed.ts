/**
 * 초기 설정 / 샘플 데이터
 *
 *   npm run db:seed                    기본 세율만 등록
 *   INIT_COMPANY_NAME=... INIT_COMPANY_BIZNO=... INIT_ADMIN_ID=... INIT_ADMIN_PASSWORD=... npm run db:seed
 *                                      첫 회사와 최고관리자 생성 (설치 시 1회)
 *   SEED_DEMO=true npm run db:seed     시연용 샘플 회사·현장·거래처·사용자 생성
 */
import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { createDb, Tx } from './db';
import { budgetRevisionLines, budgetRevisions, companies, costCodes, materials, memberships, membershipRoles, projectAssignments, projectBudgets, projects, roles, taxRateSettings, users, vendors } from './schema';
import { seedDefaultRoles } from '../admin/companies';
import { ensureAccountingDefaults } from '../accounting/defaults';
import { hashPassword, checkPasswordPolicy } from '../auth/password';
import { isValidBizNo, normalizeBizNo } from '../common/bizno';
import { encryptField, maskAccount } from '../common/crypto';
import { vatFromSupply } from '../common/money';

export async function seedBase(tx: Tx) {
  // 부가가치세법 제30조: 세율 10%. 법 개정 시 관리 화면에서 새 적용기간을 추가한다
  await tx
    .insert(taxRateSettings)
    .values({ key: 'VAT', rate: '0.1000', effectiveFrom: '1977-07-01', note: '부가가치세법 제30조 (10%)', verifiedBy: '초기설정' })
    .onConflictDoNothing();
  // 기존 회사에 새 버전의 회계 기본값(계정과목·원가항목·자동분개 규칙·결재선) 보충
  for (const c of await tx.select({ id: companies.id }).from(companies)) await ensureAccountingDefaults(tx, c.id);
}

async function createCompanyWithAdmin(tx: Tx, c: { code: string; name: string; bizRegNo: string; ceoName?: string; address?: string }, admin: { loginId: string; name: string; password: string; mustChange: boolean; systemAdmin?: boolean }) {
  const [company] = await tx.insert(companies).values(c).returning();
  await seedDefaultRoles(tx, company.id);
  const [u] = await tx
    .insert(users)
    .values({ loginId: admin.loginId, name: admin.name, passwordHash: await hashPassword(admin.password), mustChangePassword: admin.mustChange, isSystemAdmin: !!admin.systemAdmin })
    .returning();
  const [m] = await tx.insert(memberships).values({ companyId: company.id, userId: u.id, department: '관리부', position: '관리자' }).returning();
  const [adminRole] = await tx.select().from(roles).where(eq(roles.companyId, company.id)).then((rs) => rs.filter((r) => r.key === 'ADMIN'));
  await tx.insert(membershipRoles).values({ membershipId: m.id, roleId: adminRole.id });
  return { company, adminUser: u };
}

async function addUser(tx: Tx, companyId: string, u: { loginId: string; name: string; dept: string; pos: string; role: string }, password: string) {
  const [user] = await tx.insert(users).values({ loginId: u.loginId, name: u.name, passwordHash: await hashPassword(password) }).returning();
  const [m] = await tx.insert(memberships).values({ companyId, userId: user.id, department: u.dept, position: u.pos }).returning();
  const [role] = (await tx.select().from(roles).where(eq(roles.companyId, companyId))).filter((r) => r.key === u.role);
  await tx.insert(membershipRoles).values({ membershipId: m.id, roleId: role.id });
  return m;
}

async function demo(tx: Tx) {
  const pw = process.env.DEMO_PASSWORD ?? 'Demo!2026erp';
  const { company } = await createCompanyWithAdmin(
    tx,
    { code: 'SS', name: '㈜에스에스전력', bizRegNo: '1018117536', ceoName: '이상진', address: '서울특별시 강서구 공항대로 000' },
    { loginId: 'admin', name: '시스템관리자', password: pw, mustChange: false },
  );
  // 두 번째 회사 — 회사 간 데이터 격리 시연용
  const other = await createCompanyWithAdmin(
    tx,
    { code: 'HN', name: '㈜한누리통신', bizRegNo: '2148839612', ceoName: '박대표' },
    { loginId: 'hn.admin', name: '한누리관리자', password: pw, mustChange: false },
  );

  const ceo = await addUser(tx, company.id, { loginId: 'ceo', name: '이상진', dept: '임원실', pos: '대표이사', role: 'CEO' }, pw);
  void ceo;
  await addUser(tx, company.id, { loginId: 'acct', name: '김회계', dept: '관리부', pos: '과장', role: 'ACCOUNTING_MANAGER' }, pw);
  await addUser(tx, company.id, { loginId: 'buyer', name: '최구매', dept: '공무부', pos: '대리', role: 'PURCHASER' }, pw);
  const site = await addUser(tx, company.id, { loginId: 'site1', name: '박소장', dept: '공사부', pos: '부장', role: 'SITE_MANAGER' }, pw);
  await addUser(tx, company.id, { loginId: 'tax', name: '정세무', dept: '외부', pos: '세무사', role: 'TAX_ACCOUNTANT' }, pw);

  const rows: Array<[string, 'ELECTRIC' | 'TELECOM' | 'BUILDING' | 'COMPLEX', 'PLANNED' | 'IN_PROGRESS' | 'SUSPENDED' | 'COMPLETED' | 'SETTLED', 'PUBLIC' | 'PRIVATE', 'PRIME' | 'SUB', string, string, string, string, string, number]> = [
    ['강서초등학교 전기설비 개선공사', 'ELECTRIC', 'IN_PROGRESS', 'PUBLIC', 'PRIME', '서울특별시강서교육지원청', '2026-03-12', '2026-03-20', '2026-11-30', '412000000', 0.62],
    ['마곡 R&D센터 정보통신공사', 'TELECOM', 'IN_PROGRESS', 'PRIVATE', 'SUB', '㈜대성건설', '2026-04-02', '2026-04-15', '2026-10-31', '268500000', 0.81],
    ['김포 물류창고 신축 전기공사', 'ELECTRIC', 'IN_PROGRESS', 'PRIVATE', 'SUB', '㈜한강종합건설', '2026-02-10', '2026-02-20', '2027-01-31', '735000000', 0.48],
    ['양천구청 CCTV 통합관제 구축', 'TELECOM', 'PLANNED', 'PUBLIC', 'PRIME', '서울특별시 양천구', '2026-10-05', '2026-11-01', '2027-03-31', '189000000', 0],
    ['화곡동 근린생활시설 리모델링', 'BUILDING', 'SUSPENDED', 'PRIVATE', 'PRIME', '김OO', '2026-05-18', '2026-06-01', '2026-12-15', '320000000', 0.27],
    ['인천공항 T2 수변전설비 교체', 'COMPLEX', 'COMPLETED', 'PUBLIC', 'SUB', '㈜동방이엔씨', '2025-08-01', '2025-08-20', '2026-06-30', '958000000', 1],
    ['등촌동 아파트 세대 LED 교체', 'ELECTRIC', 'SETTLED', 'PRIVATE', 'PRIME', '등촌OO아파트 입주자대표회의', '2025-11-03', '2025-11-10', '2026-02-28', '86400000', 1],
  ];
  let i = 0;
  for (const [name, trade, status, sector, role, client, cd, sd, pe, supply, prog] of rows) {
    i++;
    const v = vatFromSupply(supply, '0.1');
    const year = cd.slice(0, 4);
    const budget = (BigInt(supply) * BigInt(82 + (i % 4) * 3) / 100n).toString();
    const [p] = await tx
      .insert(projects)
      .values({
        companyId: company.id, code: `P${year.slice(2)}-${String(i).padStart(4, '0')}`, name, tradeType: trade, status, clientSector: sector, contractRole: role, clientName: client,
        contractDate: cd, startDate: sd, plannedEndDate: pe, actualEndDate: status === 'COMPLETED' || status === 'SETTLED' ? pe : null,
        supplyAmount: v.supply, vatAmount: v.vat, totalAmount: v.total, vatRate: '0.1000', executionBudget: budget, progressRate: prog.toFixed(4),
        siteAddress: '서울특별시 강서구', siteManagerName: i % 2 ? '박소장' : '이현장', managerName: '최공무',
      })
      .returning();
    if (i <= 2) await tx.insert(projectAssignments).values({ membershipId: site.id, projectId: p.id, roleInProject: '현장소장' });
    // 원가항목별 실행예산 (샘플: 승인 완료 상태)
    const share: Record<string, number[]> = { ELECTRIC: [52, 25, 0, 8, 3, 2, 4, 3, 2, 1], TELECOM: [45, 28, 0, 15, 2, 1, 4, 3, 1, 1], BUILDING: [40, 22, 0, 25, 4, 2, 3, 2, 1, 1], COMPLEX: [50, 24, 2, 10, 3, 2, 4, 3, 1, 1] };
    const ccs = (await tx.select().from(costCodes).where(eq(costCodes.companyId, company.id))).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 10);
    let left = BigInt(budget);
    const parts = ccs.map((c, j) => {
      const amt = j === ccs.length - 1 ? left : (BigInt(budget) * BigInt(share[trade][j])) / 100n;
      left -= amt;
      return { c, amt };
    }).filter((x) => x.amt > 0n);
    await tx.insert(projectBudgets).values(parts.map((x) => ({ companyId: company.id, projectId: p.id, costCodeId: x.c.id, amount: `${x.amt}.00` })));
    const [rev] = await tx.insert(budgetRevisions).values({ companyId: company.id, projectId: p.id, code: `BR${year.slice(2)}-${String(i).padStart(4, '0')}`, title: '최초 실행예산 편성', reason: '계약 체결 후 공종별 실행예산 편성', status: 'APPROVED', totalBefore: '0.00', totalAfter: `${budget}.00`, approvedAt: new Date(cd) }).returning();
    await tx.insert(budgetRevisionLines).values(parts.map((x) => ({ revisionId: rev.id, costCodeId: x.c.id, beforeAmount: '0.00', afterAmount: `${x.amt}.00` })));
  }
  await tx.execute(sql`insert into number_sequence (company_id, key, last_value) values (${company.id}, 'BR-2026', 7) on conflict do nothing`);
  // 번호 시퀀스를 샘플 데이터 다음 번호부터 이어가도록 맞춘다
  await tx.execute(sql`insert into number_sequence (company_id, key, last_value) values (${company.id}, 'PROJECT-2026', 7), (${company.id}, 'PROJECT-2025', 7) on conflict do nothing`);

  const vrows: Array<[string, 'SUPPLIER' | 'SUBCONTRACTOR' | 'CLIENT' | 'BOTH', string, string, string?, string?]> = [
    ['㈜LS전선 서울대리점', 'SUPPLIER', '1168119948', '김전선', '외상 30일', '110-123-456789'],
    ['대한전기자재㈜', 'SUPPLIER', '1248100998', '오자재', '월말 마감 익월 15일', '1002-345-678901'],
    ['㈜한빛통신기술', 'SUBCONTRACTOR', '1078163213', '한통신', '기성 확인 후 30일'],
    ['㈜대성건설', 'CLIENT', '1018600118', '대성'],
    ['서울특별시강서교육지원청', 'CLIENT', '1098300450', '교육장'],
  ];
  let k = 0;
  for (const [name, type, biz, ceoName, terms, acc] of vrows) {
    k++;
    await tx.insert(vendors).values({
      companyId: company.id, code: `V${String(k).padStart(5, '0')}`, name, vendorType: type, bizRegNo: isValidBizNo(biz) ? biz : null, ceoName, paymentTerms: terms ?? null,
      bankName: acc ? '국민은행' : null, bankAccountEnc: acc ? encryptField(acc) : null, bankAccountMask: acc ? maskAccount(acc) : null, bizStatus: 'UNKNOWN',
    });
  }
  await tx.execute(sql`insert into number_sequence (company_id, key, last_value) values (${company.id}, 'VENDOR', ${k}) on conflict do nothing`);

  // 자재마스터 샘플
  const mats: Array<[string, string, string, string, string, 'ELECTRIC' | 'TELECOM' | 'COMMON', string]> = [
    ['F-CV 케이블', '6sq 2C', 'LS전선', 'm', '전선', 'ELECTRIC', '1850'],
    ['F-CV 케이블', '16sq 4C', 'LS전선', 'm', '전선', 'ELECTRIC', '9800'],
    ['HFIX 전선', '2.5sq', '대한전선', 'm', '전선', 'ELECTRIC', '350'],
    ['HFIX 전선', '4sq', '대한전선', 'm', '전선', 'ELECTRIC', '560'],
    ['TFR-CV 케이블', '35sq 1C', 'LS전선', 'm', '전선', 'ELECTRIC', '6200'],
    ['전선관(HI-PVC)', '28C', '', '본', '배관', 'ELECTRIC', '3200'],
    ['전선관(ST)', '36C', '', '본', '배관', 'ELECTRIC', '12500'],
    ['풀박스', '200×200×100', '', 'EA', '배관', 'ELECTRIC', '8500'],
    ['분전반', '주 40A / 분기 20A×12', '', '면', '배전반', 'ELECTRIC', '480000'],
    ['차단기(MCCB)', '3P 100AF/75AT', 'LS ELECTRIC', 'EA', '차단기', 'ELECTRIC', '68000'],
    ['누전차단기(ELB)', '2P 30AF/20AT', 'LS ELECTRIC', 'EA', '차단기', 'ELECTRIC', '9800'],
    ['LED 평판등', '640×640 50W', '', 'EA', '조명', 'ELECTRIC', '42000'],
    ['LED 다운라이트', '6인치 15W', '', 'EA', '조명', 'ELECTRIC', '11000'],
    ['콘센트', '2구 접지 매입', '', 'EA', '배선기구', 'ELECTRIC', '2900'],
    ['UTP 케이블', 'CAT.6 305m', 'LS전선', 'box', '통신선', 'TELECOM', '98000'],
    ['광케이블', 'SM 12C', '', 'm', '통신선', 'TELECOM', '2100'],
    ['RJ45 모듈러잭', 'CAT.6', '', 'EA', '통신자재', 'TELECOM', '2400'],
    ['19인치 랙', '42U 600×1000', '', 'EA', '통신자재', 'TELECOM', '650000'],
    ['케이블타이', '300mm', '', '봉', '부자재', 'COMMON', '4300'],
    ['절연테이프', '19mm×10m', '', 'EA', '부자재', 'COMMON', '900'],
  ];
  let mi = 0;
  for (const [name, spec, maker, unit, category, trade, price] of mats) {
    mi++;
    await tx.insert(materials).values({ companyId: company.id, code: `M${String(mi).padStart(5, '0')}`, name, spec, maker: maker || null, unit, category, tradeType: trade, defaultPrice: price });
  }
  await tx.execute(sql`insert into number_sequence (company_id, key, last_value) values (${company.id}, 'MATERIAL', ${mi}) on conflict do nothing`);

  // 다른 회사 현장 1건 (격리 확인용)
  await tx.insert(projects).values({ companyId: other.company.id, code: 'P26-0001', name: '[한누리] 부천 데이터센터 통신공사', tradeType: 'TELECOM', status: 'IN_PROGRESS', supplyAmount: '500000000.00', vatAmount: '50000000.00', totalAmount: '550000000.00', vatRate: '0.1000' });
  console.log(`샘플 데이터 생성 완료. 로그인: admin / ceo / acct / buyer / site1 / tax  (비밀번호: ${pw})`);
}

async function main() {
  const { pool, db } = createDb(process.env.DATABASE_URL!);
  try {
    await db.transaction(async (tx) => {
      await seedBase(tx);
      if (process.env.SEED_DEMO === 'true') {
        await demo(tx);
        return;
      }
      const name = process.env.INIT_COMPANY_NAME;
      const [existing] = await tx.select({ id: companies.id }).from(companies).limit(1);
      if (name && existing) {
        console.log('이미 회사가 등록되어 있어 초기 회사 생성을 건너뜁니다');
      } else if (name) {
        const bizRegNo = normalizeBizNo(process.env.INIT_COMPANY_BIZNO ?? '');
        if (!isValidBizNo(bizRegNo)) throw new Error('INIT_COMPANY_BIZNO 사업자등록번호가 올바르지 않습니다');
        const loginId = (process.env.INIT_ADMIN_ID ?? 'admin').toLowerCase();
        const password = process.env.INIT_ADMIN_PASSWORD ?? '';
        const policy = checkPasswordPolicy(password, loginId);
        if (policy) throw new Error(`INIT_ADMIN_PASSWORD: ${policy}`);
        await createCompanyWithAdmin(tx, { code: process.env.INIT_COMPANY_CODE ?? 'MAIN', name, bizRegNo }, { loginId, name: '최고관리자', password, mustChange: true, systemAdmin: true });
        console.log(`회사 "${name}" 와 최고관리자 "${loginId}" 를 만들었습니다. 첫 로그인 시 비밀번호를 변경해야 합니다.`);
      } else {
        console.log('기본 세율 설정 완료');
      }
    });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('초기화 실패:', e.message ?? e);
    process.exit(1);
  });
}
