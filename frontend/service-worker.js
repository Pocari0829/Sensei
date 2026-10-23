// ─────────────────────────────────────────────
// 서비스 워커: 홈 화면에 설치(PWA)할 수 있게 하고, 인터넷이 끊겼을 때 화면 껍데기를 보여준다.
// 등록은 src/scripts/pwa.js 가 한다.
//
// 방식: "네트워크 먼저". 항상 서버에서 최신 파일을 받고, 받은 파일을 캐시에 넣어 둔다.
//   인터넷이 끊겼을 때만 캐시에 있던 파일을 쓴다. 그래서 코드를 고치면 새로고침만 해도 바로 반영된다.
//   (캐시 먼저 방식은 빠르지만, 배포 후에도 예전 화면이 남아 있는 문제가 생기기 쉬워서 쓰지 않는다)
// 다른 주소(Supabase, 백엔드, Google 로그인, 글꼴 CDN)로 가는 요청은 건드리지 않는다.
//
// [팀 논의 필요 D13] 오프라인 범위: 지금은 인터넷이 끊기면 화면만 뜨고 로그인·대화·퀴즈는 안 된다.
//   (하쿠와 DB 가 모두 인터넷 너머에 있으므로) "인터넷 연결이 필요해요" 안내 화면을 따로 만들지 정하기.
// ─────────────────────────────────────────────

// 캐시에 넣는 파일 목록이나 방식을 바꾸면 숫자를 올린다. 예전 캐시는 activate 에서 지운다.
const CACHE_NAME = "sensei-v3";

// 설치할 때 미리 받아 두는 파일. 하나가 없어도 나머지는 받는다.
const PRECACHE = [
  "./src/pages/index.html",
  "./src/pages/nickname.html",
  "./src/pages/survey.html",
  "./src/pages/chat.html",
  "./src/pages/history.html",
  "./src/pages/profile.html",
  "./src/pages/quiz.html",
  "./src/styles/style.css",
  "./public/mascot.png",
  "./public/avatar-default.svg",
  "./public/haku-shadow.png",
  "./public/icon-menu.svg",
  "./public/icon-send.svg",
  "./public/icon-kakao.svg",
  "./public/icon-question.svg",
  "./public/icons/icon-192.png",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      // ?session= 처럼 주소 뒤가 달라도 같은 화면이면 캐시를 쓴다.
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? Response.error())),
  );
});
