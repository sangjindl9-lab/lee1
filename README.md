# 예정공정표 — 윈도우 PC 단독형

웹 프로그램(lee1 저장소 `gongjung` 브랜치)의 단일파일 빌드를 Electron에 넣은 윈도우 설치판입니다. 인터넷 없이 동작하고 데이터는 PC에만 저장됩니다.

## 다시 빌드하기
1. 웹 프로그램에서 `npm run build:single` → `dist-single/index.html`
2. 이 폴더에서 `npm install`
3. `node prepare.mjs <dist-single/index.html 경로>` (글꼴 내장, app/ 생성)
4. `npx electron-builder --win --x64` → `dist/Gongjung-Setup-<버전>.exe`
   (리눅스에서 빌드할 때는 wine 필요)

버전을 올릴 때는 package.json의 `version`을 바꾸세요. 같은 appId로 설치하면 기존 데이터를 유지한 채 업데이트됩니다.

## 데이터
- 저장 위치: `%APPDATA%\예정공정표` (프로그램 내부 저장소)
- 자동 백업: `문서\예정공정표 백업\자동백업_YYYYMMDD_HHMM.json` (닫을 때·30분마다, 최근 30개)
- 백업 파일은 프로그램의 [목록] → [JSON 복원]으로 불러올 수 있음
