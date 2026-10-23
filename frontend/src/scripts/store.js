// ─────────────────────────────────────────────
// 학습 기록 저장소 (Supabase DB).
// 화면 코드(chat.js / history.js / quiz.js / profile.js)는 DB 를 직접 만지지 않고
// 이 파일의 함수만 쓴다. 모두 로그인한 사용자 본인의 기록만 읽고 쓴다.
//
//   테이블              들어가는 것
//   sessions            학습 세션 하나. 대화는 haku_log 에 [{role, text, ts}] 배열로 통째로 저장
//                       role: "user"(나) / "sensei"(하쿠) / "system"(정오 판별 알림, 어디가 틀렸는지)
//                             "check" 는 예전 방식의 정오 판별 알림("틀렸어요." 만). system 과 똑같이 다룬다.
//   quiz_items          퀴즈 문제 하나 (세션별, 만든 순서대로) + 사용자가 쓴 답
//   system_corrections  정오 판별에서 "틀렸어요" 가 나온 설명과 피드백
//   gap_records         모르는 개념(= 세션 주제)별로 틀린 횟수 / "더 쉽게" 누른 횟수
//   answer_levels       설명마다 어느 학교급 수준인지 판단한 결과 (레벨 1~5 + 근거)
//
// 기록 화면에서 세션을 삭제하면(hideSession) DB 에서 지우지 않고 sessions.ended_at 에 시각만 적는다.
// 사용자 화면(목록 / 채팅 / 퀴즈 / 통계)에서만 안 보이고, 대화·퀴즈·틀린 설명 기록은 DB 에 그대로 남는다.
//
// 닉네임과 수준(users 테이블)은 user.js 가 다룬다.
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

// ended_at: 기획서의 테이블 설계에 있던 "세션 종료 시각" 칸. 다른 곳에서는 쓰지 않아서,
// 사용자가 기록 화면에서 삭제(숨김)한 시각으로 쓴다. 비어 있으면 보이는 세션이다.
const SESSION_COLUMNS = "id, topic, haku_log, started_at, updated_at, ended_at";

/** 사용자가 기록 화면에서 삭제(숨김)한 세션인지. */
function isHidden(row) {
  return Boolean(row.ended_at);
}

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

// 학습과 상관없는 말(예: "히히 똥")에 붙는 경고. haku_log 에 {role: "system", kind: OFF_TOPIC, text} 로 저장된다.
export const OFF_TOPIC = "off-topic";

/** 경고가 붙은 사용자 말인지. (바로 다음 메시지가 학습과 상관없다는 경고) */
export function isOffTopicAt(messages, i) {
  return messages[i]?.role === "user" && messages[i + 1]?.kind === OFF_TOPIC;
}

/**
 * Gemini(하쿠 / 문제 생성)에게 보낼 대화 기록 [{role, text}].
 * 학습과 상관없는 말과 그 경고는 뺀다. (하쿠가 "똥이 뭐야?" 라고 묻거나, 그걸로 문제를 내지 않게)
 */
export function messagesForAI(messages) {
  return messages
    .filter((m, i) => m.kind !== OFF_TOPIC && !isOffTopicAt(messages, i))
    .map((m) => ({ role: m.role, text: m.text }));
}

/** 문장이 너무 길면 세션 목록/헤더에 쓸 짧은 주제 이름으로 잘라준다. */
const TOPIC_MAX_LENGTH = 10;

export function deriveTopic(text) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TOPIC_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, TOPIC_MAX_LENGTH)}…`;
}

/** 내 세션 전부. 최근에 대화한 세션이 먼저 온다. 대화가 하나도 없는 세션과 숨긴 세션은 뺀다. */
export async function getAllSessions() {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLUMNS)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data.filter((row) => !isHidden(row)).map(toSession).filter((s) => s.messages.length > 0);
}

/** 가장 최근에 대화한 세션. 없으면 null. (채팅 화면을 그냥 열었을 때 이어서 보여줄 세션) */
export async function getLatestSession() {
  const sessions = await getAllSessions();
  return sessions[0] ?? null;
}

/** 세션 하나. 없거나, 내 세션이 아니거나, 숨긴 세션이면 null. */
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
  return data && !isHidden(data) ? toSession(data) : null;
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

/** 세션의 주제 이름만 바꾼다. (기록 화면의 연필 버튼) 대화(haku_log)는 건드리지 않는다. */
export async function renameSession(id, topic) {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("sessions")
    .update({ topic })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("이미 삭제됐거나 내 기록이 아니에요.");
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

/**
 * 세션을 사용자 화면에서 숨긴다. (기록 화면의 휴지통 버튼)
 * DB 에서 지우지 않고 ended_at 에 지금 시각만 적는다. 대화, 퀴즈, 틀린 설명, 취약 개념 기록은 그대로 남는다.
 */
export async function hideSession(id) {
  const user = await requireUser();
  const { data, error } = await supabase
    .from("sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("이미 삭제됐거나 내 기록이 아니에요.");
}

// ─────────────────────────────────────────────
// 프로필 화면 (최근 학습 주제 + 대시보드: 학습 잔디 / 퀴즈 정답률 / 다시 볼 개념)
// ─────────────────────────────────────────────

/** 날짜 → "YYYY-MM-DD" (내 컴퓨터 시간 기준). 학습 잔디의 칸과 gap_records.last_seen 이 이 모양이다. */
export function dayKey(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 다시 볼 개념을 몇 개까지 보여줄지.
const GAP_TOP = 3;

/**
 * 프로필 화면에 필요한 기록을 한 번에 읽는다. (세션은 한 번만 읽어서 여러 곳에 같이 쓴다)
 *   lastTopic  가장 최근에 대화한 세션의 주제. 없으면 null.
 *   activity   날짜("YYYY-MM-DD")별로 내가 보낸 설명(메시지) 수. {"2026-10-24": 5, ...}
 *   quiz       채점한 문제 수(graded)와 그중 맞힌 문제 수(correct). 시험지를 "제출" 해야 채점된다.
 *   gaps       다시 볼 개념. 틀린 횟수(wrong) + "더 쉽게" 누른 횟수(easy) 가 많은 순서로 최대 3개.
 *              sessionId 는 그 주제로 대화한 가장 최근 세션 (퀴즈로 바로 가는 링크에 쓴다). 없으면 null.
 * 숨긴(삭제한) 세션의 대화와 퀴즈는 세지 않는다.
 */
export async function getProfileStats() {
  const user = await requireUser();
  const sessions = await getAllSessions();

  // 메시지마다 보낸 시각(ts)이 있다. 시각이 없는 예전 메시지는 세션을 시작한 날로 친다.
  const activity = {};
  for (const session of sessions) {
    for (const m of session.messages) {
      if (m.role !== "user") continue;
      const day = dayKey(new Date(m.ts ?? session.createdAt));
      activity[day] = (activity[day] ?? 0) + 1;
    }
  }

  // quiz_items 에는 user_id 가 없어서 내 세션 id 들로 찾는다. 채점한(is_correct 가 있는) 문제만.
  const quiz = { graded: 0, correct: 0 };
  if (sessions.length > 0) {
    const { data, error } = await supabase
      .from("quiz_items")
      .select("is_correct")
      .in("session_id", sessions.map((s) => s.id))
      .not("is_correct", "is", null);
    if (error) throw error;
    quiz.graded = data.length;
    quiz.correct = data.filter((row) => row.is_correct).length;
  }

  const { data: gapRows, error: gapError } = await supabase
    .from("gap_records")
    .select("concept, occurrence, easy_btn_count, last_seen")
    .eq("user_id", user.id);
  if (gapError) throw gapError;
  const gaps = gapRows
    .map((row) => ({
      concept: row.concept,
      wrong: row.occurrence ?? 0,
      easy: row.easy_btn_count ?? 0,
      lastSeen: row.last_seen ?? "",
    }))
    .filter((g) => g.concept && g.wrong + g.easy > 0)
    // 횟수가 같으면 최근에 나온 개념이 먼저.
    .sort((a, b) => b.wrong + b.easy - (a.wrong + a.easy) || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, GAP_TOP)
    .map((g) => ({ ...g, sessionId: sessions.find((s) => s.topic === g.concept)?.id ?? null }));

  return {
    lastTopic: sessions.find((s) => s.topic)?.topic ?? null,
    activity,
    quiz,
    gaps,
  };
}

// ─────────────────────────────────────────────
// 퀴즈 (quiz_items: 문제 하나가 한 행)
// ─────────────────────────────────────────────

const QUIZ_COLUMNS = "id, type, question, answers, choices, user_answer, message_count, is_correct";

/**
 * DB 의 quiz_items 행을 화면 코드가 쓰는 문제 모양 {id, type, question, answers, choices, isCorrect} 으로 바꾼다.
 * isCorrect 는 채점 결과. 아직 채점하지 않았으면 null.
 */
function toQuizItem(row) {
  return {
    id: row.id,
    type: row.type,
    question: row.question,
    answers: row.answers ?? [],
    choices: row.choices ?? undefined,
    isCorrect: row.is_correct ?? null,
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

/**
 * 시험지 목록 화면(quiz-list.html)에 쓸 세션별 요약. 문제가 하나라도 있는 세션만 준다.
 * 돌려주는 것: Map<세션 id, {total, graded, correct, lastMadeAt}>  (lastMadeAt = 마지막으로 문제를 만든 시각, ms)
 */
export async function getQuizSummaries(sessionIds) {
  const summaries = new Map();
  if (sessionIds.length === 0) return summaries;

  const { data, error } = await supabase
    .from("quiz_items")
    .select("session_id, is_correct, created_at")
    .in("session_id", sessionIds);
  if (error) throw error;

  for (const row of data) {
    const s = summaries.get(row.session_id) ?? { total: 0, graded: 0, correct: 0, lastMadeAt: 0 };
    s.total += 1;
    if (row.is_correct !== null && row.is_correct !== undefined) s.graded += 1;
    if (row.is_correct === true) s.correct += 1;
    s.lastMadeAt = Math.max(s.lastMadeAt, Date.parse(row.created_at));
    summaries.set(row.session_id, s);
  }
  return summaries;
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

/** 채점 결과(맞았는지)를 저장한다. 채점할 때의 답도 같이 저장해서, 채점한 답과 저장된 답이 어긋나지 않게 한다. */
export async function saveQuizGrade(itemId, answer, isCorrect) {
  const { error } = await supabase
    .from("quiz_items")
    .update({ user_answer: answer, is_correct: isCorrect })
    .eq("id", itemId);
  if (error) throw error;
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
  return dayKey(new Date());
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

// ─────────────────────────────────────────────
// 대답 수준 (answer_levels: 설명 하나가 한 행)
// ─────────────────────────────────────────────

/**
 * 설명 하나의 수준을 기록한다. 백엔드(/judge-level)가 판단한 레벨(1~5)과 그 근거(reason).
 * 내 지금 수준(users.level_current)을 움직이는 것은 user.js 의 applyAnswerLevel 이 한다.
 */
export async function addAnswerLevel(sessionId, answer, level, reason) {
  const user = await requireUser();
  const { error } = await supabase
    .from("answer_levels")
    .insert({ user_id: user.id, session_id: sessionId, answer, level, reason });
  if (error) throw error;
}
