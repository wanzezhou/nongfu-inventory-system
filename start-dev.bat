@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================================
::  农富库存管理系统 - 开发环境一键启动
::  功能：清除本地代理干扰 -> 预检 MySQL -> 启动后端(3000) + 前端(5173) -> 打开浏览器
::  用法：双击本文件即可（每个服务独立窗口，关闭窗口即停止）
:: ============================================================

:: 切换到脚本所在目录（项目根目录），保证相对路径正确
cd /d "%~dp0"

echo ============================================
echo   农富库存管理系统 开发环境一键启动
echo ============================================

:: 清除本地代理变量，避免 localhost 请求被代理拦截导致服务启动/访问失败
:: （之前出现过 HTTP_PROXY=127.0.0.1:7897 未启动代理导致后台启动失败的情况）
set HTTP_PROXY=
set HTTPS_PROXY=
set http_proxy=
set https_proxy=

:: 定位 node 可执行文件（优先 PATH，其次 WorkBuddy managed node）
set "NODE_EXE=node.exe"
where node >nul 2>&1
if errorlevel 1 (
    if exist "C:\Users\15085\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
        set "NODE_EXE=C:\Users\15085\.workbuddy\binaries\node\versions\22.22.2\node.exe"
    ) else (
        echo [错误] 未找到 node，请先安装 Node.js 或确认 WorkBuddy managed node 路径
        pause
        exit /b 1
    )
)
echo [OK] 使用 node: %NODE_EXE%

:: 预检 MySQL(3306)，仅警告不阻塞（MySQL 为系统服务，需自行启动）
powershell -NoProfile -Command "$ok=Test-NetConnection -ComputerName 127.0.0.1 -Port 3306 -WarningAction SilentlyContinue -InformationLevel Quiet; if(-not $ok){Write-Host '[警告] MySQL(3306) 未启动，后端可能因无法连库而报错，请先启动 MySQL 服务' -ForegroundColor Yellow}"

:: 启动后端（独立窗口，nodemon 热重载）
echo [启动] 后端服务 (端口 3000)...
start "农富后端-backend" cmd /k "cd /d %~dp0backend && %NODE_EXE% node_modules/nodemon/bin/nodemon.js src/app.js"

:: 启动前端（独立窗口，vite 热重载）
echo [启动] 前端服务 (端口 5173)...
start "农富前端-frontend" cmd /k "cd /d %~dp0frontend && %NODE_EXE% node_modules/vite/bin/vite.js"

:: 等待服务启动后自动打开浏览器
echo [等待] 服务启动中，稍后自动打开前端页面...
timeout /t 6 >nul
start "" http://localhost:5173/

echo.
echo ============================================
echo   启动完成！
echo   后端:  http://localhost:3000
echo   前端:  http://localhost:5173
echo   说明:  每个服务在独立命令行窗口运行，关闭对应窗口即可停止该服务
echo ============================================
pause
