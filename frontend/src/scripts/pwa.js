// ─────────────────────────────────────────────
// 모든 페이지에 <script> 로 넣는다. 서비스 워커(frontend/service-worker.js)를 등록해서
// 휴대폰에서 "홈 화면에 추가" 로 앱처럼 설치할 수 있게 한다.
// 서비스 워커는 https 나 localhost 에서만 동작한다. (127.0.0.1 도 되지만, 로그인은 localhost 로 열 것)
// 앱 이름 / 색 / 아이콘은 frontend/manifest.json 에 있다.
//
// [팀 논의 필요 D12] 앱 아이콘(public/icons/icon-*.png)은 mascot.png 를 연보라 배경 가운데에 놓아 만든 임시본이다.
//   최종 아이콘 디자인과 홈 화면에 보일 앱 이름(지금 "SENSEI"), 테마 색(지금 --primary #4f46c8)을 정해야 한다.
//   아이콘을 바꾸면 같은 이름(icon-180 / 192 / 512.png, 정사각형)으로 덮어쓰면 된다.
// ─────────────────────────────────────────────

if ("serviceWorker" in navigator) {
  // 서비스 워커 파일은 frontend 맨 위에 있어야 모든 페이지를 맡을 수 있다. (이 파일 기준 ../../)
  const url = new URL("../../service-worker.js", import.meta.url);
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url).catch((err) => console.warn("서비스 워커를 등록하지 못했어요:", err));
  });
}
