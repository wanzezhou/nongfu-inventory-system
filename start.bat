@echo off
setlocal enabledelayedexpansion

REM ============================================================
REM  Nongfu Inventory System - One-Click Start (portable)
REM  Auto: env check -> DB init -> deps install -> start servers
REM  Usage: double-click this file
REM ============================================================

cd /d "%~dp0"

echo ============================================
echo   Nongfu Inventory System - One-Click Start
echo ============================================

REM ---------- Config (edit for new machine) ----------
REM MySQL root password (leave empty if none)
set "DB_PASSWORD="
REM npm registry mirror (leave empty to use default)
set "NPM_REGISTRY=https://registry.npmmirror.com"

REM ---------- 1. Check Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js 18+ from https://nodejs.org/ and re-run.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
echo [OK] Node.js %NODE_VER%

REM ---------- 2. Check MySQL (port 3306) ----------
powershell -NoProfile -Command "$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue -InformationLevel Quiet; if (-not $ok) { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] MySQL not detected on port 3306.
    echo         Please install and start MySQL 5.7+/8.0, then re-run.
    pause
    exit /b 1
)
echo [OK] MySQL connected (3306)

REM ---------- 3. Database init (idempotent) ----------
echo [CHECK] Database initialization...
node backend/scripts/init_db.js --db-password=%DB_PASSWORD%
if errorlevel 1 (
    echo [ERROR] Database init failed. Check the message above.
    pause
    exit /b 1
)

REM ---------- 4. Backend deps ----------
if not exist "backend\node_modules" (
    echo [INSTALL] Backend dependencies (first run, takes a few minutes)...
    pushd backend
    if defined NPM_REGISTRY (
        call npm install --registry=%NPM_REGISTRY%
    ) else (
        call npm install
    )
    if errorlevel 1 (
        echo [ERROR] Backend dependency install failed.
        popd
        pause
        exit /b 1
    )
    popd
)
echo [OK] Backend deps ready

REM ---------- 5. Frontend deps ----------
if not exist "frontend\node_modules" (
    echo [INSTALL] Frontend dependencies (first run, takes a few minutes)...
    pushd frontend
    if defined NPM_REGISTRY (
        call npm install --registry=%NPM_REGISTRY%
    ) else (
        call npm install
    )
    if errorlevel 1 (
        echo [ERROR] Frontend dependency install failed.
        popd
        pause
        exit /b 1
    )
    popd
)
echo [OK] Frontend deps ready

REM ---------- 6. Ensure backend/.env ----------
if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
    echo [INFO] backend\.env created from example. If MySQL password is not empty, edit DB_PASSWORD there.
)

REM ---------- 7. Start servers ----------
echo [START] Backend on port 3000...
start "nongfu-backend-3000" cmd /k "cd /d %~dp0backend && node src/app.js"

echo [START] Frontend on port 5173...
start "nongfu-frontend-5173" cmd /k "cd /d %~dp0frontend && node node_modules/vite/bin/vite.js"

echo [WAIT] Starting services, opening browser...
timeout /t 6 >nul
start "" http://localhost:5173/

echo.
echo ============================================
echo   Started!
echo   Frontend: http://localhost:5173
echo   Backend : http://localhost:3000
echo   Note: each service runs in its own window;
echo         close the window to stop that service.
echo ============================================
pause
