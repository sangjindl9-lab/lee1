"""APK Signature Scheme v2 로 APK 를 다시 서명한다 (minSdk 24 이상용, v1 서명 없음).
사용: python3 apk_v2_sign.py in.apk out.apk keystore.p12 password
"""
import hashlib, struct, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import pkcs12

MAGIC = b"APK Sig Block 42"
V2_ID = 0x7109871A
ALG_RSA_PKCS1_SHA256 = 0x0103
CHUNK = 1 << 20


def lp(b):
    return struct.pack("<I", len(b)) + b


def find_eocd(d):
    i = d.rfind(b"PK\x05\x06", max(0, len(d) - 65557))
    if i < 0:
        sys.exit("EOCD 없음")
    return i


def section_digest(sections):
    chunks = []
    for s in sections:
        for o in range(0, len(s), CHUNK):
            c = s[o:o + CHUNK]
            chunks.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest())
    return hashlib.sha256(b"\x5a" + struct.pack("<I", len(chunks)) + b"".join(chunks)).digest()


def main(src, dst, ks, pw):
    d = open(src, "rb").read()
    e = find_eocd(d)
    cd_size, cd_off = struct.unpack("<II", d[e + 12:e + 20])
    start = cd_off
    if d[cd_off - 16:cd_off] == MAGIC:  # 기존 서명 블록 제거
        size = struct.unpack("<Q", d[cd_off - 24:cd_off - 16])[0]
        start = cd_off - size - 8
    contents, cd, eocd = d[:start], d[cd_off:cd_off + cd_size], bytearray(d[e:])
    eocd[16:20] = struct.pack("<I", start)  # 다이제스트 계산 시 CD 오프셋 = 서명 블록 시작

    key, cert, _ = pkcs12.load_key_and_certificates(open(ks, "rb").read(), pw.encode())
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    pub_der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    digest = section_digest([contents, cd, bytes(eocd)])
    signed_data = lp(lp(struct.pack("<I", ALG_RSA_PKCS1_SHA256) + lp(digest))) + lp(lp(cert_der)) + lp(b"")
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    signer = lp(signed_data) + lp(lp(struct.pack("<I", ALG_RSA_PKCS1_SHA256) + lp(sig))) + lp(pub_der)
    value = lp(lp(signer))

    pair = struct.pack("<I", V2_ID) + value
    pairs = struct.pack("<Q", len(pair)) + pair
    blk_size = len(pairs) + 8 + 16
    block = struct.pack("<Q", blk_size) + pairs + struct.pack("<Q", blk_size) + MAGIC

    eocd[16:20] = struct.pack("<I", start + len(block))
    open(dst, "wb").write(contents + block + cd + bytes(eocd))
    print("서명 완료:", dst, "인증서 SHA-256:", hashlib.sha256(cert_der).hexdigest())


if __name__ == "__main__":
    main(*sys.argv[1:5])
