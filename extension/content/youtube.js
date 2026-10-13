// 유튜브 이중 자막: 플레이어가 받은 자막 파일을 미리 통째로 번역해 두고,
// 영상 시간에 맞춰 한국어 줄을 원래 자막 위에 띄운다.
(() => {
  const BATCH = 16;
  let cues = [];          // {start, end, text, ko}
  let trackKey = "";
  let overlay = null;
  let enabled = true;

  chrome.storage.local.get({ youtube: true }, (s) => (enabled = s.youtube));
  chrome.storage.onChanged.addListener((c) => c.youtube && (enabled = c.youtube.newValue));

  // 1) 훅 스크립트(youtube-hook.js)는 manifest에서 MAIN world로 먼저 실행된다

  // 2) 자막 파일을 받으면 줄 단위로 바꾼다 (json3 또는 XML)
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "murmur-hook") return;
    const url = new URL(e.data.url, location.href);
    const key = `${url.searchParams.get("v")}|${url.searchParams.get("lang")}|${url.searchParams.get("tlang") || ""}`;
    if (key === trackKey) return;
    const lang = url.searchParams.get("tlang") || url.searchParams.get("lang") || "";
    if (lang.startsWith("ko")) return; // 이미 한국어 자막이면 번역하지 않는다
    const parsed = parse(e.data.body);
    if (!parsed.length) return;
    trackKey = key;
    cues = parsed;
    console.log(`[murmur] 자막 ${cues.length}줄을 받았어요 (${url.searchParams.get("lang")})`);
    translateAll();
  });

  function parse(body) {
    const out = [];
    if (body.trim().startsWith("{")) {
      for (const ev of JSON.parse(body).events || []) {
        const text = (ev.segs || []).map((g) => g.utf8).join("").replace(/\s+/g, " ").trim();
        if (text) out.push({ start: ev.tStartMs / 1000, end: (ev.tStartMs + (ev.dDurationMs || 2000)) / 1000, text });
      }
    } else {
      const doc = new DOMParser().parseFromString(body, "text/xml");
      for (const p of doc.querySelectorAll("p, text")) {
        const t = Number(p.getAttribute("t") ?? p.getAttribute("start") * 1000);
        const d = Number(p.getAttribute("d") ?? p.getAttribute("dur") * 1000);
        const text = p.textContent.replace(/\s+/g, " ").trim();
        if (text) out.push({ start: t / 1000, end: (t + d) / 1000, text });
      }
    }
    return out;
  }

  // 3) 지금 재생 위치에 가까운 줄부터 묶어서 번역한다
  async function translateAll() {
    const key = trackKey;
    const video = document.querySelector("video");
    const now = video ? video.currentTime : 0;
    const order = cues.map((c, i) => i).sort((a, b) => {
      const da = cues[a].end < now ? 1e6 + cues[a].start : cues[a].start - now;
      const db = cues[b].end < now ? 1e6 + cues[b].start : cues[b].start - now;
      return da - db;
    });
    for (let k = 0; k < order.length; k += BATCH) {
      const ids = order.slice(k, k + BATCH).filter((i) => !cues[i].ko);
      if (!ids.length) continue;
      const res = await chrome.runtime.sendMessage({ type: "translate", texts: ids.map((i) => cues[i].text) });
      if (key !== trackKey) return; // 다른 영상으로 넘어감
      if (res && res.ok) ids.forEach((i, j) => (cues[i].ko = res.translations[j]));
    }
    console.log(`[murmur] 자막 번역 완료 ${cues.length}줄`);
  }

  // 4) 영상 시간에 맞는 줄을 원문+번역 두 줄로 띄운다 (유튜브 기본 자막은 숨긴다)
  function tick() {
    const video = document.querySelector("video");
    const player = document.querySelector("#movie_player");
    if (video && player) {
      if (!overlay || !player.contains(overlay)) {
        overlay = document.createElement("div");
        overlay.className = "murmur-yt";
        overlay.innerHTML = '<div class="murmur-yt-en"></div><div class="murmur-yt-ko"></div>';
        player.appendChild(overlay);
      }
      const on = enabled && cues.length > 0;
      player.classList.toggle("murmur-on", on);
      const t = video.currentTime;
      const cue = on && cues.find((c) => t >= c.start && t < c.end);
      const en = cue ? cue.text : "";
      const ko = cue ? cue.ko || "…" : "";
      const [enEl, koEl] = overlay.children;
      if (enEl.textContent !== en) enEl.textContent = en;
      if (koEl.textContent !== ko) koEl.textContent = ko;
      overlay.hidden = !cue;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
