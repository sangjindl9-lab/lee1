@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist .venv\Scripts\python.exe (echo 먼저 "설치.bat"을 실행하세요 & pause & exit /b 1)
echo 터널 통합전력관리 서버를 시작합니다.  브라우저에서 http://localhost:8080 으로 접속하세요.
echo 창을 닫으면 서버가 멈춥니다.
start "" http://localhost:8080
.venv\Scripts\python -m app.main
pause
