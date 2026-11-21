"""
EUM SECURITY PRO 위협 DB 묶음 생성·서명.
  python3 tools/build_threat_db.py --key KEY.pem [--bazaar mb_full.csv(.zip)] [--version N]
출력: db/manifest.json, db/manifest.json.sig, db/threat-db-<ver>.json  (+ 앱 내장 사본 app/src/main/assets/threatdb/)
- 서명: Ed25519(manifest.json 원본 바이트) → base64
- MalwareBazaar(abuse.ch, CC0) CSV 를 주면 file_type == apk 인 해시를 운영 데이터로 넣는다 (Auth-Key 필요한 데이터).
"""
import argparse, base64, csv, glob, hashlib, io, json, os, re, shutil, sys, time, zipfile
from cryptography.hazmat.primitives import serialization

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ap = argparse.ArgumentParser()
ap.add_argument('--key', required=True); ap.add_argument('--bazaar'); ap.add_argument('--version', type=int)
ap.add_argument('--max-hashes', type=int, default=300000)
a = ap.parse_args()
version = a.version or int(time.strftime('%Y%m%d%H', time.gmtime()))
now = int(time.time() * 1000)

def yara_rules(path, test):
    src = open(path, encoding='utf-8').read()
    out = []
    # 파일 하나를 규칙 하나의 묶음으로 넣고, 이름은 규칙별 메타 조회용으로 따로 남긴다
    names = re.findall(r'^rule\s+(\w+)', src, re.M)
    sev = dict(re.findall(r'rule\s+(\w+)[\s\S]*?severity\s*=\s*"(\w+)"', src))
    conf = dict(re.findall(r'rule\s+(\w+)[\s\S]*?confidence\s*=\s*(\d+)', src))
    for i, n in enumerate(names):
        out.append({'name': n, 'body': src if i == 0 else '// (같은 파일에 포함됨)\n', 'severity': sev.get(n, 'MEDIUM'),
                    'confidence': int(conf.get(n, 50)), 'source': 'EUM 테스트 데이터' if test else 'EUM 자체 휴리스틱 v1',
                    'license': 'Apache-2.0', 'test': test})
    return out

yara = yara_rules(os.path.join(ROOT, 'db_src/yara/eum_test.yar'), True) + yara_rules(os.path.join(ROOT, 'db_src/yara/eum_heuristics.yar'), False)
patterns = json.load(open(os.path.join(ROOT, 'db_src/patterns.json'), encoding='utf-8'))
fixture = hashlib.sha256(open(os.path.join(ROOT, 'fixtures/eum-test-fixture.apk'), 'rb').read()).hexdigest()
hashes = [
    {'sha256': fixture, 'threat_name': 'EUM.Test.Fixture', 'threat_family': 'EUM-TEST', 'category': 'TEST', 'severity': 'HIGH',
     'confidence': 100, 'source': 'EUM 테스트 데이터 (TEST)', 'first_seen': '2026-01-01', 'last_seen': '2026-01-01'},
    {'sha256': '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f', 'threat_name': 'EICAR-Test-File', 'threat_family': 'EICAR',
     'category': 'TEST', 'severity': 'HIGH', 'confidence': 100, 'source': 'EICAR 표준 테스트 파일 (TEST)', 'first_seen': None, 'last_seen': None},
]
sources = [
    {'code': 'eum_test', 'name': 'EUM 테스트 데이터 (운영 탐지 아님)', 'url': 'https://github.com/sangjindl9-lab/lee1/tree/eum-security-pro/db_src', 'license': 'Apache-2.0', 'test': True, 'checked': now},
    {'code': 'eum_heur', 'name': 'EUM 자체 휴리스틱 규칙 v1 (주의 판정용)', 'url': 'https://github.com/sangjindl9-lab/lee1/tree/eum-security-pro/db_src', 'license': 'Apache-2.0', 'test': False, 'checked': now},
]
if a.bazaar and a.bazaar.endswith('.json'):
    # MalwareBazaar API (query=get_file_type&file_type=apk) 응답
    n = 0
    for r in json.load(open(a.bazaar)).get('data') or []:
        sha = (r.get('sha256_hash') or '').lower()
        if (r.get('file_type') or '').lower() != 'apk' or not re.fullmatch(r'[0-9a-f]{64}', sha): continue
        sig = r.get('signature') or ''
        hashes.append({'sha256': sha, 'threat_name': sig or 'Android.Malware.Generic', 'threat_family': sig or 'unknown', 'category': 'MALWARE',
                       'severity': 'HIGH', 'confidence': 95, 'source': 'MalwareBazaar (abuse.ch)',
                       'first_seen': (r.get('first_seen') or '')[:10] or None, 'last_seen': (r.get('last_seen') or '')[:10] or None})
        n += 1
    sources.append({'code': 'malwarebazaar', 'name': 'MalwareBazaar (abuse.ch) Android APK', 'url': 'https://bazaar.abuse.ch/', 'license': 'CC0-1.0', 'test': False, 'checked': now})
    print('MalwareBazaar APK hashes:', n)
elif a.bazaar:
    raw = open(a.bazaar, 'rb').read()
    if a.bazaar.endswith('.zip'):
        z = zipfile.ZipFile(io.BytesIO(raw)); raw = z.read(z.namelist()[0])
    lines = [l for l in raw.decode('utf-8', 'replace').splitlines() if l and not l.startswith('#')]
    n = 0
    for row in csv.reader(lines, skipinitialspace=True):
        # first_seen_utc, sha256_hash, md5, sha1, reporter, file_name, file_type_guess, mime_type, signature, clamav, vtpercent, imphash, ssdeep, tlsh
        if len(row) < 9: continue
        ftype = row[6].strip().strip('"').lower(); sha = row[1].strip().strip('"').lower()
        if ftype != 'apk' or not re.fullmatch(r'[0-9a-f]{64}', sha): continue
        sig = row[8].strip().strip('"'); sig = '' if sig in ('n/a', '') else sig
        hashes.append({'sha256': sha, 'threat_name': sig or 'Android.Malware.Generic', 'threat_family': sig or 'unknown', 'category': 'MALWARE',
                       'severity': 'HIGH', 'confidence': 95, 'source': 'MalwareBazaar (abuse.ch)', 'first_seen': row[0].strip().strip('"')[:10], 'last_seen': None})
        n += 1
        if n >= a.max_hashes: break
    sources.append({'code': 'malwarebazaar', 'name': 'MalwareBazaar (abuse.ch) Android APK', 'url': 'https://bazaar.abuse.ch/', 'license': 'CC0-1.0', 'test': False, 'checked': now})
    print('MalwareBazaar APK hashes:', n)

payload = {'version': version, 'sources': sources, 'hashes': hashes, 'yara': yara, 'patterns': patterns, 'false_positives': [],
           'domains': {'phishing': ['phishing-test.eum-security.invalid'], 'malware': ['malware-test.eum-security.invalid']}}
pbytes = json.dumps(payload, ensure_ascii=True, separators=(',', ':')).encode()
pname = f'threat-db-{version}.json'
manifest = {'format': 1, 'version': version, 'created': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'payload': pname,
            'sha256': hashlib.sha256(pbytes).hexdigest(), 'size': len(pbytes)}
mbytes = json.dumps(manifest, ensure_ascii=True, indent=1).encode()
key = serialization.load_pem_private_key(open(a.key, 'rb').read(), None)
sig = base64.b64encode(key.sign(mbytes)).decode()

for d in [os.path.join(ROOT, 'db'), os.path.join(ROOT, 'app/src/main/assets/threatdb')]:
    os.makedirs(d, exist_ok=True)
    for old in glob.glob(os.path.join(d, 'threat-db-*.json')): os.remove(old)
    open(os.path.join(d, pname), 'wb').write(pbytes)
    open(os.path.join(d, 'manifest.json'), 'wb').write(mbytes)
    open(os.path.join(d, 'manifest.json.sig'), 'w').write(sig + '\n')
print('version', version, 'hashes', len(hashes), 'yara', len(yara), 'patterns', len(patterns), 'payload', len(pbytes), 'bytes')
