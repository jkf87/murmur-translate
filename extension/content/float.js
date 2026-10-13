// 화면 오른쪽에 떠 있는 번역 버튼. 누르면 이 페이지를 이중 언어로 번역한다.
(() => {
  if (window.top !== window || document.getElementById("murmur-float")) return;
  const btn = document.createElement("button");
  btn.id = "murmur-float";
  btn.title = "Murmur 로컬 번역";
  btn.textContent = "번역";
  btn.addEventListener("click", () => {
    btn.classList.add("on");
    window.murmurTranslatePage();
  });
  document.documentElement.appendChild(btn);
})();
