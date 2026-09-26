@echo off
rem Go back to the Remi version before the last update.
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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0remi-server.ps1" rollback %*
set status=%errorlevel%
echo.
pause
exit /b %status%
