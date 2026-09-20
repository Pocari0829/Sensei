// ─────────────────────────────────────────────
// history.html 전용 스크립트.
// 예전에는 세션 카드 2~3개가 html에 그대로 박혀 있었다.
// 이제는 store.js(localStorage)에 실제로 쌓인 학습 세션을 읽어서 그린다.
// ─────────────────────────────────────────────

import * as store from "./store.js";

const listEl = document.getElementById("history-list");
const newSessionBtn = document.getElementById("new-session-btn");

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** "오늘" / "어제" / "n일 전" 처럼 사람이 읽기 편한 상대 시간으로 바꾼다. */
function relativeDay(ts) {
  const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);

  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";
  return `${diffDays}일 전`;
}

function sessionCard(session, isActive) {
  const topic = escapeHtml(session.topic || "제목 없는 주제");
  const meta = `${relativeDay(session.updatedAt)} · 대화 ${session.messages.length}회`;
  const statusLabel = isActive ? "진행 중" : "완료";
  const statusClass = isActive ? "status status--active" : "status";
  const cardClass = isActive ? "session card card--tinted" : "session card";

  return `
    <a class="${cardClass}" href="./chat.html?session=${encodeURIComponent(session.id)}">
      <img src="../../public/mascot.png" alt="" />
      <div class="session__body">
        <p class="session__topic">${topic}</p>
        <p class="session__meta">${meta}</p>
      </div>
      <span class="${statusClass}">${statusLabel}</span>
    </a>`;
}

function emptyState() {
  return `
    <div class="card tip">
      <p class="tip__title">아직 학습 기록이 없어요</p>
      <p class="tip__text">채팅에서 하쿠에게 오늘 배운 내용을 설명하면 여기에 기록이 쌓여요.</p>
    </div>`;
}

function render() {
  const sessions = store.getAllSessions().filter((s) => s.messages.length > 0);

  if (sessions.length === 0) {
    listEl.innerHTML = emptyState();
    return;
  }

  const activeId = store.getActiveSessionId();
  const current = sessions.find((s) => s.id === activeId);
  const others = sessions.filter((s) => s.id !== activeId);

  let html = "";

  if (current) {
    html += `
      <section>
        <p class="section-label">지금 진행 중</p>
        ${sessionCard(current, true)}
      </section>`;
  }

  if (others.length > 0) {
    html += `
      <section style="margin-top: 16px">
        <p class="section-label">이전 학습</p>
        ${others.map((s) => sessionCard(s, false)).join("")}
      </section>`;
  }

  listEl.innerHTML = html;
}

// "새 세션" 버튼: 빈 세션을 만들어두고 채팅 화면으로 넘어간다.
newSessionBtn.addEventListener("click", (e) => {
  e.preventDefault();
  const session = store.createSession();
  window.location.href = `./chat.html?session=${encodeURIComponent(session.id)}`;
});

document.addEventListener("DOMContentLoaded", render);
