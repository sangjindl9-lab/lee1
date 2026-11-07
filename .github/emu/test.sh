#!/bin/bash
# 에뮬레이터 실동작 테스트 (실기기 아님). 결과는 emu/report.txt 와 PNG 로 남긴다.
A=kr.eumsoft.quick
D=.github/emu
O=emu; mkdir -p $O
R=$O/report.txt
log(){ echo "$*" | tee -a $R; }
shot(){ adb exec-out screencap -p > $O/$1.png; }
dump(){ adb shell uiautomator dump --windows /sdcard/ui.xml >/dev/null 2>&1 || adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml $O/ui.xml >/dev/null 2>&1; }
tap_text(){ dump; p=$(python3 $D/ui.py $O/ui.xml "$1" $2) || { log "  (못 찾음: $1)"; return 1; }; adb shell input tap $p; sleep ${3:-2}; }
elog(){ adb logcat -d -s EUMQ:I | grep EUMQ | tail -${1:-6} | sed 's/^.*EUMQ *: /    log: /' | tee -a $R; adb logcat -c; }
helper(){ adb logcat -d -s EUMQ:I | grep "helper " | tail -1 | awk '{n=NF; print $(n-3)+int($(n-1)/2), $(n-2)+int($(n-1)/2)}'; }
pics(){ adb shell ls /sdcard/Pictures/EUM_QUICK/ 2>/dev/null | tr -d '\r'; }
pullnew(){ # $1 = 저장 이름, 이전 목록과 비교해 새 파일을 가져온다
  local now; now=$(pics)
  local f; f=$(comm -13 <(echo "$BEFORE" | sort) <(echo "$now" | sort) | head -1)
  if [ -z "$f" ]; then log "  결과: 새 캡처 파일 없음 → 실패"; BEFORE=$now; return 1; fi
  adb pull "/sdcard/Pictures/EUM_QUICK/$f" $O/$1.png >/dev/null
  log "  결과: 저장됨 $f / $(python3 -c "import struct;d=open('$O/$1.png','rb').read(24);print('%dx%d'%struct.unpack('>II',d[16:24]))")"
  BEFORE=$now
}

log "== 환경"; log "$(adb shell getprop ro.build.version.release | tr -d '\r') / API $(adb shell getprop ro.build.version.sdk | tr -d '\r') / $(adb shell wm size | tr -d '\r') / density $(adb shell wm density | tr -d '\r' | grep -o '[0-9]*$')"
adb install -r eum-quick.apk | tee -a $R
adb shell pm grant $A android.permission.POST_NOTIFICATIONS
adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 3; shot 01_home_before
adb shell am force-stop $A
adb push $D/eum.xml /data/local/tmp/eum.xml >/dev/null
adb shell "cat /data/local/tmp/eum.xml | run-as $A sh -c 'mkdir -p shared_prefs && cat > shared_prefs/eum.xml'"
adb shell settings put secure enabled_accessibility_services $A/$A.service.HelperService
adb shell settings put secure accessibility_enabled 1
sleep 6
log "== 접근성 서비스"; adb shell dumpsys accessibility | grep -o "kr.eumsoft.quick[^ ,}]*" | sort -u | tee -a $R
adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 3; shot 02_home_on

# 도우미 버튼 위치 계산 (기본: 오른쪽, 높이 40%, 44dp)
read W H < <(adb shell wm size | tr -d '\r' | grep -o '[0-9]*x[0-9]*' | tail -1 | tr x ' ')
DEN=$(adb shell wm density | tr -d '\r' | grep -o '[0-9]*$' | tail -1)
S=$((44*DEN/160)); BX=$((W - S/2)); BY=$((H*400/1000 + S/2))
log "도우미 버튼 예상 위치 $BX,$BY (크기 ${S}px)"

adb shell input keyevent KEYCODE_HOME; sleep 2; shot 03_launcher_with_helper
BEFORE=$(pics)

for NAV in gestural threebutton; do
  adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.$NAV >/dev/null 2>&1; sleep 4
  adb shell input keyevent KEYCODE_HOME; sleep 2
  shot 04_${NAV}_screen
  log "== [$NAV] 길게 누르기 캡처"; adb logcat -c; adb shell input swipe $BX $BY $BX $BY 1200; sleep 2; shot 05_${NAV}_longpress_toast; sleep 3; pullnew 05_${NAV}_longpress; elog
  log "== [$NAV] 세 번 터치 캡처"; adb shell "input tap $BX $BY; input tap $BX $BY; input tap $BX $BY"; sleep 5; pullnew 06_${NAV}_triple; elog
done

log "== 가로 화면 캡처 (3버튼)"
adb shell settings put system accelerometer_rotation 0; adb shell settings put system user_rotation 1; sleep 4
adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 3
shot 07_landscape_screen
read W2 H2 < <(echo $H $W)
adb shell input swipe $((W2 - S/2)) $((H2*400/1000 + S/2)) $((W2 - S/2)) $((H2*400/1000 + S/2)) 1200; sleep 5; pullnew 08_landscape_capture; elog
adb shell settings put system user_rotation 0; sleep 3

log "== 공유 메뉴로 클립 저장"
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "붙여넣기테스트" -n $A/.ui.ShareReceiveActivity >/dev/null; sleep 2
adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "482913" -n $A/.ui.ShareReceiveActivity >/dev/null; sleep 2
adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 2
tap_text "클립 보관함"; shot 09_clips
dump; grep -o 'text="[^"]*테스트[^"]*"\|text="482913"' $O/ui.xml | sort -u | tee -a $R

log "== 입력창 붙여넣기 (기본 키보드, ACTION_PASTE 경로)"
tap_text "수정" "" 3
adb shell input keyevent KEYCODE_MOVE_HOME 2>/dev/null
# EditText를 탭해서 커서를 둔다
dump; p=$(python3 - $O/ui.xml <<'PY'
import sys,re,xml.etree.ElementTree as ET
for n in ET.parse(sys.argv[1]).getroot().iter('node'):
    if n.get('class')=='android.widget.EditText':
        x1,y1,x2,y2=map(int,re.findall(r'\d+',n.get('bounds'))); print(x1+40,(y1+y2)//2); break
PY
)
adb shell input tap $p; sleep 2
adb shell input keyevent KEYCODE_MOVE_END; adb shell input keyevent KEYCODE_DPAD_LEFT KEYCODE_DPAD_LEFT KEYCODE_DPAD_LEFT; sleep 1
shot 10_field_focused
HP=$(helper); log "  도우미 위치(입력창 옆): $HP"; elog 3
log "  붙여넣기 전 입력창: $(dump; python3 $D/find_text.py $O/ui.xml | head -1)"
adb logcat -c
adb shell input tap $HP; sleep 3; shot 11_panel_open
RP=$(adb logcat -d -s EUMQ:I | grep "panel row0" | tail -1 | awk '{print $(NF-1), $NF}')
log "  패널 첫 항목 위치: $RP"
adb shell input tap $RP; sleep 3; shot 12_after_paste; elog
log "  붙여넣기 후 입력창: $(dump; python3 $D/find_text.py $O/ui.xml | head -1)"
log "== 전용 키보드"
adb shell ime enable $A/.ime.EumKeyboard | tee -a $R
adb shell ime set $A/.ime.EumKeyboard | tee -a $R
sleep 2; adb shell input tap $p; sleep 3; shot 13_ime
adb shell ime reset >/dev/null 2>&1

log "== 화면들"
adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 2
tap_text "캡처 보관함"; shot 14_captures
tap_text "설정"; shot 15_settings
adb shell input swipe $((W/2)) $((H*3/4)) $((W/2)) $((H/4)) 300; sleep 1; shot 16_settings2
tap_text "홈"; shot 17_home

log "== 오류(크래시) 로그"
adb logcat -d -b crash | tail -50 | tee -a $R
adb logcat -d | grep -i "kr.eumsoft.quick\|AndroidRuntime" | tail -80 > $O/logcat.txt
log "끝"
