// ─────────────────────────────────────────────
// profile.html 전용 스크립트.
// 인스타그램 프로필처럼 프로필 사진 + 최근 학습 주제 + 닉네임 + [프로필 편집] 을 보여준다.
// 닉네임은 DB(users.nickname)에 있다. 처음 로그인할 때 이름 정하기 화면에서 정한 값을 [프로필 편집] 으로 고칠 수 있다.
// 프로필 사진은 사진을 눌러서 고른다. 256x256 으로 줄여서 DB(users.avatar)에 저장하고, 없으면 기본 사진을 보여준다.
// 최근 학습 주제와 아래 대시보드(학습 잔디 / 퀴즈 정답률 / 다시 볼 개념)는 DB 에 쌓인 내 기록(store.js)에서 가져온다.
// 대시보드를 그리는 것은 dashboard.js 가 한다.
// ─────────────────────────────────────────────

import * as store from "./store.js";
import { signOut } from "./auth.js";
import { renderDashboard } from "./dashboard.js";
import { cleanNickname, getProfile, saveAvatar, saveNickname } from "./user.js";

// 아직 닉네임을 정하지 않았을 때(이름 정하기 화면을 거치기 전) 보여줄 이름.
const DEFAULT_NICKNAME = "게스트 학습자";
// 아직 사진을 고르지 않았을 때 보여줄 기본 사진.
const DEFAULT_AVATAR = "../../public/avatar-default.svg";
// 저장할 사진의 크기(정사각형, px). 화면에는 86px 로 보이므로 고화질 화면에서도 충분하다.
const AVATAR_SIZE = 256;

const avatarBtn = document.getElementById("avatar-btn");
const avatarImg = document.getElementById("avatar-img");
const avatarInput = document.getElementById("avatar-input");
const avatarResetBtn = document.getElementById("avatar-reset-btn");
const nicknameText = document.getElementById("nickname-text");
const nicknameEdit = document.getElementById("nickname-edit");
const nicknameInput = document.getElementById("nickname-input");
const editBtn = document.getElementById("edit-nickname-btn");
const saveBtn = document.getElementById("save-nickname-btn");
const statTopic = document.getElementById("stat-topic");
const logoutBtn = document.getElementById("logout-btn");

let profile = { nickname: null, avatar: null };

function renderNickname() {
  nicknameText.textContent = profile.nickname || DEFAULT_NICKNAME;
  nicknameInput.value = profile.nickname || "";
}

function renderAvatar() {
  avatarImg.src = profile.avatar || DEFAULT_AVATAR;
  avatarResetBtn.hidden = !profile.avatar;
}

/** 최근 학습 주제와 대시보드. 기록은 한 번만 읽어서 둘 다에 쓴다. */
async function renderStats() {
  let stats = null;
  try {
    stats = await store.getProfileStats();
    statTopic.textContent = stats.lastTopic || "아직 없음";
  } catch (err) {
    console.warn("학습 기록을 불러오지 못했어요:", err);
  }
  renderDashboard(stats);
}

// 편집 중에는 [프로필 편집] 버튼 자리에 닉네임 입력칸이 나온다. 위의 닉네임은 그대로 보인다.
function enterEditMode() {
  editBtn.hidden = true;
  nicknameEdit.hidden = false;
  nicknameInput.focus();
  nicknameInput.select();
}

function exitEditMode() {
  editBtn.hidden = false;
  nicknameEdit.hidden = true;
}

editBtn.addEventListener("click", enterEditMode);

saveBtn.addEventListener("click", async () => {
  const value = cleanNickname(nicknameInput.value);

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

// ─────────────────────────────────────────────
// 프로필 사진: 고른 사진을 가운데 기준 정사각형으로 잘라 256x256 으로 줄이고,
// DB 에 바로 넣을 수 있는 글자(data URL)로 바꿔서 저장한다.
// ─────────────────────────────────────────────

/** 고른 사진 파일을 <img> 로 읽는다. (휴대폰 사진의 회전 정보도 브라우저가 알아서 반영한다) */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("사진을 열지 못했어요. 다른 사진을 골라주세요."));
    };
    img.src = url;
  });
}

/** 사진 파일 → 256x256 정사각형 data URL. */
async function toAvatarDataUrl(file) {
  const img = await loadImage(file);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  // 투명한 부분(PNG)은 흰색으로. JPEG 로 저장할 때 검게 나오지 않게.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  // WebP 가 가장 작다. WebP 를 못 만드는 브라우저(예전 Safari)는 PNG 를 돌려주므로 그때는 JPEG 로 만든다.
  const webp = canvas.toDataURL("image/webp", 0.85);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
}

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files?.[0];
  // 같은 사진을 다시 골라도 change 가 일어나게 비워 둔다.
  avatarInput.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    window.alert("사진 파일만 고를 수 있어요.");
    return;
  }

  avatarBtn.classList.add("is-busy");
  try {
    const avatar = await toAvatarDataUrl(file);
    await saveAvatar(avatar);
    profile = { ...profile, avatar };
    renderAvatar();
  } catch (err) {
    window.alert(`프로필 사진을 바꾸지 못했어요. 다시 시도해주세요. (${err.message})`);
  } finally {
    avatarBtn.classList.remove("is-busy");
  }
});

avatarResetBtn.addEventListener("click", async () => {
  avatarResetBtn.disabled = true;
  try {
    await saveAvatar(null);
    profile = { ...profile, avatar: null };
    renderAvatar();
  } catch (err) {
    window.alert(`기본 사진으로 바꾸지 못했어요. 다시 시도해주세요. (${err.message})`);
  } finally {
    avatarResetBtn.disabled = false;
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
    profile = { ...profile, ...(await getProfile()) };
    renderNickname();
    renderAvatar();
  } catch (err) {
    console.warn("프로필을 불러오지 못했어요:", err);
  }
});
