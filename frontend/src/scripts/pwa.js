// ─────────────────────────────────────────────
// 모든 페이지에 <script> 로 넣는다. 서비스 워커(frontend/service-worker.js)를 등록해서
// 휴대폰에서 "홈 화면에 추가" 로 앱처럼 설치할 수 있게 한다.
// 서비스 워커는 https 나 localhost 에서만 동작한다. (127.0.0.1 도 되지만, 로그인은 localhost 로 열 것)
// 앱 이름 / 색 / 아이콘은 frontend/manifest.json 에 있다.
//
// 앱 아이콘(public/icons/icon-*.png)은 새 디자인의 mascot.png 를 흰 배경만 지우고 --background(#eaf1fd) 가운데에 놓아 만들었다.
//   icon-180 / 192 / 512.png          홈 화면·바탕화면용. 마스코트를 크게 (높이 74%)
//   icon-maskable-512.png             안드로이드가 동그랗게 잘라 쓰는 아이콘. 잘려도 안 보이는 곳이 없게 작게 (높이 62%)
//   상단 상태바 색은 각 페이지의 <meta name="theme-color"> 가 정한다. (지금 #4f46c8)
// [팀 논의 필요 D12] 최종 아이콘 디자인과 홈 화면에 보일 앱 이름(지금 "SENSEI")을 정해야 한다.
//   아이콘을 바꾸면 같은 이름, 같은 크기(정사각형)로 덮어쓰면 된다.
// ─────────────────────────────────────────────

if ("serviceWorker" in navigator) {
  // 서비스 워커 파일은 frontend 맨 위에 있어야 모든 페이지를 맡을 수 있다. (이 파일 기준 ../../)
  const url = new URL("../../service-worker.js", import.meta.url);
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url).catch((err) => console.warn("서비스 워커를 등록하지 못했어요:", err));
  });
}
