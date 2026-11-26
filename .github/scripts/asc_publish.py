#!/usr/bin/env python3
"""App Store 정식 출시 정보를 App Store Connect API로 채웁니다 (빌드 서버용).
환경변수: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8
  python3 asc_publish.py <metadata.json> <스크린샷 폴더>
심사 제출(“심사에 추가”)은 하지 않습니다 — 사용자가 App Store Connect에서 직접 누릅니다.
"""
import base64, hashlib, json, os, sys, time, urllib.error, urllib.parse, urllib.request
import jwt

API = "https://api.appstoreconnect.apple.com"
meta = json.load(open(sys.argv[1], encoding="utf-8"))
shots_dir = sys.argv[2]


def token():
    return jwt.encode({"iss": os.environ["ASC_ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
                      os.environ["ASC_KEY_P8"], algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"], "typ": "JWT"})


class ApiErr(Exception):
    def __init__(self, code, body): super().__init__(f"{code}: {body[:800]}"); self.code = code; self.body = body


def call(method, path, body=None, ok404=False):
    url = path if path.startswith("http") else API + path
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req)
        t = r.read()
        return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        if ok404 and e.code == 404:
            return None
        raise ApiErr(e.code, b)


def step(name):
    print(f"\n== {name}", flush=True)


def demo_password():
    # 새 비밀 값 없이도 매번 같은 비밀번호가 나오도록 API 키에서 파생 (저장소에 남지 않음)
    h = hashlib.sha256(("fm2-appreview|" + os.environ["ASC_KEY_P8"]).encode()).digest()
    return "Rv" + base64.urlsafe_b64encode(h).decode()[:14].replace("-", "x").replace("_", "y") + "7!"


warnings = []

# ---------- 심사용 데모 계정 ----------
step("심사용 데모 계정")
rv = meta["review"]
pw = demo_password()
print(f"::add-mask::{pw}")
try:
    req = urllib.request.Request("https://fm2.ieumerp.kr/api/auth/register", method="POST",
                                 data=json.dumps({"email": rv["demoEmail"], "password": pw, "name": "App Review"}).encode(),
                                 headers={"Content-Type": "application/json"})
    print(urllib.request.urlopen(req).read().decode()[:200])
except urllib.error.HTTPError as e:
    print("가입 응답", e.code, e.read().decode()[:200])
with open(os.environ.get("GITHUB_ENV", "/dev/null"), "a") as f:
    f.write(f"DEMO_EMAIL={rv['demoEmail']}\nDEMO_PASSWORD={pw}\n")
if len(sys.argv) > 3 and sys.argv[3] == "account-only":
    sys.exit(0)

# ---------- 앱 ----------
step("앱 찾기")
app = call("GET", "/v1/apps?" + urllib.parse.urlencode({"filter[bundleId]": meta["bundleId"]}))["data"][0]
app_id = app["id"]
print(app["attributes"]["name"], app_id)
try:
    call("PATCH", f"/v1/apps/{app_id}", {"data": {"type": "apps", "id": app_id, "attributes": {"contentRightsDeclaration": "DOES_NOT_USE_THIRD_PARTY_CONTENT"}}})
    print("콘텐츠 권한: 제3자 콘텐츠 사용 안 함")
except ApiErr as e:
    warnings.append("콘텐츠 권한 " + str(e))

# ---------- 앱 정보(카테고리·부제·개인정보처리방침) ----------
step("앱 정보")
infos = call("GET", f"/v1/apps/{app_id}/appInfos")["data"]
info = next((i for i in infos if i["attributes"].get("appStoreState") not in ("READY_FOR_SALE", "READY_FOR_DISTRIBUTION")), infos[0])
call("PATCH", f"/v1/appInfos/{info['id']}", {"data": {"type": "appInfos", "id": info["id"], "relationships": {
    "primaryCategory": {"data": {"type": "appCategories", "id": meta["primaryCategory"]}},
    "secondaryCategory": {"data": {"type": "appCategories", "id": meta["secondaryCategory"]}}}}})
ko = meta["ko"]
for loc in call("GET", f"/v1/appInfos/{info['id']}/appInfoLocalizations")["data"]:
    if loc["attributes"]["locale"].startswith("ko"):
        call("PATCH", f"/v1/appInfoLocalizations/{loc['id']}", {"data": {"type": "appInfoLocalizations", "id": loc["id"], "attributes": {
            "subtitle": ko["subtitle"], "privacyPolicyUrl": ko["privacyPolicyUrl"]}}})
        print("부제·개인정보처리방침 주소 설정")

# ---------- 연령 등급 (모두 해당 없음) ----------
step("연령 등급")
try:
    ard = call("GET", f"/v1/appInfos/{info['id']}/ageRatingDeclaration")["data"]
    skip = {"kidsAgeBand", "ageRatingOverride", "ageRatingOverrideV2", "koreaAgeRatingOverride", "developerAgeRatingInfoUrl"}
    attrs = {}
    for k, v in ard["attributes"].items():
        if k in skip:
            continue
        attrs[k] = v if isinstance(v, bool) else ("NONE" if isinstance(v, str) else None)
    # 값이 비어 있는 항목은 문자열(NONE)인지 참/거짓인지 모르므로 API 오류를 보고 맞춰 감
    for k in [k for k, v in attrs.items() if v is None]:
        attrs[k] = "NONE"
    for _ in range(25):
        try:
            call("PATCH", f"/v1/ageRatingDeclarations/{ard['id']}", {"data": {"type": "ageRatingDeclarations", "id": ard["id"], "attributes": attrs}})
            print("연령 등급 저장:", ", ".join(f"{k}={v}" for k, v in attrs.items()))
            break
        except ApiErr as e:
            fixed = False
            for err in json.loads(e.body).get("errors", []):
                ptr = (err.get("source") or {}).get("pointer", "")
                k = ptr.rsplit("/", 1)[-1]
                if k in attrs:
                    attrs[k] = False if attrs[k] == "NONE" else ("NONE" if attrs[k] is False else None)
                    if attrs[k] is None:
                        del attrs[k]
                    fixed = True
            if not fixed:
                raise
except ApiErr as e:
    warnings.append("연령 등급 " + str(e))

# ---------- 가격(무료) ----------
step("가격: 무료")
_mp = call("GET", f"/v1/apps/{app_id}/appPriceSchedule/manualPrices", ok404=True)
if _mp and _mp.get("data"):
    print("가격 이미 설정됨")
else:
    try:
        pts = call("GET", f"/v1/apps/{app_id}/appPricePoints?" + urllib.parse.urlencode({"filter[territory]": "KOR", "limit": 200}))["data"]
        free = next(p for p in pts if float(p["attributes"]["customerPrice"]) == 0)
        call("POST", "/v1/appPriceSchedules", {"data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": app_id}},
            "baseTerritory": {"data": {"type": "territories", "id": "KOR"}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${p0}"}]}}},
            "included": [{"type": "appPrices", "id": "${p0}", "attributes": {"startDate": None},
                          "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": free["id"]}}}}]})
        print("무료로 설정")
    except (ApiErr, StopIteration) as e:
        warnings.append("가격 " + str(e))

# ---------- 판매 국가 (중국 제외 전 세계) ----------
step("판매 국가")
try:
    if call("GET", f"/v1/apps/{app_id}/appAvailabilityV2", ok404=True):
        print("판매 국가 이미 설정됨")
    else:
        terrs = []
        url = "/v1/territories?limit=200"
        while url:
            r = call("GET", url)
            terrs += [t["id"] for t in r["data"]]
            url = r.get("links", {}).get("next")
        avail = [t for t in terrs if t not in meta["excludeTerritories"]]
        inc = [{"type": "territoryAvailabilities", "id": f"${{t{i}}}", "attributes": {"available": True},
                "relationships": {"territory": {"data": {"type": "territories", "id": t}}}} for i, t in enumerate(avail)]
        call("POST", "/v2/appAvailabilities", {"data": {"type": "appAvailabilities", "attributes": {"availableInNewTerritories": True},
            "relationships": {"app": {"data": {"type": "apps", "id": app_id}},
                              "territoryAvailabilities": {"data": [{"type": "territoryAvailabilities", "id": x["id"]} for x in inc]}}},
            "included": inc})
        print(f"{len(avail)}개 국가에서 판매 (제외: {', '.join(meta['excludeTerritories'])})")
except ApiErr as e:
    warnings.append("판매 국가 " + str(e))

# ---------- 버전(1.0.0) ----------
step("버전 정보")
vers = call("GET", f"/v1/apps/{app_id}/appStoreVersions?" + urllib.parse.urlencode({"filter[platform]": "IOS", "limit": 10}))["data"]
ver = next(v for v in vers if v["attributes"]["appStoreState"] in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"))
vid = ver["id"]
call("PATCH", f"/v1/appStoreVersions/{vid}", {"data": {"type": "appStoreVersions", "id": vid, "attributes": {
    "versionString": meta["version"], "copyright": meta["copyright"], "releaseType": "AFTER_APPROVAL"}}})
locs = call("GET", f"/v1/appStoreVersions/{vid}/appStoreVersionLocalizations")["data"]
kloc = next(l for l in locs if l["attributes"]["locale"].startswith("ko"))
call("PATCH", f"/v1/appStoreVersionLocalizations/{kloc['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": kloc["id"], "attributes": {
    "description": ko["description"], "keywords": ko["keywords"], "promotionalText": ko["promotionalText"],
    "supportUrl": ko["supportUrl"], "marketingUrl": ko["marketingUrl"]}}})
print("설명·키워드·지원 주소 설정")

# ---------- 빌드 연결 ----------
step("빌드 연결")
build = None
for _ in range(40):  # 업로드 직후면 처리될 때까지 최대 20분 대기
    bs = call("GET", "/v1/builds?" + urllib.parse.urlencode({"filter[app]": app_id, "filter[preReleaseVersion.version]": meta["version"],
                                                              "filter[processingState]": "VALID", "sort": "-uploadedDate", "limit": 1}))["data"]
    if bs:
        build = bs[0]; break
    time.sleep(30)
if build:
    call("PATCH", f"/v1/appStoreVersions/{vid}/relationships/build", {"data": {"type": "builds", "id": build["id"]}})
    print("빌드", build["attributes"]["version"], "연결")
else:
    warnings.append("처리된 빌드가 없어 연결하지 못함")

# ---------- 심사 정보 ----------
step("심사 정보")
rd_attrs = {"contactFirstName": rv["firstName"], "contactLastName": rv["lastName"], "contactPhone": rv["phone"], "contactEmail": rv["email"],
            "demoAccountName": rv["demoEmail"], "demoAccountPassword": pw, "demoAccountRequired": True, "notes": rv["notes"]}
rd = call("GET", f"/v1/appStoreVersions/{vid}/appStoreReviewDetail", ok404=True)
if rd and rd.get("data"):
    call("PATCH", f"/v1/appStoreReviewDetails/{rd['data']['id']}", {"data": {"type": "appStoreReviewDetails", "id": rd["data"]["id"], "attributes": rd_attrs}})
else:
    call("POST", "/v1/appStoreReviewDetails", {"data": {"type": "appStoreReviewDetails", "attributes": rd_attrs,
        "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
print("연락처·데모 계정·메모 설정")

# ---------- 스크린샷 ----------
step("스크린샷")
files = sorted(f for f in os.listdir(shots_dir) if f.endswith(".png"))
if files:
    display = os.environ.get("SHOT_DISPLAY", "APP_IPHONE_67")
    sets = call("GET", f"/v1/appStoreVersionLocalizations/{kloc['id']}/appScreenshotSets")["data"]
    sset = next((s for s in sets if s["attributes"]["screenshotDisplayType"] == display), None)
    if sset:
        for old in call("GET", f"/v1/appScreenshotSets/{sset['id']}/appScreenshots")["data"]:
            call("DELETE", f"/v1/appScreenshots/{old['id']}")
    else:
        sset = call("POST", "/v1/appScreenshotSets", {"data": {"type": "appScreenshotSets", "attributes": {"screenshotDisplayType": display},
            "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": kloc["id"]}}}}})["data"]
    for fn in files:
        data = open(os.path.join(shots_dir, fn), "rb").read()
        shot = call("POST", "/v1/appScreenshots", {"data": {"type": "appScreenshots", "attributes": {"fileName": fn, "fileSize": len(data)},
            "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": sset["id"]}}}}})["data"]
        for op in shot["attributes"]["uploadOperations"]:
            chunk = data[op["offset"]: op["offset"] + op["length"]]
            r = urllib.request.Request(op["url"], method=op["method"], data=chunk, headers={h["name"]: h["value"] for h in op["requestHeaders"]})
            urllib.request.urlopen(r).read()
        call("PATCH", f"/v1/appScreenshots/{shot['id']}", {"data": {"type": "appScreenshots", "id": shot["id"], "attributes": {
            "uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
        print("올림:", fn)

print("\n완료. 남은 일: App Store Connect의 '앱 개인정보 보호' 설문 확인 후 '심사에 추가'")
for w in warnings:
    print("::warning::" + w.replace("\n", " ")[:900])
