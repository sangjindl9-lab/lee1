# EUM SMS GUARD — Android Studio source (prototype)

## Scope
Samsung Messages remains the default SMS app. A NotificationListenerService observes **only the allowlisted messaging app notifications** (default `com.samsung.android.messaging`). The app can attempt to dismiss matching notifications and stores a separate classification copy in local SQLite. **It cannot prevent SMS delivery, delete original messages, restore original messages, or guarantee suppressing the original notification.** It does not read the SMS database or send SMS itself; Compose opens the default SMS app.

## Build
1. Open this directory in Android Studio (JDK 17, Android SDK 35).
2. Let Android Studio sync Gradle (Android Gradle Plugin 8.7.3, Kotlin 2.0.21).
3. Build > Build APK(s) or run `gradle assembleDebug` with a configured Android SDK.
4. APK output after successful build: `app/build/outputs/apk/debug/app-debug.apk`.
5. Install on device; open the app, grant Notification Access, enable monitoring.
6. Verify the installed Samsung Messages package name is `com.samsung.android.messaging`. Some devices use Google Messages (`com.google.android.apps.messaging`) instead; the current prototype only listens to Samsung package.

## AI server
Run in a controlled HTTPS environment (do not expose Uvicorn over plaintext):
```
cd server
pip install -r requirements.txt
export OPENAI_API_KEY='...'
export GUARD_BEARER_TOKEN='long-random-secret'
uvicorn main:app --host 127.0.0.1 --port 8000
```
Configure an HTTPS reverse proxy, set the Android app endpoint to `https://YOUR_HOST/analyze`, set bearer token, and opt in to cloud analysis. The AI model name is configurable with `OPENAI_MODEL`. Cloud classification incurs API charges.

## Limitations / security
- Notification content can be absent, truncated, combined, redacted, or duplicated. Not all received SMS generate a visible notification. Other notifications from the same messaging package can be misclassified. No conversation-level deduplication yet.
- A block result arrives after the notification was posted; cancellation may be late or fail. No guaranteed pre-delivery filtering.
- `release` changes only the local classification flag, not the original message/notification.
- Rules use case-insensitive substring matching; no advanced semantic on-device classifier.
- Server stores no messages in this example, but a third-party AI API receives message content. Avoid sending sensitive messages without appropriate consent.
- SharedPreferences token is not encrypted. Use Android Keystore/Encrypted storage before production. SQLite data is unencrypted. No data export, retention controls, sender allowlist, or production audit yet.
- Not tested on a physical Galaxy device and not compiled in this environment. Source is a prototype, not a validated production APK.
