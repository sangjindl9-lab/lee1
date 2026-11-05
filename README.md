# EUM SAFE Android 1.0 (source project)

Native Android Java app. Voice recording uses a foreground service with a persistent notification and microphone privacy indicator. Video uses the installed camera app via ACTION_VIDEO_CAPTURE. Evidence is stored in app-private internal files and can be opened/shared through FileProvider.

## Build
Open this directory in Android Studio with Android SDK 35 and JDK 17. Sync Gradle, then Build > Build APK(s). Output: app/build/outputs/apk/debug/app-debug.apk.

## Limitations
This is a functional MVP source, not a signed APK. No stealth recording, encrypted vault, cloud upload, SOS, biometric authentication or automatic file segmentation is implemented. App-private storage is not encryption; removing the app may delete its files. The Android OS may show microphone indicators and notifications. Test video capture and background recording on the target device. The camera app may vary by manufacturer. Recording laws and consent requirements vary.
