// ─────────────────────────────────────────────
// profile.html 전용 스크립트.
// 닉네임은 DB(users.nickname)에 있다. 첫 채팅에서 하쿠가 물어보고 정한 값을 여기서 고칠 수 있다.
// 학습 통계는 DB 에 쌓인 내 세션 기록(store.js)에서 계산한다.
// ─────────────────────────────────────────────

import * as store from "./store.js";
import { signOut } from "./auth.js";
import { getNickname, saveNickname } from "./user.js";

// 아직 닉네임을 정하지 않았을 때(첫 채팅 전) 보여줄 이름.
const DEFAULT_NICKNAME = "게스트 학습자";

const nicknameText = document.getElementById("nickname-text");
const nicknameEdit = document.getElementById("nickname-edit");
const nicknameInput = document.getElementById("nickname-input");
const editBtn = document.getElementById("edit-nickname-btn");
const saveBtn = document.getElementById("save-nickname-btn");
const statSessions = document.getElementById("stat-sessions");
const statMessages = document.getElementById("stat-messages");
const statTopic = document.getElementById("stat-topic");
const logoutBtn = document.getElementById("logout-btn");

let profile = { nickname: null };

function renderNickname() {
  nicknameText.textContent = profile.nickname || DEFAULT_NICKNAME;
  nicknameInput.value = profile.nickname || "";
}

async function renderStats() {
  try {
    const stats = await store.getStats();
    statSessions.textContent = `${stats.totalSessions}개`;
    statMessages.textContent = `${stats.totalMessages}개`;
    statTopic.textContent = stats.lastTopic || "아직 없음";
  } catch (err) {
    console.warn("학습 통계를 불러오지 못했어요:", err);
  }
}

function enterEditMode() {
  nicknameText.hidden = true;
  editBtn.hidden = true;
  nicknameEdit.hidden = false;
  nicknameInput.focus();
  nicknameInput.select();
}

function exitEditMode() {
  nicknameText.hidden = false;
  editBtn.hidden = false;
  nicknameEdit.hidden = true;
}

editBtn.addEventListener("click", enterEditMode);

saveBtn.addEventListener("click", async () => {
  const value = nicknameInput.value.trim();

  // 비워서 저장하면 바꾸지 않은 것으로 본다.
  if (!value || value === profile.nickname) {
    renderNickname();
    exitEditMode();
    return;
  }

  saveBtn.disabled = true;
  try {
    await saveNickname(value);
    profile = { ...profile, nickname: value };
    renderNickname();
    exitEditMode();
  } catch (err) {
    window.alert(`닉네임을 저장하지 못했어요. 다시 시도해주세요. (${err.message})`);
  } finally {
    saveBtn.disabled = false;
  }
});

nicknameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveBtn.click();
  }
  if (e.key === "Escape") {
    renderNickname();
    exitEditMode();
  }
});

logoutBtn.addEventListener("click", () => {
  logoutBtn.disabled = true;
  signOut();
});

document.addEventListener("DOMContentLoaded", async () => {
  renderNickname();
  renderStats();

  try {
    profile = { ...profile, nickname: await getNickname() };
    renderNickname();
  } catch (err) {
    console.warn("닉네임을 불러오지 못했어요:", err);
  }
});
