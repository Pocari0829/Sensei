// ─────────────────────────────────────────────
// 로그인 / 로그아웃 / 로그인 확인.
//
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

/** 지금 로그인한 사용자. 로그인 안 했으면 null. */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
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
