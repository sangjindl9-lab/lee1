#!/bin/bash
# 에뮬레이터 실동작 검수 (실기기 아님). 결과: emu/report.txt + PNG + 로그
A=kr.eumsoft.purchasenote
D=.github/emu
O=emu; mkdir -p $O
R=$O/report.txt
log(){ echo "$*" | tee -a $R; }
shot(){ adb exec-out screencap -p > $O/$1.png; }
dump1(){ adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml $O/ui.xml >/dev/null 2>&1; }
# 에뮬레이터의 런처 '응답 없음' 창이 화면을 가리면 '기다리기'를 누르고 다시 덤프
dump(){ dump1; if grep -q "isn't responding" $O/ui.xml; then p=$(python3 $D/ui.py $O/ui.xml "Wait") && adb shell input tap $p; sleep 2; dump1; fi; }
tap(){ dump; p=$(python3 $D/ui.py $O/ui.xml "$1" ${2:-0}) || { log "  (화면에서 못 찾음: $1)"; return 1; }; adb shell input tap $p; sleep ${3:-2}; }
has(){ dump; grep -q "$1" $O/ui.xml; }
a11y(){ dump; cp $O/ui.xml $O/dump_$1.xml; python3 $D/a11y.py $O/ui.xml $DEN "$1" | tee -a $R; }
start(){ adb shell am force-stop $A; adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 3; }
alarms(){ adb shell dumpsys alarm | grep "tag=\*walarm\*:$A.REMIND" | grep -o "walarm\*:$A.REMIND[^ ]*" > $O/alarms_$1.txt; echo "대기 중 $(wc -l < $O/alarms_$1.txt)개(서로 다른 것 $(sort -u $O/alarms_$1.txt | wc -l)개)"; }
result(){ log "  → $1"; }

adb logcat -c
adb shell settings put global hide_error_dialogs 1
DEN=$(adb shell wm density | tr -d '\r' | grep -o '[0-9]*$' | tail -1)
log "== 환경: Android $(adb shell getprop ro.build.version.release | tr -d '\r') / API $(adb shell getprop ro.build.version.sdk | tr -d '\r') / $(adb shell wm size | tr -d '\r') / density $DEN (에뮬레이터)"
adb install -r app-debug.apk | tee -a $R
adb install -r app-debug-androidTest.apk | tee -a $R

log "== 1. 기기 테스트 (ML Kit 글자 인식 · Room · 파일 · AlarmManager · 백업)"
adb shell am instrument -w -r -e class $A.OcrDeviceTest,$A.DataDeviceTest $A.test/androidx.test.runner.AndroidJUnitRunner > $O/instrument.txt 2>&1
python3 - <<'PY' | tee -a $R
import re
t = open('emu/instrument.txt', encoding='utf-8', errors='replace').read()
cur = {}
for blk in t.split('INSTRUMENTATION_STATUS_CODE:'):
    pass
tests = re.findall(r'INSTRUMENTATION_STATUS: class=(\S+)\s+(?:.*\n)*?INSTRUMENTATION_STATUS: test=(\S+)\s+INSTRUMENTATION_STATUS_CODE: (-?\d+)', t)
res = {}
for c, n, code in tests:
    k = c.split('.')[-1] + '.' + n
    if code != '1': res[k] = 'PASS' if code == '0' else 'FAIL'
for k, v in res.items(): print(f"  {v} {k}")
print("  요약:", (re.findall(r'(OK \(\d+ tests?\)|FAILURES!!!.*|Tests run: .*)', t) or ['(요약 없음)'])[-1])
PY
adb logcat -d -s PNTEST:I | sed 's/^.*PNTEST: //' > $O/ocr_log.txt

log "== 2. 첫 실행 안내 (한국어)"
adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 3
adb shell cmd locale set-app-locales $A --locales ko-KR; sleep 2
log "  앱 언어: $(adb shell cmd locale get-app-locales $A | tr -d '\r')"
start; shot 01_onboarding_ko; a11y onboarding
tap "다음"; shot 01b_onboarding_2; tap "다음"; shot 01c_onboarding_3; tap "시작하기"
shot 02_home_empty_ko; has "첫 구매를 저장해 보세요" && result "빈 홈: 추가 버튼·공유 안내 표시" || result "빈 홈 확인 실패"

log "== 3. 비행기 모드에서 주문 화면 공유 → 글자 읽기 → 저장"
adb shell cmd connectivity airplane-mode enable; sleep 2
adb push app/src/androidTest/assets/receipts/receipt_ko.png /data/local/tmp/receipt_ko.png >/dev/null
adb shell "cat /data/local/tmp/receipt_ko.png | run-as $A sh -c 'mkdir -p cache && cat > cache/share_ko.png'"
SHARE="file:///data/data/$A/cache/share_ko.png"
log "  공유 파일: $SHARE (셸은 다른 앱에 미디어 읽기 권한을 줄 수 없어 앱이 읽을 수 있는 파일로 공유 동작을 재현)"
adb shell am start -W -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM $SHARE -n $A/.ui.MainActivity >/dev/null 2>&1; sleep 4
shot 03_share_ko; a11y add_screen
has "사진 1" && result "공유한 사진이 등록 화면에 들어옴" || result "공유 사진이 안 보임(공유 권한 문제일 수 있음)"
tap "사진에서 글자 읽기" 0 10; shot 04_ocr_ko
has "읽어 온 내용" && result "글자 읽기 결과 후보 표시" || result "글자 읽기 결과 없음"
has "자동으로 채운 칸" && result "확실한 값 자동 채움 안내 표시" || result "자동 채움 안내 없음"
tap "무선 이어폰 화이트" 0 2; shot 04b_candidate_picked
tap "저장" 0 4; shot 05_saved_detail
has "주문번호\|상태" && result "저장 후 상세 화면 이동" || result "저장 확인 실패"
adb shell cmd connectivity airplane-mode disable

log "== 3b. 시스템 사진 선택 화면으로 사진 추가"
adb push app/src/androidTest/assets/receipts/receipt_ja.png /sdcard/Pictures/receipt_ja.png >/dev/null
adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/receipt_ja.png >/dev/null 2>&1; sleep 3
start; tap "구매 추가" 0 3; tap "사진 추가" 0 4; shot 03b_picker
dump; P=$(python3 - <<'PY'
import re, xml.etree.ElementTree as ET
r = ET.parse('emu/ui.xml').getroot()
for n in r.iter('node'):
    d = (n.get('content-desc') or '') + (n.get('text') or '')
    if n.get('clickable') == 'true' and re.search(r'(Photo|사진|image|이미지).*(taken|촬영|on|\d)', d, re.I):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds'))); print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
[ -n "$P" ] && adb shell input tap $P && sleep 2
tap "Add (1)" 0 4 || tap "추가(1)" 0 4
has "사진 1" && result "사진 선택기로 고른 사진이 등록 화면에 들어옴" || result "사진 선택기 경로 확인 못함(선택기 화면 자동 조작 실패 가능)"
shot 03c_picked; tap "사진에서 글자 읽기" 0 12; shot 03d_ocr_ja
has "읽어 온 내용" && result "일본어 영수증 자동 언어 인식 결과 표시" || result "일본어 인식 결과 확인 못함"
adb shell input keyevent KEYCODE_BACK; sleep 1; tap "버리기" 0 2

log "== 4. 앱 재실행 후 영수증 다시 열기"
start; tap "무선 이어폰 화이트" 0 3; tap "사진 1" 0 3; shot 06_reopen_receipt
has "맞춤" && result "재실행 후 원본 사진 확대 보기 열림" || result "영수증 다시 열기 실패"
adb shell input keyevent KEYCODE_BACK; sleep 1

log "== 5. 같은 사진 다시 공유 → 기존 기록 먼저"
adb shell am start -W -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM $SHARE -n $A/.ui.MainActivity >/dev/null 2>&1; sleep 4
shot 07_duplicate_share
has "이미 저장한 사진이에요" && result "중복 안내 표시(다른 상품 추가 가능)" || result "중복 안내 없음"
tap "다른 상품 추가"; adb shell input keyevent KEYCODE_BACK; sleep 1; tap "버리기" 0 2

log "== 6. 합성 데이터 + 알림 (권한 허용)"
adb shell am instrument -w -e class $A.SeedTest $A.test/androidx.test.runner.AndroidJUnitRunner > $O/seed.txt 2>&1
adb shell pm grant $A android.permission.POST_NOTIFICATIONS
start; shot 08_home_seeded_ko; a11y home
log "  예약된 알림(기기 테스트 실행이 앱을 강제 종료해 0일 수 있음): $(alarms a)"
adb shell am broadcast -n $A/.reminder.RescheduleReceiver -a kr.test.RESCHEDULE >/dev/null; sleep 3
adb shell am broadcast -n $A/.reminder.RescheduleReceiver -a kr.test.RESCHEDULE >/dev/null; sleep 3
log "  재설정 2번 후: $(alarms b) (같으면 중복 없음)"
for i in $(seq 1 30); do adb shell dumpsys notification --noredact | grep -q "pkg=$A" && break; sleep 6; done
adb shell dumpsys notification --noredact | grep -A40 "pkg=$A" | head -60 > $O/notification.txt
grep -q "pkg=$A" $O/notification.txt && result "기한 당일 알림 게시됨" || result "알림이 3분 안에 오지 않음"
grep -q "2027030412345678" $O/notification.txt && result "주의: 알림에 주문번호 노출" || result "알림에 주문번호 없음"
grep -qi "vis=PRIVATE\|visibility=0\|VISIBILITY_PRIVATE" $O/notification.txt && result "잠금화면 공개 범위: PRIVATE(상품명 숨김 버전 사용)" || result "잠금화면 공개 범위 표시를 dumpsys에서 찾지 못함"
adb shell cmd statusbar expand-notifications; sleep 2; shot 09_notification; adb shell cmd statusbar collapse
adb logcat -d -s EUMPN:I | sed 's/^.*EUMPN *: //' >> $O/eumpn.txt

log "== 6b. 쇼핑몰에서 가져오기 (로그인은 하지 않음: 화면·안전장치만 확인)"
start; tap "쇼핑몰에서 가져오기" 0 3; shot 21_import_pick
has "아마존 (미국)" && result "쇼핑몰 목록 표시(쿠팡·네이버·아마존)" || result "쇼핑몰 목록 확인 실패"
tap "아마존 (미국)" 0 15; shot 22_import_amazon
tap "이 화면 가져오기" 0 3; shot 23_import_none
has "주문을 찾지 못했어요" && result "주문 내역이 아닌 화면(로그인 화면)에서는 아무것도 가져오지 않음" || result "가져오기 버튼 반응 확인 못함"
adb shell input keyevent KEYCODE_BACK; sleep 1; adb shell input keyevent KEYCODE_BACK; sleep 1
tap "쿠팡" 0 15; shot 24_import_coupang; adb shell input keyevent KEYCODE_BACK; sleep 1
tap "네이버 쇼핑(네이버페이)" 0 15; shot 25_import_naver
adb shell input keyevent KEYCODE_BACK; sleep 1; adb shell input keyevent KEYCODE_BACK; sleep 1

log "== 7. 4개 언어 + 미지원 언어 + 긴 번역문"
for L in en-US ja-JP es-ES fr-FR; do
  adb shell cmd locale set-app-locales $A --locales $L; start; shot 10_home_$L
  case $L in en-US) T="Add purchase";; ja-JP) T="購入を追加";; es-ES) T="Añadir compra";; fr-FR) T="Add purchase";; esac
  tap "$T" 0 3; shot 11_add_$L; adb shell input keyevent KEYCODE_BACK; sleep 1
  has "$T\|Settings\|設定\|Ajustes" && result "$L 표시됨" || result "$L 확인 실패"
done
adb shell cmd locale set-app-locales $A --locales ko-KR

log "== 8. 글자 크기 200% + 큰 글씨·간편 보기"
adb shell settings put system font_scale 2.0; start; shot 12_font200_home; a11y font200_home
tap "큰 글씨·간편 보기" 0 2; shot 13_font200_easy; a11y easy
tap "기한 확인" 0 2; shot 14_font200_deadlines; adb shell input keyevent KEYCODE_BACK; sleep 1
tap "구매 추가" 0 2; shot 15_font200_add; a11y font200_add; adb shell input keyevent KEYCODE_BACK; sleep 1
tap "기본 보기로" 0 2
adb shell settings put system font_scale 1.0

log "== 9. 다크 모드 · 가로 화면"
adb shell cmd uimode night yes; start; shot 16_dark_home
tap "무선 이어폰 화이트" 0 3; shot 17_dark_detail; adb shell cmd uimode night no
adb shell cmd window user-rotation lock 1; sleep 4; shot 18_landscape_detail
tap "수정" 0 3; shot 18b_landscape_edit; adb shell input keyevent KEYCODE_BACK; sleep 1
adb shell cmd window user-rotation lock 0; adb shell cmd window user-rotation free; sleep 2

log "== 10. 알림 거부 상태"
adb shell pm revoke $A android.permission.POST_NOTIFICATIONS; start; shot 19_notif_denied
has "알림이 꺼져 있어요" && result "거부 시 안내 문구 표시 + 앱 내 기한 목록 유지" || result "거부 안내 확인 실패"
adb shell pm grant $A android.permission.POST_NOTIFICATIONS

log "== 11. 기기 시간대 변경"
adb logcat -c
adb shell settings put global auto_time_zone 0
adb shell service call alarm 3 s16 America/New_York >/dev/null 2>&1; sleep 5
log "  현재 시간대: $(adb shell getprop persist.sys.timezone | tr -d '\r')"
adb logcat -d -s EUMPN:I | grep "TIMEZONE_CHANGED" | tail -1 | tee -a $R
adb logcat -d -s EUMPN:I | grep -q "TIMEZONE_CHANGED" && result "시간대 변경 후 알림 재계산 실행" || result "시간대 변경 신호 확인 못함"
log "  변경 후 알림: $(alarms tz)"
adb shell service call alarm 3 s16 Asia/Seoul >/dev/null 2>&1; sleep 3

log "== 12. 재부팅"
adb reboot; adb wait-for-device
for i in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] && break; sleep 3; done; sleep 60
adb shell settings put global hide_error_dialogs 1
adb logcat -d -s EUMPN:I | grep "BOOT_COMPLETED" | tail -1 | tee -a $R
adb logcat -d -s EUMPN:I | grep -q "BOOT_COMPLETED" && result "재부팅 후 알림 재설정 실행" || result "재부팅 신호 확인 못함(로그 버퍼 확인 필요)"
log "  재부팅 후 알림: $(alarms boot)"
start; shot 20_after_reboot
adb logcat -d -s EUMPN:I | sed 's/^.*EUMPN *: //' >> $O/eumpn.txt
adb logcat -d | grep -E "FATAL|AndroidRuntime" | grep -i -B2 -A10 "$A" > $O/crash.txt
[ -s $O/crash.txt ] && log "== 앱 종료(크래시) 기록 있음: crash.txt" || log "== 크래시 없음"
log "== 끝"
