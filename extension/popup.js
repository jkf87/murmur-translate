const status = document.getElementById("status");
const live = document.getElementById("live");
const liveNote = document.getElementById("liveNote");

chrome.runtime.sendMessage({ type: "health" }, (r) => {
  status.textContent = r && r.ok ? `연결됨 · ${r.engine}` : "번역 서버가 꺼져 있어요";
  status.className = r && r.ok ? "ok" : "bad";
  if (r && r.ok && r.stt !== "ready") {
    live.disabled = true;
    liveNote.textContent = r.stt === "loading" ? "받아쓰기 모델을 불러오는 중이에요. 잠시 뒤 다시 열어 주세요."
      : "실시간 자막은 Apple Silicon 맥에서 setup.sh로 받아쓰기(whisper)를 준비해야 써요.";
  }
});

document.getElementById("page").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: "translatePage" });
  window.close();
});

const yt = document.getElementById("yt");
chrome.storage.local.get({ youtube: true }, (s) => (yt.checked = s.youtube));
yt.addEventListener("change", () => chrome.storage.local.set({ youtube: yt.checked }));

// 실시간 자막: 팝업을 누른 이 순간에만 탭 소리를 받을 권한(streamId)을 얻을 수 있다
(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { tabId } = await chrome.runtime.sendMessage({ type: "live-status" });
  const listening = tabId === tab.id;
  live.textContent = listening ? "실시간 자막 끄기" : "실시간 자막 켜기";
  live.classList.toggle("on", listening);
  live.addEventListener("click", async () => {
    if (listening) {
      await chrome.runtime.sendMessage({ type: "live-stop" });
    } else {
      if (tabId != null) await chrome.runtime.sendMessage({ type: "live-stop" }); // 다른 탭은 멈춘다
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const r = await chrome.runtime.sendMessage({ type: "live-start", tabId: tab.id, streamId });
      if (!r || !r.ok) { liveNote.textContent = `시작하지 못했어요: ${r && r.error}`; return; }
    }
    window.close();
  });
})();
