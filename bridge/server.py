#!/usr/bin/env python3
"""murmur 번역 엔진(NLLB-200)을 크롬 확장이 부를 수 있게 열어 주는 로컬 HTTP 서버.

  GET  /health                         → 엔진 상태
  POST /translate {"texts": [...], "source": "en", "target": "ko"}
                                       → {"translations": [...], "ms": 123, "cached": 2}
  POST /transcribe {"session": "탭 번호", "audio": base64 float32 16kHz 모노(약 3초), "target": "ko"}
                                       → {"text": "원문", "translation": "번역", "language": "en", "ms": 812}
     (실시간 자막 · murmur의 whisper 전사. Apple Silicon 맥에서 setup.sh가 준비한다)

이 컴퓨터(127.0.0.1)에서만 받는다. 번역은 전부 로컬에서 돈다.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from murmur.translate import NLLB_LANG_MAP, NLLB_SRC_MAP, Translator

try:  # 실시간 자막용 전사(선택). mlx-whisper가 없으면 번역만 한다
    import numpy as np
    from murmur.postprocess import apply_term_corrections, dedup_overlap, filter_already_seen, is_hallucination
    from murmur.stt import WhisperSTT
    from murmur.vad import VoiceActivityDetector
    import mlx_whisper  # noqa: F401
    HAS_STT = True
except ImportError:
    HAS_STT = False

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


SR = 16000
OVERLAP = 2.0      # murmur 엔진과 같은 값: 앞 조각의 끝 2초를 겹쳐서 다시 듣는다
MAX_CHUNK = 8.0    # 한 번에 받는 소리 최대 길이(초)


def _norm(w: str) -> str:
    return re.sub(r"[^\w]", "", w.lower())


def _same(a: str, b: str) -> bool:
    # 조각 경계에서 잘린 낱말(increase ↔ increasingly)도 같은 낱말로 본다
    return a == b or (min(len(a), len(b)) >= 3 and (a.startswith(b) or b.startswith(a)))


def trim_repeat(prev: str, new: str) -> str:
    """새 조각 앞부분이 앞 조각 끝과 겹치면 지운다.
    겹치는 2초는 다시 듣는 구간이라 첫 낱말이 잘려 다르게 들릴 수 있어서(Attention, the … / nots to …)
    새 조각 앞의 낱말 두 개까지는 건너뛰고 맞춰 본다."""
    p = [_norm(w) for w in prev.split()[-20:]]
    n = new.split()
    nn = [_norm(w) for w in n]
    best = None
    for skip in (0, 1, 2):
        for k in range(min(len(p), len(n) - skip), 1, -1):
            if skip and k < 3:
                break
            for drop in (0, 1, 2):
                if k + drop > len(p):
                    continue
                tail = p[len(p) - k - drop:len(p) - drop]
                if all(_same(x, y) for x, y in zip(tail, nn[skip:skip + k])):
                    if best is None or skip + k > best:
                        best = skip + k
                    break
            if best is not None and best >= skip + k:
                break
    return " ".join(n[best:]) if best else new


class Session:
    """탭 하나의 실시간 자막 상태. murmur 엔진의 _transcribe_chunk 흐름을 HTTP 요청 단위로 옮겼다."""

    def __init__(self):
        self.stt = WhisperSTT()
        self.stt._ready = True  # 모델은 Listener.load()에서 한 번 미리 불러 둔다
        self.tail = np.zeros(0, dtype=np.float32)
        self.last_text = ""
        self.full_text = ""
        self.seen = time.time()


class Listener:
    """murmur의 whisper 전사(STT) → 환각 거르기 → 겹친 부분 지우기 → NLLB 번역."""

    def __init__(self, engine: Engine):
        self.engine = engine
        self.vad = VoiceActivityDetector(sample_rate=SR)
        self.sessions: dict[str, Session] = {}
        self.lock = threading.Lock()
        self.state = "loading"

    def load(self):
        self.state = "ready" if WhisperSTT().preload() else "error"
        print(f"[전사] whisper 모델 {'준비 완료' if self.state == 'ready' else '불러오기 실패'}", flush=True)

    def transcribe(self, session: str, audio: np.ndarray, target: str) -> dict:
        now = time.time()
        for k in [k for k, v in self.sessions.items() if now - v.seen > 600]:
            del self.sessions[k]  # 10분 동안 소리가 안 오면 정리
        ss = self.sessions.setdefault(session, Session())
        ss.seen = now
        chunk = np.concatenate([ss.tail, audio])
        ss.tail = chunk[-int(OVERLAP * SR):]
        if not self.vad.has_speech(chunk):
            return {"text": "", "skipped": "silence"}
        t0 = time.time()
        with self.lock:
            r = ss.stt.transcribe(chunk, language="auto")
        text = apply_term_corrections(r.text) if r.text else ""
        if not text or is_hallucination(text):
            return {"text": "", "skipped": "empty", "ms": int((time.time() - t0) * 1000)}
        new = filter_already_seen(ss.full_text, trim_repeat(ss.last_text, dedup_overlap(ss.last_text, text)))
        ss.last_text = text
        if not new:
            return {"text": "", "skipped": "duplicate", "ms": int((time.time() - t0) * 1000)}
        ss.full_text = (ss.full_text + " " + new)[-4000:]
        lang = r.language or "en"
        tr = ""
        if not lang.startswith(target) and lang in NLLB_SRC_MAP:
            tr = self.engine.translate([new], lang, target)[0][0]
        return {"text": new, "translation": tr, "language": lang, "ms": int((time.time() - t0) * 1000)}


def make_handler(engine: Engine, listener: "Listener | None" = None):
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
                                        "model": engine.model_dir.name, "cache": len(engine.cache),
                                        "stt": listener.state if listener else "off"})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path == "/transcribe":
                return self._transcribe()
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

        def _transcribe(self):
            if not listener or listener.state != "ready":
                state = listener.state if listener else "off"
                return self._send(503, {"error": f"전사 엔진 {state} (Apple Silicon 맥에서 setup.sh로 준비)"})
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                raw = base64.b64decode(req.get("audio", ""), validate=True)
                if not raw or len(raw) % 4 or len(raw) > SR * 4 * MAX_CHUNK:
                    raise ValueError("audio size")
                audio = np.frombuffer(raw, dtype="<f4").astype(np.float32)
            except (ValueError, TypeError):
                return self._send(400, {"error": "bad audio"})
            out = listener.transcribe(str(req.get("session", "default")), audio, req.get("target", "ko"))
            self._send(200, out)
            if out.get("text"):
                print(f"[전사] {out['language']} {out['ms']}ms · {out['text'][:60]}", flush=True)

        def log_message(self, *args):
            pass

    return Handler


def main():
    ap = argparse.ArgumentParser(description="murmur 로컬 번역 서버")
    ap.add_argument("--port", type=int, default=int(os.environ.get("MURMUR_TRANSLATE_PORT", 8790)))
    ap.add_argument("--model", type=Path, default=Path(os.environ.get("MURMUR_NLLB_DIR", DEFAULT_MODEL)))
    ap.add_argument("--no-stt", action="store_true", help="실시간 자막(전사) 끄기")
    a = ap.parse_args()
    engine = Engine(a.model)
    if not engine.load():
        raise SystemExit(f"NLLB 모델을 불러오지 못했어요: {a.model} (setup.sh 먼저 실행)")
    listener = None
    if HAS_STT and not a.no_stt:
        listener = Listener(engine)
        threading.Thread(target=listener.load, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(engine, listener))
    shown = str(a.model).replace(str(Path.home()), "~")
    print(f"murmur 번역 서버 준비 완료 → http://127.0.0.1:{a.port}  (모델 {shown})", flush=True)
    if listener:
        print("실시간 자막: murmur whisper 전사 켜짐 (/transcribe)", flush=True)
    else:
        print("실시간 자막: 꺼짐 (mlx-whisper 없음 — Apple Silicon 맥에서 setup.sh로 준비)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
