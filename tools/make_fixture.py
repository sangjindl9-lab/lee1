"""무해한 테스트 픽스처 APK 생성 (실행되지 않는 ZIP). 결정적 출력: 같은 입력이면 같은 SHA-256."""
import zipfile, hashlib, sys, os
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'eum-test-fixture.apk')
def add(z, name, data):
    zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; z.writestr(zi, data)
dex = bytearray(b'dex\n035\x00' + bytes(0x68))
dex[0x20:0x24] = (0x70 + 64).to_bytes(4, 'little')
dex += b'EUM-SECURITY-TEST-MALWARE-MARKER-0001' + bytes(64 - 37)
with zipfile.ZipFile(out, 'w') as z:
    add(z, 'classes.dex', bytes(dex))
    add(z, 'assets/readme.txt', b'Harmless EUM SECURITY PRO test fixture. Not malware.\n')
print(out, hashlib.sha256(open(out, 'rb').read()).hexdigest())
