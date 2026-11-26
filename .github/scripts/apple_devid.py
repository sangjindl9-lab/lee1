#!/usr/bin/env python3
"""빌드 서버(macOS)에서 Developer ID 인증서를 App Store Connect API로 받아 .p12로 만듭니다.
필요한 환경변수: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8, APPLE_DEVID_PRIVATE_KEY
결과는 GITHUB_ENV 로 APPLE_CERTIFICATE / APPLE_CERTIFICATE_PASSWORD / APPLE_SIGNING_IDENTITY 를 내보냅니다."""
import base64, json, os, secrets, subprocess, sys, tempfile, time, urllib.request
import jwt
from cryptography import x509
from cryptography.hazmat.primitives import serialization

kid, iss, p8, devkey = (os.environ.get(k, "") for k in ("ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_KEY_P8", "APPLE_DEVID_PRIVATE_KEY"))
if not all([kid, iss, p8, devkey]):
    print("::warning::Apple 서명용 값이 없어 임시 서명으로 빌드합니다"); sys.exit(0)
tok = jwt.encode({"iss": iss, "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
                 p8, algorithm="ES256", headers={"kid": kid, "typ": "JWT"})
req = urllib.request.Request("https://api.appstoreconnect.apple.com/v1/certificates?filter[certificateType]=DEVELOPER_ID_APPLICATION,DEVELOPER_ID_APPLICATION_G2&limit=50",
                             headers={"Authorization": "Bearer " + tok})
data = json.load(urllib.request.urlopen(req))["data"]
key = serialization.load_pem_private_key(devkey.encode(), None)
mine = key.public_key().public_numbers()
cert = None
for c in data:
    der = base64.b64decode(c["attributes"]["certificateContent"])
    x = x509.load_der_x509_certificate(der)
    if x.public_key().public_numbers() == mine:
        cert = x; break
if cert is None:
    print("::error::개인 키와 짝이 맞는 Developer ID 인증서를 찾지 못했습니다"); sys.exit(1)
cn = cert.subject.get_attributes_for_oid(x509.NameOID.COMMON_NAME)[0].value
pw = secrets.token_hex(16)
with tempfile.TemporaryDirectory() as d:
    open(f"{d}/k.pem", "w").write(devkey)
    open(f"{d}/c.pem", "wb").write(cert.public_bytes(serialization.Encoding.PEM))
    # macOS 키체인이 읽을 수 있는 형식(시스템 LibreSSL)으로 묶음
    subprocess.run(["/usr/bin/openssl", "pkcs12", "-export", "-inkey", f"{d}/k.pem", "-in", f"{d}/c.pem",
                    "-out", f"{d}/c.p12", "-passout", f"pass:{pw}"], check=True)
    p12 = base64.b64encode(open(f"{d}/c.p12", "rb").read()).decode()
with open(os.environ["GITHUB_ENV"], "a") as f:
    f.write(f"APPLE_CERTIFICATE={p12}\nAPPLE_CERTIFICATE_PASSWORD={pw}\nAPPLE_SIGNING_IDENTITY={cn}\n")
print(f"::add-mask::{pw}")
print("서명 인증서 준비 완료:", cn, "만료", cert.not_valid_after_utc.date())
