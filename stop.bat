@echo off
setlocal
cd /d "%~dp0"

REM Stop services started by start.bat (reads backend.pid / frontend.pid)

if not exist "backend.pid" (
    echo [INFO] backend.pid not found - backend may not be running.
) else (
    set /p BPID=<backend.pid
    if defined BPID (
        taskkill /PID %BPID% /F >nul 2>&1
        if not errorlevel 1 ( echo [OK] Backend stopped (pid %BPID%) ) else ( echo [INFO] Backend process not found )
    )
)

if not exist "frontend.pid" (
    echo [INFO] frontend.pid not found - frontend may not be running.
) else (
    set /p FPID=<frontend.pid
    if defined FPID (
        taskkill /PID %FPID% /F >nul 2>&1
        if not errorlevel 1 ( echo [OK] Frontend stopped (pid %FPID%) ) else ( echo [INFO] Frontend process not found )
    )
)

echo.
echo [DONE] Services stopped.
pause
