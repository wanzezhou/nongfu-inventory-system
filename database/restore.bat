@echo off
chcp 65001 >nul
setlocal

set MYSQL_BIN=C:\Program Files\MySQL\MySQL Server 8.4\bin
set DB_NAME=nongfu_inventory

echo ========================================
echo   数据库恢复工具
echo ========================================
echo.
echo 警告：此操作将覆盖当前数据库中的所有数据！
echo.
set /p CONFIRM=确定要恢复吗？(输入 yes 继续): 

if /i not "%CONFIRM%"=="yes" (
    echo 已取消恢复操作。
    pause
    exit /b
)

echo.
echo 可用的备份文件：
echo ------------------------
dir /b "%~dp0backup\*.sql" 2>nul
echo ------------------------
echo.

set /p FILENAME=请输入要恢复的备份文件名（含扩展名）: 

set SQL_FILE=%~dp0backup\%FILENAME%

if not exist "%SQL_FILE%" (
    echo 错误：文件 %SQL_FILE% 不存在！
    pause
    exit /b
)

echo.
echo 正在恢复数据库 %DB_NAME% ...
"%MYSQL_BIN%\mysql.exe" -u root %DB_NAME% < "%SQL_FILE%"

if %errorlevel% equ 0 (
    echo 恢复成功！
) else (
    echo 恢复失败！
)

echo.
pause
