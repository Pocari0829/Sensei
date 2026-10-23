// ─────────────────────────────────────────────
// 삼선(☰) 메뉴 열기/닫기 + 로그아웃.
// 화면 이동은 이 메뉴로만 한다 (하단 탭바 없음). chat.html, history.html, profile.html, quiz.html 에서 공용으로 쓴다.
// ─────────────────────────────────────────────

import { getNickname } from "./user.js";
import { signOut } from "./auth.js";

const body = document.body;
const openBtn = document.getElementById("btn-menu");
const closeBtn = document.getElementById("btn-menu-close");
const overlay = document.getElementById("menu-overlay");
const menu = document.getElementById("menu");
const nicknameEl = document.getElementById("menu-nickname");
const logoutBtn = document.getElementById("btn-logout");

function open() {
  body.classList.add("menu-open");
  openBtn.setAttribute("aria-expanded", "true");
  menu.setAttribute("aria-hidden", "false");
  menu.removeAttribute("inert");
  closeBtn.focus();
}

function close() {
  body.classList.remove("menu-open");
  openBtn.setAttribute("aria-expanded", "false");
  menu.setAttribute("aria-hidden", "true");
  menu.setAttribute("inert", "");
  openBtn.focus();
}

openBtn?.addEventListener("click", open);
closeBtn?.addEventListener("click", close);
overlay?.addEventListener("click", close);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && body.classList.contains("menu-open")) close();
});

// 메뉴 상단에 닉네임을 띄운다. 못 불러와도 메뉴는 그대로 쓸 수 있어야 한다.
getNickname()
  .then((nickname) => {
    if (nickname && nicknameEl) nicknameEl.textContent = nickname;
  })
  .catch((err) => console.warn("닉네임을 불러오지 못했어요:", err));

logoutBtn?.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut();
    window.location.href = "./index.html?logout=1";
  } catch (err) {
    console.warn("로그아웃하지 못했어요:", err);
    logoutBtn.disabled = false;
  }
});
