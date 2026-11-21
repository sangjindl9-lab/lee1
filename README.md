# 이음 구매노트 (EUM Purchase Note)

주문 화면·영수증을 공유하면 구매를 기록하고, 반품·교환·AS 기한을 챙기고, 증빙을 다시 찾는 안드로이드 앱.
로그인·서버 없이 기기 안에서만 동작합니다. (`site/` 는 Railway에 올리는 개인정보처리방침·지원 페이지)

- 기술: Kotlin · Jetpack Compose · Room · ML Kit 기기 내 글자 인식(한국어·일본어·라틴) · AlarmManager
- 최소 Android 8.0 (API 26), 대상 API 35
- 언어: 한국어·영어·일본어·스페인어 (기본/미지원 언어 = 영어). 문구 원본은 `tools/gen_strings.py`

## 빌드
GitHub Actions(`.github/workflows/eum-purchase-note.yml`)가 이 브랜치에 push될 때마다
단위 테스트 → 사내 테스트 APK → 에뮬레이터 검수까지 실행하고 릴리스에 올립니다.

로컬 재빌드: JDK 17 + Android SDK(35) + Gradle 8.9
```
gradle testDebugUnitTest assembleDebug          # 사내 테스트 APK: app/build/outputs/apk/debug/app-debug.apk
python3 tools/gen_strings.py                    # 문구 수정 후 4개 언어 리소스 다시 생성
python3 tools/make_receipts.py                  # 합성 영수증 이미지 다시 생성
```
스토어 배포용(서명된 AAB)은 아직 만들지 않았습니다. 업로드 키 생성·서명 설정 후 `gradle bundleRelease`.

## 구조
- `core/` 날짜·통화·영수증 후보 추출(안드로이드 의존 없음, 단위 테스트)
- `data/` Room(구매·이미지·연결), 이미지 사본, 저장/삭제/정리
- `ocr/` 기기 내 글자 인식
- `reminder/` 기한 알림(재부팅·시간대 변경 시 재계산)
- `backup/` 암호화 백업 형식(AES-256-GCM, PBKDF2) 과 복원
- `ui/` Compose 화면
