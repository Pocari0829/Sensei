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
 * @returns {Promise<{ok: true, question: string} | {ok: false, error: string}>}
 */
export async function askHaku(message, history = []) {
  try {
    const res = await fetch(`${API_BASE}/ask-haku`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
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
