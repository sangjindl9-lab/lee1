set -x
PKG=kr.eumsoft.filemanager2
EMAIL="fgs-demo-$(date +%s)@example.com"; PW="DemoPass1234"
curl -s -X POST https://fm2-connect-production.up.railway.app/api/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"name\":\"demo\"}"; echo
adb shell settings put global hide_error_dialogs 1 || true
sleep 15
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set $PKG MANAGE_EXTERNAL_STORAGE allow
adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS || true
adb shell 'mkdir -p /sdcard/Download; screencap -p /sdcard/Download/현장사진_001.png; echo 견적서 > /sdcard/Download/견적서.txt'
mkdir -p vid
# 화면 요소를 글자로 찾아 누르기
tapt() { # $1=text  $2=index(last|first)
  for t in 1 2 3 4 5 6; do
    adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1; adb pull /sdcard/u.xml /tmp/u.xml >/dev/null 2>&1
    XY=$(python3 - "$1" "${2:-first}" <<'PY'
import re,sys
x=open('/tmp/u.xml',encoding='utf-8').read(); want=sys.argv[1]; which=sys.argv[2]
nodes=re.findall(r'<node [^>]*>',x); hits=[]
for n in nodes:
  t=re.search(r' text="([^"]*)"',n).group(1); d=re.search(r'content-desc="([^"]*)"',n).group(1)
  if want in (t,d) or (want.startswith('~') and want[1:] in t):
    b=list(map(int,re.findall(r'\d+',re.search(r'bounds="([^"]*)"',n).group(1)))); hits.append(((b[0]+b[2])//2,(b[1]+b[3])//2))
if hits: h=max(hits,key=lambda p:p[1]) if which=='last' else hits[0]; print(h[0],h[1])
PY
)
    if [ -n "$XY" ]; then adb shell input tap $XY; return 0; fi
    sleep 2
  done
  echo "NOT FOUND: $1"; return 1
}
typein() { adb shell input text "$1"; }
adb shell am start -n $PKG/.MainActivity; sleep 5
adb shell screenrecord --time-limit 175 --bit-rate 4000000 /sdcard/fgs.mp4 &
REC=$!
sleep 3
adb shell input swipe 540 1700 540 900 400; sleep 2
tapt "PC 연결" || { adb shell input swipe 540 1700 540 700 400; sleep 2; tapt "PC 연결"; }
sleep 3
tapt "이메일"; typein "$EMAIL"; sleep 1
tapt "비밀번호"; typein "$PW"; sleep 1
adb shell input keyevent 4; sleep 2
tapt "로그인" last; sleep 8
adb shell uiautomator dump /sdcard/u.xml >/dev/null; adb pull /sdcard/u.xml /tmp/after_login.xml >/dev/null; grep -o 'text="[^"]*"' /tmp/after_login.xml | head -30
# 연결 켜기 (스위치)
adb shell uiautomator dump /sdcard/u.xml >/dev/null; adb pull /sdcard/u.xml /tmp/u.xml >/dev/null
SW=$(python3 -c "
import re;x=open('/tmp/u.xml',encoding='utf-8').read()
for n in re.findall(r'<node [^>]*>',x):
  if 'checkable=\"true\"' in n:
    b=list(map(int,re.findall(r'\d+',re.search(r'bounds=\"([^\"]*)\"',n).group(1))));print((b[0]+b[2])//2,(b[1]+b[3])//2);break")
adb shell input tap $SW; sleep 6
# 알림(포그라운드 서비스) 보여주기
adb shell cmd statusbar expand-notifications; sleep 5; adb shell cmd statusbar collapse; sleep 2
# PC에서 연결 요청 → 휴대폰에서 승인
(cp .github/fgs-pc.mjs server/fgs-pc.mjs; cd server && node fgs-pc.mjs "$EMAIL" "$PW" request)
sleep 6
tapt "승인하고 폴더 선택" || { adb shell input swipe 540 900 540 1500 300; sleep 3; tapt "승인하고 폴더 선택"; }; sleep 3
tapt "승인" last; sleep 4
# 앱을 나간 뒤에도 PC 요청 처리 (사용자와 직접 상호작용 없음)
(cp .github/fgs-pc.mjs server/fgs-pc.mjs; cd server && node fgs-pc.mjs "$EMAIL" "$PW" transfer > /tmp/pc.log 2>&1 &)
sleep 4
adb shell input keyevent 3; sleep 12
adb shell cmd statusbar expand-notifications; sleep 10; adb shell cmd statusbar collapse; sleep 15
adb shell cmd statusbar expand-notifications; sleep 8; adb shell cmd statusbar collapse; sleep 3
# 다시 앱으로 돌아와 연결 기록 확인
adb shell am start -n $PKG/.MainActivity; sleep 6
adb shell input swipe 540 1700 540 600 400; sleep 4
wait $REC || true
sleep 3
adb pull /sdcard/fgs.mp4 vid/fgs-dataSync-demo.mp4
cat /tmp/pc.log || true
ls -la vid
