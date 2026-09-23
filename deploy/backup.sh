#!/usr/bin/env bash
# ============================================================================
# 备份脚本 —— 数据库 + 代码
#
# 用法：  bash /opt/nongfu/deploy/backup.sh
# 定时：  crontab -e 加入
#           0 3 * * * /bin/bash /opt/nongfu/deploy/backup.sh >> /var/log/nongfu-backup.log 2>&1
#
# ⚠️ 为什么两者都要备：代码可以用 git 回滚，**数据库回不去**。
#    本项目曾因直接导入含 DROP DATABASE 的完整 dump 而误伤正式库。
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nongfu}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups}"
DB_NAME="${DB_NAME:-nongfu_inventory}"
DB_USER="${DB_USER:-nongfu}"
DB_PASSWORD="${DB_PASSWORD:-}"
KEEP_DAYS="${KEEP_DAYS:-30}"

STAMP="$(date +%Y-%m-%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"
mkdir -p /var/log

echo "[$(date '+%F %T')] ===== 开始备份 ====="

# ---------- 1. 数据库 ----------
if [ -z "$DB_PASSWORD" ]; then
  echo "[提示] 未设置 DB_PASSWORD，尝试用 ~/.my.cnf 或 socket 认证连接。"
  echo "       推荐：export DB_PASSWORD='你的密码' 后再执行本脚本。"
fi

DB_FILE="$BACKUP_DIR/db-$STAMP.sql"
echo "[1/3] 导出数据库 → $DB_FILE"
mysqldump \
  -h 127.0.0.1 -u "$DB_USER" ${DB_PASSWORD:+-p"$DB_PASSWORD"} \
  --default-character-set=utf8mb4 \
  --single-transaction --quick --routines --triggers \
  "$DB_NAME" > "$DB_FILE"

# 简单校验：文件不能是空的，且要能找到建表语句
if [ ! -s "$DB_FILE" ]; then
  echo "[错误] 导出的数据库文件为空，备份失败！" >&2
  exit 1
fi
if ! grep -q "CREATE TABLE" "$DB_FILE"; then
  echo "[错误] 备份文件里没有建表语句，内容异常，请人工检查。" >&2
  exit 1
fi
echo "      数据库备份大小：$(du -h "$DB_FILE" | cut -f1)"

# ---------- 2. 代码（排除依赖与构建产物，体积小、恢复快）----------
CODE_FILE="$BACKUP_DIR/code-$STAMP.tar.gz"
echo "[2/3] 打包代码 → $CODE_FILE"
tar -czf "$CODE_FILE" \
  -C "$(dirname "$APP_DIR")" "$(basename "$APP_DIR")" \
  --exclude='node_modules' \
  --exclude='frontend/dist' \
  --exclude='.git' \
  --exclude='*.log' \
  --exclude='*.pid' \
  --exclude='backend/uploads'
echo "      代码备份大小：$(du -h "$CODE_FILE" | cut -f1)"

# ---------- 3. 清理过期备份 ----------
echo "[3/3] 清理 $KEEP_DAYS 天前的备份"
find "$BACKUP_DIR" -name 'db-*.sql'   -mtime +"$KEEP_DAYS" -print -delete
find "$BACKUP_DIR" -name 'code-*.tar.gz' -mtime +"$KEEP_DAYS" -print -delete

echo "[$(date '+%F %T')] ===== 备份完成 ====="
ls -lh "$BACKUP_DIR" | tail -n 10
