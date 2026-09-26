@echo off
rem Show whether Remi is running, its version and where to open it.
rem Double-click it; the window stays open so you can read what happened.
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remi-server.ps1" status %*
set status=%errorlevel%
echo.
pause
exit /b %status%
