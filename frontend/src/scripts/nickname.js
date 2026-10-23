// ─────────────────────────────────────────────
// nickname.html(이름 정하기 화면) 전용 스크립트.
// 처음 로그인했을 때(users.nickname 이 비어 있을 때) 하쿠가 부를 이름을 정한다.
// 로그인 화면(login.js)과 채팅 화면(chat.js)이 닉네임이 없으면 이 화면으로 보낸다.
// 이름을 정하면 채팅 화면으로 가고, 하쿠가 "안녕 {이름}!" 하고 부른다.
// ─────────────────────────────────────────────

import { HOME_PAGE } from "./auth.js";
import { NICKNAME_MAX, cleanNickname, getNickname, saveNickname } from "./user.js";

const form = document.getElementById("nickname-form");
const input = document.getElementById("nickname-input");
const errorEl = document.getElementById("nickname-error");
const nextBtn = document.getElementById("nickname-next");

// 프로필 화면의 닉네임 입력칸과 같은 최대 길이.
input.maxLength = NICKNAME_MAX;

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = cleanNickname(input.value);

  if (!name) {
    showError("하쿠가 부를 이름을 입력해주세요.");
    input.focus();
    return;
  }

  nextBtn.disabled = true;
  errorEl.hidden = true;
  try {
    await saveNickname(name);
    window.location.replace(HOME_PAGE);
  } catch (err) {
    showError(`이름을 저장하지 못했어요. 다시 눌러주세요. (${err.message})`);
    nextBtn.disabled = false;
  }
});

async function init() {
  input.focus();

  // 이미 정한 닉네임이 있으면(주소로 다시 들어온 경우 등) 입력칸에 채워 둔다.
  try {
    const nickname = await getNickname();
    if (nickname && !input.value) input.value = nickname;
  } catch (err) {
    console.warn("닉네임을 불러오지 못했어요:", err);
  }
}

init();
