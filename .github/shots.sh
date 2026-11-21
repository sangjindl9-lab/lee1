set -x
mkdir -p shots
adb shell settings put global hide_error_dialogs 1 || true
adb shell pm disable-user --user 0 com.google.android.apps.nexuslauncher || true
sleep 20
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS || true
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell appops set kr.eumsoft.filemanager2 MANAGE_EXTERNAL_STORAGE allow
adb shell 'mkdir -p /sdcard/Documents/현장사진 /sdcard/Documents/견적서 /sdcard/Download/자료 /sdcard/Music /sdcard/Movies'
for i in 1 2 3 4 5 6; do adb shell "screencap -p /sdcard/Pictures/photo_$i.png"; done
adb shell 'cp /sdcard/Pictures/photo_1.png /sdcard/Download/photo_1_복사본.png; cp /sdcard/Pictures/photo_2.png /sdcard/Documents/현장사진/photo_2.png'
adb shell 'echo 회의록 > /sdcard/Documents/회의록.txt; echo 메모 > /sdcard/Download/메모.txt'
adb shell 'dd if=/dev/urandom of=/sdcard/Download/백업.zip bs=1024 count=20480; dd if=/dev/urandom of=/sdcard/Movies/현장영상.mp4 bs=1024 count=40960; dd if=/dev/urandom of=/sdcard/Documents/견적서/견적서_2026.pdf bs=1024 count=900'
adb shell content call --uri content://media --method scan_volume --arg external_primary || true
sleep 5
W=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1); X=${W%x*}; Y=${W#*x}
tap() { adb shell input tap $((X*$1/100)) $((Y*$2/100)); }
shot() { adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null; sleep 4; adb exec-out screencap -p > shots/$1.png; }
start() { adb shell am force-stop kr.eumsoft.filemanager2; adb shell am start -n kr.eumsoft.filemanager2/.MainActivity; sleep 4; }
start; shot 01_home
tap 50 30; shot 02_browse
start; tap 15 58; sleep 3; shot 03_images
start; tap 46 89; sleep 6; shot 04_analysis
start; adb shell input swipe $((X/2)) $((Y*85/100)) $((X/2)) $((Y*25/100)) 500; shot 05_home_bottom
ls -la shots
