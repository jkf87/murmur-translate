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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === "translate") {
    translate(msg.texts, msg.source, msg.target)
      .then((r) => reply({ ok: true, translations: r.translations, ms: r.ms }))
      .catch((e) => reply({ ok: false, error: String(e) }));
    return true; // 비동기 응답
  }
  if (msg.type === "health") {
    fetch(`${SERVER}/health`).then((r) => r.json())
      .then((r) => reply({ ok: r.ok, engine: r.engine }))
      .catch(() => reply({ ok: false }));
    return true;
  }
});
