/** 순수 계산 규칙 — DB 없이 */
import { afterAll, beforeAll, describe, expect, it } from './shim';
import { checkVatTriple, sumMoney, vatFromSupply, vatFromTotal } from '../src/common/money';
import { isValidBizNo, normalizeBizNo } from '../src/common/bizno';
import { decryptField, encryptField, maskAccount } from '../src/common/crypto';
import { checkPasswordPolicy } from '../src/auth/password';

describe('[필수1] 공급가액·부가세·합계 계산', () => {
  it('공급가액 기준 10% 부가세, 원 미만 절사', () => {
    expect(vatFromSupply('123456789', '0.1')).toEqual({ supply: '123456789.00', vat: '12345678.00', total: '135802467.00' });
    expect(vatFromSupply('15', '0.1')).toEqual({ supply: '15.00', vat: '1.00', total: '16.00' }); // 1.5 → 1 (절사)
  });
  it('합계 기준 역산 시 공급가액 + 부가세 = 합계가 항상 성립', () => {
    for (const t of ['110', '1100000', '999999', '1', '12345679', '33']) {
      const r = vatFromTotal(t, '0.1');
      expect((BigInt(r.supply.split('.')[0]) + BigInt(r.vat.split('.')[0])).toString()).toBe(t);
    }
    expect(vatFromTotal('1100000', '0.1')).toEqual({ supply: '1000000.00', vat: '100000.00', total: '1100000.00' });
  });
  it('세 값 검증: 합계 불일치와 부가세 오차를 잡아낸다', () => {
    expect(checkVatTriple({ supply: '1000000', vat: '100000', total: '1100000' }, '0.1').ok).toBe(true);
    expect(checkVatTriple({ supply: '1000000', vat: '100000', total: '1100001' }, '0.1').ok).toBe(false);
    expect(checkVatTriple({ supply: '1000000', vat: '99990', total: '1099990' }, '0.1', 10).ok).toBe(true);
    expect(checkVatTriple({ supply: '1000000', vat: '99989', total: '1099989' }, '0.1', 10).ok).toBe(false);
  });
  it('부동소수점 오차가 없다 (0.1 + 0.2 문제)', () => {
    expect(sumMoney(['0.1', '0.2'])).toBe('0.30');
    expect(sumMoney(Array(1000).fill('1234567.89'))).toBe('1234567890.00');
    expect(sumMoney(['99999999999999.99', '0.01'])).toBe('100000000000000.00');
  });
});

describe('사업자등록번호 검증', () => {
  it('국세청 체크섬', () => {
    expect(isValidBizNo('101-81-17536')).toBe(true);
    expect(isValidBizNo('1018117537')).toBe(false);
    expect(isValidBizNo('12345')).toBe(false);
    expect(normalizeBizNo('214-88-39612')).toBe('2148839612');
  });
});

describe('필드 암호화', () => {
  it('AES-256-GCM 왕복, 매번 다른 암호문, 변조 감지', () => {
    const a = encryptField('110-123-456789');
    const b = encryptField('110-123-456789');
    expect(a).not.toBe(b);
    expect(a).not.toContain('456789');
    expect(decryptField(a)).toBe('110-123-456789');
    const parts = a.split('.');
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA');
    expect(() => decryptField(parts.join('.'))).toThrow();
  });
  it('계좌 마스킹', () => {
    expect(maskAccount('110-123-456789')).toBe('110-******-789');
  });
});

describe('비밀번호 정책', () => {
  it('약한 비밀번호 거부', () => {
    expect(checkPasswordPolicy('short1!')).toMatch(/10자/);
    expect(checkPasswordPolicy('alllowercaseletters')).toMatch(/3종류/);
    expect(checkPasswordPolicy('Admin!2026xx', 'admin')).toMatch(/아이디/);
    expect(checkPasswordPolicy('Aaaa!1111bbb')).toMatch(/4번/);
    expect(checkPasswordPolicy('Strong!pass26')).toBeNull();
  });
});
