#!/usr/bin/env python3
"""murmur 번역 엔진(NLLB-200)을 크롬 확장이 부를 수 있게 열어 주는 로컬 HTTP 서버.

  GET  /health                         → 엔진 상태
  POST /translate {"texts": [...], "source": "en", "target": "ko"}
                                       → {"translations": [...], "ms": 123, "cached": 2}

이 컴퓨터(127.0.0.1)에서만 받는다. 번역은 전부 로컬에서 돈다.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from murmur.translate import NLLB_LANG_MAP, NLLB_SRC_MAP, Translator

DEFAULT_MODEL = Path.home() / ".cache" / "murmur-translate" / "nllb-ct2"
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


class Engine:
    """murmur Translator를 그대로 쓰되, 여러 문단을 한 번에 묶어서 번역한다."""

    def __init__(self, model_dir: Path, cache_size: int = 5000):
        self.tr = Translator(str(model_dir))
        self.model_dir = model_dir
        self.lock = threading.Lock()
        self.cache: OrderedDict[tuple, str] = OrderedDict()
        self.cache_size = cache_size

    def load(self) -> bool:
        return self.tr.load()

    def translate(self, texts: list[str], source: str, target: str) -> tuple[list[str], int]:
        src = NLLB_SRC_MAP.get(source, "eng_Latn")
        tgt = NLLB_LANG_MAP.get(target, "kor_Hang")
        out: list[str | None] = [None] * len(texts)
        todo: list[tuple[int, list[str]]] = []
        hits = 0
        for i, text in enumerate(texts):
            key = (src, tgt, text)
            if not text.strip():
                out[i] = ""
            elif key in self.cache:
                self.cache.move_to_end(key)
                out[i] = self.cache[key]
                hits += 1
            else:
                sents = [s.strip() for s in SENTENCE_SPLIT.split(text.strip()) if s.strip()]
                todo.append((i, sents))
        if todo:
            batch = [[src] + self.tr._sp.encode(s, out_type=str) + ["</s>"] for _, sents in todo for s in sents]
            with self.lock:
                results = self.tr._translator.translate_batch(
                    batch, target_prefix=[[tgt]] * len(batch), beam_size=2,
                    max_decoding_length=256, max_batch_size=32)
            decoded = iter(self.tr._sp.decode(r.hypotheses[0][1:]) for r in results)
            for i, sents in todo:
                out[i] = " ".join(next(decoded) for _ in sents)
                self.cache[(src, tgt, texts[i])] = out[i]
                if len(self.cache) > self.cache_size:
                    self.cache.popitem(last=False)
        return [o or "" for o in out], hits


def make_handler(engine: Engine):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            origin = self.headers.get("Origin", "")
            if origin.startswith("chrome-extension://"):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self._send(204, {})

        def do_GET(self):
            if self.path == "/health":
                return self._send(200, {"ok": engine.tr.is_available, "engine": "murmur NLLB-200 (local)",
                                        "model": engine.model_dir.name, "cache": len(engine.cache)})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/translate":
                return self._send(404, {"error": "not found"})
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                texts = [str(t) for t in req.get("texts", [])][:200]
            except (ValueError, TypeError):
                return self._send(400, {"error": "bad json"})
            t0 = time.time()
            translations, hits = engine.translate(texts, req.get("source", "en"), req.get("target", "ko"))
            ms = int((time.time() - t0) * 1000)
            self._send(200, {"translations": translations, "ms": ms, "cached": hits})
            print(f"[번역] {len(texts)}개 · 캐시 {hits} · {ms}ms", flush=True)

        def log_message(self, *args):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description="murmur 로컬 번역 서버")
    ap.add_argument("--port", type=int, default=int(os.environ.get("MURMUR_TRANSLATE_PORT", 8790)))
    ap.add_argument("--model", type=Path, default=Path(os.environ.get("MURMUR_NLLB_DIR", DEFAULT_MODEL)))
    a = ap.parse_args()
    engine = Engine(a.model)
    if not engine.load():
        raise SystemExit(f"NLLB 모델을 불러오지 못했어요: {a.model} (setup.sh 먼저 실행)")
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(engine))
    shown = str(a.model).replace(str(Path.home()), "~")
    print(f"murmur 번역 서버 준비 완료 → http://127.0.0.1:{a.port}  (모델 {shown})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
