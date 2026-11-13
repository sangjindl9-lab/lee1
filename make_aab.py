#!/usr/bin/env python3
"""aapt2 --proto-format 결과물 + classes.dex 로 구글 플레이용 앱 번들(.aab)을 만들고 업로드 키로 서명한다."""
import sys, zipfile, os, subprocess, tempfile

BUNDLETOOL_VERSION = b'1.18.3'

def bundle_config():
    # BundleConfig { bundletool(1) { version(2) = "x.y.z" } }
    inner = b'\x12' + bytes([len(BUNDLETOOL_VERSION)]) + BUNDLETOOL_VERSION
    return b'\x0a' + bytes([len(inner)]) + inner

def main(proto_zip, dex, out, keypem):
    src = zipfile.ZipFile(proto_zip)
    if os.path.exists(out): os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('BundleConfig.pb', bundle_config())
        for i in src.infolist():
            n = i.filename
            if n == 'AndroidManifest.xml': dst = 'base/manifest/AndroidManifest.xml'
            elif n == 'resources.pb': dst = 'base/resources.pb'
            elif n.startswith('res/'): dst = 'base/' + n
            else: raise SystemExit('unexpected entry ' + n)
            z.writestr(dst, src.read(n))
        z.write(dex, 'base/dex/classes.dex')
    # PEM(개인키+인증서) -> PKCS12 -> jarsigner
    with tempfile.TemporaryDirectory() as td:
        p12 = os.path.join(td, 'k.p12')
        subprocess.run(['openssl', 'pkcs12', '-export', '-in', keypem, '-out', p12, '-name', 'upload', '-passout', 'pass:eumzip'], check=True)
        r = subprocess.run(['jarsigner', '-keystore', p12, '-storetype', 'PKCS12', '-storepass', 'eumzip',
                            '-sigalg', 'SHA256withRSA', '-digestalg', 'SHA-256', out, 'upload'], capture_output=True, text=True)
        if r.returncode != 0: raise SystemExit(r.stdout + r.stderr)
    print('bundle', out, os.path.getsize(out))

if __name__ == '__main__':
    main(*sys.argv[1:5])
