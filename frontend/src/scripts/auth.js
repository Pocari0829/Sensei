// ─────────────────────────────────────────────
// 로그인 / 로그아웃 / 로그인 확인.
//
// - 이메일: 이메일과 비밀번호로 가입하고 로그인한다. 비밀번호는 Supabase 가 암호화해서 auth.users 에 보관한다.
//          (우리 DB 의 users 테이블에는 비밀번호를 저장하지 않는다)
// - Google: 로그인 버튼(login.js)이 Google 에서 받은 "ID 토큰"을 Supabase 에 넘긴다.
// - 카카오: 이 탭이 카카오 로그인 화면으로 이동했다가, 로그인이 끝나면 Supabase 를 거쳐 돌아온다.
// 어느 쪽이든 Supabase 가 그 사람의 계정(auth.users)을 만들거나 찾아서 로그인시켜 준다.
// 로그인 상태는 supabase-js 가 이 브라우저의 localStorage 에 저장하고 알아서 갱신하므로,
// 로그아웃하기 전까지는 다음에 들어와도 로그인된 상태다.
// ─────────────────────────────────────────────

import { supabase } from "./supabase.js";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// 모든 페이지가 같은 폴더(src/pages)에 있으므로 상대 경로로 충분하다.
export const LOGIN_PAGE = "./index.html";
export const HOME_PAGE = "./chat.html";
// 닉네임을 아직 정하지 않은 사람이 먼저 가는 화면.
export const NICKNAME_PAGE = "./nickname.html";

/** 지금 로그인한 사용자. 로그인 안 했으면 null. */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** 지금 로그인한 사용자. 로그인 안 했으면 오류를 던진다. (DB 에 읽고 쓸 때 쓴다) */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("로그인되어 있지 않아요.");
  return user;
}

/**
 * Google 이 준 ID 토큰으로 Supabase 에 로그인한다.
 * @param {string} idToken - Google 로그인 버튼이나 One Tap 이 콜백으로 넘겨준 credential.
 * @param {string} nonce - Google 에는 해시해서 보냈던 원래 값. 토큰을 가로채 재사용하는 것을 막는다.
 */
export async function signInWithGoogleToken(idToken, nonce) {
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce,
  });
  if (error) throw error;
}

// 비밀번호 최소 길이. Supabase 의 기본값(6)과 같다.
export const PASSWORD_MIN = 6;

// Google / 카카오로 가입한 계정은 비밀번호가 없어서 이메일 로그인이 안 된다.
// 어느 방법으로 가입했는지는 Supabase 가 (보안상) 알려주지 않으므로, 헷갈릴 만한 오류에는 이 안내를 덧붙인다.
const SOCIAL_HINT = "Google이나 카카오로 가입했다면 아래 버튼으로 로그인해 주세요.";

/** Supabase 의 영어 오류를 화면에 보여줄 한국어로 바꾼다. 모르는 오류는 원래 문구를 붙여서 보여준다. */
function emailAuthError(error) {
  const messages = {
    invalid_credentials: `이메일 또는 비밀번호가 맞지 않아요. ${SOCIAL_HINT}`,
    email_not_confirmed: "아직 메일 인증을 하지 않았어요. 가입할 때 받은 메일의 링크를 먼저 눌러 주세요.",
    user_already_exists: `이미 가입된 이메일이에요. 로그인해 주세요. ${SOCIAL_HINT}`,
    email_exists: `이미 가입된 이메일이에요. 로그인해 주세요. ${SOCIAL_HINT}`,
    weak_password: `비밀번호가 너무 쉬워요. ${PASSWORD_MIN}자 이상으로 정해 주세요.`,
    validation_failed: "이메일 형식이 올바르지 않아요.",
    email_address_invalid: "쓸 수 없는 이메일 주소예요.",
    over_email_send_rate_limit: "인증 메일을 너무 자주 보냈어요. 잠시 후 다시 시도해 주세요.",
    over_request_rate_limit: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
    signup_disabled: "지금은 이메일 가입을 받지 않고 있어요.",
  };
  return new Error(messages[error.code] ?? `문제가 생겼어요: ${error.message}`);
}

/**
 * 이메일과 비밀번호로 가입한다.
 * Supabase 에서 메일 인증을 켜 두었으면 인증 메일이 가고, 메일의 링크를 누르면 로그인 화면으로 돌아와 로그인된다.
 * @returns {Promise<{needsConfirm: boolean}>} needsConfirm 이 true 면 아직 로그인 전이다. (메일 인증을 기다린다)
 */
export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: new URL(LOGIN_PAGE, window.location.href).href },
  });
  if (error) throw emailAuthError(error);
  // 메일 인증을 켜 두면, 이미 가입된 이메일이어도 Supabase 가 오류 대신 빈 계정을 돌려준다. (가입 여부를 숨기려고)
  // identities 가 비어 있으면 이미 가입된 이메일이다.
  if (data.user && data.user.identities?.length === 0) throw emailAuthError({ code: "user_already_exists" });
  return { needsConfirm: !data.session };
}

/** 이메일과 비밀번호로 로그인한다. */
export async function signInWithEmail(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw emailAuthError(error);
}

/** Supabase 에서 해당 로그인 방식(예: "kakao")이 켜져 있는지. */
async function isProviderEnabled(provider) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_KEY },
    });
    const settings = await res.json();
    return settings.external?.[provider] === true;
  } catch {
    // 확인 자체가 실패하면(네트워크 등) 막지 말고 일단 시도는 해보게 둔다.
    return true;
  }
}

/**
 * 카카오 로그인 화면으로 보낸다. (Google 과 달리 팝업이 아니라 이 탭이 카카오로 이동한다)
 * 로그인이 끝나면 카카오 → Supabase → 로그인 페이지(index.html) 순서로 돌아오고,
 * 로그인 페이지의 자동 로그인 확인을 거쳐 채팅으로 간다.
 */
export async function signInWithKakao() {
  // 카카오 로그인이 꺼져 있는데 그대로 보내면 Supabase 의 영어 JSON 오류 화면에서 멈춘다. 미리 막는다.
  if (!(await isProviderEnabled("kakao"))) {
    throw new Error("아직 카카오 로그인이 준비되지 않았어요. (Supabase 에서 카카오 로그인을 켜야 해요)");
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "kakao",
    options: { redirectTo: new URL(LOGIN_PAGE, window.location.href).href },
  });
  if (error) throw error;
}

/** 로그아웃하고 로그인 페이지로 보낸다. */
export async function signOut() {
  // scope: "local" = 이 브라우저에서만 로그아웃.
  // 서버에 묻지 않으므로 네트워크가 끊겨 있어도 확실히 로그아웃된다.
  await supabase.auth.signOut({ scope: "local" });
  // logout=1 을 붙이면 로그인 화면이 Google 자동 로그인을 끈다. (안 그러면 로그아웃하자마자 다시 로그인된다)
  window.location.replace(`${LOGIN_PAGE}?logout=1`);
}

/**
 * 로그인이 필요한 페이지에서 부른다. 로그인 안 했으면 로그인 페이지로 보낸다.
 * @returns {Promise<object|null>} 로그인한 사용자. 로그인 페이지로 보내는 중이면 null.
 */
export async function requireLogin() {
  const user = await getCurrentUser();
  if (!user) window.location.replace(LOGIN_PAGE);
  return user;
}
