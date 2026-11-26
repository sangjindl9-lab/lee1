#!/usr/bin/env python3
"""App Store Connect API 도우미 (빌드 서버용). 환경변수 ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 필요.
  python3 asc.py ensure-bundle <번들ID> <이름>    # 앱 ID(번들 ID)가 없으면 등록
  python3 asc.py app <번들ID>                     # App Store Connect 앱 레코드 확인
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request
import jwt

def token():
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
                      os.environ["ASC_KEY_P8"], algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})

def call(method, path, body=None):
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        sys.exit(f"::error::App Store Connect API {e.code}: {e.read().decode()[:500]}")

cmd = sys.argv[1]
if cmd == "ensure-bundle":
    ident, name = sys.argv[2], sys.argv[3]
    found = call("GET", "/v1/bundleIds?" + urllib.parse.urlencode({"filter[identifier]": ident}))["data"]
    found = [b for b in found if b["attributes"]["identifier"] == ident]
    if found:
        print("앱 ID 이미 있음:", ident)
    else:
        call("POST", "/v1/bundleIds", {"data": {"type": "bundleIds", "attributes": {"identifier": ident, "name": name, "platform": "IOS"}}})
        print("앱 ID 등록함:", ident)
elif cmd == "app":
    apps = call("GET", "/v1/apps?" + urllib.parse.urlencode({"filter[bundleId]": sys.argv[2]}))["data"]
    if apps:
        print("앱 레코드 있음:", apps[0]["attributes"]["name"], apps[0]["id"])
    else:
        print(f"::warning::App Store Connect에 {sys.argv[2]} 앱이 아직 없습니다 — 웹에서 '새로운 앱'을 만들어야 TestFlight에 올라갑니다")
        sys.exit(3)
