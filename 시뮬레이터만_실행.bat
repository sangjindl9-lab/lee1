@echo off
chcp 65001 >nul
cd /d %~dp0
rem 가상 PLC만 따로 띄울 때 사용 (config.json 의 simulator.embedded 를 false 로 두고 서버를 따로 실행)
.venv\Scripts\python -m sim.plc_sim
pause
