@echo off
rem Remi launcher for Windows: double-click this file.
rem
rem - If Remi is already running, it just opens it in your browser.
rem - Otherwise it builds the dashboard on first run, starts Remi on http://127.0.0.1:8765
rem   and opens it in your browser.
rem - Close this window (or press Ctrl+C) to stop Remi. Nothing ever leaves this machine.
rem
rem Needs uv (Python) and Node.js installed. Set REMI_REBUILD=1 to force a rebuild of the
rem dashboard after updating the code; set REMI_PORT to use another port.
setlocal

set "ROOT=%~dp0"
if "%REMI_PORT%"=="" (set "PORT=8765") else (set "PORT=%REMI_PORT%")
set "URL=http://127.0.0.1:%PORT%/"

rem Already running? Just open it.
curl -fsS -m 2 "http://127.0.0.1:%PORT%/api/health" 2>nul | findstr /c:"remi" >nul 2>nul
if %errorlevel%==0 (
  echo Remi is already running. Opening %URL%
  start "" "%URL%"
  exit /b 0
)

where uv >nul 2>nul
if errorlevel 1 (
  echo uv is not installed. Install it from the uv website, then run this again.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from the Node.js website, then run this again.
  pause
  exit /b 1
)

rem Build the dashboard on first run, or when REMI_REBUILD=1.
set "NEEDBUILD="
if not exist "%ROOT%frontend\remi\dist\index.html" set "NEEDBUILD=1"
if "%REMI_REBUILD%"=="1" set "NEEDBUILD=1"
if defined NEEDBUILD (
  echo Building the dashboard. This takes a minute.
  pushd "%ROOT%frontend\remi"
  if not exist node_modules (
    call npm ci --no-audit --no-fund
    if errorlevel 1 (
      echo Installing frontend packages failed.
      popd
      pause
      exit /b 1
    )
  )
  call npm run build
  if errorlevel 1 (
    echo Building the dashboard failed. See the messages above.
    popd
    pause
    exit /b 1
  )
  popd
)

echo.
echo Starting Remi on %URL%
echo Keep this window open while you use Remi. Close it (or press Ctrl+C) to stop.
cd /d "%ROOT%backend"
uv run python -m remi.main --port %PORT% %*
if errorlevel 1 pause
