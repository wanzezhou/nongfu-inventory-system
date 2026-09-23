#!/usr/bin/env bash
# ============================================================================
# 一键发布脚本 —— 农夫山泉经销商进销存系统
#
# 用法：
#   bash /opt/nongfu/deploy/deploy.sh              # 发布当前分支最新代码（日常用这个）
#   bash /opt/nongfu/deploy/deploy.sh V1.2         # 发布并检出指定 tag
#
# ⚠️ 传 tag 会进入 detached HEAD（分离头指针）。脚本已做兼容：下次不带参数运行时
#    会自动切回默认分支再 pull，不必手工 `git checkout master`。
#
# 流程：备份 → 拉代码 → 装依赖 → 跑数据库迁移 → 构建前端 → 重启后端 → 校验
#     任何一步失败立即停止（set -e），不会留下「半发布」状态。
#
# ⚠️ 执行前建议先在本机跑通冒烟脚本（backend: node scripts/run_smokes.js）。
# ============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nongfu}"
DB_NAME="${DB_NAME:-nongfu_inventory}"
DB_USER="${DB_USER:-nongfu}"
PM2_NAME="${PM2_NAME:-nongfu-api}"
API_PORT="${API_PORT:-3000}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-master}"

TARGET_TAG="${1:-}"

cd "$APP_DIR"

echo "=============================================================="
echo " 开始发布  $(date '+%F %T')"
echo " 目录：$APP_DIR"
[ -n "$TARGET_TAG" ] && echo " 目标版本：$TARGET_TAG"
echo "=============================================================="

# ---------- 第 0 步：数据库密码 ----------
if [ -z "${DB_PASSWORD:-}" ]; then
  read -r -s -p "请输入数据库账号 $DB_USER 的密码: " DB_PASSWORD
  echo
fi
export DB_PASSWORD

# ---------- 第 1 步：备份（代码 + 数据库）----------
echo
echo "[1/7] 备份当前版本…"
bash "$APP_DIR/deploy/backup.sh"

# ---------- 第 2 步：拉取代码 ----------
echo
echo "[2/7] 拉取代码…"
git fetch --all --tags --prune
if [ -n "$TARGET_TAG" ]; then
  git checkout "$TARGET_TAG"
else
  # ⚠️ 此前若用 tag 部署过，此刻处于 detached HEAD —— 直接 `git pull` 会报
  #    「You are not currently on a branch」并把整次发布中断。故先切回默认分支。
  if ! git symbolic-ref --quiet --short HEAD > /dev/null 2>&1; then
    echo "      检测到分离头指针（此前用 tag 部署过），切回 $DEFAULT_BRANCH…"
    git checkout "$DEFAULT_BRANCH"
  fi
  git pull --ff-only
fi
echo "      当前版本：$(git describe --tags --always 2>/dev/null || git rev-parse --short HEAD)"

# ---------- 第 3 步：数据库迁移（有新迁移文件时必须人工确认）----------
echo
echo "[3/7] 检查数据库迁移…"
# 记录已执行过的迁移，避免重复执行
MIGRATION_STAMP="$APP_DIR/.deploy-migrations"
touch "$MIGRATION_STAMP"

PENDING=()
while IFS= read -r f; do
  name="$(basename "$f")"
  if ! grep -qxF "$name" "$MIGRATION_STAMP"; then
    PENDING+=("$f")
  fi
done < <(find "$APP_DIR/database" -maxdepth 1 -name 'migration_*.sql' | sort)

if [ "${#PENDING[@]}" -eq 0 ]; then
  echo "      没有待执行的迁移。"
else
  echo "      ⚠️ 检测到 ${#PENDING[@]} 个未执行的迁移脚本："
  for f in "${PENDING[@]}"; do echo "        - $(basename "$f")"; done
  echo
  echo "      ⚠️ 数据库迁移不可自动回滚（除非配套 rollback_*.sql）。"
  read -r -p "      确认全部执行？输入 yes 继续: " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    echo "      已取消。代码已更新到新版本，但后端未重启 —— 请手动处理后再执行本脚本。"
    exit 1
  fi
  for f in "${PENDING[@]}"; do
    echo "      执行 $(basename "$f") …"
    mysql -h 127.0.0.1 -u "$DB_USER" -p"$DB_PASSWORD" \
      --default-character-set=utf8mb4 "$DB_NAME" < "$f"
    echo "$(basename "$f")" >> "$MIGRATION_STAMP"
  done
  echo "      迁移完成。"
fi

# ---------- 第 4 步：后端依赖 ----------
echo
echo "[4/7] 安装后端依赖…"
cd "$APP_DIR/backend"
npm ci --omit=dev --no-audit --no-fund

# ---------- 第 5 步：构建前端 ----------
echo
echo "[5/7] 构建前端…"
cd "$APP_DIR/frontend"
npm ci --no-audit --no-fund
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1024}" npm run build

if [ ! -f "$APP_DIR/frontend/dist/index.html" ]; then
  echo "[错误] 构建未产出 dist/index.html，发布中止。" >&2
  exit 1
fi

# ---------- 第 6 步：重启后端 ----------
echo
echo "[6/7] 重载后端进程…"
# reload 是平滑重启（先起新进程再停旧）；若不在 pm2 里则直接启动
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
else
  pm2 start "$APP_DIR/deploy/ecosystem.config.js"
fi
pm2 save

# ---------- 第 7 步：发布后校验 ----------
echo
echo "[7/7] 发布后校验…"
sleep 3

HEALTH="$(curl -s --max-time 10 "http://127.0.0.1:$API_PORT/health" || true)"
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  echo "      ✅ 后端健康：$HEALTH"
else
  echo "      ❌ 后端健康检查未通过：${HEALTH:-（无响应）}" >&2
  echo "      请查看日志：pm2 logs $PM2_NAME --lines 100" >&2
  echo "      如需回滚：bash $APP_DIR/deploy/rollback.sh <上一个tag>" >&2
  exit 1
fi

FRONT_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1/ || true)"
echo "      前端首页 HTTP 状态：$FRONT_CODE（期望 200）"

API_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1/api/orders || true)"
echo "      接口反代 HTTP 状态：$API_CODE（期望 401，**404 说明 nginx 反代失效**）"

echo
echo "=============================================================="
echo " 发布完成  $(date '+%F %T')"
echo " 版本：$(git -C "$APP_DIR" describe --tags --always 2>/dev/null || echo unknown)"
echo " 建议再人工过一遍浏览器：登录 → 商品管理（看图片）→ 新建订单 → 仪表盘"
echo "=============================================================="
