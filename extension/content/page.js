// 웹페이지 이중 언어 번역: 문단을 골라 원문 아래에 한국어 번역을 붙인다.
// 화면에 보이는 문단부터 번역하고, 나중에 생기는 문단도 따라가며 번역한다.
// 플로팅 버튼(float.js)이나 팝업이 murmurTranslatePage()를 부르면 시작한다.
window.murmurTranslatePage = () => {
  if (window.__murmurPage) return;
  window.__murmurPage = true;

  const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, dd, dt, figcaption, td, th, summary";
  const SKIP = "pre, code, script, style, textarea, nav, [contenteditable], .murmur-tr";
  const BATCH = 12;
  const queue = [];
  let busy = false;

  // 번역할 만한 문단인가: 영어 단어가 두 개 이상이고, 이미 한국어 위주가 아니고, 안쪽에 다른 문단이 없다
  function worth(el) {
    if (el.dataset.murmur || el.closest(SKIP) || el.querySelector(BLOCKS)) return false;
    const text = el.innerText.trim();
    if ((text.match(/[A-Za-z]{2,}/g) || []).length < 2) return false;
    const hangul = (text.match(/[가-힣]/g) || []).length;
    return hangul / text.length < 0.3;
  }

  function attach(el) {
    el.dataset.murmur = "wait";
    const tr = document.createElement("span");
    tr.className = "murmur-tr murmur-wait";
    tr.textContent = "…";
    el.appendChild(tr);
    queue.push({ el, tr, text: el.innerText.replace(tr.innerText, "").trim() });
    pump();
  }

  async function pump() {
    if (busy || !queue.length) return;
    busy = true;
    const batch = queue.splice(0, BATCH);
    const res = await chrome.runtime.sendMessage({ type: "translate", texts: batch.map((b) => b.text) });
    batch.forEach((b, i) => {
      b.tr.classList.remove("murmur-wait");
      b.tr.textContent = res && res.ok ? res.translations[i] : "(번역 서버에 연결할 수 없어요)";
      b.el.dataset.murmur = "done";
    });
    busy = false;
    pump();
  }

  // 화면에 들어온 문단부터 번역 대기열에 넣는다
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !e.target.dataset.murmur) {
        seen.unobserve(e.target);
        attach(e.target);
      }
    }
  }, { rootMargin: "0px 0px 200% 0px" }); // 화면 아래 두 장 분량까지 미리 번역

  const scan = (root) => root.querySelectorAll(BLOCKS).forEach((el) => worth(el) && seen.observe(el));
  scan(document.body);

  // 무한 스크롤처럼 나중에 붙는 문단도 따라간다
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => n.nodeType === 1 && !n.classList.contains("murmur-tr") && scan(n));
  }).observe(document.body, { childList: true, subtree: true });
};

chrome.runtime.onMessage.addListener((msg) => msg.type === "translatePage" && window.murmurTranslatePage());
