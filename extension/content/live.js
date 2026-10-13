// 실시간 자막 표시: 백그라운드가 넘겨준 받아쓰기(원문)와 번역을 두 줄로 띄운다.
// 유튜브에서는 플레이어 안(기본 자막 자리)에, 다른 사이트는 가장 큰 동영상 아래쪽이나 화면 아래에 띄운다.
(() => {
  if (window.top !== window) return;
  let box = null;
  let hideTimer = 0;
  let on = false;

  function player() {
    return document.querySelector("#movie_player");
  }

  function biggestVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll("video")) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area && r.bottom > 0 && r.top < innerHeight) { best = v; area = r.width * r.height; }
    }
    return best;
  }

  function ensureBox() {
    const p = player();
    const parent = p || document.documentElement;
    if (!box || !parent.contains(box)) {
      box = document.createElement("div");
      box.className = p ? "murmur-yt murmur-live" : "murmur-live murmur-live-float";
      box.innerHTML = '<div class="murmur-yt-en"></div><div class="murmur-yt-ko"></div>';
      parent.appendChild(box);
      if (!p) requestAnimationFrame(place);
    }
    return box;
  }

  // 일반 사이트: 동영상이 보이면 그 안 아래쪽(컨트롤 막대 위)에, 없으면 화면 아래 가운데. 스크롤해도 따라간다
  function place() {
    if (!box || player()) return;
    if (!box.hidden) {
      const v = biggestVideo();
      const r = v ? v.getBoundingClientRect() : null;
      box.style.left = r ? `${r.left + r.width / 2}px` : "50%";
      box.style.top = r ? `${Math.min(r.bottom, innerHeight) - Math.max(56, r.height * 0.12)}px` : "";
      box.style.bottom = r ? "" : "6%";
    }
    requestAnimationFrame(place);
  }

  function setOn(v) {
    on = v;
    const p = player();
    if (p) p.classList.toggle("murmur-live-on", v); // 유튜브 기본 자막과 파일 자막 상자는 잠시 숨긴다
    if (!v && box) box.hidden = true;
  }

  function show(en, ko) {
    const b = ensureBox();
    b.children[0].textContent = en;
    b.children[1].textContent = ko;
    b.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (b.hidden = true), 8000); // 8초 동안 말이 없으면 내린다
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "live-state") {
      setOn(msg.on);
      if (msg.on) show("", "실시간 자막을 듣고 있어요…");
    }
    if (msg.type === "live-caption" && on) {
      show(msg.text, msg.translation);
      console.log(`[murmur] 실시간 자막 ${msg.ms}ms · ${msg.text}`);
    }
    if (msg.type === "live-error" && on) show("", msg.error);
  });
})();
