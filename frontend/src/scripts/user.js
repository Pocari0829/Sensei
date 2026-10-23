// ─────────────────────────────────────────────
// 로그인한 사용자의 정보(DB 의 users 테이블) 읽기 / 쓰기.
//   닉네임  처음 로그인했을 때 이름 정하기 화면에서 정한다 (nickname.js).
//   수준    "더 쉽게" 를 누를 때마다 한 단계씩 내려간다 (chat.js).
// ─────────────────────────────────────────────

import { supabase } from "./supabase.js";
import { requireUser } from "./auth.js";

// 프로필 화면의 닉네임 입력칸(maxlength)과 같은 값.
export const NICKNAME_MAX = 16;

// 눈에 안 보이는 글자: 한글 채움 문자(U+3164 등)와 폭 없는 공백(U+200B 등).
// 이것만 넣으면 빈칸 검사를 통과해서, 인사말에 이름이 없는 것처럼("안녕 !") 보이므로 뺀다.
const INVISIBLE_CHARS = /[\u115F\u1160\u3164\uFFA0\u200B-\u200D\u2060\uFEFF]/g;

/** 닉네임 입력을 다듬는다. 보이지 않는 글자와 앞뒤 공백을 빼고, 남는 게 없으면 빈 문자열. */
export function cleanNickname(text) {
  return text.replace(INVISIBLE_CHARS, "").trim();
}

/**
 * users 행에 upsert 할 값. 이메일은 로그인 정보에 있을 때만 같이 쓴다.
 * (이메일 없이 가입한 카카오 계정 등이 저장할 때마다 DB 의 이메일을 빈 값으로 덮어쓰지 않게)
 */
function userRow(user, fields) {
  return user.email ? { id: user.id, email: user.email, ...fields } : { id: user.id, ...fields };
}

/** 내 닉네임. 아직 정하지 않았으면 null. */
export async function getNickname() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("users")
    .select("nickname")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.nickname || null;
}

/**
 * 닉네임을 저장한다.
 * update 가 아니라 upsert 인 이유: 가입 트리거가 생기기 전에 만든 계정은 users 행이 없어서,
 * 이때 행을 같이 만든다.
 */
export async function saveNickname(nickname) {
  const user = await requireUser();
  const { error } = await supabase.from("users").upsert(userRow(user, { nickname }));
  if (error) throw error;
}

// ─────────────────────────────────────────────
// 수준(level): 숫자가 작을수록 쉽게. 나중에 하쿠가 질문 난이도를 맞출 때 쓰려고 모은다.
//   level_init     처음 수준. 여기서는 바꾸지 않는다.
//   level_current  지금 수준. "더 쉽게" 를 누르면 1 내려간다.
// 아직 하쿠의 질문이나 화면에는 반영하지 않는다.
// ─────────────────────────────────────────────

// 가장 낮은(쉬운) 수준. 이미 여기면 "더 쉽게" 를 눌러도 그대로 둔다.
const LEVEL_MIN = 1;
// DB(users)의 level_init / level_current 기본값과 같은 값.
// users 행이 없거나 두 칸이 모두 비어 있으면 이 수준이었던 것으로 본다.
const LEVEL_DEFAULT = 3;

/**
 * 지금 수준(level_current)을 한 단계 내리고, 내린 수준을 돌려준다. ("더 쉽게" 를 눌렀을 때)
 * level_current 가 비어 있으면 처음 수준(level_init)에서 내린다.
 * upsert 인 이유는 saveNickname 과 같다. (users 행이 없는 계정은 이때 행을 같이 만든다)
 */
export async function lowerLevel() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("users")
    .select("level_init, level_current")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;

  const current = data?.level_current ?? data?.level_init ?? LEVEL_DEFAULT;
  const level = Math.max(LEVEL_MIN, current - 1);

  const { error: saveError } = await supabase
    .from("users")
    .upsert(userRow(user, { level_current: level }));
  if (saveError) throw saveError;
  return level;
}
