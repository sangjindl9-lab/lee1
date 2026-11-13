#!/usr/bin/env python3
"""APK 조립(정렬) + APK Signature Scheme v2 서명."""
import sys, struct, hashlib, zipfile, io, os
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import NameOID
import datetime

def build_zip(base_apk, dex_path, out):
    src = zipfile.ZipFile(base_apk)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        entries = [(i.filename, src.read(i.filename)) for i in src.infolist()]
        entries.insert(1, ('classes.dex', open(dex_path, 'rb').read()))
        for name, data in entries:
            zi = zipfile.ZipInfo(name, date_time=(1981, 1, 1, 1, 1, 2))
            stored = name == 'resources.arsc'
            zi.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            if stored:  # 4바이트 정렬
                off = buf.tell() + 30 + len(name.encode())
                pad = (4 - off % 4) % 4
                zi.extra = b'\0' * pad
            z.writestr(zi, data)
    open(out, 'wb').write(buf.getvalue())

def load_or_make_key(path):
    if os.path.exists(path):
        d = open(path, 'rb').read()
        key = serialization.load_pem_private_key(d, None)
        cert = x509.load_pem_x509_certificate(d[d.index(b'-----BEGIN CERTIFICATE'):])
        return key, cert
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'AllZip'), x509.NameAttribute(NameOID.COUNTRY_NAME, 'KR')])
    now = datetime.datetime(2026, 1, 1)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=365 * 30)).sign(key, hashes.SHA256()))
    with open(path, 'wb') as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return key, cert

def lp(b): return struct.pack('<I', len(b)) + b

def chunk_digest(parts):
    digs = []
    for p in parts:
        for i in range(0, len(p), 1 << 20):
            c = p[i:i + (1 << 20)]
            digs.append(hashlib.sha256(b'\xa5' + struct.pack('<I', len(c)) + c).digest())
    return hashlib.sha256(b'\x5a' + struct.pack('<I', len(digs)) + b''.join(digs)).digest()

def sign(apk_in, apk_out, keyfile):
    data = open(apk_in, 'rb').read()
    eocd = data.rfind(b'PK\x05\x06')
    assert eocd >= 0 and len(data) - eocd == 22, 'EOCD comment not supported'
    cd_size, cd_off = struct.unpack('<II', data[eocd + 12:eocd + 20])
    assert cd_off + cd_size == eocd
    contents, cd, end = data[:cd_off], data[cd_off:eocd], data[eocd:]
    key, cert = load_or_make_key(keyfile)
    ALG = 0x0103  # RSASSA-PKCS1-v1_5 + SHA-256
    digest = chunk_digest([contents, cd, end])
    digests = lp(struct.pack('<I', ALG) + lp(digest))
    certs = lp(cert.public_bytes(serialization.Encoding.DER))
    signed_data = lp(digests) + lp(certs) + lp(b'')
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    sigs = lp(struct.pack('<I', ALG) + lp(sig))
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signer = lp(signed_data) + lp(sigs) + lp(pub)
    v2 = lp(lp(signer))
    pair = struct.pack('<QI', 4 + len(v2), 0x7109871a) + v2
    size = len(pair) + 8 + 16
    block = struct.pack('<Q', size) + pair + struct.pack('<Q', size) + b'APK Sig Block 42'
    end2 = end[:16] + struct.pack('<I', cd_off + len(block)) + end[20:]
    open(apk_out, 'wb').write(contents + block + cd + end2)

if __name__ == '__main__':
    base, dex, out, keyfile = sys.argv[1:5]
    tmp = out + '.unsigned'
    build_zip(base, dex, tmp)
    sign(tmp, out, keyfile)
    os.remove(tmp)
    print('signed', out, os.path.getsize(out))
