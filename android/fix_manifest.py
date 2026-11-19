# 시작 시 꺼짐 방지: 언어 설정 서비스(AppLocalesMetadataHolderService)를 앱 설정에 직접 등록
p = 'app/src/main/AndroidManifest.xml'
s = open(p, encoding='utf-8').read()
if 'xmlns:tools' not in s:
    s = s.replace('<manifest ', '<manifest xmlns:tools="http://schemas.android.com/tools" ', 1)
if 'AppLocalesMetadataHolderService' not in s:
    svc = ('<service android:name="androidx.appcompat.app.AppLocalesMetadataHolderService" android:enabled="false" '
           'android:exported="false" tools:node="replace"><meta-data android:name="autoStoreLocales" android:value="false" /></service>')
    s = s.replace('</application>', svc + '\n</application>', 1)
# 앱 시작 시 사이트 설정 바로가기 화면을 켜므로 반드시 등록되어 있어야 한다
if 'ManageDataLauncherActivity' not in s:
    act = ('<activity android:name="com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity" android:exported="false" android:enabled="false">'
           '<meta-data android:name="android.support.customtabs.trusted.MANAGE_SPACE_URL" android:value="https://eumchat-production.up.railway.app/" /></activity>')
    s = s.replace('</application>', act + '\n</application>', 1)
open(p, 'w', encoding='utf-8').write(s)
print('manifest patched')
