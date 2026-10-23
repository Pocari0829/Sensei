// ─────────────────────────────────────────────
// index.html(로그인 화면) 전용 스크립트.
//
// Google 공식 로그인(Google Identity Services)을 쓴다.
// - 로그인 버튼: Google 이 직접 그려주는 공식 버튼. 누르면 Google 의 작은 로그인 창이 뜬다.
//   버튼 안쪽은 Google 이 그려서 CSS 로는 못 바꾸고, Google 이 정한 선택지 안에서만 고를 수 있다.
//   그래서 원래 디자인(흰색 알약 모양 + 가운데 로고 + 꽉 찬 너비)에 가장 가깝게 골랐다.
//   (공식 버튼을 투명하게 숨기거나 다른 것으로 가리면, Google 에 로그인된 Chrome 이 클릭을 무시한다)
// - 자동 로그인(One Tap): 전에 로그인한 적이 있으면 버튼을 누르지 않아도 Google 이 알아서 로그인시킨다.
// 어느 쪽이든 Google 이 준 ID 토큰을 Supabase 에 넘겨서 로그인을 마친다.
//
// 이메일 로그인 / 회원가입은 위쪽 입력칸으로 한다. 아래 "회원가입" 을 누르면 같은 칸이 회원가입 모양으로 바뀐다.
// 회원가입은 Supabase 의 설정에 따라 인증 메일을 보내고, 메일의 링크를 누르면 이 페이지로 돌아와 로그인된다.
//
// 카카오 로그인은 우리가 만든 버튼이다. 누르면 이 탭이 카카오 로그인 화면으로 이동했다가,
// 로그인이 끝나면 이 페이지로 돌아온다. 돌아왔을 때 로그인돼 있으면 init() 이 채팅으로 보낸다.
// ─────────────────────────────────────────────

import { GOOGLE_CLIENT_ID } from "./config.js";
import {
  HOME_PAGE,
  NICKNAME_PAGE,
  PASSWORD_MIN,
  getCurrentUser,
  signInWithEmail,
  signInWithGoogleToken,
  signInWithKakao,
  signUpWithEmail,
} from "./auth.js";
import { getNickname } from "./user.js";

/**
 * 로그인을 마친 뒤 갈 곳. 닉네임을 아직 안 정했으면(처음 가입) 이름 정하기 화면, 정했으면 채팅.
 * 닉네임 확인이 실패하면 일단 채팅으로 보낸다. (채팅 화면이 한 번 더 확인한다)
 */
async function goAfterLogin() {
  let nickname = null;
  try {
    nickname = await getNickname();
  } catch (err) {
    console.warn("닉네임을 확인하지 못했어요:", err);
    window.location.replace(HOME_PAGE);
    return;
  }
  window.location.replace(nickname ? HOME_PAGE : NICKNAME_PAGE);
}

const googleBtnHost = document.getElementById("google-login-btn");
const kakaoBtn = document.getElementById("kakao-login-btn");
const errorEl = document.getElementById("login-error");
const infoEl = document.getElementById("login-info");
const form = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const confirmInput = document.getElementById("login-password-confirm");
const submitBtn = document.getElementById("login-submit");
const modeText = document.getElementById("login-mode-text");
const modeBtn = document.getElementById("login-mode-btn");

function showError(message) {
  infoEl.hidden = true;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/** 오류가 아닌 안내 (예: "인증 메일을 보냈어요") */
function showInfo(message) {
  errorEl.hidden = true;
  infoEl.textContent = message;
  infoEl.hidden = false;
}

// ─────────────────────────────────────────────
// 이메일 로그인 / 회원가입
// ─────────────────────────────────────────────
let signUpMode = false;

/** 로그인 ↔ 회원가입 모양을 바꾼다. 입력한 이메일은 그대로 둔다. */
function setSignUpMode(on) {
  signUpMode = on;
  confirmInput.hidden = !on;
  confirmInput.value = "";
  passwordInput.autocomplete = on ? "new-password" : "current-password";
  passwordInput.placeholder = on ? `비밀번호 (${PASSWORD_MIN}자 이상)` : "비밀번호";
  submitBtn.textContent = on ? "회원가입" : "로그인";
  modeText.textContent = on ? "이미 SENSEI 회원이신가요?" : "아직 SENSEI 회원이 아니신가요?";
  modeBtn.textContent = on ? "로그인" : "회원가입";
  errorEl.hidden = true;
  infoEl.hidden = true;
}

modeBtn.addEventListener("click", () => {
  setSignUpMode(!signUpMode);
  emailInput.focus();
});

/** 입력값 검사. 문제가 있으면 안내 문구, 없으면 null. */
function checkInputs(email, password) {
  if (!email || !emailInput.checkValidity()) return "이메일을 올바르게 입력해 주세요.";
  if (!password) return "비밀번호를 입력해 주세요.";
  if (signUpMode && password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상으로 정해 주세요.`;
  if (signUpMode && password !== confirmInput.value) return "비밀번호 확인이 맞지 않아요.";
  return null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const problem = checkInputs(email, password);
  if (problem) {
    showError(problem);
    return;
  }

  submitBtn.disabled = true;
  errorEl.hidden = true;
  infoEl.hidden = true;
  try {
    if (signUpMode) {
      const { needsConfirm } = await signUpWithEmail(email, password);
      if (needsConfirm) {
        // 메일 인증을 기다린다. 링크를 누르면 이 페이지로 돌아와서 init() 이 로그인된 것을 보고 넘어간다.
        setSignUpMode(false);
        emailInput.value = email;
        showInfo(`${email} 로 인증 메일을 보냈어요. 메일의 링크를 누르면 로그인돼요.`);
        return;
      }
    } else {
      await signInWithEmail(email, password);
    }
    // 처음 가입한 사람은 닉네임이 없으므로 이름 정하기 화면으로 간다.
    await goAfterLogin();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    submitBtn.disabled = false;
  }
});

/** 카카오에서 돌아올 때 실패했으면(취소, 설정 오류 등) 주소에 error_description 이 붙어 온다. */
function readLoginError() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return query.get("error_description") || hash.get("error_description");
}

kakaoBtn.addEventListener("click", async () => {
  kakaoBtn.disabled = true;
  errorEl.hidden = true;

  try {
    // 성공하면 카카오 로그인 화면으로 넘어가므로, 이 페이지의 할 일은 여기서 끝난다.
    await signInWithKakao();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    kakaoBtn.disabled = false;
  }
});

// 카카오 화면에서 "뒤로 가기"로 돌아오면 브라우저가 이 페이지를 저장해 둔 그대로
// (카카오 버튼이 막힌 채로) 되살릴 수 있다. 그때는 버튼을 다시 켠다.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) kakaoBtn.disabled = false;
});

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Google 로그인을 불러오지 못했어요. 인터넷 연결을 확인해주세요."));
    document.head.appendChild(script);
  });
}

/** 로그인 화면을 열 때마다 새로 만드는 일회용 값. Google 에는 해시를, Supabase 에는 원래 값을 보낸다. */
async function makeNonce() {
  const raw = crypto.randomUUID();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { raw, hashed };
}

async function startGoogleLogin() {
  if (!GOOGLE_CLIENT_ID) {
    showError("Google 클라이언트 ID 가 없어요. .env 에 GOOGLE_CLIENT_ID 를 넣어주세요.");
    return;
  }

  await loadGoogleScript();
  const nonce = await makeNonce();

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce: nonce.hashed,
    // 자동 로그인: 전에 로그인한 Google 계정이 하나뿐이면 묻지 않고 바로 로그인한다.
    auto_select: true,
    callback: async ({ credential }) => {
      try {
        await signInWithGoogleToken(credential, nonce.raw);
        await goAfterLogin();
      } catch (err) {
        showError(`로그인하지 못했어요: ${err.message}`);
      }
    },
  });

  // 방금 로그아웃하고 온 경우에는 자동 로그인을 끈다. (안 그러면 로그아웃하자마자 다시 로그인된다)
  // 다음에 버튼으로 직접 로그인하면 Google 이 자동 로그인을 다시 켠다.
  if (new URLSearchParams(window.location.search).has("logout")) {
    google.accounts.id.disableAutoSelect();
  }

  google.accounts.id.renderButton(googleBtnHost, {
    type: "icon", // 로고만 있는 동그란 아이콘 버튼 (카카오 버튼과 나란히 두기 위함)
    theme: "outline", // 흰색 + 회색 테두리
    shape: "circle",
    size: "large", // 고를 수 있는 가장 큰 크기(40px). CSS 로 키우면 클릭이 막힐 수 있어서 그대로 둔다
    locale: "ko",
  });

  // One Tap: 화면 위에 Google 계정 선택 창을 띄운다. auto_select 면 여기서 자동 로그인된다.
  google.accounts.id.prompt();
}

async function init() {
  const loginError = readLoginError();
  if (loginError) {
    showError(`로그인하지 못했어요: ${loginError}`);
    // 새로고침해도 같은 오류가 또 뜨지 않게 주소를 깨끗하게 만든다. (logout 표시는 남긴다)
    const keep = new URLSearchParams(window.location.search).has("logout") ? "?logout=1" : "";
    window.history.replaceState(null, "", window.location.pathname + keep);
  }

  // 이미 로그인돼 있으면(카카오에서 막 돌아온 경우 포함) Google 에 묻지 않고 바로 넘어간다.
  // (닉네임이 없으면 이름 정하기 화면, 있으면 채팅)
  if (await getCurrentUser()) {
    await goAfterLogin();
    return;
  }

  try {
    await startGoogleLogin();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

init();
