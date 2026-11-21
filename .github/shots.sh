set -x
mkdir -p shots
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set kr.eumsoft.filemanager2 MANAGE_EXTERNAL_STORAGE allow
# 샘플 파일 만들기
adb shell 'mkdir -p /sdcard/Documents/현장사진 /sdcard/Documents/견적서 /sdcard/Download/자료 /sdcard/Music'
for i in 1 2 3 4 5 6; do adb shell "screencap -p /sdcard/Pictures/sample_$i.png"; done
adb shell 'cp /sdcard/Pictures/sample_1.png /sdcard/Download/sample_1_복사본.png; cp /sdcard/Pictures/sample_2.png /sdcard/Documents/현장사진/sample_2.png'
adb shell 'echo 회의록 > /sdcard/Documents/회의록.txt; echo 메모 > /sdcard/Download/메모.txt'
adb shell 'dd if=/dev/urandom of=/sdcard/Download/백업.zip bs=1024 count=20480; dd if=/dev/urandom of=/sdcard/Movies/현장영상.mp4 bs=1024 count=40960; dd if=/dev/urandom of=/sdcard/Documents/견적서/견적서_2026.pdf bs=1024 count=900'
adb shell 'am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/sample_1.png' || true
adb shell content call --uri content://media --method scan_volume --arg external_primary || true
sleep 5
shot() { sleep 4; adb exec-out screencap -p > shots/$1.png; }
adb shell am start -n kr.eumsoft.filemanager2/.MainActivity
shot 01_home
# 내부 저장소 카드 누르기 (화면 상단 1/3 지점)
W=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); X=${W%x*}; Y=${W#*x}
adb shell input tap $((X/2)) $((Y*36/100))
shot 02_browse
adb shell input keyevent BACK; sleep 2
adb shell input swipe $((X/2)) $((Y*80/100)) $((X/2)) $((Y*30/100)) 400
shot 03_home_scrolled
adb shell am force-stop kr.eumsoft.filemanager2
adb shell am start -n kr.eumsoft.filemanager2/.MainActivity
sleep 3
adb shell input tap $((X/2)) $((Y*36/100)); sleep 3
adb shell input tap $((X/2)) $((Y*40/100)); sleep 3
shot 04_folder
ls -la shots
# v1
