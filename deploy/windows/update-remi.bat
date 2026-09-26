@echo off
rem Update Remi to the latest release on GitHub, or from a zip: update-remi.bat -Zip path-to-zip
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remi-server.ps1" update %*
set status=%errorlevel%
echo.
pause
exit /b %status%
