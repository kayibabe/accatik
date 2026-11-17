@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem ---------------------------------------------------------------------------
rem  MatchSlip - stop the local system.
rem  Closes the console window start.bat opened (and any earlier leftover one),
rem  terminates the server process tree, and confirms the port is free.
rem ---------------------------------------------------------------------------

set "APP_DIR=%~dp0"
set "APP_PORT=3000"

if exist ".env" (
  for /f "eol=# tokens=1,* delims==" %%A in (.env) do (
    if /i "%%A"=="PORT" set "APP_PORT=%%~B"
  )
)

echo ============================================
echo   MatchSlip - stopping the local system
echo ============================================
echo.

rem --- 1. Console windows ---------------------------------------------------
rem `taskkill /FI "WINDOWTITLE eq ..."` is unreliable with spaces and cannot
rem close a console whose node child already exited, so match on both the
rem window title and the command line, then kill the whole process tree.
echo [1/4] Closing the server console window...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$self = $PID; $byCmd = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -and ($_.CommandLine -like '*MatchSlip Server*' -or $_.CommandLine -like '*npm run dev*') } | Select-Object -ExpandProperty ProcessId); $byTitle = @(Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'MatchSlip*' } | Select-Object -ExpandProperty Id); $unique = @($byCmd + $byTitle) | Where-Object { $_ -and $_ -ne $self } | Sort-Object -Unique; if ($unique) { foreach ($procId in $unique) { taskkill /PID $procId /T /F 2>$null | Out-Null }; Write-Host ('      Closed console process ID(s): ' + ($unique -join ', ')) } else { Write-Host '      No console window found.' }"

rem --- 2. Server processes --------------------------------------------------
echo [2/4] Stopping server processes on port %APP_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir = $env:APP_DIR.TrimEnd('\'); $port = [int]$env:APP_PORT; $self = $PID; $pids = @(); $pids += @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess); $pids += @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $self -and $_.Name -notin @('powershell.exe','pwsh.exe','cmd.exe') -and $_.CommandLine -and $_.CommandLine.Contains($dir) -and ($_.CommandLine -match 'tsx|server\.ts|vite|run dev') } | Select-Object -ExpandProperty ProcessId); $unique = $pids | Where-Object { $_ -and $_ -gt 4 } | Sort-Object -Unique; if ($unique) { foreach ($procId in $unique) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }; Write-Host ('      Stopped process ID(s): ' + ($unique -join ', ')) } else { Write-Host '      Nothing was running.' }"
if errorlevel 1 echo       [WARN] Some processes could not be stopped.

rem --- 3. Leftover console sweep -------------------------------------------
rem A console can linger with an idle prompt after its server died; take a
rem second pass once the process tree above has been torn down.
echo [3/4] Sweeping any remaining server console...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$self = $PID; $left = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cmd.exe' -and $_.ProcessId -ne $self -and $_.CommandLine -and $_.CommandLine -like '*MatchSlip Server*' } | Select-Object -ExpandProperty ProcessId); if ($left) { foreach ($procId in $left) { taskkill /PID $procId /T /F 2>$null | Out-Null }; Write-Host ('      Closed leftover console(s): ' + ($left -join ', ')) } else { Write-Host '      None left open.' }"

rem --- 4. Verify ------------------------------------------------------------
echo [4/4] Checking port %APP_PORT%...
ping -n 3 127.0.0.1 >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue) { Write-Host '      [WARN] Port is still in use.'; exit 1 } else { Write-Host '      Port is free.'; exit 0 }"
echo.
echo MatchSlip is stopped.
ping -n 4 127.0.0.1 >nul
exit /b 0
