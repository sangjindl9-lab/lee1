@echo off
rem WebNVR admin command (run as Administrator). e.g. nvrctl status / nvrctl restart / nvrctl backup D:\backup
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "NVR_ROOT=%~dp0"
pushd "%NVR_ROOT%app\backend"
"%NVR_ROOT%python\python.exe" -m nvr.winctl %*
set RC=%ERRORLEVEL%
popd
exit /b %RC%
