/**
 * 설치 시 1회 실행: 내부 CA, 브로커 서버 인증서, 관제서버용 클라이언트 인증서를 DATA_DIR/pki 에 만든다.
 * 사용: BROKER_HOSTS="mqtt.example.local,10.0.0.5" node dist/tools/init-pki.js
 */
import { PkiService } from '../common/pki.service';

const hosts = (process.env.BROKER_HOSTS || 'localhost,127.0.0.1,mqtt').split(',').map(s => s.trim()).filter(Boolean);
const pki = new PkiService();
const f = pki.ensureBrokerCert(hosts);
pki.serverClientCert();
console.log(`CA:            ${f.caFile}`);
console.log(`브로커 인증서: ${f.certFile} (${hosts.join(', ')})`);
console.log(`브로커 개인키: ${f.keyFile}`);
console.log('완료. 브로커 인증서의 호스트 이름은 장치가 접속하는 주소와 같아야 합니다.');
