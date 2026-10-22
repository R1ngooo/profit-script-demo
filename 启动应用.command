#!/bin/bash
# 双击运行：启动毛利·粗算面板（开发/源码方式）
# 首次使用如提示没有权限：chmod +x 启动应用.command
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js（需要 20 或更高版本）。"
  echo "请先安装：https://nodejs.org/"
  echo "macOS 也可以直接解压 release/ 里的 ProfitScript.app 双击运行。"
  read -n 1 -s -r -p "按任意键退出…"
  exit 1
fi

exec node scripts/start-app.mjs "$@"
