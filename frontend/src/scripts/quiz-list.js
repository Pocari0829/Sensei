// ─────────────────────────────────────────────
// quiz-list.html(빈틈 시험지 목록) 전용 스크립트.
// 문제가 하나라도 만들어진 학습 세션마다 시험지 카드를 하나씩 그린다. (학습 기록 화면과 같은 카드 모양)
// 카드를 누르면 그 세션의 시험지(quiz.html?session=)가 열린다. 문제를 만들고 채점하는 일은 quiz.js 가 그대로 한다.
// ─────────────────────────────────────────────

import * as store from "./store.js";

const listEl = document.getElementById("quiz-list");
const sortButtons = document.querySelectorAll(".sort-tab");

// ─────────────────────────────────────────────
// 정렬 기준
//   wrong    오답률 높은 순 (기본값). 오답률 = 채점한 문제 중 틀린 비율 (quiz_items.is_correct).
//            아직 채점한 문제가 없는 시험지는 오답률을 알 수 없으므로 맨 뒤에 둔다.
//   made     최근 생성 순 — 마지막으로 문제를 만든 시각
//   studied  최근 학습 순 — 그 세션에서 마지막으로 대화한 시각 (학습 기록 화면과 같은 기준)
// 같으면 최근 생성 순으로 둔다.
// ─────────────────────────────────────────────
const SORT_KEY = "sensei.quizListSort";
const SORTS = {
  wrong: (a, b) => (wrongRate(b.summary) ?? -1) - (wrongRate(a.summary) ?? -1),
  made: () => 0,
  studied: (a, b) => b.session.updatedAt - a.session.updatedAt,
};

/** 채점한 문제 중 틀린 비율(0~1). 채점한 문제가 없으면 null. */
function wrongRate(summary) {
  return summary.graded > 0 ? (summary.graded - summary.correct) / summary.graded : null;
}

function loadSort() {
  try {
    const saved = localStorage.getItem(SORT_KEY);
    return saved in SORTS ? saved : "wrong";
  } catch {
    return "wrong";
  }
}

let sortBy = loadSort();
// 한 번 불러온 목록. 정렬 기준을 바꿀 때는 DB 를 다시 읽지 않고 이것만 다시 정렬해서 그린다.
let entries = null;

/** 글자 그대로 보이게 HTML 특수문자를 바꾼다. 따옴표도 바꿔서 속성값 안에 넣어도 안전하다. */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML.replaceAll('"', "&quot;");
}

/** "오늘" / "어제" / "n일 전" 처럼 사람이 읽기 편한 상대 시간으로 바꾼다. (history.js 와 같다) */
function relativeDay(ts) {
  const startOfDay = (t) => new Date(t).setHours(0, 0, 0, 0);
  const diffDays = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);

  if (diffDays <= 0) return "오늘";
  if (diffDays === 1) return "어제";
  return `${diffDays}일 전`;
}

/**
 * 시험지 카드 하나. 학습 기록의 세션 카드와 같은 모양이다.
 *   상태 배지: 아직 안 푼(채점 안 한) 문제가 있으면 "풀 문제 n개", 다 풀었으면 "정답 a/b"
 */
function quizCard(session, summary) {
  const topic = escapeHtml(session.topic || "제목 없는 주제");
  const rate = wrongRate(summary);
  const meta = [
    // 최근 학습 순으로 볼 때는 마지막으로 대화한 날을, 그 밖에는 문제를 만든 날을 보여준다.
    relativeDay(sortBy === "studied" ? session.updatedAt : summary.lastMadeAt),
    `문제 ${summary.total}개`,
    rate === null ? null : `오답률 ${Math.round(rate * 100)}%`,
  ]
    .filter(Boolean)
    .join(" · ");
  const left = summary.total - summary.graded;
  const statusLabel = left > 0 ? `풀 문제 ${left}개` : `정답 ${summary.correct}/${summary.total}`;
  const statusClass = left > 0 ? "status status--active" : "status";
  const params = new URLSearchParams({ session: session.id });
  if (session.topic) params.set("topic", session.topic);

  return `
    <div class="session card">
      <a class="session__link" href="./quiz.html?${params}">
        <img src="../../public/mascot.png" alt="" />
        <div class="session__body">
          <p class="session__topic">${topic}</p>
          <p class="session__meta">${meta}</p>
        </div>
        <span class="${statusClass}">${statusLabel}</span>
      </a>
    </div>`;
}

function emptyState() {
  return `
    <div class="card empty-illustration">
      <img src="../../public/mascot.png" alt="" />
      <p class="empty-illustration__title">아직 시험지가 없어요</p>
      <p class="empty-illustration__text">채팅에서 하쿠에게 설명하고 [퀴즈 풀기]를 누르면<br />여기에 시험지가 쌓여요.</p>
    </div>`;
}

function errorState(message) {
  return `
    <div class="card empty-illustration">
      <img src="../../public/mascot.png" alt="" />
      <p class="empty-illustration__title">시험지를 불러오지 못했어요</p>
      <p class="empty-illustration__text">${escapeHtml(message)}<br />잠시 후 새로고침해 주세요.</p>
    </div>`;
}

/** 불러온 목록을 지금 정렬 기준으로 그린다. */
function draw() {
  for (const btn of sortButtons) btn.setAttribute("aria-pressed", String(btn.dataset.sort === sortBy));

  if (entries.length === 0) {
    listEl.innerHTML = emptyState();
    return;
  }

  const byMade = (a, b) => b.summary.lastMadeAt - a.summary.lastMadeAt;
  const sorted = [...entries].sort((a, b) => SORTS[sortBy](a, b) || byMade(a, b));
  listEl.innerHTML = sorted.map((e) => quizCard(e.session, e.summary)).join("");
}

async function load() {
  try {
    // 학습 기록에서 삭제(숨김)한 세션의 시험지는 보이지 않는다. (getAllSessions 가 빼고 준다)
    const sessions = await store.getAllSessions();
    const summaries = await store.getQuizSummaries(sessions.map((s) => s.id));
    entries = sessions
      .filter((s) => summaries.has(s.id))
      .map((s) => ({ session: s, summary: summaries.get(s.id) }));
  } catch (err) {
    listEl.innerHTML = errorState(err.message);
    return;
  }
  draw();
}

for (const btn of sortButtons) {
  btn.addEventListener("click", () => {
    sortBy = btn.dataset.sort;
    try {
      localStorage.setItem(SORT_KEY, sortBy);
    } catch {
      // 저장소가 막혀 있어도(시크릿 모드 등) 이번 화면에서는 그대로 정렬된다.
    }
    for (const b of sortButtons) b.setAttribute("aria-pressed", String(b === btn));
    if (entries) draw();
  });
}

document.addEventListener("DOMContentLoaded", load);
