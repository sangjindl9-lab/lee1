@echo off
chcp 65001 >nul
cd /d %~dp0
echo [1/2] 파이썬 가상환경 만들기...
python -m venv .venv || (echo 파이썬 3.10 이상을 먼저 설치하세요: https://www.python.org/downloads/ & pause & exit /b 1)
echo [2/2] 필요한 패키지 설치...
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt
echo.
echo 설치가 끝났습니다. "실행.bat"을 더블클릭하세요.
pause
