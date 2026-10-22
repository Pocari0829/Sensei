// ─────────────────────────────────────────────
// 로그인한 사용자의 정보(DB 의 users 테이블) 읽기 / 쓰기.
// 지금은 닉네임만 다룬다. 닉네임은 첫 채팅에서 하쿠가 물어보고 정한다 (chat.js).
// ─────────────────────────────────────────────

import { supabase } from "./supabase.js";
import { getCurrentUser } from "./auth.js";

// 프로필 화면의 닉네임 입력칸(maxlength)과 같은 값.
export const NICKNAME_MAX = 16;

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("로그인되어 있지 않아요.");
  return user;
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
    .upsert({ id: user.id, email: user.email, nickname });
  if (error) throw error;
}
