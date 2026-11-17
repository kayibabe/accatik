@echo off
setlocal EnableExtensions
title MatchSlip Launcher
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  MatchSlip - start the local system and open it in the browser.
rem  The server runs in its own console window so this launcher can exit.
rem ---------------------------------------------------------------------------

set "APP_DIR=%~dp0"
set "APP_PORT=3000"

rem Read PORT from .env when it is present (comments are skipped).
if exist ".env" (
  for /f "eol=# tokens=1,* delims==" %%A in (.env) do (
    if /i "%%A"=="PORT" set "APP_PORT=%%~B"
  )
)

set "APP_URL=http://localhost:%APP_PORT%"
set "HEALTH_URL=http://127.0.0.1:%APP_PORT%/api/health"

echo ============================================
echo   MatchSlip - starting the local system
echo ============================================
echo.

rem --- 0. Prerequisites ------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo         Install Node.js 22.18 or newer and run this file again.
  echo.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH.
  echo         Reinstall Node.js, then run this file again.
  echo.
  pause
  exit /b 1
)

rem --- 1. Dependencies ------------------------------------------------------
if not exist "node_modules" (
  echo [1/3] Installing dependencies ^(first run, this may take a while^)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. See the messages above.
    echo.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Dependencies already installed.
)

if not exist ".env" (
  echo [WARN] No .env file found.
  echo        Copy .env.example to .env and add API_FOOTBALL_KEY for live odds.
  echo.
) else (
  findstr /b /i "API_FOOTBALL_KEY=" ".env" >nul 2>&1
  if errorlevel 1 (
    echo [WARN] .env has no API_FOOTBALL_KEY set.
    echo        The fixture slate will be empty until you add one.
    echo.
  )
)

rem --- 2. Server ------------------------------------------------------------
call :is_running
if not errorlevel 1 (
  echo [2/3] Server already running on port %APP_PORT%.
  goto :open_browser
)

rem The console sets its own title via the `title` command so stop.bat can find
rem this exact window by command line, even if the process tree is partly gone.
rem Start-Process is used instead of `start` so the detached console cannot
rem inherit (and hold open) the launcher's output handles.
echo [2/3] Starting the server in a separate console window...
powershell -NoProfile -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','title MatchSlip Server && npm run dev' -WorkingDirectory '%APP_DIR%'"

echo       Waiting for %APP_URL% to respond...
call :wait_ready
if errorlevel 1 (
  echo.
  echo [WARN] The server did not respond within 60 seconds.
  echo        Open the "MatchSlip Server" window and check for errors.
  echo.
)

rem --- 3. Browser -----------------------------------------------------------
:open_browser
echo [3/3] Opening %APP_URL%
start "" "%APP_URL%"
echo.
echo MatchSlip is running. Use stop.bat to shut it down.
ping -n 4 127.0.0.1 >nul
exit /b 0

rem ---------------------------------------------------------------------------
:is_running
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
exit /b %errorlevel%

rem ---------------------------------------------------------------------------
:wait_ready
powershell -NoProfile -Command "$u = '%HEALTH_URL%'; for ($i = 0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { }; Start-Sleep -Milliseconds 500 }; exit 1"
exit /b %errorlevel%
