# 이음 키즈 컬러링 (EUM KIDS COLORING PRO)

Higgsfield 로 만든 오리지널 캐릭터 도안 30장을 색칠하는 어린이용 안드로이드 앱입니다. (스마트폰·태블릿, 오프라인)

- 패키지: `kr.eumsoft.kidscoloring` / minSdk 26 / targetSdk 35
- Kotlin, Jetpack Compose(Material 3), Room, DataStore, Coroutines
- 권한 없음 · 광고 없음 · 인터넷 사용 안 함

## 폴더

| 경로 | 내용 |
|---|---|
| `app/` | Android Studio 프로젝트 (앱 모듈) |
| `app/src/main/java/.../engine` | 색칠 엔진 (순수 Kotlin: 영역 채우기, 붓, 실행 취소) |
| `app/src/main/java/.../data` | Room DB, DataStore 설정, 도안·작업 저장소 |
| `app/src/main/java/.../ui` | 화면 (Compose), 캔버스 뷰, ViewModel |
| `app/src/main/assets/art` | 앱용 도안: 선화 `line/`, 영역 마스크 `mask/`, 썸네일 `thumb/`, `catalog.json` |
| `content/originals` | Higgsfield 원본 30장 (2048×2048) |
| `content/prompts.json` | 도안별 생성 프롬프트, 모델, 제작일, 결과 주소 |
| `content/report.json` | 전처리 검수 결과 |
| `tools/pipeline.py` | 원본 → 선화·마스크·썸네일·메타데이터 전처리 |
| `docs/` | 사용자 매뉴얼, 개인정보처리방침 초안, 서명 안내, Play 배포 준비, 테스트 보고서 |

## 빌드

Android Studio 에서 이 폴더를 열거나:

```bash
gradle testDebugUnitTest assembleDebug     # 단위 테스트 + 디버그 APK
gradle bundleRelease                       # 릴리스 AAB (서명은 docs/RELEASE_SIGNING.md)
```

(Gradle 8.9, JDK 17. Gradle wrapper 는 넣지 않았으므로 Android Studio 가 내려받는 Gradle 또는 설치된 `gradle` 을 씁니다.)

`eum-kids-coloring` 브랜치에 push 하면 GitHub Actions 가 단위 테스트, APK/AAB 빌드, 에뮬레이터 테스트를 돌리고 릴리스에 올립니다.

## 도안을 바꾸거나 추가할 때

1. Higgsfield 에서 생성한 PNG 를 `content/originals/aNN.png` 로 넣습니다. (`content/sources.json` 에 결과 주소를 적고 push 하면 Actions 가 대신 내려받습니다.)
2. `python3 tools/pipeline.py` (OpenCV, NumPy 필요)
3. `content/report.json` 과 앱 화면으로 검수합니다.

원본이 없는 도안은 `catalog.json` 에 `available=false` 로 남고, 앱에서는 "준비 중"으로 표시되어 열리지 않습니다.
