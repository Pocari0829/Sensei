// ─────────────────────────────────────────────
// quiz.html 전용 스크립트.
// [퀴즈 풀기] 로 들어오면 그 세션의 대화로 백엔드(/generate-quiz)가 문제를 만들고
// (빈칸 / 객관식 중 어느 유형으로 낼지도 백엔드의 Gemini 가 고른다),
// 만든 문제와 사용자가 쓴 답은 DB(quiz_items)에 저장한다. 자세한 흐름은 아래 "시험지 생성 연결".
// 맨 위 주제 이름은 채팅 화면(chat.js)이 ?topic= 으로 넘겨준 값으로 채운다.
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
// [퀴즈 풀기] 로 이 페이지에 들어오면(?session=세션 id), 그 세션의 대화를
// 백엔드 /generate-quiz 로 보내고, 받은 문제로 예시 카드(Q1, Q2)를 바꿔 그린다.
// 만든 문제는 대화마다 DB(quiz_items)에 저장해서 쌓아 둔다. 대화를 더 나눈 뒤 다시 들어오면
// 예전 문제는 그대로 두고 새 문제를 하나 더 만들어 아래에 덧붙인다.
// quiz.html 은 건드리지 않고, 화면에 뜬 뒤에 카드만 교체한다.
// (import 는 모듈 맨 위가 아니어도 동작한다)
// ─────────────────────────────────────────────
import * as store from "./store.js";
import { generateQuiz } from "./api.js";

// 나중에 채점할 때 쓰려고 받은 정답을 여기 보관해둔다. (화면에는 안 보임)
let currentQuizItems = [];

// ─────────────────────────────────────────────
// 답 저장: 사용자가 쓴(고른) 답을 문제마다 DB(quiz_items.user_answer)에 저장한다.
// 빈칸 문제는 글자를 칠 때마다 저장하면 요청이 너무 많아지므로,
// 입력이 멈추고 잠깐 뒤에 저장하고, 입력칸을 벗어날 때는 바로 저장한다.
// ─────────────────────────────────────────────
const ANSWER_SAVE_DELAY = 600;
const answerSaveTimers = new Map();

function saveAnswer(item, value) {
  // DB 에 저장되지 않은 문제(id 없음)는 답도 저장할 곳이 없다.
  if (!item?.id) return;
  store.saveQuizAnswer(item.id, value).catch((err) => console.warn("답을 저장하지 못했어요:", err));
}

function saveAnswerSoon(item, value) {
  clearTimeout(answerSaveTimers.get(item?.id));
  answerSaveTimers.set(
    item?.id,
    setTimeout(() => {
      answerSaveTimers.delete(item?.id);
      saveAnswer(item, value);
    }, ANSWER_SAVE_DELAY),
  );
}

/** 기다리던 저장이 있으면 지금 바로 저장한다. */
function saveAnswerNow(item, value) {
  if (!answerSaveTimers.has(item?.id)) return;
  clearTimeout(answerSaveTimers.get(item?.id));
  answerSaveTimers.delete(item?.id);
  saveAnswer(item, value);
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

// 시험지에 있어야 하는 최소 문제 수. 이보다 적으면 대화가 그대로여도 모자란 만큼 만든다.
const MIN_QUIZ_ITEMS = 1;

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
 * 빈칸 문제는 입력한 글을, 객관식은 고른 보기의 글을 userAnswers 에 넣고 DB 에 저장한다.
 */
function bindAnswers(quiz, from = 0) {
  const setAnswer = (i, value) => {
    quiz.userAnswers = quiz.userAnswers ?? [];
    quiz.userAnswers[i] = value;
  };

  document.querySelectorAll(".q-card[data-index]").forEach((card) => {
    const i = Number(card.dataset.index);
    if (i < from) return;
    const item = quiz.items[i];
    const saved = quiz.userAnswers?.[i] ?? "";

    const textarea = card.querySelector("textarea");
    if (textarea) {
      textarea.value = saved;
      textarea.addEventListener("input", () => {
        setAnswer(i, textarea.value);
        saveAnswerSoon(item, textarea.value);
      });
      textarea.addEventListener("blur", () => saveAnswerNow(item, textarea.value));
      return;
    }

    const choices = item?.choices ?? [];
    card.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.checked = saved !== "" && choices[Number(radio.value)] === saved;
      radio.addEventListener("change", () => {
        if (!radio.checked) return;
        setAnswer(i, choices[Number(radio.value)]);
        saveAnswer(item, choices[Number(radio.value)]);
      });
    });
  });
}

/** 저장된 문제를 전부 그린다. note 가 있으면 맨 아래에 안내 카드를 하나 덧붙인다. */
function showQuiz(quiz, note = "") {
  currentQuizItems = quiz.items;
  replaceCards(quiz.items.map(quizCard).join("") + (note ? infoCard(note) : ""));
  updatePager(quiz.items.length);
  bindAnswers(quiz);
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
function appendNewCards(quiz, from, scroll = from > 0) {
  const note = document.getElementById(NOTE_ID);
  if (!note) {
    showQuiz(quiz);
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
  bindAnswers(quiz, from);

  // 예전 문제 아래에 붙었으면, 새 문제가 보이도록 그쪽으로 내려간다.
  // (한 번에 여러 문제를 만들 때 두 번째부터는 내려가지 않는다. 첫 문제를 읽는 중일 수 있으므로)
  if (scroll) {
    document.querySelectorAll(".q-card")[from]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function loadQuiz() {
  // 채팅의 [퀴즈 풀기] 가 넘겨준 세션. 없으면(주소로 바로 들어옴) 가장 최근에 대화한 세션.
  const sessionId = new URLSearchParams(window.location.search).get("session");
  let session;
  let quiz;
  try {
    session = sessionId ? await store.getSession(sessionId) : await store.getLatestSession();
    // 이 대화로 지금까지 만든 문제들. 없으면 빈 시험지에서 시작한다.
    quiz = session ? await store.getQuiz(session.id) : null;
  } catch (err) {
    replaceCards(infoCard(`대화를 불러오지 못했어요. 잠시 후 새로고침해 주세요. (${err.message})`));
    updatePager(0);
    return;
  }

  const history = (session?.messages ?? []).map((m) => ({ role: m.role, text: m.text }));

  if (history.length === 0) {
    replaceCards(infoCard("아직 하쿠와 나눈 대화가 없어요. 먼저 설명을 해주세요!"));
    updatePager(0);
    return;
  }

  // 만들 문제 수:
  //   시험지가 MIN_QUIZ_ITEMS 개보다 적으면 → 모자란 만큼 (대화가 그대로여도. 예전에 하나만 만들어졌을 때 채운다)
  //   충분하면 → 마지막으로 문제를 만든 뒤에 대화가 늘었을 때만 1개
  //   대화도 그대로면(새로고침, 그냥 다시 들어옴) 저장된 문제만 보여주고 Gemini 를 부르지 않는다.
  const hasNewTalk = history.length > quiz.messageCount;
  const toMake = Math.max(MIN_QUIZ_ITEMS - quiz.items.length, hasNewTalk ? 1 : 0);
  if (toMake === 0) {
    showQuiz(quiz);
    return;
  }

  // 예전 문제는 먼저 그대로 보여주고, 그 아래에 "만드는 중" 안내를 붙인다.
  // 백엔드는 한 번에 한 문제를 만드므로 toMake 번 부른다.
  // 한 문제가 만들어질 때마다 바로 보여주고, 다음 문제는 그 아래에서 이어서 만든다.
  const firstNote =
    quiz.items.length > 0 ? "문제를 더 만드는 중이에요..." : "대화를 바탕으로 문제를 만드는 중이에요...";
  showQuiz(quiz, firstNote);

  let notice = "";
  for (let made = 0; made < toMake; made += 1) {
    if (made > 0) {
      document.querySelectorAll(".q-card")[quiz.items.length - 1]?.insertAdjacentHTML(
        "afterend",
        infoCard("다음 문제를 만드는 중이에요..."),
      );
    }

    const result = await addOneQuizItem(session, quiz, history, made === 0 && quiz.items.length > 0);
    if (result.notice) notice = result.notice;

    // 시험지가 비어 있는데 대화에 낼 만한 내용이 없으면, 채팅으로 돌려보내서 더 설명하게 한다.
    // (chat.js 가 ?notice=need-more 를 보고 "아직 문제를 만들 수 없어요…" 알림을 띄운다)
    if (result.empty && quiz.items.length === 0) {
      const params = new URLSearchParams({ session: session.id, notice: "need-more" });
      window.location.replace(`./chat.html?${params}`);
      return;
    }

    // 실패하거나 낼 내용이 없으면 거기서 멈춘다. 이미 만든 문제는 화면과 DB 에 그대로 남는다.
    if (!result.ok) {
      setNote(result.error);
      return;
    }
  }

  // 마지막 수단 모델로 만든 문제가 있었으면 맨 아래에 안내 카드를 붙인다. (저장하지 않으므로 다시 들어오면 사라진다)
  if (notice) {
    const cards = document.querySelectorAll(".q-card");
    cards[cards.length - 1]?.insertAdjacentHTML("afterend", infoCard(notice));
  }
}

/**
 * 문제를 하나 만들어 DB 에 저장하고, 안내 카드 자리에 그린다. scroll 이면 새 문제 쪽으로 화면을 내린다.
 * 돌려주는 것: {ok: true, notice?} | {ok: false, error, empty?}
 *   empty 는 대화에서 문제로 낼 만한 내용을 찾지 못했을 때 true 다.
 *   notice 는 백엔드가 마지막 수단 모델로 만들었을 때의 "오늘 사용량이 많아서…" 안내다.
 */
async function addOneQuizItem(session, quiz, history, scroll) {
  // 이미 낸 문제를 같이 보내서, 겹치지 않는 새 문제를 받는다.
  // 문제 유형(빈칸 주관식 / 객관식)은 정해서 보내지 않는다. 백엔드의 Gemini 가 대화 내용에 더 맞는 쪽을 고른다.
  const result = await generateQuiz(history, quiz.items.map((item) => item.question));

  // 실패해도 예전 문제는 화면에 그대로 남는다. 저장도 바꾸지 않으므로 다음에 다시 시도된다.
  if (!result.ok) {
    return { ok: false, error: result.error || "문제를 만들지 못했어요. 다시 시도해주세요." };
  }

  const newItems = result.items ?? [];
  if (newItems.length === 0) {
    const error = "대화에서 문제를 만들 만한 내용을 더 찾지 못했어요.";
    return { ok: false, empty: true, error: result.notice ? `${error} ${result.notice}` : error };
  }

  // 새 문제를 DB 에 저장한다. 실패하면 문제를 보여주지 않는다.
  // (저장된 문제가 아니면 답도 저장할 수 없으므로. 다음에 들어오면 다시 만든다)
  let savedItems;
  try {
    savedItems = await store.addQuizItems(session.id, newItems, history.length);
  } catch (err) {
    return { ok: false, error: `문제를 저장하지 못했어요. 잠시 후 다시 들어와 주세요. (${err.message})` };
  }

  // 예전 문제는 그대로 두고 뒤에 추가만 한다.
  const before = quiz.items.length;
  quiz.items.push(...savedItems);
  quiz.messageCount = history.length;
  appendNewCards(quiz, before, scroll);
  return { ok: true, notice: result.notice };
}

document.addEventListener("DOMContentLoaded", loadQuiz);
