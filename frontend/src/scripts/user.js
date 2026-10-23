// ─────────────────────────────────────────────
// 로그인한 사용자의 정보(DB 의 users 테이블) 읽기 / 쓰기.
//   닉네임  처음 로그인했을 때 이름 정하기 화면에서 정한다 (nickname.js).
//   사진    프로필 화면에서 고른다 (profile.js). 없으면 기본 사진을 보여준다.
//   수준    "더 쉽게" 를 누르면 한 단계 내려가고, 설명을 보낼 때마다 그 설명의 수준 쪽으로 조금씩 움직인다 (chat.js).
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
  return user.email
    ? { id: user.id, email: user.email, ...fields }
    : { id: user.id, ...fields };
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
  const { error } = await supabase
    .from("users")
    .upsert(userRow(user, { nickname }));
  if (error) throw error;
}

// ─────────────────────────────────────────────
// 프로필 사진(users.avatar): 파일 저장소(Storage)가 아니라 칸에 글자(data URL)로 바로 넣는다.
//   "data:image/webp;base64,..." 처럼 생겼고, <img src> 에 그대로 넣으면 사진이 보인다.
//   넣기 전에 프로필 화면이 256x256 으로 줄인다 (profile.js). 보통 20~40KB.
// ─────────────────────────────────────────────

// 사진 글자의 최대 길이. DB 의 검사 조건(supabase/2026-10-24_profile_avatar.sql)과 같은 값.
export const AVATAR_MAX_LENGTH = 200000;

/**
 * 내 프로필: 닉네임과 사진. 둘 다 아직 없으면 null.
 * avatar 칸을 만드는 SQL 을 실행하기 전이면(칸 없음 오류 42703) 닉네임만 읽어서 사진 없이 돌려준다.
 */
export async function getProfile() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("users")
    .select("nickname, avatar")
    .eq("id", user.id)
    .maybeSingle();
  if (error?.code === "42703") return { nickname: await getNickname(), avatar: null };
  if (error) throw error;
  return { nickname: data?.nickname || null, avatar: data?.avatar || null };
}

/** 프로필 사진을 저장한다. null 이면 사진을 지워서 기본 사진으로 돌아간다. upsert 인 이유는 saveNickname 과 같다. */
export async function saveAvatar(avatar) {
  if (avatar && avatar.length > AVATAR_MAX_LENGTH) {
    throw new Error("사진이 너무 커요.");
  }
  const user = await requireUser();
  const { error } = await supabase
    .from("users")
    .upsert(userRow(user, { avatar }));
  if (error) throw error;
}

// ─────────────────────────────────────────────
// 수준(level): 숫자가 작을수록 쉽게. 하쿠의 질문과 시험지 문제의 난이도를 이 수준에 맞춘다. (높을수록 어렵게)
//   1 초등 저학년 · 2 초등 고학년 · 3 중학생 · 4 고등학생 · 5 대학생 이상
//   level_init     처음 수준. 여기서는 바꾸지 않는다.
//   level_score    지금 수준을 소수까지 담은 점수. 설명 하나로 수준이 확 바뀌지 않게 이 점수를 조금씩 움직인다.
//   level_current  지금 수준. level_score 를 반올림한 값.
// 점수가 바뀌는 때:
//   "더 쉽게" 를 누르면 1 내려간다. (lowerLevel)
//   설명을 보내면 백엔드가 판단한 그 설명의 수준 쪽으로 다가간다. 오를 때 30%, 내릴 때 20%. (applyAnswerLevel)
// 쓰는 곳: getLevel() 로 읽어서 하쿠에게 질문할 때(chat.js), 시험지 문제를 만들 때(quiz.js) 백엔드에 같이 보낸다.
// ─────────────────────────────────────────────

// 가장 낮은(쉬운) 수준. 이미 여기면 "더 쉽게" 를 눌러도 그대로 둔다.
const LEVEL_MIN = 1;
// 가장 높은 수준. 백엔드(app.py)의 LEVEL_MAX 와 같은 값.
const LEVEL_MAX = 5;
// DB(users)의 level_init / level_current 기본값과 같은 값.
// users 행이 없거나 수준 칸이 모두 비어 있으면 이 수준이었던 것으로 본다.
const LEVEL_DEFAULT = 3;
// 설명 하나가 점수를 움직이는 정도. 0.3 = 판단한 수준과의 차이의 30% 만큼 다가간다.
// 잘한 설명이 빨리 보상받도록 오를 때를 더 크게 한다. 내릴 때는 한두 번 실수한 설명에 크게 흔들리지 않게 작게.
//   오를 때 (예: 점수 3 에서 4 수준 설명) 3 → 3.3 → 3.51 : 두 번이면 레벨 4
//   내릴 때 (예: 점수 3 에서 2 수준 설명) 3 → 2.8 → 2.64 → 2.51 → 2.41 : 네 번이면 레벨 2
const RISE_WEIGHT = 0.3;
const FALL_WEIGHT = 0.2;

function clampLevel(score) {
  return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, score));
}

/** 지금 점수. level_score 가 비어 있으면(이 칸이 생기기 전의 계정) level_current → level_init 순서로 쓴다. */
async function readLevelScore(user) {
  const { data, error } = await supabase
    .from("users")
    .select("level_init, level_current, level_score")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.level_score ?? data?.level_current ?? data?.level_init ?? LEVEL_DEFAULT;
}

/**
 * 점수를 저장하고, 반올림한 지금 수준을 돌려준다.
 * upsert 인 이유는 saveNickname 과 같다. (users 행이 없는 계정은 이때 행을 같이 만든다)
 */
async function saveLevelScore(user, score) {
  // 소수 둘째 자리까지만 남긴다. (DB 에서 3.2 가 3.2000000476 처럼 보이지 않게)
  const rounded = Math.round(clampLevel(score) * 100) / 100;
  const level = Math.round(rounded);
  const { error } = await supabase
    .from("users")
    .upsert(userRow(user, { level_score: rounded, level_current: level }));
  if (error) throw error;
  return level;
}

// 점수 바꾸기는 한 번에 하나씩 한다. 읽고 → 계산하고 → 저장하는 사이에 다른 변경이 끼어들면
// (예: 설명의 수준 판단이 끝나는 순간 "더 쉽게" 를 누름) 한쪽의 변경이 덮어써져 사라지기 때문이다.
let levelQueue = Promise.resolve();

/** change(지금 점수) 가 돌려준 값을 새 점수로 저장하고, 지금 수준을 돌려준다. */
function changeLevelScore(change) {
  const run = levelQueue.then(async () => {
    const user = await requireUser();
    const score = await readLevelScore(user);
    return saveLevelScore(user, change(score));
  });
  // 하나가 실패해도 다음 변경은 그대로 돌게 한다. (실패는 run 을 기다리는 쪽이 받는다)
  levelQueue = run.catch(() => {});
  return run;
}

/** 지금 수준을 한 단계 내리고, 내린 수준을 돌려준다. ("더 쉽게" 를 눌렀을 때) */
export function lowerLevel() {
  return changeLevelScore((score) => score - 1);
}

/** 설명 하나의 수준(1~5)을 반영한다. 점수를 그쪽으로 조금 움직이고, 지금 수준을 돌려준다. */
export function applyAnswerLevel(answerLevel) {
  return changeLevelScore((score) => {
    const weight = answerLevel > score ? RISE_WEIGHT : FALL_WEIGHT;
    return score + (answerLevel - score) * weight;
  });
}

/**
 * 지금 수준(1~5). 하쿠의 질문과 시험지 문제의 난이도를 맞출 때 백엔드에 보낸다.
 * 바꾸는 중인 점수(설명 수준 반영, "더 쉽게")가 있으면 그게 끝난 뒤의 값을 읽는다.
 */
export function getLevel() {
  return levelQueue.then(async () => {
    const user = await requireUser();
    return Math.round(clampLevel(await readLevelScore(user)));
  });
}
