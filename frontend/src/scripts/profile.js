// ─────────────────────────────────────────────
// profile.html 전용 스크립트.
// 아직 실제 로그인/DB가 없어서(로그인 버튼은 데모용 Google/Kakao 링크일 뿐),
// 닉네임은 localStorage에 저장하고 학습 통계는 store.js가 가진 세션 기록에서 계산한다.
// ─────────────────────────────────────────────

import * as store from "./store.js";

const PROFILE_KEY = "sensei.profile.v1";
const DEFAULT_NICKNAME = "게스트 학습자";

function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return { nickname: DEFAULT_NICKNAME };
    const parsed = JSON.parse(raw);
    return { nickname: (parsed && parsed.nickname) || DEFAULT_NICKNAME };
  } catch {
    return { nickname: DEFAULT_NICKNAME };
  }
}

function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // 저장 안 돼도 화면은 계속 동작해야 하므로 조용히 무시한다.
  }
}

const nicknameText = document.getElementById("nickname-text");
const nicknameEdit = document.getElementById("nickname-edit");
const nicknameInput = document.getElementById("nickname-input");
const editBtn = document.getElementById("edit-nickname-btn");
const saveBtn = document.getElementById("save-nickname-btn");
const statSessions = document.getElementById("stat-sessions");
const statMessages = document.getElementById("stat-messages");
const statTopic = document.getElementById("stat-topic");
const logoutBtn = document.getElementById("logout-btn");

let profile = loadProfile();

function renderNickname() {
  nicknameText.textContent = profile.nickname;
  nicknameInput.value = profile.nickname;
}

function renderStats() {
  const stats = store.getStats();
  statSessions.textContent = `${stats.totalSessions}개`;
  statMessages.textContent = `${stats.totalMessages}개`;
  statTopic.textContent = stats.lastTopic || "아직 없음";
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

saveBtn.addEventListener("click", () => {
  const value = nicknameInput.value.trim();
  profile = { ...profile, nickname: value || DEFAULT_NICKNAME };
  saveProfile(profile);
  renderNickname();
  exitEditMode();
});

nicknameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveBtn.click();
  }
  if (e.key === "Escape") {
    nicknameInput.value = profile.nickname;
    exitEditMode();
  }
});

logoutBtn.addEventListener("click", () => {
  // 별도 로그인 세션이 없으므로, 로그아웃은 로그인 화면으로 되돌아가는 것으로 처리한다.
  window.location.href = "./index.html";
});

document.addEventListener("DOMContentLoaded", () => {
  renderNickname();
  renderStats();
});
