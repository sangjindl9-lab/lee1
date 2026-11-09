import { Injectable, Logger } from '@nestjs/common';
import * as forge from 'node-forge';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export interface IssuedCert { certPem: string; keyPem: string; serial: string; fingerprint: string }

/**
 * 내부 인증기관(CA). 장치별 클라이언트 인증서(mTLS)와 브로커·서버 인증서를 발급한다.
 * CA 개인키는 DATA_DIR/pki/ca.key (권한 600). 운영 시 기관 보안정책에 따라 HSM/오프라인 CA로 교체 가능.
 */
@Injectable()
export class PkiService {
  private readonly log = new Logger('PKI');
  private readonly dir = path.join(config.dataDir, 'pki');
  private caCert!: forge.pki.Certificate;
  private caKey!: forge.pki.rsa.PrivateKey;
  caPem = '';

  constructor() { this.init(); }

  private init() {
    fs.mkdirSync(this.dir, { recursive: true });
    const cf = path.join(this.dir, 'ca.crt'), kf = path.join(this.dir, 'ca.key');
    if (!fs.existsSync(cf)) {
      const { certPem, keyPem } = this.selfSignedCa();
      fs.writeFileSync(kf, keyPem, { mode: 0o600 });
      fs.writeFileSync(cf, certPem);
      this.log.log('내부 CA를 생성했습니다');
    }
    this.caPem = fs.readFileSync(cf, 'utf8');
    this.caCert = forge.pki.certificateFromPem(this.caPem);
    this.caKey = forge.pki.privateKeyFromPem(fs.readFileSync(kf, 'utf8'));
  }

  private keypair() {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const keyPem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const key = forge.pki.privateKeyFromPem(keyPem);
    const pub = forge.pki.setRsaPublicKey(key.n, key.e);
    return { keyPem, key, pub };
  }

  private serial() { return '01' + crypto.randomBytes(15).toString('hex'); }

  private selfSignedCa() {
    const { keyPem, key, pub } = this.keypair();
    const c = forge.pki.createCertificate();
    c.publicKey = pub; c.serialNumber = this.serial();
    c.validity.notBefore = new Date(Date.now() - 3600_000);
    c.validity.notAfter = new Date(Date.now() + 20 * 365 * 86400_000);
    const attrs = [{ name: 'commonName', value: 'EUM SMART VMS Device CA' }, { name: 'organizationName', value: 'EUM' }];
    c.setSubject(attrs); c.setIssuer(attrs);
    c.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }, { name: 'subjectKeyIdentifier' }]);
    c.sign(key, forge.md.sha256.create());
    return { certPem: forge.pki.certificateToPem(c), keyPem };
  }

  issue(cn: string, kind: 'client' | 'server', sans: string[] = [], years = 5): IssuedCert {
    const { keyPem, pub } = this.keypair();
    const c = forge.pki.createCertificate();
    c.publicKey = pub; c.serialNumber = this.serial();
    c.validity.notBefore = new Date(Date.now() - 3600_000);
    c.validity.notAfter = new Date(Date.now() + years * 365 * 86400_000);
    c.setSubject([{ name: 'commonName', value: cn }]);
    c.setIssuer(this.caCert.subject.attributes);
    const ext: any[] = [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', clientAuth: kind === 'client', serverAuth: kind === 'server' },
    ];
    if (sans.length) ext.push({ name: 'subjectAltName', altNames: sans.map(s => /^\d+\.\d+\.\d+\.\d+$/.test(s) ? { type: 7, ip: s } : { type: 2, value: s }) });
    c.setExtensions(ext);
    c.sign(this.caKey, forge.md.sha256.create());
    const certPem = forge.pki.certificateToPem(c);
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes();
    const fingerprint = crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
    return { certPem, keyPem, serial: c.serialNumber, fingerprint };
  }

  /** 서버 자신이 브로커에 접속할 때 쓰는 클라이언트 인증서(없으면 생성) */
  serverClientCert(): { cert: string; key: string } {
    const cf = path.join(this.dir, 'server-client.crt'), kf = path.join(this.dir, 'server-client.key');
    if (!fs.existsSync(cf)) {
      const i = this.issue('eum-server', 'client', [], 10);
      fs.writeFileSync(kf, i.keyPem, { mode: 0o600 }); fs.writeFileSync(cf, i.certPem);
    }
    return { cert: fs.readFileSync(cf, 'utf8'), key: fs.readFileSync(kf, 'utf8') };
  }

  /** 브로커용 서버 인증서 파일 생성 (설치 스크립트에서 사용) */
  ensureBrokerCert(hosts: string[]): { certFile: string; keyFile: string; caFile: string } {
    const cf = path.join(this.dir, 'broker.crt'), kf = path.join(this.dir, 'broker.key');
    if (!fs.existsSync(cf)) {
      const i = this.issue(hosts[0] || 'localhost', 'server', hosts, 10);
      fs.writeFileSync(kf, i.keyPem, { mode: 0o600 }); fs.writeFileSync(cf, i.certPem);
    }
    return { certFile: cf, keyFile: kf, caFile: path.join(this.dir, 'ca.crt') };
  }
}
