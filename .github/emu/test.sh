#!/bin/bash
# 노트프로 에뮬레이터 검수 (실기기 아님)
mkdir -p emu
R=emu/report.txt
PKG=kr.eumsoft.notepro
RUN=$PKG.test/androidx.test.runner.AndroidJUnitRunner
log() { echo "$*" | tee -a $R; }
shot() { adb exec-out screencap -p > emu/$1.png; }
tap_text() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb pull /sdcard/ui.xml emu/ui.xml >/dev/null 2>&1
  python3 - "$1" <<'PY'
import re,sys,subprocess
t=sys.argv[1]; x=open('emu/ui.xml',encoding='utf-8').read()
for m in re.finditer(r'<node[^>]*>', x):
    n=m.group(0)
    if f'text="{t}"' in n or f'content-desc="{t}"' in n:
        b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',n)
        if b:
            a=list(map(int,b.groups())); subprocess.run(['adb','shell','input','tap',str((a[0]+a[2])//2),str((a[1]+a[3])//2)]); print('tapped',t); sys.exit(0)
print('not found',t)
PY
}
result() { if grep -q "OK (" "$1"; then log "PASS $2"; else log "FAIL $2"; grep -E "FAILURES|Error|expected|at kr\." "$1" | head -20 | tee -a $R; fi; }

log "== 노트프로 에뮬레이터 검수 $(date -u)"
log "기기: $(adb shell getprop ro.product.model) / Android $(adb shell getprop ro.build.version.release)"
adb install -r app-debug.apk | tee -a $R
adb install -r app-debug-androidTest.apk | tee -a $R

log "== 1. 데이터 보존 계측 테스트"
adb shell am instrument -w -e class $PKG.DataSafetyTest $RUN > emu/data_tests.txt 2>&1
cat emu/data_tests.txt | tail -30
result emu/data_tests.txt "DataSafetyTest (DB 재시작·되돌리기·버전 복원·페이지 복구·100쪽 PDF·암호화 백업·렌더 성능)"
adb shell run-as $PKG cat files/perf_pdf.txt | tee -a $R; echo | tee -a $R
adb shell run-as $PKG cat files/perf_render.txt | tee -a $R; echo | tee -a $R

log "== 2. 저장 중 강제 종료(kill) 테스트"
adb shell am instrument -w -e class $PKG.CrashKillTest#writeAndKill $RUN > emu/kill_write.txt 2>&1
grep -qiE "Process crashed|INSTRUMENTATION_RESULT|shortMsg" emu/kill_write.txt && log "프로세스 강제 종료됨(의도)"
sleep 2
adb shell am instrument -w -e class $PKG.CrashKillTest#verifyAfterKill $RUN > emu/kill_verify.txt 2>&1
result emu/kill_verify.txt "CrashKillTest.verifyAfterKill (종료 직전 커밋된 획 모두 보존 + 무결성)"
adb shell run-as $PKG cat files/crash_result.txt | tee -a $R; echo | tee -a $R

log "== 3. UI 자동 조작: 새 노트 → 필기 → 강제 종료 → 재시작"
adb shell am start -W -n $PKG/.ui.MainActivity >/dev/null; sleep 5; shot 01_launch
tap_text "OK"; sleep 1
tap_text "New note"; sleep 2; shot 02_new_note_dialog
tap_text "Create"; sleep 4; shot 03_editor
W=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | cut -dx -f1); H=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1 | cut -dx -f2)
for i in 0 1 2 3 4 5; do
  y=$((H/3 + i*90)); adb shell input swipe $((W/5)) $y $((W*4/5)) $((y+40)) 500
done
# 원 그리기(손가락) — 끝에서 멈추면 도형 보정
adb shell input swipe $((W/2)) $((H*2/3)) $((W/2+5)) $((H*2/3+5)) 900
sleep 2; shot 04_drawn
adb shell am force-stop $PKG; sleep 2
adb shell am start -W -n $PKG/.ui.MainActivity >/dev/null; sleep 6; shot 05_after_force_stop
adb shell am force-stop $PKG
adb shell am instrument -w -e class $PKG.CrashKillTest#uiDrawnStrokesExist $RUN > emu/ui_verify.txt 2>&1
result emu/ui_verify.txt "UI로 쓴 필기가 강제 종료 후에도 보존"
adb shell run-as $PKG cat files/ui_result.txt | tee -a $R; echo | tee -a $R

log "== 4. 비정상 종료 기록"
adb logcat -d -s AndroidRuntime:E | grep -A5 "FATAL" | grep -v "CrashKillTest" | head -40 > emu/fatal.txt
if [ -s emu/fatal.txt ]; then log "앱 오류 로그 있음(emu/fatal.txt)"; head -20 emu/fatal.txt | tee -a $R; else log "앱 FATAL 오류 없음"; fi
log "== 끝"
