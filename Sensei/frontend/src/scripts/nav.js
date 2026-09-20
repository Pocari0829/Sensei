// ─────────────────────────────────────────────
// 화면 최하단 탭 바 (채팅 / 학습 기록 / 프로필).
// 마크업을 각 html 파일마다 복사해두지 않고, 이 모듈이 매번 그려서
// <div id="bottom-nav"></div> 자리에 꽂아 넣는다. 탭이 늘어나도 여기 하나만 고치면 된다.
// ─────────────────────────────────────────────

const ICONS = {
  chat: `<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />`,
  history: `<path d="M3 12a9 9 0 1 0 2.6-6.32L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3.5 2" />`,
  profile: `<circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" />`,
};

// 페이지 파일명(body[data-page])과 탭을 매핑한다. 지금은 3개만 연결한다.
const TABS = [
  { key: "chat", label: "채팅", href: "./chat.html" },
  { key: "history", label: "학습 기록", href: "./history.html" },
  { key: "profile", label: "프로필", href: "./profile.html" },
];

/**
 * 현재 페이지의 <body data-page="..."> 값을 활성 탭 표시에 사용한다.
 * mount(activePage) 처럼 값을 직접 넘겨도 되고, 생략하면 body 속성에서 읽는다.
 */
export function renderBottomNav(activePage) {
  const host = document.getElementById("bottom-nav");
  if (!host) return;

  const active = activePage || document.body.dataset.page;

  host.innerHTML = TABS.map((tab) => {
    const isActive = tab.key === active;
    return `
      <a
        class="bottom-nav__item${isActive ? " is-active" : ""}"
        href="${tab.href}"
        aria-current="${isActive ? "page" : "false"}"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          ${ICONS[tab.key]}
        </svg>
        <span>${tab.label}</span>
      </a>
    `;
  }).join("");
}

// 스크립트가 로드되자마자 알아서 그린다. (각 페이지에서 renderBottomNav()를 또 부를 필요 없음)
document.addEventListener("DOMContentLoaded", () => renderBottomNav());
