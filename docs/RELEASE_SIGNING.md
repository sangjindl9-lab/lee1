# 릴리스 서명 구성 안내

Play 스토어에 올리려면 AAB 를 **업로드 키**로 서명해야 합니다. 키 파일과 비밀번호는 저장소에 넣지 않습니다.

## 1. 업로드 키 만들기 (한 번만)

```bash
keytool -genkeypair -v -keystore eum-kids-upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

- 만든 `.jks` 파일과 비밀번호는 안전한 곳에 따로 보관합니다. (잃어버리면 Play Console 에서 업로드 키 재설정을 요청해야 합니다.)
- Play Console 에서 앱을 만들 때 **Play 앱 서명**을 사용하면, 이 키는 "업로드 키"로만 쓰입니다.

## 2. 서명된 AAB 빌드

`app/build.gradle.kts` 는 아래 환경변수가 있을 때만 릴리스 서명을 적용합니다.

```bash
export EUM_KEYSTORE=/절대/경로/eum-kids-upload.jks
export EUM_KEYSTORE_PASSWORD=...
export EUM_KEY_ALIAS=upload
export EUM_KEY_PASSWORD=...
gradle bundleRelease        # app/build/outputs/bundle/release/app-release.aab
```

환경변수가 없으면 **서명되지 않은 AAB** 가 만들어집니다. (GitHub Actions 가 릴리스에 올리는 `eum-kids-coloring-release-unsigned.aab` 가 이것입니다.)

이미 만들어진 미서명 AAB 에 나중에 서명하려면:

```bash
jarsigner -keystore eum-kids-upload.jks -signedjar eum-kids-coloring.aab \
  eum-kids-coloring-release-unsigned.aab upload
```

## 3. 버전 올리기

업데이트할 때마다 `app/build.gradle.kts` 의 `versionCode` 를 1 씩 올립니다.
