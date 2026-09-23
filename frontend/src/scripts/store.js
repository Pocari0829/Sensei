// ─────────────────────────────────────────────
// 학습 세션 저장소.
// 아직 백엔드에 DB(Supabase)가 붙지 않았기 때문에, 우선은 이 브라우저의
// localStorage 에 세션(주제 + 대화 기록)을 저장해서 페이지 사이를 잇는다.
// 나중에 DB 가 생기면 이 파일의 함수 내부만 fetch 호출로 바꾸면 된다.
// ─────────────────────────────────────────────

const STORAGE_KEY = "sensei.sessions.v1";

function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [], activeSessionId: null };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.sessions)) return { sessions: [], activeSessionId: null };
    return parsed;
  } catch {
    // localStorage 가 막혀있거나(시크릿 모드 등) JSON이 깨졌으면 빈 상태로 시작한다.
    return { sessions: [], activeSessionId: null };
  }
}

function saveRaw(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 저장 실패해도 앱이 죽으면 안 되므로 조용히 무시한다.
  }
}

function makeId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 문장이 너무 길면 세션 목록/헤더에 쓸 짧은 주제 이름으로 잘라준다. */
export function deriveTopic(text) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 14)}…`;
}

export function getAllSessions() {
  // 최근에 바뀐 세션이 먼저 오도록 정렬한다.
  return [...loadRaw().sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getSession(id) {
  if (!id) return null;
  return loadRaw().sessions.find((s) => s.id === id) || null;
}

export function getActiveSessionId() {
  return loadRaw().activeSessionId;
}

export function setActiveSessionId(id) {
  const state = loadRaw();
  state.activeSessionId = id;
  saveRaw(state);
}

/** 새 학습 세션을 만들고 바로 활성 세션으로 지정한다. */
export function createSession() {
  const now = Date.now();
  const session = {
    id: makeId(),
    topic: null, // 첫 메시지를 보내는 순간 채워진다.
    status: "active", // "active" | "done"
    messages: [],
    createdAt: now,
    updatedAt: now,
  };

  const state = loadRaw();
  state.sessions.push(session);
  state.activeSessionId = session.id;
  saveRaw(state);

  return session;
}

/** 세션 하나를 통째로 덮어 저장한다 (메시지 추가/수정 후 호출). */
export function saveSession(session) {
  const state = loadRaw();
  const idx = state.sessions.findIndex((s) => s.id === session.id);
  session.updatedAt = Date.now();

  if (idx === -1) {
    state.sessions.push(session);
  } else {
    state.sessions[idx] = session;
  }

  saveRaw(state);
  return session;
}

export function addMessage(session, role, text) {
  session.messages.push({ role, text, ts: Date.now() });
  if (!session.topic && role === "user") {
    session.topic = deriveTopic(text);
  }
  return saveSession(session);
}

export function getStats() {
  const sessions = getAllSessions();
  const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
  const lastTopic = sessions.find((s) => s.topic)?.topic ?? null;

  return {
    totalSessions: sessions.length,
    totalMessages,
    lastTopic,
  };
}
