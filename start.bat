@echo off
setlocal
cd /d "%~dp0"

REM ---------- Config (edit for new machine) ----------
REM MySQL root password (leave empty if none)
set "DB_PASSWORD="
REM npm registry mirror (leave empty to use default)
set "NPM_REGISTRY=https://registry.npmmirror.com"

REM Run the real startup logic (Node), logs also saved to start.log
node "%~dp0backend\scripts\start.js"
if errorlevel 1 (
    echo.
    echo [ERROR] Startup failed - see messages above (also saved in start.log).
    pause
)
