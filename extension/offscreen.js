// 실시간 자막: 탭에서 나는 소리를 받아 3초마다 로컬 서버(/transcribe)로 보낸다.
// 서버는 murmur의 whisper로 받아쓰고 NLLB로 번역해서 돌려준다. 결과는 백그라운드를 거쳐 탭으로 간다.
// 이 문서는 화면에 보이지 않는 확장 페이지(offscreen document)라 탭 오디오 스트림을 열 수 있다.
const SERVER = "http://127.0.0.1:8790";
const SR = 16000;          // whisper 입력: 16kHz 모노
const INTERVAL = 3000;     // murmur 엔진과 같은 3초 간격
const MAX_SEC = 8;         // 서버가 느려 밀리면 최근 8초만 남긴다

let live = null; // { tabId, media, ctx, timer, buf: Float32Array[], inflight }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.route !== "offscreen") return;
  if (msg.type === "live-start") start(msg.tabId, msg.streamId);
  if (msg.type === "live-stop") stop();
});

async function start(tabId, streamId) {
  stop();
  const media = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(media);
  src.connect(ctx.destination); // 탭 캡처는 원래 소리를 끄므로 그대로 다시 들려준다

  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);

  live = { tabId, media, ctx, buf: [], inflight: false };
  const ratio = ctx.sampleRate / SR;
  proc.onaudioprocess = (e) => {
    if (!live) return;
    // 48kHz(또는 44.1kHz) → 16kHz: 구간 평균으로 줄인다
    // (44.1kHz처럼 나누어떨어지지 않으면 버퍼 끝의 한두 샘플은 버린다. 받아쓰기에는 영향 없음)
    const x = e.inputBuffer.getChannelData(0);
    const out = new Float32Array(Math.floor(x.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio), b = Math.floor((i + 1) * ratio);
      let s = 0;
      for (let j = a; j < b; j++) s += x[j];
      out[i] = s / (b - a);
    }
    live.buf.push(out);
  };
  live.timer = setInterval(flush, INTERVAL);
  tell({ type: "live-state", tabId, on: true });
}

async function flush() {
  if (!live || live.inflight) return; // 앞 요청이 아직이면 다음 차례에 합쳐서 보낸다
  let n = live.buf.reduce((s, b) => s + b.length, 0);
  if (n < SR * 0.5) return;
  const audio = new Float32Array(n);
  let o = 0;
  for (const b of live.buf) { audio.set(b, o); o += b.length; }
  live.buf = [];
  const send = audio.length > SR * MAX_SEC ? audio.subarray(audio.length - SR * MAX_SEC) : audio;
  const { tabId } = live;
  live.inflight = true;
  try {
    const res = await fetch(`${SERVER}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: String(tabId), audio: b64(send), target: "ko" }),
    });
    const r = await res.json();
    if (!live || live.tabId !== tabId) return; // 그사이 꺼졌으면 늦게 온 결과는 버린다
    if (!res.ok) tell({ type: "live-error", tabId, error: r.error || `서버 오류 ${res.status}` });
    else if (r.text) tell({ type: "live-caption", tabId, text: r.text, translation: r.translation || "", ms: r.ms });
  } catch (e) {
    if (live) tell({ type: "live-error", tabId, error: "번역 서버가 꺼져 있어요" });
  } finally {
    if (live) live.inflight = false;
  }
}

function stop() {
  if (!live) return;
  clearInterval(live.timer);
  live.media.getTracks().forEach((t) => t.stop());
  live.ctx.close();
  tell({ type: "live-state", tabId: live.tabId, on: false });
  live = null;
}

function b64(f32) {
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function tell(msg) {
  chrome.runtime.sendMessage({ ...msg, route: "background" });
}
