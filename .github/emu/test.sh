#!/bin/bash
# EUM SECURITY PRO 에뮬레이터 실동작 검수 (실기기 아님). 결과: emu/report.txt + 화면 PNG + 로그
API=${1:-?}
A=kr.eumsoft.securitypro.full
P=kr.eumsoft.securitypro
D=.github/emu
O=emu; mkdir -p $O
R=$O/report.txt
log(){ echo "$*" | tee -a $R; }
shot(){ adb exec-out screencap -p > $O/api${API}_$1.png; }
dump1(){ adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml $O/ui.xml >/dev/null 2>&1; }
dump(){ dump1; if grep -q "isn't responding" $O/ui.xml; then p=$(python3 $D/ui.py $O/ui.xml "Wait") && adb shell input tap $p; sleep 2; dump1; fi; }
tap(){ dump; p=$(python3 $D/ui.py $O/ui.xml "$1" ${2:-0}) || { log "  (화면에서 못 찾음: $1)"; return 1; }; adb shell input tap $p; sleep ${3:-2}; }
has(){ dump; grep -q "$1" $O/ui.xml; }
ok(){ log "  [통과] $*"; }
ng(){ log "  [실패] $*"; }
# 셸에서 도메인 해석 결과(IP) — ping 의 첫 줄 "PING host (IP)" 에서 IP 만 꺼낸다
resolve(){ adb shell "ping -c 1 -W 3 $1 2>&1 | head -1" | tr -d '\r' | sed -n 's/^PING [^ ]* (\([^)]*\)).*/\1/p'; }
check_block(){ local ip; ip=$(resolve $1); if [ "$ip" = "0.0.0.0" ] || [ "$ip" = "127.0.0.1" ] || [ "$ip" = "::" ]; then ok "$2: $1 → $ip (차단)"; else ng "$2: $1 → '${ip:-해석 실패}' (차단 안 됨)"; fi; }
check_pass(){ local ip; ip=$(resolve $1); if [ -n "$ip" ] && [ "$ip" != "0.0.0.0" ] && [ "$ip" != "127.0.0.1" ]; then ok "$2: $1 → $ip (정상 해석)"; else ng "$2: $1 → '${ip:-해석 실패}'"; fi; }

adb logcat -c
adb shell settings put global hide_error_dialogs 1
log "== 환경: Android $(adb shell getprop ro.build.version.release | tr -d '\r') / API $(adb shell getprop ro.build.version.sdk | tr -d '\r') / ABI $(adb shell getprop ro.product.cpu.abi | tr -d '\r') (에뮬레이터, 실기기 아님)"
adb install -r app-debug.apk | tee -a $R
adb install -r app-debug-androidTest.apk | tee -a $R

log "== 1. 기기 테스트 (네이티브 YARA-X·Ed25519, APK 분석, 매니페스트 파서, Room 스키마)"
adb shell am instrument -w -r -e class kr.eumsoft.securitypro.DeviceEngineTest $A.test/androidx.test.runner.AndroidJUnitRunner > $O/instrument.txt 2>&1
python3 - <<'PY' | tee -a $R
import re
t = open('emu/instrument.txt', encoding='utf-8', errors='replace').read()
res = {}
for c, n, code in re.findall(r'INSTRUMENTATION_STATUS: class=(\S+)\s+(?:.*\n)*?INSTRUMENTATION_STATUS: test=(\S+)\s+INSTRUMENTATION_STATUS_CODE: (-?\d+)', t):
    if code != '1': res[n] = 'PASS' if code == '0' else 'FAIL'
for k, v in res.items(): print(f"  {v} DeviceEngineTest.{k}")
for m in re.findall(r'INSTRUMENTATION_STATUS: stack=(.*)', t)[:5]: print("    ", m[:300])
print("  요약:", (re.findall(r'(OK \(\d+ tests?\)|FAILURES!!!.*|Tests run: .*)', t) or ['(요약 없음)'])[-1])
PY
adb logcat -d -s EUMTEST:I | sed 's/^.*EUMTEST: /  · /' | tee -a $R

log "== 2. 앱 시작 · 시작 시간 (시스템 언어 영어 — UI 조작은 영어 화면 기준)"
adb shell pm grant $A android.permission.POST_NOTIFICATIONS 2>/dev/null
adb shell cmd locale set-app-locales $A --locales ko-KR 2>/dev/null
adb shell am force-stop $A
log "  콜드 스타트: $(adb shell am start -W -n $A/kr.eumsoft.securitypro.ui.MainActivity | grep -E 'TotalTime|WaitTime' | tr -d '\r' | tr '\n' ' ')"
sleep 3; shot 01_onboarding
tap "Next"; tap "Next"; tap "Get started"; sleep 2; shot 02_home

log "== 3. 정상 DNS (VPN 켜기 전)"
check_pass example.com "VPN 전 정상 사이트"
BASE_AD=$(resolve doubleclick.net); log "  VPN 전 doubleclick.net → ${BASE_AD:-해석 실패}"

log "== 4. 광고 차단 VPN 연결"
adb shell appops set $A ACTIVATE_VPN allow
T0=$(date +%s%3N)
tap "Block ads, trackers & phishing" 0 6
for i in $(seq 1 40); do adb shell dumpsys connectivity 2>/dev/null | grep -q "Transports: VPN" && break; sleep 1; done
log "  VPN 연결 감지까지: $(( $(date +%s%3N) - T0 )) ms (UI 누름 포함)"
adb shell dumpsys connectivity | grep -m2 -E "VPN|tun" | tr -d '\r' | sed 's/^/  · /' | tee -a $R
adb logcat -d -s EUM_VPN:I | tail -3 | sed 's/^.*EUM_VPN: /  · /' | tee -a $R
log "  필터 목록 내려받기 대기 (최대 120초)…"
for i in $(seq 1 60); do adb logcat -d -s EUM_DNS:I | grep -q "filters=\[1" && break; sleep 2; done
adb logcat -d -s EUM_DNS:I | grep "DnsProxy 시작" | tail -1 | sed 's/^.*EUM_DNS: /  · /' | tee -a $R
sleep 3; shot 03_home_vpn_on

log "== 5. 차단 동작"
check_pass example.com "정상 사이트 유지"
check_pass www.google.com "정상 사이트 유지"
check_pass github.com "정상 사이트 유지"
check_block doubleclick.net "광고 도메인"
check_block googleadservices.com "광고 도메인"
check_block phishing-test.eum-security.invalid "피싱 테스트 도메인 (서명된 위협 DB)"
check_block malware-test.eum-security.invalid "악성 테스트 도메인 (서명된 위협 DB)"
log "  · 앱 차단 기록:"; adb logcat -d -s EUM_DNS:I | grep "blocked domain" | head -8 | sed 's/^.*EUM_DNS: /    /' | tee -a $R
log "  · 일반 트래픽 경로: VPN 에는 198.18.53.53/32·fd00:e0a::53/128 만 라우팅 (ip route)"
adb shell ip route show table all 2>/dev/null | grep -E "198.18.53|tun" | head -4 | sed 's/^/    /' | tee -a $R

log "== 6. DNS 응답 지연 (앱 기록, 캐시 제외)"
for d in example.org wikipedia.org cloudflare.com apple.com microsoft.com naver.com; do resolve $d >/dev/null; done
adb logcat -d -s EUM_DNS:D | grep "pass domain" | grep "cache=false" | sed -n 's/.*ms=\([0-9]*\).*/\1/p' > $O/latency.txt
python3 -c "
v=[int(x) for x in open('emu/latency.txt') if x.strip()]
print('  업스트림 질의 %d건: 평균 %.0f ms, 최대 %d ms' % (len(v), sum(v)/len(v), max(v)) if v else '  (지연 기록 없음)')" | tee -a $R

log "== 7. 허용 목록 우선순위 (doubleclick.net 허용)"
tap "Ad Block" 0 2; tap "Allow/Block" 0 2
dump; p=$(python3 $D/ui.py $O/ui.xml "Domain (e.g. example.com)") && adb shell input tap $p && sleep 1 && adb shell input text "doubleclick.net" && sleep 1
adb shell input keyevent 111 2>/dev/null; tap "Allow" 0 25
shot 04_allowlist
check_pass doubleclick.net "허용 목록 도메인"
check_block googleadservices.com "다른 광고 도메인은 계속 차단"

log "== 8. 일시 정지 5분 → 재개"
tap "Status" 0 2; tap "5 min" 0 12
check_pass googleadservices.com "일시 정지 중"
tap "Resume now" 0 12
check_block googleadservices.com "재개 후"
shot 05_adblock_status

log "== 9. 네트워크 전환 (Wi-Fi 끄기/켜기, 모바일 데이터)"
adb shell svc wifi disable; sleep 8
log "  Wi-Fi 끔: $(adb shell dumpsys connectivity | grep -m1 -oE 'NetworkAgentInfo\{[^}]*(MOBILE|WIFI)' | grep -oE 'MOBILE|WIFI' | head -1)"
check_pass example.com "Wi-Fi 끔(모바일)"
check_block googleadservices.com "Wi-Fi 끔(모바일)"
adb shell svc wifi enable; sleep 10
check_pass example.com "Wi-Fi 다시 켬"
check_block googleadservices.com "Wi-Fi 다시 켬"
adb logcat -d -s EUM_VPN:I | grep "네트워크 변경" | tail -3 | sed 's/^.*EUM_VPN: /  · /' | tee -a $R

log "== 10. 화면 · 통계 · 차단 기록"
tap "Block log" 0 2; shot 07_blocklog
has "googleadservices.com" && ok "차단 기록에 도메인 표시" || ng "차단 기록 표시"
tap "Stats" 0 2; shot 06_stats
tap "Filters" 0 2; shot 08_filters

log "== 11. 악성코드 빠른 검사"
tap "Scan" 0 2; shot 09_scan
T1=$(date +%s)
tap "Quick scan" 0 3
for i in $(seq 1 90); do has "Scan summary" && break; sleep 2; done
log "  빠른 검사 소요: $(( $(date +%s) - T1 )) 초"
shot 10_scan_result
has "Scan summary" && ok "검사 결과 화면" || ng "검사 결과 화면"
dump; grep -oE 'text="(대상|위험|주의|검사 불가)[^"]*"' $O/ui.xml | head -6 | sed 's/^/  · /' | tee -a $R

log "== 12. 설치 앱 정밀 검사 + 검사 중지"
tap "Scan" 0 2; tap "Full installed-app scan" 0 6
has "Stop scan" && { tap "Stop scan" 0 3; ok "검사 중지 버튼 동작"; } || log "  (이미 끝났거나 표시 안 됨)"
sleep 3; tap "Scan" 0 2; dump; grep -c "CANCELLED" $O/ui.xml | sed 's/^/  · 중지된 세션 표시 수: /' | tee -a $R

log "== 13. 보안 DB · 설정 화면"
tap "Security DB" 0 3; shot 11_db
has "rules" && ok "보안 DB 화면" || ng "보안 DB 화면"
dump; grep -oE 'text="yara-x[^"]*"' $O/ui.xml | head -2 | sed 's/^/  · /' | tee -a $R
tap "Update now (threat DB + ad filters)" 0 25; shot 12_db_updated
dump; grep -oE 'text="(최신 버전|버전 [0-9]+ 적용|실패)[^"]*"' $O/ui.xml | head -2 | sed 's/^/  · /' | tee -a $R
tap "Settings" 0 2; shot 13_settings

adb logcat -d -s EUM_FILTER:W | sed 's/^.*EUM_FILTER: /  · /' | tee -a $R
log "== 14. 성능 (VPN 실행 중)"
log "  메모리: $(adb shell dumpsys meminfo $A | grep -m1 'TOTAL' | tr -s ' ' | tr -d '\r')"
log "  CPU: $(adb shell top -b -n 1 | grep $A | head -1 | tr -s ' ' | tr -d '\r')"
adb shell dumpsys batterystats --charged $A 2>/dev/null | grep -m3 -iE "Estimated power use|Uid u0a|computed drain" | tr -s ' ' | sed 's/^/  · /' | tee -a $R

log "== 15. 앱 종료 후 재실행 (설정 유지 · VPN 유지)"
adb shell am force-stop $A; sleep 3
log "  강제 종료 후 VPN: $(adb shell dumpsys connectivity | grep -c 'Transports: VPN') (0 이면 꺼짐 — 사용자가 다시 켜야 함)"
adb shell am start -W -n $A/kr.eumsoft.securitypro.ui.MainActivity >/dev/null; sleep 4; shot 14_relaunch
has "Get started" && ng "재실행 시 첫 안내가 다시 나옴(설정 유지 실패)" || ok "재실행 후 첫 안내 생략 (설정 유지)"

log "== 16. VPN 끄기 → 네트워크 복구"
adb shell am start -W -n $A/kr.eumsoft.securitypro.ui.MainActivity >/dev/null; sleep 2
tap "Home" 0 2
has 'checked="true"' && tap "Block ads, trackers & phishing" 0 5
for i in $(seq 1 15); do adb shell dumpsys connectivity | grep -q "Transports: VPN" || break; sleep 1; done
check_pass example.com "VPN 끈 뒤 정상 사이트"
AFTER_AD=$(resolve doubleclick.net); log "  VPN 끈 뒤 doubleclick.net → ${AFTER_AD:-해석 실패} (VPN 전: ${BASE_AD:-해석 실패})"

log "== 17. 한국어 화면 (스토어 스크린샷, API 33+ 앱별 언어)"
adb shell cmd locale set-app-locales $A --locales ko-KR 2>/dev/null; adb shell am force-stop $A; sleep 1
adb shell am start -W -n $A/kr.eumsoft.securitypro.ui.MainActivity >/dev/null; sleep 4; shot 15_home_ko
has "광고 차단" && { ok "한국어 화면 전환"; tap "광고 차단" 0 2; shot 16_adblock_ko; tap "검사" 0 2; shot 17_scan_ko; } || log "  (앱별 언어 전환 미지원 또는 실패)"

log "== 18. Play 판 (광고·추적 차단 제외) 화면 · 차단 범위"
adb install -r app-play-debug.apk | tee -a $R
adb shell pm grant $P android.permission.POST_NOTIFICATIONS 2>/dev/null
adb shell am start -W -n $P/.ui.MainActivity >/dev/null; sleep 4
tap "Next"; tap "Next"; tap "Get started"; sleep 2
adb shell appops set $P ACTIVATE_VPN allow
tap "Block phishing & malicious sites" 0 25
check_pass doubleclick.net "Play 판은 광고 도메인을 막지 않음"
check_block phishing-test.eum-security.invalid "Play 판 피싱 테스트 도메인"
check_pass example.com "Play 판 정상 사이트"
shot play_01_home_en; tap "Web Guard" 0 2; shot play_02_webguard_en; tap "Scan" 0 2; tap "Quick scan" 0 3
for i in $(seq 1 60); do has "Scan summary" && break; sleep 2; done; shot play_03_result_en
tap "Security DB" 0 3; shot play_04_db_en
adb shell cmd locale set-app-locales $P --locales ko-KR 2>/dev/null; adb shell am force-stop $P; sleep 1
adb shell am start -W -n $P/.ui.MainActivity >/dev/null; sleep 4
has "웹 보호" && { tap "피싱·악성 사이트 차단" 0 8; shot play_05_home_ko; tap "웹 보호" 0 2; shot play_06_webguard_ko; tap "검사" 0 2; shot play_07_scan_ko; tap "보안 DB" 0 3; shot play_08_db_ko; } || log "  (한국어 전환 미지원)"
dump; grep -qi "ad block\|광고" $O/ui.xml && ng "Play 판 화면에 광고 차단 문구가 보임" || ok "Play 판 화면에 광고 차단 문구 없음"

if [ "$API" -ge 34 ]; then
  log "== 18b. Play 심사용 시연 동영상 (VPN·설치 앱 검사)"
  adb shell am force-stop $P; sleep 1
  adb shell screenrecord --time-limit 150 /sdcard/demo.mp4 & RP=$!; sleep 2
  adb shell am start -W -n $P/.ui.MainActivity >/dev/null; sleep 4
  tap "피싱·악성 사이트 차단" 0 6; tap "피싱·악성 사이트 차단" 0 10
  adb shell cmd statusbar expand-notifications; sleep 4; adb shell cmd statusbar collapse; sleep 2
  tap "웹 보호" 0 4
  tap "검사" 0 2; tap "설치 앱 정밀 검사" 0 3
  for i in $(seq 1 40); do has "검사 요약" && break; sleep 2; done; sleep 4
  adb shell input swipe 540 1600 540 600 800; sleep 3
  adb shell input swipe 540 1600 540 600 800; sleep 3
  adb shell pkill -INT screenrecord; sleep 4; wait $RP 2>/dev/null
  adb pull /sdcard/demo.mp4 $O/play_demo_ko.mp4 >/dev/null && ok "시연 동영상 저장 ($(du -h $O/play_demo_ko.mp4 | cut -f1))" || ng "시연 동영상 저장 실패"
fi

log "== 19. 크래시 확인"
CR=$(adb logcat -d -b crash | grep -c "kr.eumsoft.securitypro")
[ "$CR" = "0" ] && ok "크래시 0건" || { ng "크래시 $CR건"; adb logcat -d -b crash | grep -A20 "$A" | head -60 > $O/crash.txt; }
adb logcat -d > $O/logcat.txt
log "== 끝"
