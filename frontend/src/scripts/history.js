// ─────────────────────────────────────────────
// history.html 전용 스크립트.
// 예전에는 세션 카드 2~3개가 html에 그대로 박혀 있었다.
// 이제는 DB 에 쌓인 내 학습 세션을 store.js 로 읽어서 그린다.
// ─────────────────────────────────────────────

import * as store from "./store.js";

const listEl = document.getElementById("history-list");
const newSessionBtn = document.getElementById("new-session-btn");

/** 글자 그대로 보이게 HTML 특수문자를 바꾼다. 따옴표도 바꿔서 속성값(aria-label 등) 안에 넣어도 안전하다. */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replaceAll('"', "&quot;");
}

/** "오늘" / "어제" / "n일 전" 처럼 사람이 읽기 편한 상대 시간으로 바꾼다. */
function relativeDay(ts) {
  const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);

  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";
  return `${diffDays}일 전`;
}

// 주제 이름 입력칸의 최대 글자 수 (예전 채팅 화면의 주제 수정 칸과 같다)
const TOPIC_INPUT_MAX = 20;

function sessionCard(session, isActive) {
  const topic = escapeHtml(session.topic || "제목 없는 주제");
  const meta = `${relativeDay(session.updatedAt)} · 대화 ${session.messages.length}회`;
  const statusLabel = isActive ? "진행 중" : "완료";
  const statusClass = isActive ? "status status--active" : "status";
  const cardClass = isActive ? "session card card--tinted" : "session card";

  // 카드 전체가 링크이고, 오른쪽 끝의 연필·휴지통 버튼만 따로 눌린다. (버튼을 링크 안에 넣으면 누를 때 채팅으로 넘어가 버린다)
  // 연필을 누르면 링크·버튼 대신 아래 주제 이름 입력칸(.session__edit)이 보인다.
  return `
    <div class="${cardClass}" data-id="${escapeHtml(session.id)}" data-topic="${escapeHtml(session.topic || "")}">
      <a class="session__link" href="./chat.html?session=${encodeURIComponent(session.id)}">
        <img src="../../public/mascot.png" alt="" />
        <div class="session__body">
          <p class="session__topic">${topic}</p>
          <p class="session__meta">${meta}</p>
        </div>
        <span class="${statusClass}">${statusLabel}</span>
      </a>
      <button type="button" class="session__action" data-rename aria-label="${topic} 주제 이름 수정">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      <button type="button" class="session__action session__delete" aria-label="${topic} 학습 기록 삭제">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
        </svg>
      </button>
      <form class="session__edit" hidden>
        <input type="text" maxlength="${TOPIC_INPUT_MAX}" aria-label="주제 이름 입력" />
        <button type="submit" class="pill pill--primary">저장</button>
        <button type="button" class="pill pill--ghost" data-cancel>취소</button>
      </form>
    </div>`;
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

// ─────────────────────────────────────────────
// 주제 이름 수정: 연필 버튼 → 카드 안에서 바로 입력 → 저장(Enter) / 취소(Esc)
// ─────────────────────────────────────────────
function setEditing(card, editing) {
  card.querySelector(".session__link").hidden = editing;
  for (const btn of card.querySelectorAll(".session__action")) btn.hidden = editing;
  const form = card.querySelector(".session__edit");
  form.hidden = !editing;
  if (editing) {
    const input = form.querySelector("input");
    input.value = card.dataset.topic;
    input.focus();
    input.select();
  }
}

listEl.addEventListener("click", (e) => {
  const renameBtn = e.target.closest("[data-rename]");
  if (renameBtn) {
    setEditing(renameBtn.closest(".session"), true);
    return;
  }
  const cancelBtn = e.target.closest("[data-cancel]");
  if (cancelBtn) {
    const card = cancelBtn.closest(".session");
    setEditing(card, false);
  }
});

listEl.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !e.target.closest(".session__edit")) return;
  e.target.closest(".session").querySelector("[data-cancel]").click();
});

listEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const card = form.closest(".session");
  const topic = form.querySelector("input").value.trim();
  // 비워서 저장하면 바꾸지 않는다.
  if (!topic) {
    form.querySelector("[data-cancel]").click();
    return;
  }

  for (const el of form.elements) el.disabled = true;
  try {
    await store.renameSession(card.dataset.id, topic);
  } catch (err) {
    for (const el of form.elements) el.disabled = false;
    window.alert(`주제 이름을 저장하지 못했어요. ${err.message}`);
    return;
  }
  render();
});

// 휴지통 버튼: 물어본 뒤 세션을 목록에서 숨기고 다시 그린다. (DB 에서는 지우지 않는다. store.hideSession 참고)
listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest(".session__delete");
  if (!btn) return;

  const topic = btn.closest(".session")?.querySelector(".session__topic")?.textContent ?? "";
  if (!window.confirm(`'${topic}' 학습 기록을 삭제할까요?
목록과 채팅에서 더 이상 볼 수 없어요.`)) return;

  btn.disabled = true;
  try {
    await store.hideSession(btn.closest(".session").dataset.id);
  } catch (err) {
    btn.disabled = false;
    window.alert(`삭제하지 못했어요. ${err.message}`);
    return;
  }
  render();
});

// "새 세션" 버튼: 채팅 화면을 빈 화면(?new)으로 연다.
// 세션은 첫 메시지를 보낼 때 DB 에 만들어진다. (빈 세션이 쌓이지 않게)
newSessionBtn.addEventListener("click", (e) => {
  e.preventDefault();
  window.location.href = "./chat.html?new";
});

document.addEventListener("DOMContentLoaded", render);
