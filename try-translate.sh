#!/usr/bin/env bash
# 서버가 켜져 있을 때, 확장 없이 터미널에서 번역을 시험해 본다.
set -euo pipefail
TEXT="${*:-Under Artemis, NASA will send astronauts to explore more of the Moon.}"
curl -s http://127.0.0.1:8790/health; echo
curl -s -X POST http://127.0.0.1:8790/translate -H 'Content-Type: application/json' \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"texts": [sys.argv[1]], "source": "en", "target": "ko"}))' "$TEXT")" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("번역:", d["translations"][0]); print("걸린 시간 %sms · 캐시 %s" % (d["ms"], d["cached"]))'
