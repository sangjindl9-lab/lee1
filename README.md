# 전기 기사 도우미 (Electrician Helper)

Electricians' Handbook(calculation.apps.electricalinstallationapp v27)의 구성을 참고해 새로 만든 오프라인 안드로이드 앱.
본문·문제·그림은 모두 새로 작성/제작했습니다(원본 텍스트·사진 미사용).

- 패키지: com.eumsoftware.electricianhelper · minSdk 24 · targetSdk 35
- 구조: Kotlin WebView 셸(WebViewAssetLoader) + `app/src/main/assets/www` (HTML/JS, 오프라인)
- 언어 8개: ko, en(US), ja, zh(간체), hi(인도), de, fr, es — 기기 언어 자동 선택, 지구본 버튼으로 변경
- 섹션: 전기 이론 24 · 설치 가이드 15 · 계산기 24 · 공구 20 · 안전 12 · 용어 42 · 태양광 7 · 퀴즈 40
- 그림: `assets/www/img/*.svg` 27장(직접 제작, 글자 없는 기호 위주라 모든 언어 공용)
- 스토어 자료: `store/` (언어별 제목·짧은 설명·자세한 설명, 아이콘 512, 그래픽 이미지 1024×500, 언어별 스크린샷 6장, 개인정보처리방침)

## 빌드
GitHub Actions(`.github/workflows/build.yml`)가 debug APK, release AAB/APK를 만듭니다.
Play 업로드용 서명: 저장소 Secrets에 KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD 등록.
로컬: Android Studio로 폴더 열기 → Build > Generate Signed Bundle.

## 언어 추가
`assets/www/i18n/en.js`를 복사해 번역 → index.html에 script 추가 → shared.js `langs`에 등록 → `res/values-xx/strings.xml`.
