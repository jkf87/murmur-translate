// 콘텐츠 스크립트가 보낸 번역 요청을 로컬 murmur 서버로 전달한다.
// 웹페이지에서 직접 127.0.0.1을 부르지 않고, 확장의 백그라운드만 서버와 이야기한다.
const SERVER = "http://127.0.0.1:8790";

async function translate(texts, source = "en", target = "ko") {
  const res = await fetch(`${SERVER}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, source, target }),
  });
  if (!res.ok) throw new Error(`번역 서버 오류 ${res.status}`);
  return res.json();
}

// 실시간 자막: 탭 소리는 offscreen.html이 받아서 서버로 보내고, 결과를 여기서 그 탭으로 넘긴다.
// 한 번에 한 탭만 듣는다. 지금 듣는 탭 번호는 storage.session에 둔다(서비스 워커가 잠들어도 유지).
async function liveTab() {
  return (await chrome.storage.session.get({ liveTab: null })).liveTab;
}

async function startLive(tabId, streamId) {
  if (!(await chrome.offscreen.hasDocument())) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA"],
      justification: "탭 소리를 받아 로컬 murmur 서버로 실시간 자막을 만든다",
    });
  }
  await chrome.storage.session.set({ liveTab: tabId });
  chrome.runtime.sendMessage({ route: "offscreen", type: "live-start", tabId, streamId });
}

async function stopLive() {
  const tabId = await liveTab();
  await chrome.storage.session.set({ liveTab: null });
  if (await chrome.offscreen.hasDocument()) {
    chrome.runtime.sendMessage({ route: "offscreen", type: "live-stop" });
    setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 500);
  }
  if (tabId != null) chrome.tabs.sendMessage(tabId, { type: "live-state", on: false }).catch(() => {});
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === (await liveTab())) stopLive();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.route === "offscreen") return; // offscreen 문서 몫
  if (msg.route === "background") {
    // offscreen → 자막·상태·오류를 해당 탭의 live.js로 전달
    chrome.tabs.sendMessage(msg.tabId, msg).catch(() => {});
    return;
  }
  if (msg.type === "translate") {
    translate(msg.texts, msg.source, msg.target)
      .then((r) => reply({ ok: true, translations: r.translations, ms: r.ms }))
      .catch((e) => reply({ ok: false, error: String(e) }));
    return true; // 비동기 응답
  }
  if (msg.type === "health") {
    fetch(`${SERVER}/health`).then((r) => r.json())
      .then((r) => reply({ ok: r.ok, engine: r.engine, stt: r.stt }))
      .catch(() => reply({ ok: false }));
    return true;
  }
  if (msg.type === "live-start") {
    startLive(msg.tabId, msg.streamId).then(() => reply({ ok: true }), (e) => reply({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === "live-stop") {
    stopLive().then(() => reply({ ok: true }));
    return true;
  }
  if (msg.type === "live-status") {
    liveTab().then((tabId) => reply({ tabId }));
    return true;
  }
});
