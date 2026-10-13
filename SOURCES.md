# 출처 (2026-10-13 확인)

- murmur (실시간 음성 전사·번역, NLLB 번역 모듈): https://github.com/jkf87/murmur
- NLLB-200 distilled 600M, CTranslate2 변환본: https://huggingface.co/JustFrederik/nllb-200-distilled-600M-ct2
- CTranslate2: https://github.com/OpenNMT/CTranslate2
- REA (Reverse Engineer Anything): https://github.com/morluto/rea
- 참고한 확장(구조만 관찰, 코드 미사용): Immersive Translate https://chromewebstore.google.com/detail/bpoadfkcbjbfhfodiogcnhhhpibjhbnh
- Chrome 확장 문서: content scripts의 `world: "MAIN"` https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- 영상 속 예제 화면: NASA "How We Are Going to the Moon"(https://www.youtube.com/watch?v=_T8cn2J13-4), NASA Artemis 페이지(https://www.nasa.gov/humans-in-space/artemis/) — NASA 미디어 이용 지침을 따름

## 실시간 자막 (2026-10-14 추가)
- murmur 받아쓰기·후처리(`murmur.stt` whisper-small, `murmur.postprocess`, `murmur.vad`, 3초 간격·2초 겹침): https://github.com/jkf87/murmur/tree/master/core/src/murmur
- whisper-small (MLX 변환본): https://huggingface.co/mlx-community/whisper-small-mlx · mlx-whisper: https://github.com/ml-explore/mlx-examples/tree/main/whisper
- Chrome 확장 문서: 탭 오디오 캡처 `chrome.tabCapture` https://developer.chrome.com/docs/extensions/reference/api/tabCapture , `chrome.offscreen` https://developer.chrome.com/docs/extensions/reference/api/offscreen
- 실시간 자막 점검에 쓴 라이브 방송: Sky News 유튜브 라이브(https://www.youtube.com/@SkyNews/live) — 화면 녹화·배포에는 쓰지 않음
