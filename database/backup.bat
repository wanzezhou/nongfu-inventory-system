@echo off
chcp 65001 >nul
setlocal

set MYSQL_BIN=C:\Program Files\MySQL\MySQL Server 8.4\bin
set DB_NAME=nongfu_inventory
set BACKUP_DIR=%~dp0backup
set DATE=%date:~0,4%%date:~5,2%%date:~8,2%
set TIME=%time:~0,2%%time:~3,2%
set TIME=%TIME: =0%

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

set BACKUP_FILE=%BACKUP_DIR%\%DB_NAME%_%DATE%_%TIME%.sql

echo 正在备份数据库 %DB_NAME% ...
"%MYSQL_BIN%\mysqldump.exe" -u root %DB_NAME% > "%BACKUP_FILE%"

if %errorlevel% equ 0 (
    echo 备份成功！
    echo 备份文件: %BACKUP_FILE%
) else (
    echo 备份失败！
)

echo.
pause
