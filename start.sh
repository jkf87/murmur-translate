#!/usr/bin/env bash
# 로컬 번역 서버를 켠다 → http://127.0.0.1:8790  (끄려면 Ctrl+C)
set -euo pipefail
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || { echo "먼저 ./setup.sh 를 실행하세요"; exit 1; }
exec .venv/bin/python bridge/server.py "$@"
