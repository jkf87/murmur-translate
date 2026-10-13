#!/usr/bin/env bash
# 서버가 켜져 있을 때, 확장 없이 실시간 자막(받아쓰기 → 번역)을 시험해 본다.
# 맥의 say로 영어 음성을 만들고, 확장처럼 3초씩 잘라 /transcribe로 보낸다.  인자: 오디오 파일(선택)
set -euo pipefail
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [ $# -gt 0 ]; then SRC="$1"; else
  SRC="$TMP/speech.aiff"
  say -v Samantha -o "$SRC" "Under Artemis, NASA will send astronauts to explore more of the Moon. Nothing leaves your computer."
fi
ffmpeg -v error -y -i "$SRC" -ar 16000 -ac 1 -f f32le "$TMP/audio.f32"
python3 - "$TMP/audio.f32" <<'PY'
import base64, json, os, sys, urllib.request
raw = open(sys.argv[1], "rb").read()
step = 16000 * 4 * 3  # 3초
for i in range(0, len(raw), step):
    body = json.dumps({"session": f"try-{os.getpid()}", "audio": base64.b64encode(raw[i:i + step]).decode(), "target": "ko"}).encode()
    req = urllib.request.Request("http://127.0.0.1:8790/transcribe", body, {"Content-Type": "application/json"})
    try:
        d = json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        sys.exit(json.load(e).get("error"))
    if d.get("text"):
        print(f"[{i // step * 3:>3}초] {d['text']}\n       → {d['translation']}  ({d['ms']}ms)")
PY
