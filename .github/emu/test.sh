#!/bin/bash
# 에뮬레이터 자동 테스트 (실제 기기 아님). 결과: emu/report.txt + 화면 캡처
A=kr.eumsoft.kidscoloring
D=.github/emu
TAG=${1:-phone}
O=emu; mkdir -p $O
R=$O/report_$TAG.txt
PASS=0; FAIL=0
log(){ echo "$*" | tee -a $R; }
ok(){ PASS=$((PASS+1)); log "PASS $*"; }
ng(){ FAIL=$((FAIL+1)); log "FAIL $*"; }
shot(){ adb exec-out screencap -p > $O/${TAG}_$1.png; }
dump(){ adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml $O/ui.xml >/dev/null 2>&1; }
has(){ dump; python3 $D/ui.py $O/ui.xml has "$1"; }
tap(){ dump; p=$(python3 $D/ui.py $O/ui.xml find "$1" $2) || { log "  (못 찾음: $1)"; return 1; }; adb shell input tap $p; sleep ${3:-2}; }
# 가로로 스크롤되는 줄(도구, 색상) 안의 항목: 안 보이면 anchor 가 있는 줄을 왼쪽으로 밀어 찾는다
tapx(){ for i in 1 2 3 4; do dump; p=$(python3 $D/ui.py $O/ui.xml find "$1" exact) && { adb shell input tap $p; sleep 1; return 0; }
  a=$(python3 $D/ui.py $O/ui.xml find "$2" exact) || a=$(python3 $D/ui.py $O/ui.xml find "$3" exact) || break; read ax ay <<< "$a"; adb shell input swipe $((SW*8/10)) $ay $((SW*4/10)) $ay 500; sleep 1; done; log "  (못 찾음: $1)"; return 1; }
canvas(){ dump; python3 $D/ui.py $O/ui.xml bounds "색칠 도안"; }
# 에뮬레이터 자체의 "응답 없음" 창(런처 등)이 뜨면 닫는다
anr(){ if has "isn't responding"; then log "  (에뮬레이터 시스템 창 닫음: $(grep -o 'text="[^"]*responding"' $O/ui.xml | head -1))"; tap "Close app" "" 5; fi; }
geom(){ B=$(canvas); read X1 Y1 X2 Y2 <<< "$B"; CX=$(((X1+X2)/2)); CY=$(((Y1+Y2)/2)); W=$((X2-X1)); H=$((Y2-Y1)); S=$((W<H?W:H)); }
check(){ if "${@:2}"; then ok "$1"; else ng "$1"; fi; }

log "== 환경: Android $(adb shell getprop ro.build.version.release | tr -d '\r') / API $(adb shell getprop ro.build.version.sdk | tr -d '\r') / $(adb shell wm size | tr -d '\r') / $(adb shell wm density | tr -d '\r') / $TAG"
API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
adb logcat -c
# 에뮬레이터 런처 등의 "응답 없음" 창이 화면을 가리지 않게 한다 (앱 자체의 비정상 종료는 아래에서 logcat 으로 따로 확인)
adb shell settings put global hide_error_dialogs 1
adb install -r eum-kids-coloring.apk | tail -1 | tee -a $R
log "요청 권한: $(adb shell dumpsys package $A | grep -A8 'requested permissions:' | grep 'android.permission' | tr -d ' \r' | tr '\n' ' ')"
# 오프라인: 통신을 모두 끈 상태에서 진행
adb shell svc wifi disable; adb shell svc data disable
read SW SH < <(adb shell wm size | tr -d '\r' | grep -o '[0-9]*x[0-9]*' | tail -1 | tr x ' ')
sleep 15; anr
# 다국어: 언어를 바꿔 가며 첫 화면·색칠 화면·완성 축하·색 조정판이 그 언어로 나오는지 보고,
# 언어별 스토어 스크린샷(l10n_<언어>_1~4)을 찍는다. (앱 실행 인텐트의 lang 값으로 언어 고정)
J=app/src/main/assets/i18n
# L10N_LANGS 로 언어를 고르고, L10N_ONLY 가 있으면 언어별 화면만 찍고 끝낸다 (스토어 스크린샷만 다시 찍을 때)
for L in ${L10N_LANGS:-en ja es pt zh-CN zh-TW de fr id hi}; do
  T(){ python3 -c "import json,sys;print(json.load(open('$J/$L.json'))[sys.argv[1]])" "$1"; }
  adb shell am force-stop $A; adb shell pm clear $A >/dev/null
  adb shell am start -W -n $A/.ui.MainActivity --es lang $L >/dev/null; sleep 5; anr
  shot l10n_${L}_1
  if has "$(T '오늘은 무엇을 색칠할까요?')" && has "$(T '동물 친구들')"; then ok "언어 $L: 첫 화면 번역 표시 ($(T '오늘은 무엇을 색칠할까요?'))"; else ng "언어 $L: 첫 화면 번역 표시"; fi
  tap "$(T '눌러서 색칠해요 🎨')" "" 6
  M=$(T '더보기')
  if has "$M"; then ok "언어 $L: 색칠 화면 번역 표시 ($M)"; else ng "언어 $L: 색칠 화면 번역 표시 ($M)"; fi
  tap "$M" exact 2; tap "$(T '✨ 자동 색칠')" "" 2; tap "$(T '무지개')" exact 1
  shot l10n_${L}_3
  if has "$(T '참 잘했어요!')"; then ok "언어 $L: 자동 색칠 뒤 완성 축하 표시"; else ng "언어 $L: 자동 색칠 뒤 완성 축하 표시"; fi
  sleep 4; shot l10n_${L}_2
  if tapx "$(T '＋ 나만의 색')" "$(T '기본')" "$(T '무지개')"; then
    sleep 1; shot l10n_${L}_4
    if has "$(T '이 색으로 칠하기')"; then ok "언어 $L: 색 조정판 번역 표시"; else ng "언어 $L: 색 조정판 번역 표시"; fi
    tap "$(T '닫기')" exact 1
  else ng "언어 $L: 색 조정판 열기"; fi
done
adb shell am force-stop $A; adb shell pm clear $A >/dev/null
if [ -n "$L10N_ONLY" ]; then log "== 결과($TAG, 언어별 화면만): PASS $PASS / FAIL $FAIL"; exit 0; fi
# 아래 기능 테스트는 한국어 화면으로 진행한다
adb shell am start -W -n $A/.ui.MainActivity --es lang ko >/dev/null; sleep 6; anr; anr; shot 01_home
check "앱 설치 후 실행 (오프라인)" has "오늘의 추천 그림"
check "카테고리 표시: 동물 친구들" has "동물 친구들"

tap "당근을 들고 있는 아기 토끼" "" 6; shot 02_coloring
anr; geom
if [ -n "$B" ]; then ok "도안 열기 / 색칠 화면 표시"; else ng "도안 열기"; fi
log "  캔버스 $B"
# 영역 채우기: 가운데 근처 여러 곳
adb shell input tap $((CX - S/5)) $((CY - S/6)); sleep 1
tapx "파랑" "빨강" "주황"; adb shell input tap $((CX + S/12)) $((CY + S/5)); sleep 1
tapx "노랑" "빨강" "주황"; adb shell input tap $((X1 + S/20 + (W-S)/2)) $((Y1 + S/20 + (H-S)/2)); sleep 1
shot 03_filled
# 나만의 색 만들기(색 정밀 조정판)
if tapx "＋ 나만의 색" "기본" "무지개"; then
  sleep 1; shot 03b_color_picker
  check "색 정밀 조정판 열림" has "이 색으로 칠하기"
  tap "밝게 줄이기" exact 0.5; tap "밝게 줄이기" exact 0.5; tap "색깔 늘리기" exact 0.5
  check "조금씩 조절 버튼 표시" has "선명하게 늘리기"
  tap "이 색으로 칠하기" "" 1; adb shell input tap $((CX + S/4)) $((CY + S/4)); sleep 1; shot 03c_custom_color
  if has "이 색으로 칠하기"; then ng "색을 고르면 조정판이 닫힘"; else ok "색을 고르면 조정판이 닫힘"; fi
else ng "색 정밀 조정판 열림"; fi
# 붓 (손가락)
tap "붓" exact 1; tapx "초록" "노랑" "파랑"; geom; log "  캔버스(붓 도구) $B"
adb shell input swipe $((CX - S/3)) $((CY + S/3)) $((CX + S/3)) $((CY + S/4)) 600; sleep 1
# 스타일러스 입력 (에뮬레이션: 실제 S Pen 아님, 필압 없음)
tap "크레용" exact 1; tapx "보라" "초록" "파랑"
adb shell input stylus swipe $((CX - S/3)) $((CY - S/3)) $((CX + S/4)) $((CY - S/4)) 600; sleep 1
shot 04_brush
tap "취소" exact 1; shot 05_undo
tap "다시" exact 1; shot 06_redo
# 스티커
tapx "스티커" "형광펜" "반짝이"; adb shell input tap $((CX + S/3)) $((CY - S/3)); sleep 1
# 확대(두 손가락은 adb 로 못 하므로 생략) / 화면 회전
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1; sleep 4; shot 07_rotated
check "화면 회전 후에도 색칠 화면 유지" has "색칠 도안"
adb shell settings put system user_rotation 0; sleep 4; shot 08_rotated_back
check "되돌려도 색칠 화면 유지" has "색칠 도안"
# 사진으로 내보내기 (보호자 확인 문제를 풀어야 함)
if [ "$API" -ge 29 ]; then
  tap "더보기" exact 2; tap "사진으로 내보내기" "" 2; shot 09_gate
  dump; ANS=$(python3 $D/ui.py $O/ui.xml gate)
  if [ -n "$ANS" ]; then ok "내보내기 전에 보호자 확인이 뜸"; else ng "보호자 확인"; fi
  for d in $(echo $ANS | grep -o .); do tap "$d" exact 0.5; done
  tap "확인" exact 3
  F=$(adb shell ls /sdcard/Pictures/EumKidsColoring/ 2>/dev/null | tr -d '\r' | head -1)
  if [ -n "$F" ]; then adb pull "/sdcard/Pictures/EumKidsColoring/$F" $O/${TAG}_export.png >/dev/null; ok "PNG 저장: $F ($(python3 -c "import struct;d=open('$O/${TAG}_export.png','rb').read(24);print('%dx%d'%struct.unpack('>II',d[16:24]))"))"; else ng "PNG 저장"; fi
else
  log "SKIP PNG 저장 (API 28 이하는 시스템 파일 선택 화면을 쓰므로 자동 테스트 제외)"
fi
# 자동 저장 → 강제 종료 → 복구
log "  자동 저장 대기(5초: 칠한 뒤 2초 안에 저장되는지)"; sleep 5
adb shell am force-stop $A; sleep 1
adb shell run-as $A ls -la files/projects/ 2>/dev/null | tail -3 | tee -a $R
adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 5; shot 10_after_kill
check "강제 종료 후 재실행: '이어서 색칠하기' 표시" has "이어서 색칠하기"
tap "이어서 색칠하기" "" 1
tap "아기 토끼 이어서" "" 6 || tap "당근을 들고 있는 아기 토끼" "" 6
shot 11_restored
check "저장된 그림 복원 화면" has "색칠 도안"
# 다 했어요 → 축하 → 갤러리
tap "완성" exact 1; shot 12_celebrate; sleep 4
tap "홈" exact 3; shot 12b_leave_completed
if has "지우고 나가기"; then ng "완성한 그림은 묻지 않고 나감"; tap "저장하고 나가기" "" 3; else ok "완성한 그림은 묻지 않고 나감"; fi
tap "내 그림" exact 3; shot 13_gallery
check "완성한 그림이 갤러리에 표시" has "당근을 들고 있는 아기 토끼"
adb shell input keyevent KEYCODE_BACK; sleep 2
# 부모님 메뉴
tap "부모님" exact 2; dump; ANS=$(python3 $D/ui.py $O/ui.xml gate)
for d in $(echo $ANS | grep -o .); do tap "$d" exact 0.5; done
tap "확인" exact 3; shot 14_parent
check "부모님 메뉴 진입 (성인 확인 통과 후)" has "부모님 메뉴"
adb shell input keyevent KEYCODE_BACK; sleep 2
# 다른 도안 몇 장 열어 보기
for T in "웃고 있는 아기 티라노사우루스" "둥근 머리의 친구 로봇"; do
  for i in 1 2 3 4; do has "$T" && break; adb shell input swipe $((CX)) $((CY + S/3)) $((CX)) $((CY - S/3)) 300; sleep 1; done
  tap "$T" "" 6 && check "도안 열기: $T" has "색칠 도안"
  shot "15_art_$(echo $T | md5sum | cut -c1-4)"
  tap "홈" exact 1; tap "저장하고 나가기" "" 3
done
# 뒤로 가기 → 지우고 나가기
for i in 1 2 3; do has "작은 날개가 달린 아기 용" && break; adb shell input swipe $((SW/2)) $((SH*7/10)) $((SW/2)) $((SH*3/10)) 300; sleep 1; done
tap "작은 날개가 달린 아기 용" "" 6; geom; adb shell input tap $CX $CY; sleep 4
adb shell input keyevent KEYCODE_BACK; sleep 2; shot 16_exit_dialog
check "뒤로 가기: 저장/지우기 선택 창" has "지우고 나가기"
tap "지우고 나가기" "" 2; tap "지우기" exact 4
N=$(adb shell run-as $A ls files/projects/ | tr -d '\r' | wc -l)
adb shell am force-stop $A; adb shell am start -W -n $A/.ui.MainActivity >/dev/null; sleep 5
tap "내 그림" exact 3; tap "색칠하는 중" exact 2; shot 17_after_discard
if has "작은 날개가 달린 아기 용"; then ng "지우고 나가면 목록에 남지 않음"; else ok "지우고 나가면 목록에 남지 않음 (저장 폴더 $N개)"; fi
CR=$(adb logcat -d | grep -A2 "FATAL EXCEPTION" | grep -c "Process: $A")
if [ "$CR" = "0" ]; then ok "비정상 종료 없음"; else ng "비정상 종료 $CR 회"; adb logcat -d | grep -A30 "FATAL EXCEPTION: main" | head -90 >> $R; fi
adb shell dumpsys meminfo $A | grep -E "TOTAL PSS|TOTAL:" | head -2 | tee -a $R
log "== 결과($TAG): PASS $PASS / FAIL $FAIL"
