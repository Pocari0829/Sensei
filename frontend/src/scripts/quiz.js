// ─────────────────────────────────────────────
// quiz.html 전용 스크립트.
// 문항 생성 자체는 백엔드에 아직 없으므로(app.py의 /generate-quiz는 주석 처리됨),
// 채팅 화면(chat.js)이 ?topic= 으로 넘겨준 주제 이름만 반영해서 예시 문항 제목을 채운다.
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const topic = params.get("topic");
  const subEl = document.getElementById("quiz-sub");

  if (topic && subEl) {
    subEl.textContent = `${topic} · 복습 퀴즈`;
  }
});

// ─────────────────────────────────────────────
// (추가) 시험지 생성 연결
// [퀴즈 풀기] 로 이 페이지에 들어오면, localStorage 에 저장된 현재 대화를
// 백엔드 /generate-quiz 로 보내고, 받은 문제로 예시 카드(Q1, Q2)를 바꿔 그린다.
// 만든 문제는 대화마다 저장해서 쌓아 둔다. 대화를 더 나눈 뒤 다시 들어오면
// 예전 문제는 그대로 두고 새 문제를 하나 더 만들어 아래에 덧붙인다.
// quiz.html 은 건드리지 않고, 화면에 뜬 뒤에 카드만 교체한다.
// (import 는 모듈 맨 위가 아니어도 동작한다)
// ─────────────────────────────────────────────
import * as store from "./store.js";
import { generateQuiz } from "./api.js";

// 나중에 채점할 때 쓰려고 받은 정답을 여기 보관해둔다. (화면에는 안 보임)
let currentQuizItems = [];

// ─────────────────────────────────────────────
// 시험지 보관: 한 번 만든 문제는 지워지지 않게 한다.
// 문제를 만들면 이 브라우저의 localStorage 에 "대화(세션)별로" 저장해두고,
// 다시 들어오거나 새로고침하면 저장된 문제를 전부 그대로 보여준다.
// 새 문제는 기존 목록 뒤에 "추가"만 한다. (예전 문제 + 새 문제)
// (store.js 와 같은 방식. 나중에 DB 가 생기면 아래 두 함수 안쪽만 fetch 로 바꾸면 된다)
// 저장 모양: { [세션 id]: {
//   items: [{question, answers}],   지금까지 만든 문제 전부 (만든 순서대로)
//   userAnswers: ["..."],           문제마다 입력한 답 (items 와 같은 순서)
//   messageCount: 5,                마지막으로 문제를 만들 때의 대화 메시지 수
//   createdAt
// } }
// ─────────────────────────────────────────────
const QUIZ_STORAGE_KEY = "sensei.quizzes.v1";

function loadSavedQuizzes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUIZ_STORAGE_KEY) || "{}");
    const isMap = parsed && typeof parsed === "object" && !Array.isArray(parsed);
    return isMap ? parsed : {};
  } catch {
    // localStorage 가 막혀있거나 JSON 이 깨졌으면 저장된 게 없는 것으로 본다.
    return {};
  }
}

function saveQuiz(sessionId, quiz) {
  try {
    const all = loadSavedQuizzes();
    all[sessionId] = quiz;
    localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 저장에 실패해도 화면의 문제는 그대로 보여준다.
  }
}

function escapeQuizHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/** 객관식 문제인지. (예전에 저장된 문제는 type 이 없으므로 빈칸 문제로 본다) */
function isChoice(item) {
  return item.type === "choice" && Array.isArray(item.choices) && item.choices.length > 0;
}

function quizCard(item, index) {
  const n = index + 1;

  if (isChoice(item)) {
    const options = item.choices
      .map(
        (choice, k) => `
        <label class="q-choice">
          <input type="radio" name="q-${index}" value="${k}" />
          <span class="q-choice__num">${k + 1}</span>
          <span class="q-choice__text">${escapeQuizHtml(choice)}</span>
        </label>`,
      )
      .join("");

    return `
    <div class="card q-card" data-index="${index}">
      <p class="q-card__label">Q ${n} · 객관식</p>
      <p class="q-card__text">${escapeQuizHtml(item.question)}</p>
      <div class="q-choices" role="radiogroup" aria-label="Q ${n} 보기">${options}</div>
    </div>`;
  }

  const count = item.answers?.length ?? 0;
  const placeholder =
    count > 1 ? `빈칸 ${count}개의 답을 순서대로 입력하세요...` : "답을 입력하세요...";

  return `
    <div class="card q-card" data-index="${index}">
      <p class="q-card__label">Q ${n}</p>
      <p class="q-card__text">${escapeQuizHtml(item.question)}</p>
      <textarea rows="2" placeholder="${placeholder}" aria-label="Q ${n} 답안"></textarea>
    </div>`;
}

// 안내 카드("만드는 중이에요..." 같은 글)는 화면에 하나만 있고, 이 id 로 찾는다.
const NOTE_ID = "quiz-note";

function infoCard(text) {
  return `
    <div class="card q-card" id="${NOTE_ID}">
      <p class="q-card__text">${escapeQuizHtml(text)}</p>
    </div>`;
}

/** 예시 카드를 모두 지우고 새 카드 HTML 로 바꾼다. */
function replaceCards(html) {
  const cards = document.querySelectorAll(".q-card");
  const anchor = cards[0]?.previousElementSibling;
  cards.forEach((c) => c.remove());
  anchor?.insertAdjacentHTML("afterend", html);
}

function updatePager(total) {
  const pager = document.querySelector(".pager");
  const pagerText = document.querySelector(".pager-text");
  if (pager) {
    pager.innerHTML = Array.from({ length: total }, (_, i) =>
      i === 0 ? `<span class="is-active"></span>` : `<span></span>`,
    ).join("");
  }
  if (pagerText) pagerText.textContent = total > 0 ? `1 / ${total}` : "0 / 0";
}

/**
 * from 번째 문제부터: 저장된 답을 채우고, 고칠 때마다 같이 저장되게 한다.
 * 빈칸 문제는 입력한 글을, 객관식은 고른 보기의 글을 userAnswers 에 저장한다.
 */
function bindAnswers(sessionId, quiz, from = 0) {
  const setAnswer = (i, value) => {
    quiz.userAnswers = quiz.userAnswers ?? [];
    quiz.userAnswers[i] = value;
    saveQuiz(sessionId, quiz);
  };

  document.querySelectorAll(".q-card[data-index]").forEach((card) => {
    const i = Number(card.dataset.index);
    if (i < from) return;
    const saved = quiz.userAnswers?.[i] ?? "";

    const textarea = card.querySelector("textarea");
    if (textarea) {
      textarea.value = saved;
      textarea.addEventListener("input", () => setAnswer(i, textarea.value));
      return;
    }

    const choices = quiz.items[i]?.choices ?? [];
    card.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.checked = saved !== "" && choices[Number(radio.value)] === saved;
      radio.addEventListener("change", () => {
        if (radio.checked) setAnswer(i, choices[Number(radio.value)]);
      });
    });
  });
}

/** 저장된 문제를 전부 그린다. note 가 있으면 맨 아래에 안내 카드를 하나 덧붙인다. */
function showQuiz(sessionId, quiz, note = "") {
  currentQuizItems = quiz.items;
  replaceCards(quiz.items.map(quizCard).join("") + (note ? infoCard(note) : ""));
  updatePager(quiz.items.length);
  bindAnswers(sessionId, quiz);
}

/** 맨 아래 안내 카드의 글만 바꾼다. 이미 그려진 문제 카드는 건드리지 않는다. */
function setNote(text) {
  const el = document.querySelector(`#${NOTE_ID} .q-card__text`);
  if (el) el.textContent = text;
}

/**
 * 안내 카드 자리에 새 문제 카드(from 번째부터)를 끼워 넣는다.
 * 전체를 다시 그리지 않으므로, 예전 문제에 입력 중이던 답과 커서가 그대로 유지된다.
 */
function appendNewCards(sessionId, quiz, from) {
  const note = document.getElementById(NOTE_ID);
  if (!note) {
    showQuiz(sessionId, quiz);
    return;
  }

  const html = quiz.items
    .slice(from)
    .map((item, k) => quizCard(item, from + k))
    .join("");
  note.insertAdjacentHTML("beforebegin", html);
  note.remove();

  currentQuizItems = quiz.items;
  updatePager(quiz.items.length);
  bindAnswers(sessionId, quiz, from);

  // 예전 문제 아래에 붙었으면, 새 문제가 보이도록 그쪽으로 내려간다.
  if (from > 0) {
    document.querySelectorAll(".q-card")[from]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function loadQuiz() {
  const session = store.getSession(store.getActiveSessionId());
  const history = (session?.messages ?? []).map((m) => ({ role: m.role, text: m.text }));

  if (history.length === 0) {
    replaceCards(infoCard("아직 하쿠와 나눈 대화가 없어요. 먼저 설명을 해주세요!"));
    updatePager(0);
    return;
  }

  // 이 대화로 지금까지 만든 문제들. 없으면 빈 시험지에서 시작한다.
  const saved = loadSavedQuizzes()[session.id];
  const quiz =
    saved?.items?.length > 0 ? saved : { items: [], userAnswers: [], createdAt: Date.now() };

  // 마지막으로 문제를 만든 뒤에 대화가 더 늘어났을 때만 새 문제를 만든다.
  // 대화가 그대로면(새로고침, 그냥 다시 들어옴) 저장된 문제만 보여주고 Gemini 를 부르지 않는다.
  // (messageCount 가 없는 예전 저장분은 0 으로 봐서, 한 번 더 만들어 덧붙인다)
  const hasNewTalk = history.length > (quiz.messageCount ?? 0);
  if (!hasNewTalk) {
    showQuiz(session.id, quiz);
    return;
  }

  // 예전 문제는 먼저 그대로 보여주고, 그 아래에 "만드는 중" 안내를 붙인다.
  const before = quiz.items.length;
  showQuiz(
    session.id,
    quiz,
    before > 0
      ? "새로 나눈 대화로 문제를 하나 더 만드는 중이에요..."
      : "대화를 바탕으로 문제를 만드는 중이에요...",
  );

  // 이미 낸 문제를 같이 보내서, 겹치지 않는 새 문제를 받는다.
  // 문제 유형은 객관식 → 빈칸 → 객관식 ... 순서로 번갈아 낸다.
  const result = await generateQuiz(
    history,
    quiz.items.map((item) => item.question),
    before % 2 === 0 ? "choice" : "blank",
  );

  // 실패해도 예전 문제는 화면에 그대로 남는다. 저장도 바꾸지 않으므로 다음에 다시 시도된다.
  if (!result.ok) {
    setNote(result.error || "문제를 만들지 못했어요. 다시 시도해주세요.");
    return;
  }

  const newItems = result.items ?? [];

  if (newItems.length === 0) {
    setNote("대화에서 문제를 만들 만한 내용을 찾지 못했어요.");
    return;
  }

  // 예전 문제는 그대로 두고 뒤에 추가만 한다.
  quiz.items.push(...newItems);
  quiz.messageCount = history.length;
  saveQuiz(session.id, quiz);
  appendNewCards(session.id, quiz, before);
}

document.addEventListener("DOMContentLoaded", loadQuiz);
