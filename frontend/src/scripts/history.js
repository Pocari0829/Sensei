// ─────────────────────────────────────────────
// history.html 전용 스크립트.
// 예전에는 세션 카드 2~3개가 html에 그대로 박혀 있었다.
// 이제는 DB 에 쌓인 내 학습 세션을 store.js 로 읽어서 그린다.
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
    <div class="card empty-illustration">
      <img src="../../public/mascot.png" alt="" />
      <p class="empty-illustration__title">아직 학습 기록이 없어요</p>
      <p class="empty-illustration__text">채팅에서 하쿠에게 오늘 배운 내용을 설명하면<br />여기에 기록이 쌓여요.</p>
    </div>`;
}

function errorState(message) {
  return `
    <div class="card empty-illustration">
      <img src="../../public/mascot.png" alt="" />
      <p class="empty-illustration__title">학습 기록을 불러오지 못했어요</p>
      <p class="empty-illustration__text">${escapeHtml(message)}<br />잠시 후 새로고침해 주세요.</p>
    </div>`;
}

async function render() {
  let sessions;
  try {
    sessions = await store.getAllSessions();
  } catch (err) {
    listEl.innerHTML = errorState(err.message);
    return;
  }

  if (sessions.length === 0) {
    listEl.innerHTML = emptyState();
    return;
  }

  // "지금 진행 중" = 하단 채팅 탭을 누르면 이어서 열리는 세션(가장 최근에 대화한 세션)
  const [current, ...others] = sessions;

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

// "새 세션" 버튼: 채팅 화면을 빈 화면(?new)으로 연다.
// 세션은 첫 메시지를 보낼 때 DB 에 만들어진다. (빈 세션이 쌓이지 않게)
newSessionBtn.addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = "./chat.html?new";
});

document.addEventListener("DOMContentLoaded", render);
