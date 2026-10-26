# 검측서류 작성·관리

전기·정보통신공사 검측서류(검측요청서·결과통보, 검측 체크리스트, 공사참여자 실명부, 사진대지) 작성·관리 프로그램.
같은 코드로 **Windows EXE**와 **웹(Railway)** 두 가지로 실행됩니다. 화면은 `index.html` 하나입니다.

## 웹 (Railway)
- Dockerfile로 빌드, `/healthz` 헬스체크
- 환경변수
  - `GCMS_PASSWORD` (필수, 8자 이상) — 회사 공용 로그인 비밀번호
  - `GCMS_DATA_DIR` — 데이터 폴더 (기본 `/data`, Railway 볼륨을 여기에 연결)
- 데이터: `/data/data.json`, 사진 `/data/photos/`, 일별 자동 백업 `/data/backups/`

## Windows EXE 빌드
```
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o 검측서류관리.exe .
```
EXE 옆 `검측서류_데이터` 폴더에 데이터가 저장됩니다.
