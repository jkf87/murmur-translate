const status = document.getElementById("status");
chrome.runtime.sendMessage({ type: "health" }, (r) => {
  status.textContent = r && r.ok ? `연결됨 · ${r.engine}` : "번역 서버가 꺼져 있어요";
  status.className = r && r.ok ? "ok" : "bad";
});

document.getElementById("page").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: "translatePage" });
  window.close();
});

const yt = document.getElementById("yt");
chrome.storage.local.get({ youtube: true }, (s) => (yt.checked = s.youtube));
yt.addEventListener("change", () => chrome.storage.local.set({ youtube: yt.checked }));
