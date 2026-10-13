#!/usr/bin/env bash
# murmur 번역 엔진(NLLB-200)과 로컬 번역 서버를 준비한다. 처음 한 번만 실행한다.
#  - Python 3.11 이상 가상환경(.venv)을 만들고 murmur 코어와 번역 의존성을 설치한다
#  - NLLB-200 distilled 600M (CTranslate2 변환본, 약 2.3GB)을 ~/.cache/murmur-translate 에 받는다
set -euo pipefail
cd "$(dirname "$0")"
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then PY="$c"; break; fi
  done
fi
[ -n "$PY" ] || { echo "Python 3.11 이상이 필요해요"; exit 1; }
echo "[1/3] 가상환경 만들기 ($PY)"
"$PY" -m venv .venv
.venv/bin/pip install -q --upgrade pip
echo "[2/3] murmur 코어와 번역 엔진 설치"
.venv/bin/pip install -q ctranslate2 sentencepiece huggingface_hub
.venv/bin/pip install -q --no-deps "murmur @ git+https://github.com/jkf87/murmur.git#subdirectory=core"
echo "[3/3] NLLB-200 번역 모델 받기 (약 2.3GB)"
.venv/bin/python - <<'PY'
import os
from huggingface_hub import snapshot_download
dst = os.environ.get("MURMUR_NLLB_DIR", os.path.expanduser("~/.cache/murmur-translate/nllb-ct2"))
snapshot_download("JustFrederik/nllb-200-distilled-600M-ct2", local_dir=dst)
print("모델 위치:", dst)
PY
echo "완료. 이제 ./start.sh 로 번역 서버를 켜세요."
