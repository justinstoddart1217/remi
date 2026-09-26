@echo off
rem Install Remi on this server (the APEX server): run it from inside the unzipped bundle.
rem Double-click it; the window stays open so you can read what happened.
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if errorlevel 1 (
  echo Remi needs administrator rights for this, so Windows will ask.
  if "%~1"=="" (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  )
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\remi-server.ps1" install %*
set status=%errorlevel%
echo.
pause
exit /b %status%
