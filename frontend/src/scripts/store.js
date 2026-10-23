// ─────────────────────────────────────────────
// 학습 기록 저장소 (Supabase DB).
// 화면 코드(chat.js / history.js / quiz.js / profile.js)는 DB 를 직접 만지지 않고
// 이 파일의 함수만 쓴다. 모두 로그인한 사용자 본인의 기록만 읽고 쓴다.
//
//   테이블              들어가는 것
//   sessions            학습 세션 하나. 대화는 haku_log 에 [{role, text, ts}] 배열로 통째로 저장
//                       role: "user"(나) / "sensei"(하쿠) / "check"(정오 판별의 "틀렸어요." 알림)
//   quiz_items          퀴즈 문제 하나 (세션별, 만든 순서대로) + 사용자가 쓴 답
//   system_corrections  정오 판별에서 "틀렸어요" 가 나온 설명과 피드백
//   gap_records         모르는 개념(= 세션 주제)별로 틀린 횟수 / "더 쉽게" 누른 횟수
//
// 닉네임(users 테이블)은 user.js 가 다룬다.
// ─────────────────────────────────────────────

import { supabase } from "./supabase.js";
import { requireUser } from "./auth.js";

// 예전에는 이 브라우저의 localStorage 에 세션 / 퀴즈 / 닉네임을 저장했다.
// 계정 구분이 없던 테스트 데이터라 DB 로 옮기지 않고 버리기로 했다. (남아 있으면 지운다)
for (const key of ["sensei.sessions.v1", "sensei.quizzes.v1", "sensei.profile.v1"]) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 저장소가 막혀 있어도(시크릿 모드 등) 상관없다.
  }
}

// ─────────────────────────────────────────────
// 세션 (주제 + 대화)
// ─────────────────────────────────────────────

const SESSION_COLUMNS = "id, topic, haku_log, started_at, updated_at";

/** DB 의 sessions 행을 화면 코드가 쓰는 모양 {id, topic, messages, createdAt, updatedAt} 으로 바꾼다. */
function toSession(row) {
  return {
    id: row.id,
    topic: row.topic,
    messages: Array.isArray(row.haku_log) ? row.haku_log : [],
    createdAt: Date.parse(row.started_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

/** 문장이 너무 길면 세션 목록/헤더에 쓸 짧은 주제 이름으로 잘라준다. */
const TOPIC_MAX_LENGTH = 10;

export function deriveTopic(text) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TOPIC_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, TOPIC_MAX_LENGTH)}…`;
}

/** 내 세션 전부. 최근에 대화한 세션이 먼저 온다. 대화가 하나도 없는 세션은 뺀다. */
export async function getAllSessions() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map(toSession).filter((s) => s.messages.length > 0);
}

/** 가장 최근에 대화한 세션. 없으면 null. (채팅 화면을 그냥 열었을 때 이어서 보여줄 세션) */
export async function getLatestSession() {
  const sessions = await getAllSessions();
  return sessions[0] ?? null;
}

/** 세션 하나. 없거나 내 세션이 아니면 null. */
export async function getSession(id) {
  if (!id) return null;
  const user = await requireUser();
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  // 주소의 ?session= 값이 uuid 모양이 아니면 DB 가 22P02 오류를 낸다. 없는 세션으로 본다.
  if (error?.code === "22P02") return null;
  if (error) throw error;
  return data ? toSession(data) : null;
}

/**
 * 새 세션을 DB 에 만든다. 첫 메시지를 보낼 때 부른다.
 * (예전처럼 "새 주제" 를 누를 때마다 만들면 빈 세션이 쌓이므로)
 */
export async function createSession() {
  const user = await requireUser();

  // sessions.user_id 는 users 를 가리키므로 users 행이 먼저 있어야 한다.
  // 가입 트리거가 만들어 주지만, 트리거보다 먼저 생긴 계정을 위해 없으면 만든다. (있으면 그대로 둔다)
  const { error: userError } = await supabase
    .from("users")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id", ignoreDuplicates: true });
  if (userError) throw userError;

  const { data, error } = await supabase
    .from("sessions")
    .insert({ user_id: user.id, haku_log: [] })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw error;
  return toSession(data);
}

/** 세션의 주제와 대화를 DB 에 저장한다. (메시지 추가 / 주제 수정 후) */
export async function saveSession(session) {
  const { data, error } = await supabase
    .from("sessions")
    .update({ topic: session.topic, haku_log: session.messages })
    .eq("id", session.id)
    .select("updated_at")
    .single();
  if (error) throw error;
  session.updatedAt = Date.parse(data.updated_at);
  return session;
}

/**
 * 메시지를 하나 붙이고 DB 에 저장한다. 첫 사용자 메시지로 주제 이름을 정한다.
 * 저장에 실패하면 오류를 던지지만, 메시지는 session.messages 에 남아 있다.
 * (다음에 저장할 때 대화 전체를 다시 쓰므로 같이 저장된다)
 */
export async function addMessage(session, role, text) {
  session.messages.push({ role, text, ts: Date.now() });
  if (!session.topic && role === "user") {
    session.topic = deriveTopic(text);
  }
  return saveSession(session);
}

/** 프로필 화면의 학습 통계. */
export async function getStats() {
  const sessions = await getAllSessions();
  const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
  const lastTopic = sessions.find((s) => s.topic)?.topic ?? null;

  return {
    totalSessions: sessions.length,
    totalMessages,
    lastTopic,
  };
}

// ─────────────────────────────────────────────
// 퀴즈 (quiz_items: 문제 하나가 한 행)
// ─────────────────────────────────────────────

const QUIZ_COLUMNS = "id, type, question, answers, choices, user_answer, message_count";

/** DB 의 quiz_items 행을 화면 코드가 쓰는 문제 모양 {id, type, question, answers, choices} 으로 바꾼다. */
function toQuizItem(row) {
  return {
    id: row.id,
    type: row.type,
    question: row.question,
    answers: row.answers ?? [],
    choices: row.choices ?? undefined,
  };
}

/**
 * 세션의 퀴즈. quiz.js 가 쓰는 모양으로 준다.
 *   items        지금까지 만든 문제 전부 (만든 순서대로)
 *   userAnswers  문제마다 사용자가 쓴(고른) 답 (items 와 같은 순서)
 *   messageCount 마지막으로 문제를 만들 때의 대화 메시지 수
 */
export async function getQuiz(sessionId) {
  const { data, error } = await supabase
    .from("quiz_items")
    .select(QUIZ_COLUMNS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  return {
    items: data.map(toQuizItem),
    userAnswers: data.map((row) => row.user_answer ?? ""),
    messageCount: Math.max(0, ...data.map((row) => row.message_count ?? 0)),
  };
}

/** 새로 만든 문제들을 저장하고, 저장된 문제(id 포함)를 돌려준다. messageCount = 문제를 만들 때의 대화 메시지 수. */
export async function addQuizItems(sessionId, items, messageCount) {
  const rows = items.map((item) => ({
    session_id: sessionId,
    type: item.type === "choice" ? "choice" : "blank",
    question: item.question,
    answers: item.answers ?? [],
    choices: item.choices ?? null,
    message_count: messageCount,
  }));

  const { data, error } = await supabase.from("quiz_items").insert(rows).select(QUIZ_COLUMNS);
  if (error) throw error;
  return data.map(toQuizItem);
}

/** 문제 하나에 사용자가 쓴(고른) 답을 저장한다. */
export async function saveQuizAnswer(itemId, answer) {
  const { error } = await supabase.from("quiz_items").update({ user_answer: answer }).eq("id", itemId);
  if (error) throw error;
}

// ─────────────────────────────────────────────
// 틀린 설명 / 모르는 개념
// ─────────────────────────────────────────────

/** 정오 판별에서 "틀렸어요" 가 나온 설명(errorText)과 피드백을 저장한다. */
export async function addCorrection(sessionId, errorText, feedback) {
  const { error } = await supabase
    .from("system_corrections")
    .insert({ session_id: sessionId, error_text: errorText, feedback });
  if (error) throw error;
}

/** 오늘 날짜 "YYYY-MM-DD" (내 컴퓨터 시간 기준). gap_records.last_seen 이 날짜(date) 칸이라서. */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 모르는 개념을 기록한다. 개념 이름은 세션 주제를 쓴다.
 *   kind = "wrong" → 정오 판별에서 틀림       (occurrence +1)
 *   kind = "easy"  → "더 쉽게" 버튼을 누름   (easy_btn_count +1)
 * 같은 사람의 같은 개념은 한 행에 횟수를 쌓고, 마지막으로 나온 날짜(last_seen)를 오늘로 바꾼다.
 */
export async function recordGap(concept, kind) {
  const user = await requireUser();
  const isWrong = kind === "wrong";

  const { data: rows, error } = await supabase
    .from("gap_records")
    .select("id, occurrence, easy_btn_count")
    .eq("user_id", user.id)
    .eq("concept", concept)
    .limit(1);
  if (error) throw error;

  if (rows.length > 0) {
    const row = rows[0];
    const { error: updateError } = await supabase
      .from("gap_records")
      .update({
        occurrence: (row.occurrence ?? 0) + (isWrong ? 1 : 0),
        easy_btn_count: (row.easy_btn_count ?? 0) + (isWrong ? 0 : 1),
        last_seen: today(),
      })
      .eq("id", row.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await supabase.from("gap_records").insert({
    user_id: user.id,
    concept,
    occurrence: isWrong ? 1 : 0,
    easy_btn_count: isWrong ? 0 : 1,
    last_seen: today(),
  });
  if (insertError) throw insertError;
}
