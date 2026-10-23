// ─────────────────────────────────────────────
// 백엔드(Flask) 통신 전용 모듈.
// 모든 페이지가 이 한 곳을 통해서만 서버와 이야기한다.
// ─────────────────────────────────────────────

// 백엔드 서버 주소. 배포 주소가 바뀌면 여기만 고치면 된다.
export const API_BASE = "http://127.0.0.1:5000";

/**
 * 하쿠에게 방금 한 설명을 보내고 꼬리질문을 받아온다.
 *
 * @param {string} message - 사용자가 방금 입력한 문장.
 * @param {{role: "user"|"sensei", text: string}[]} history - 지금까지의 대화 기록 (이번 message는 제외).
 * @param {string|null} nickname - 하쿠가 사용자를 부를 이름. 없으면 이름 없이 대화한다.
 * @returns {Promise<{ok: true, question: string} | {ok: false, error: string}>}
 */
export async function askHaku(message, history = [], nickname = null) {
  try {
    const res = await fetch(`${API_BASE}/ask-haku`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, nickname }),
    });

    // 서버가 500이어도 JSON 바디를 내려주므로 먼저 파싱을 시도한다.
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`서버 응답을 읽을 수 없어요 (HTTP ${res.status})`);
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || `요청이 실패했어요 (HTTP ${res.status})`);
    }

    return data;
  } catch (err) {
    // fetch 자체가 실패하는 경우(서버가 꺼져 있음, CORS, 네트워크 등)도 여기로 온다.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ─────────────────────────────────────────────
// (추가) 정오 판별 / 시험지 생성
// askHaku 와 같은 방식: 실패해도 throw 하지 않고 {ok:false, error} 로 돌려준다.
// ─────────────────────────────────────────────

async function postJson(path, body) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`서버 응답을 읽을 수 없어요 (HTTP ${res.status})`);
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || `요청이 실패했어요 (HTTP ${res.status})`);
    }

    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * 방금 한 설명이 맞는지 판별만 받아온다.
 * (채팅에서는 /ask-haku 가 알아서 먼저 판별하므로 따로 부를 필요는 없다)
 *
 * @returns {Promise<{ok: true, is_correct: boolean, feedback: string} | {ok: false, error: string}>}
 */
export function checkSystem(message, history = []) {
  return postJson("/check-system", { message, history });
}

/**
 * 지금까지의 대화로 시험지 문제를 하나 만든다.
 * 문제 유형은 정해서 보내지 않는다. 백엔드의 Gemini 가 대화 내용을 보고
 * "blank"(빈칸 주관식, 직접 입력) / "choice"(객관식, 보기 4개) 중 더 맞는 쪽을 골라서 만든다.
 *
 * @param {{role: "user"|"sensei", text: string}[]} history - 대화 전체.
 * @param {string[]} previous - 이미 낸 문제의 지문들. 보내면 이것과 겹치지 않는 새 문제를 만든다.
 * @returns {Promise<{ok: true, items: {type: "blank"|"choice", question: string, answers: string[], choices?: string[]}[]} | {ok: false, error: string}>}
 *   items 는 보통 1개이고, 대화에 문제로 낼 내용이 없으면 빈 목록이다.
 */
export function generateQuiz(history = [], previous = []) {
  return postJson("/generate-quiz", { history, previous });
}

/**
 * 방금 한 설명이 어느 학교급 학생이 할 만한 설명인지 판단받는다.
 * 레벨: 1 초등 저학년 / 2 초등 고학년 / 3 중학생 / 4 고등학생 / 5 대학생 이상
 *
 * @param {string} message - 사용자가 방금 한 말.
 * @param {string} question - 그 바로 전에 하쿠가 한 말. 무엇에 대한 대답인지 알려준다. 없으면 빈 문자열.
 * @returns {Promise<{ok: true, is_explanation: boolean, level: number, reason: string} | {ok: false, error: string}>}
 *   is_explanation 이 false(질문, "모르겠어", "무슨 색이야?" 에 "초록색" 같은 한 단어 답)면 level 은 쓰지 않는다.
 */
export function judgeLevel(message, question = "") {
  return postJson("/judge-level", { message, question });
}
