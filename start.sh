#!/bin/bash
# Linux / macOS 终端启动方式（与「启动应用.command」等价）
set -euo pipefail
cd "$(dirname "$0")"
exec node scripts/start-app.mjs "$@"
