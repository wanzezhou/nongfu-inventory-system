#!/usr/bin/env bash
# ============================================================================
# 一键回滚脚本 —— 农夫山泉经销商进销存系统
#
# 用法：
#   bash /opt/nongfu/deploy/rollback.sh V1.1          # 回滚到指定 tag
#   bash /opt/nongfu/deploy/rollback.sh               # 只列出可用版本
#
# ⚠️ 回滚 ≠ 数据回滚。本脚本只回滚**代码**。
#    如果这次发布伴随数据库结构/数据变更，必须先执行配套的
#    database/rollback_xxx.sql（先回库，再回代码），
#    或直接用备份恢复数据 —— 见部署指南 §4.4。
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nongfu}"
PM2_NAME="${PM2_NAME:-nongfu-api}"
API_PORT="${API_PORT:-3000}"

TARGET_TAG="${1:-}"

cd "$APP_DIR"

if [ -z "$TARGET_TAG" ]; then
  echo "未指定版本。当前版本：$(git describe --tags --always 2>/dev/null || echo unknown)"
  echo
  echo "可回滚到的版本（最近 15 个 tag）："
  git fetch --tags --quiet || true
  git tag --sort=-creatordate | head -n 15 | sed 's/^/  - /'
  echo
  echo "用法：bash $APP_DIR/deploy/rollback.sh <tag>"
  exit 0
fi

# ---------- 校验目标版本存在 ----------
if ! git rev-parse --verify --quiet "refs/tags/$TARGET_TAG" > /dev/null; then
  echo "[错误] 找不到 tag: $TARGET_TAG" >&2
  git tag --sort=-creatordate | head -n 15 | sed 's/^/  可选：/' >&2
  exit 1
fi

echo "=============================================================="
echo " 开始回滚  $(date '+%F %T')"
echo " 当前版本：$(git describe --tags --always 2>/dev/null || echo unknown)"
echo " 目标版本：$TARGET_TAG"
echo "=============================================================="
echo
echo "⚠️  本脚本只回滚代码，不回滚数据库。"
echo "    若本次发布执行过 database/migration_*.sql，请先执行配套的 rollback 脚本，"
echo "    或从备份恢复数据（bash deploy/backup.sh 的产物在 /opt/backups）。"
read -r -p "确认继续？输入 yes: " CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "已取消。"; exit 1; }

# ---------- 第 1 步：先备份当前（可能有问题但仍是现状的）版本 ----------
echo
echo "[1/4] 备份当前状态…"
bash "$APP_DIR/deploy/backup.sh"

# ---------- 第 2 步：切回旧版本代码 ----------
echo
echo "[2/4] 切回 $TARGET_TAG…"
git fetch --tags --force
git checkout --force "$TARGET_TAG"

# ---------- 第 3 步：重装依赖 + 重建前端 ----------
echo
echo "[3/4] 重装依赖并重建前端…"
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund

cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" npm run build

# ---------- 第 4 步：重启并校验 ----------
echo
echo "[4/4] 重启后端并校验…"
pm2 restart "$PM2_NAME" --update-env
pm2 save
sleep 3

HEALTH="$(curl -s --max-time 10 "http://127.0.0.1:$API_PORT/health" || true)"
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  echo "      ✅ 回滚成功，后端健康：$HEALTH"
else
  echo "      ❌ 回滚后健康检查仍未通过：${HEALTH:-（无响应）}" >&2
  echo "      请查看日志：pm2 logs $PM2_NAME --lines 100" >&2
  exit 1
fi

echo
echo "=============================================================="
echo " 回滚完成，当前版本：$(git describe --tags --always 2>/dev/null || echo unknown)"
echo " ⚠️ 现在处于 detached HEAD（分离头指针），这是回滚的正常状态。"
echo "    要回到最新代码：bash $APP_DIR/deploy/deploy.sh"
echo "    （该脚本会自动切回默认分支；也可手工 cd $APP_DIR && git checkout master）"
echo "=============================================================="
