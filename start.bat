@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================================
::  农富库存管理系统 - 一键启动（可移植版）
::  适用：全新电脑（Windows），自动完成环境检测 -> 数据库初始化
::        -> 依赖安装 -> 启动后端(3000)+前端(5173) -> 打开浏览器
::  用法：双击 start.bat 即可
:: ============================================================

cd /d "%~dp0"

echo ============================================
echo   农富库存管理系统 一键启动
echo ============================================

:: ---------- 配置区（新电脑按需修改） ----------
:: MySQL root 密码（无密码请留空）
set "DB_PASSWORD="
:: npm 镜像源（默认国内 npmmirror，可改为 https://registry.npmjs.org/ 或用官方源时留空）
set "NPM_REGISTRY=https://registry.npmmirror.com"

:: ---------- 1. 检测 Node.js ----------
set "NODE_EXE=node.exe"
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+（https://nodejs.org/）后重新运行
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
echo [OK] Node.js %NODE_VER%

:: ---------- 2. 检测 MySQL ----------
powershell -NoProfile -Command "$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue -InformationLevel Quiet; if (-not $ok) { exit 1 }" >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 MySQL 服务（端口 3306）
    echo        请先安装并启动 MySQL 5.7+ / 8.0（默认 root 账号），然后重新运行
    pause
    exit /b 1
)
echo [OK] MySQL 服务已连接（3306）

:: ---------- 3. 数据库初始化（幂等，已初始化则跳过） ----------
echo [检查] 数据库初始化状态...
node backend/scripts/init_db.js --db-password=%DB_PASSWORD%
if errorlevel 1 (
    echo [错误] 数据库初始化失败，请检查上方提示后重试
    pause
    exit /b 1
)

:: ---------- 4. 后端依赖安装 ----------
if not exist "backend\node_modules" (
    echo [安装] 后端依赖（首次运行，需几分钟）...
    pushd backend
    if defined NPM_REGISTRY (
        call npm install --registry=%NPM_REGISTRY%
    ) else (
        call npm install
    )
    if errorlevel 1 (
        echo [错误] 后端依赖安装失败
        popd
        pause
        exit /b 1
    )
    popd
)
echo [OK] 后端依赖就绪

:: ---------- 5. 前端依赖安装 ----------
if not exist "frontend\node_modules" (
    echo [安装] 前端依赖（首次运行，需几分钟）...
    pushd frontend
    if defined NPM_REGISTRY (
        call npm install --registry=%NPM_REGISTRY%
    ) else (
        call npm install
    )
    if errorlevel 1 (
        echo [错误] 前端依赖安装失败
        popd
        pause
        exit /b 1
    )
    popd
)
echo [OK] 前端依赖就绪

:: ---------- 6. 确保 backend/.env ----------
if not exist "backend\.env" (
    copy "backend\.env.example" "backend\.env" >nul
    echo [提示] 已生成 backend\.env；如 MySQL 密码非空，请修改其中 DB_PASSWORD 后重启
)

:: ---------- 7. 启动服务 ----------
echo [启动] 后端服务（端口 3000）...
start "农富后端-3000" cmd /k "cd /d %~dp0backend && node src/app.js"

echo [启动] 前端服务（端口 5173）...
start "农富前端-5173" cmd /k "cd /d %~dp0frontend && node node_modules/vite/bin/vite.js"

:: 等待服务启动后打开浏览器
echo [等待] 服务启动中，稍后自动打开前端页面...
timeout /t 6 >nul
start "" http://localhost:5173/

echo.
echo ============================================
echo   启动完成！
echo   前端地址: http://localhost:5173
echo   后端地址: http://localhost:3000
echo   默认账号: admin / 密码见 backend/.env 或数据库 users 表
echo   说明: 每个服务独立窗口，关闭对应窗口即停止服务
echo ============================================
pause
