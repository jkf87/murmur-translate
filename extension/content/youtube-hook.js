// 유튜브 페이지 안(MAIN world)에서 실행된다. 플레이어가 자막 파일(/api/timedtext)을 받아 오는 순간
// 그 응답을 복사해서 콘텐츠 스크립트에 넘긴다. 요청을 새로 만들지 않고, 플레이어가 받은 것만 쓴다.
(() => {
  const isCaption = (url) => typeof url === "string" && url.includes("/api/timedtext");
  const send = (url, body) => window.postMessage({ source: "murmur-hook", url, body }, "*");

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await origFetch.apply(this, arguments);
    const url = typeof input === "string" ? input : input && input.url;
    if (isCaption(url)) res.clone().text().then((t) => send(url, t)).catch(() => {});
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isCaption(String(url))) {
      this.addEventListener("load", () => {
        try { send(String(url), this.responseText); } catch (e) {}
      });
    }
    return origOpen.apply(this, arguments);
  };
})();
