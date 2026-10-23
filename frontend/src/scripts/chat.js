// ─────────────────────────────────────────────
// chat.html 전용 스크립트.
// 예전에는 chat.html(학습 시작) → conversation.html(대화) → teaching.html(가르치는 중)
// 세 개의 "정적" 페이지를 하드코딩된 말풍선과 함께 오가는 구조였다.
// 지금은 이 페이지 하나에서, 실제로 보낸 메시지에 맞춰 말풍선을 그때그때 그리고
// 백엔드(/ask-haku)를 호출해 하쿠의 대답을 실시간으로 붙인다.
// 대화는 store.js 를 통해 DB(sessions)에 저장한다.
// ─────────────────────────────────────────────

import * as store from "./store.js";
import { askHaku, judgeLevel } from "./api.js";
import { applyAnswerLevel, getNickname, lowerLevel } from "./user.js";
import { NICKNAME_PAGE } from "./auth.js";

const phoneEl = document.querySelector(".phone");
const dragHint = document.getElementById("drag-hint");
const dragHintText = document.getElementById("drag-hint-text");
const topicHeader = document.getElementById("topic-header");
const topicNameEl = document.getElementById("topic-name");
const topicDisplay = document.getElementById("topic-display");
const topicEditWrap = document.getElementById("topic-edit");
const topicActions = document.getElementById("topic-actions");
const topicInput = document.getElementById("topic-input");
const editTopicBtn = document.getElementById("edit-topic-btn");
const topicSaveBtn = document.getElementById("topic-save-btn");
const stage = document.getElementById("stage");
const stageBubble = document.getElementById("stage-bubble");
const stageFeedback = document.getElementById("stage-feedback");
const messageList = document.getElementById("message-list");
const alertBanner = document.getElementById("alert-banner");
const quickActions = document.getElementById("quick-actions");
const composerForm = document.getElementById("composer");
const composerInput = document.getElementById("composer-input");
const sendBtn = document.getElementById("send-btn");
const newTopicBtn = document.getElementById("new-topic-btn");
const easierBtn = document.getElementById("easier-btn");
const dontKnowBtn = document.getElementById("dontknow-btn");
const quizBtn = document.getElementById("quiz-btn");

let activeSession = null;
let isSending = false;

// 캐릭터 화면("character", 기본값) ↔ 전체 대화 목록("list"). 대화 중에만 "list"로 바뀔 수 있고,
// 손잡이(#drag-hint)를 드래그/탭하면 바뀐다. 메시지를 보내면 항상 "character"로 돌아온다.
let view = "character";

// [더 쉽게] / [모르겠어] 버튼이 보내는 말. 사용자가 직접 한 설명이 아니므로 설명 횟수에서 뺀다.
const EASIER_MESSAGE = "방금 질문을 더 쉽게 다시 물어봐줄래?";
const DONT_KNOW_MESSAGE = "음... 모르겠어. 힌트를 줄 수 있어?";

// 직접 설명을 이만큼 해야 [퀴즈 풀기] 를 누를 수 있다. (기획서 예상 문제점 ③: 설명이 거의 없으면 낼 문제가 없다)
const MIN_EXPLANATIONS_FOR_QUIZ = 3;

/** 세션에서 사용자가 직접 한 설명의 수. 버튼으로 보낸 말은 세지 않는다. */
function countExplanations(session) {
  return (session?.messages ?? []).filter(
    (m) => m.role === "user" && m.text !== EASIER_MESSAGE && m.text !== DONT_KNOW_MESSAGE,
  ).length;
}

/** 설명 횟수에 맞춰 [퀴즈 풀기] 를 켜고 끈다. 모자라면 버튼에 "퀴즈 풀기 1/3" 처럼 진행 정도를 보여준다. */
function updateQuizBtn() {
  const count = countExplanations(activeSession);
  const ready = count >= MIN_EXPLANATIONS_FOR_QUIZ;
  quizBtn.disabled = !ready;
  quizBtn.textContent = ready ? "퀴즈 풀기" : `퀴즈 풀기 ${count}/${MIN_EXPLANATIONS_FOR_QUIZ}`;
  quizBtn.title = ready ? "" : `하쿠에게 ${MIN_EXPLANATIONS_FOR_QUIZ}번 이상 설명하면 퀴즈를 풀 수 있어요.`;
}

// 하쿠가 부르는 이름. DB(users.nickname)에서 불러오고, 하쿠에게 질문할 때 같이 보낸다.
let nickname = null;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function bubbleRowUser(text) {
  return `
    <div class="bubble-row bubble-row--user">
      <div class="bubble bubble--user">${escapeHtml(text)}</div>
    </div>`;
}

function bubbleRowSensei(text) {
  return `
    <div class="bubble-row">
      <img class="avatar" src="../../public/mascot.png" alt="" />
      <div class="bubble bubble--sensei">${escapeHtml(text)}</div>
    </div>`;
}

function systemAlert(text) {
  return `
    <div class="system">
      <p class="system__title">시스템 알림</p>
      <p class="system__text">${escapeHtml(text)}</p>
    </div>`;
}

/** 정오 판별에서 틀렸을 때의 알림 박스. 하쿠 말풍선, 보통 시스템 알림(보라)과 구분되게 빨간색이다. */
function wrongAlert(text) {
  return `
    <div class="system system--wrong" aria-label="정오 판별">
      <p class="system__title">시스템 알림</p>
      <p class="system__text">${escapeHtml(text)}</p>
    </div>`;
}

/**
 * 저장된 메시지 하나를 화면에 그린다.
 *   user   → 사용자 말풍선
 *   system → 정오 판별 알림 (어디가 틀렸는지 짚는 빨간 박스)
 *   check  → 예전 방식의 정오 판별 알림 ("틀렸어요." 만 저장된 대화). system 과 똑같이 그린다.
 *   sensei → 하쿠 말풍선
 */
function renderMessage(m) {
  if (m.role === "user") return bubbleRowUser(m.text);
  if (m.role === "system" || m.role === "check") return wrongAlert(m.text);
  return bubbleRowSensei(m.text);
}

/**
 * 저장 실패 등 시스템 알림을 띄운다. 캐릭터 화면/대화 목록 어느 쪽을 보고 있어도(심지어 세션이
 * 아직 없어도) 입력창 바로 위 고정된 자리(#alert-banner)에 뜬다 — 화면을 강제로 바꾸지 않는다.
 */
function showAlert(text) {
  alertBanner.hidden = false;
  alertBanner.innerHTML = systemAlert(text);
}

function hideAlert() {
  alertBanner.hidden = true;
  alertBanner.innerHTML = "";
}

/** 지금 보는 세션을 주소(?session=)에 남긴다. 새로고침하거나 퀴즈에서 돌아와도 같은 세션이 열린다. */
function showSessionInUrl(id) {
  window.history.replaceState(null, "", `?session=${encodeURIComponent(id)}`);
}

/**
 * 캐릭터 화면(#stage)에 보여줄 말풍선 하나를 정한다.
 * 목록(#message-list)과 달리 캐릭터 화면은 항상 "지금 하쿠가 하고 있는 말" 한 줄만 보여준다.
 *   - 대화 전: 인사말 "안녕!"
 *   - 그 밖: 가장 최근 하쿠의 말. 그 턴에 정오 판별에서 틀렸으면(system / 예전 check) 말풍선 위에 빨간 알림도 띄운다.
 *   - 마지막이 사용자 말(하쿠 답을 기다리는 중): 그 직전 하쿠 말을 그대로 유지해서 보여준다
 *     (답이 오면 render()가 다시 불려서 새 말로 바뀐다)
 */
function renderStage(messages) {
  stageBubble.classList.remove("is-typing");
  stageBubble.removeAttribute("aria-label");
  stageFeedback.hidden = true;
  stageFeedback.innerHTML = "";

  if (messages.length === 0) {
    stageBubble.className = "chat-greeting";
    stageBubble.textContent = "안녕!";
    return;
  }

  // 마지막 사용자 말 앞뒤로 끊어서, 가장 최근 턴의 하쿠 쪽 메시지(알림 + 하쿠 말)만 모은다.
  const waiting = messages[messages.length - 1].role === "user";
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role === "user") i -= 1;
  const turn = [];
  while (i >= 0 && messages[i].role !== "user") {
    turn.unshift(messages[i]);
    i -= 1;
  }

  const feedback = turn.find((m) => m.role === "system" || m.role === "check");
  if (feedback && !waiting) {
    stageFeedback.innerHTML = wrongAlert(feedback.text);
    stageFeedback.hidden = false;
  }

  stageBubble.className = "chat-greeting chat-greeting--talk";
  // 아직 하쿠가 한 마디도 안 한 상태(첫 메시지를 막 보낸 직후) — 기다리는 느낌만 준다.
  stageBubble.textContent = turn.findLast((m) => m.role === "sensei")?.text ?? "음...";
}

/** 현재 세션 상태(activeSession)와 화면 모드(view)에 맞춰 화면 전체를 다시 그린다. */
function render() {
  const messages = activeSession?.messages ?? [];
  const hasMessages = messages.length > 0;

  // 대화가 없으면(세션 자체가 없으면) 목록을 볼 수 없다 — 항상 캐릭터 화면으로.
  if (!hasMessages) view = "character";

  const showList = hasMessages && view === "list";

  // 전체 대화 목록을 보고 있을 때만 연한 배경으로, 캐릭터와 대화하는 중(기본 화면)에는 흰 배경을 유지한다.
  phoneEl.classList.toggle("phone--tinted", showList);

  dragHint.hidden = !hasMessages;
  if (dragHintText) {
    dragHintText.textContent =
      view === "list" ? "아래로 내려서 하쿠에게 돌아가기" : "위로 올려서 전체 대화 보기";
  }
  // 손잡이 자리: 하쿠 화면에서는 하쿠 바로 아래(#stage 맨 끝, 아래에서 위로 끌어올리는 느낌),
  // 목록에서는 목록 맨 위(끌어올린 목록의 윗변을 잡고 내리는 느낌).
  dragHint.classList.toggle("drag-hint--list", showList);
  // (이미 그 자리면 옮기지 않는다 — 옮기면 화살표 애니메이션이 메시지마다 다시 돈다)
  if (showList && dragHint.nextElementSibling !== messageList) messageList.before(dragHint);
  if (!showList && stage.lastElementChild !== dragHint) stage.append(dragHint);
  // 대화 중 하쿠 화면은 화면 전체가 "위로 쓸어 올리기" 영역이다 (아래 stage 의 pointer 이벤트).
  stage.classList.toggle("stage--swipeable", hasMessages);

  topicHeader.hidden = !hasMessages;
  stage.hidden = showList;
  messageList.hidden = !showList;
  quickActions.hidden = !hasMessages;
  updateQuizBtn();

  renderStage(messages);

  if (!hasMessages) return;

  topicNameEl.textContent = activeSession.topic || "학습 중";
  if (showList) {
    messageList.innerHTML =
      `<p class="day-divider">오늘</p>` +
      messages.map(renderMessage).join("");
    messageList.scrollTop = messageList.scrollHeight;
  }
}

/** view를 바꾸고 다시 그린다. 대화가 없으면(세션이 없으면) "list"로 못 간다 (render()가 되돌린다). */
function setView(next) {
  if (view === next) return;
  view = next;
  render();
}

// ─────────────────────────────────────────────
// 손잡이(#drag-hint) 드래그/탭으로 캐릭터 화면 ↔ 전체 대화 목록을 전환한다.
// 위로 드래그 = 목록 보기, 아래로 드래그 = 캐릭터 화면으로 돌아가기.
// 많이 움직이지 않고 눌렀다 뗀 정도(탭)는 지금 화면의 반대쪽으로 그냥 토글한다
// (마우스로 드래그하기 번거로운 데스크톱에서도 쓸 수 있게).
// ─────────────────────────────────────────────
const DRAG_THRESHOLD = 32; // 이만큼(px) 움직여야 "드래그"로 친다
const TAP_THRESHOLD = 8; // 이보다 적게 움직이면 "탭"으로 친다

let dragStartY = null;

dragHint.addEventListener("pointerdown", (e) => {
  dragStartY = e.clientY;
  // 손잡이는 세로 50px 정도라서, 조금만 길게 드래그해도 손가락/마우스가
  // 손잡이 영역 밖으로 빠져나간다. pointer capture를 걸어두면 이후
  // pointermove/pointerup이 실제 위치와 무관하게 이 요소로 계속 전달된다.
  dragHint.setPointerCapture?.(e.pointerId);
});

dragHint.addEventListener("pointerup", (e) => {
  if (dragStartY === null) return;
  const delta = e.clientY - dragStartY;
  dragStartY = null;
  dragHint.releasePointerCapture?.(e.pointerId);

  if (Math.abs(delta) < TAP_THRESHOLD) {
    setView(view === "list" ? "character" : "list");
  } else if (delta < -DRAG_THRESHOLD) {
    setView("list");
  } else if (delta > DRAG_THRESHOLD) {
    setView("character");
  }
});

dragHint.addEventListener("pointercancel", () => {
  dragStartY = null;
});

// 키보드로도 쓸 수 있게: 손잡이에 포커스를 두고 Enter/Space = 탭과 같다.
dragHint.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  setView(view === "list" ? "character" : "list");
});

// 손잡이를 정확히 잡지 않아도 되게, 대화 중에는 하쿠 화면(#stage) 아무 데서나 위로 쓸어 올리면 목록이 열린다.
// 여기서는 탭은 무시한다 (말풍선이나 하쿠를 그냥 눌렀다고 화면이 바뀌면 안 되니까).
let stageSwipeStartY = null;

stage.addEventListener("pointerdown", (e) => {
  if (!stage.classList.contains("stage--swipeable")) return;
  // 손잡이는 #stage 안에 있지만 자기 이벤트(탭 토글 포함)를 따로 처리한다.
  // 여기서 pointer capture 를 또 걸면 손잡이의 pointerup 이 #stage 로 가버려서 탭이 안 먹는다.
  if (dragHint.contains(e.target)) return;
  stageSwipeStartY = e.clientY;
  stage.setPointerCapture?.(e.pointerId);
});

stage.addEventListener("pointerup", (e) => {
  if (stageSwipeStartY === null) return;
  const delta = e.clientY - stageSwipeStartY;
  stageSwipeStartY = null;
  stage.releasePointerCapture?.(e.pointerId);
  if (delta < -DRAG_THRESHOLD) setView("list");
});

stage.addEventListener("pointercancel", () => {
  stageSwipeStartY = null;
});

function setSending(sending) {
  isSending = sending;
  composerInput.disabled = sending;
  sendBtn.disabled = sending;
}

// ─────────────────────────────────────────────
// 타이핑 효과: 하쿠의 대사를 한 글자씩 찍어 보여준다.
// render() 가 말풍선을 통째로 다시 그린 "직후"에 호출해서,
// 마지막 하쿠 말풍선의 글자만 지웠다가 하나씩 되채운다.
// (store 에는 이미 전체 문장이 들어있으므로 내용이 사라질 걱정은 없다)
// ─────────────────────────────────────────────

// 한 글자가 찍히는 간격(ms). 키우면 느려진다.
// 15 = 빠름,  28 = 지금,  50 = 느긋함
const TYPING_SPEED = 28;

let typingTimer = null;

/** 글자를 하나씩 el 에 채워 넣는다. el.textContent 에 이미 들어있는 완성된 문장을 대상으로 한다. */
function typeElementText(el, onTick) {
  if (!el) return;

  // 한글은 한 글자가 한 칸이지만 이모지는 두 칸을 차지한다.
  // Array.from 을 쓰면 이모지도 깨지지 않고 한 글자로 센다.
  const chars = Array.from(el.textContent);

  el.textContent = "";
  el.classList.add("is-typing");

  // 이전 타이핑이 돌고 있었다면 멈춘다 (연속 전송 대비).
  clearInterval(typingTimer);

  let i = 0;
  typingTimer = setInterval(() => {
    el.textContent += chars[i];
    i += 1;
    onTick?.();

    if (i >= chars.length) {
      clearInterval(typingTimer);
      el.classList.remove("is-typing");
    }
  }, TYPING_SPEED);
}

/** 전체 대화 목록에서 마지막 하쿠 말풍선을 타이핑 효과로 보여준다. (view === "list" 일 때) */
function typeLastSenseiBubbleInList() {
  const bubbles = messageList.querySelectorAll(".bubble--sensei");
  typeElementText(bubbles[bubbles.length - 1], () => {
    // 글자가 늘어나 말풍선이 길어지므로 따라 내려간다.
    // 단, 맨 아래를 보고 있을 때만. 위로 올려 이전 대화를 보는 중이면 끌어내리지 않는다.
    const nearBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 40;
    if (nearBottom) messageList.scrollTop = messageList.scrollHeight;
  });
}

/** 캐릭터 화면(#stage-bubble)의 말을 타이핑 효과로 보여준다. (기본 화면, view === "character" 일 때) */
function typeStageBubble() {
  typeElementText(stageBubble);
}

/** 하쿠의 대답을 기다리는 동안 캐릭터 화면에 "..." 점 세 개를 보여준다. */
function showStageTyping() {
  stageBubble.classList.remove("is-typing");
  stageBubble.className = "chat-greeting typing-dots";
  stageBubble.setAttribute("aria-label", "하쿠가 생각하는 중");
  stageBubble.innerHTML = "<span></span><span></span><span></span>";
}

/**
 * 메시지를 보낸다.
 * skipLevel: 버튼이 보내는 정해진 말("더 쉽게", "모르겠어")처럼 사용자의 설명이 아니면 true. 수준 판단을 하지 않는다.
 */
async function sendMessage(rawText, { skipLevel = false } = {}) {
  const text = rawText.trim();
  if (!text || isSending) return;

  // 메시지를 보내면 항상 캐릭터 화면으로 돌아온다 — 대화 목록을 보고 있었더라도,
  // 지금 막 주고받는 말은 캐릭터와 실시간으로 대화하는 느낌으로 보여주기 위해서다.
  view = "character";
  hideAlert();

  setSending(true);
  composerInput.value = "";

  // 저장에 실패하면 보낸 말을 입력칸에 되돌려 놓고 멈춘다.
  const stopWithAlert = (message) => {
    composerInput.value = text;
    showAlert(message);
    setSending(false);
    composerInput.focus();
  };

  // 첫 메시지면 이때 DB 에 세션을 만든다.
  if (!activeSession) {
    try {
      activeSession = await store.createSession();
    } catch (err) {
      stopWithAlert(`대화를 시작하지 못했어요. 다시 보내주세요. (${err.message})`);
      return;
    }
    showSessionInUrl(activeSession.id);
  }

  // 하쿠의 대답을 기다리는 사이에 "새 주제" 를 눌러도, 대답은 원래 세션에 붙도록 붙잡아 둔다.
  const session = activeSession;

  // 하쿠에게는 "이번 메시지 이전까지"의 대화만 history로 넘긴다.
  const historyBeforeThisTurn = session.messages.map((m) => ({
    role: m.role,
    text: m.text,
  }));

  try {
    await store.addMessage(session, "user", text);
  } catch (err) {
    session.messages.pop();
    stopWithAlert(`메시지를 저장하지 못했어요. 다시 보내주세요. (${err.message})`);
    return;
  }
  render();

  // 방금 한 설명이 어느 수준인지도 판단받는다. 하쿠의 대답과 따로 돌고, 기다리지 않는다.
  if (!skipLevel) {
    recordAnswerLevel(session, text, lastHakuText(historyBeforeThisTurn));
  }

  showStageTyping();

  const result = await askHaku(text, historyBeforeThisTurn, nickname);

  // 응답을 받자마자 일단 캐릭터 화면을 "..." 가 아닌 평소 모습으로 되돌려 둔다.
  // (성공하면 바로 아래에서 새 말로 다시 그린다. 실패해도 "..." 가 그대로 남지 않는다)
  render();

  if (result.ok) {
    // 정오 판별에서 틀렸으면, 하쿠의 대답 앞에 "시스템 알림" 을 끼워 넣는다. (사용자 말 → 알림 → 하쿠 순서)
    // 아래 addMessage 가 대화 전체를 저장하므로 여기서는 붙이기만 한다.
    // 하쿠에게 보내는 대화 기록에서는 백엔드가 이 알림을 뺀다. (하쿠는 판정을 모른다)
    const isWrong = result.is_correct === false;
    if (isWrong) {
      session.messages.push({ role: "system", text: result.feedback, ts: Date.now() });
    }

    let saveError = null;
    try {
      await store.addMessage(session, "sensei", result.question);
    } catch (err) {
      saveError = err;
    }

    if (session === activeSession) {
      render();
      if (view === "list") typeLastSenseiBubbleInList();
      else typeStageBubble();
      if (saveError) {
        showAlert(`방금 대답을 저장하지 못했어요. 다음 메시지를 보낼 때 같이 저장돼요. (${saveError.message})`);
      }
    }

    // 정오 판별에서 틀렸으면 DB 에도 따로 기록해 둔다. (system_corrections, gap_records)
    if (isWrong) {
      recordWrongAnswer(session, text, result.feedback);
    }
  } else {
    showAlert(result.error || "답변을 가져오지 못했어요. 다시 시도해주세요.");
  }

  setSending(false);
  composerInput.focus();
}

/**
 * 정오 판별에서 틀렸을 때: 틀린 설명과 피드백(system_corrections),
 * 모르는 개념(gap_records, 개념 이름 = 세션 주제)을 기록한다. 실패해도 대화는 계속한다.
 */
function recordWrongAnswer(session, text, feedback) {
  store
    .addCorrection(session.id, text, feedback)
    .catch((err) => console.warn("틀린 설명을 저장하지 못했어요:", err));

  if (session.topic) {
    store
      .recordGap(session.topic, "wrong")
      .catch((err) => console.warn("모르는 개념을 저장하지 못했어요:", err));
  }
}

/** 대화에서 하쿠가 마지막으로 한 말. 설명의 수준을 판단할 때 무엇에 대한 대답인지 같이 보낸다. 없으면 빈 문자열. */
function lastHakuText(messages) {
  return messages.findLast((m) => m.role === "sensei")?.text ?? "";
}

/**
 * 방금 한 설명이 어느 학교급 수준(레벨 1~5)인지 백엔드(/judge-level)에 판단받아서
 * answer_levels 에 기록하고, 내 수준(users.level_score / level_current)을 그쪽으로 조금 움직인다.
 * 질문, "모르겠어", 한 단어로 답하는 질문의 답("무슨 색이야?" → "초록색")은 백엔드가 설명이 아니라고 알려주므로 기록하지 않는다.
 * 실패해도 대화는 계속한다. (화면에는 영향 없음)
 */
function recordAnswerLevel(session, text, question) {
  judgeLevel(text, question)
    .then(async (result) => {
      if (!result.ok) throw new Error(result.error);
      if (!result.is_explanation) return;
      await store.addAnswerLevel(session.id, text, result.level, result.reason);
      await applyAnswerLevel(result.level);
    })
    .catch((err) => console.warn("설명의 수준을 기록하지 못했어요:", err));
}

composerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(composerInput.value);
});

newTopicBtn.addEventListener("click", () => {
  // 새 세션은 첫 메시지를 보낼 때 DB 에 만든다. 그 전까지는 빈 화면이다.
  activeSession = null;
  // 새로고침해도 빈 화면이 유지되게 주소에 표시한다. (?new 가 없으면 최근 세션이 열린다)
  window.history.replaceState(null, "", "?new");
  render();
  composerInput.focus();
});

// ─────────────────────────────────────────────
// 주제 이름 수정: 자동으로 붙은 이름(deriveTopic)이 마음에 안 들면
// 연필 버튼을 눌러 학습자가 직접 바꿀 수 있다.
// ─────────────────────────────────────────────
function enterTopicEdit() {
  if (!activeSession) return;
  topicInput.value = activeSession.topic || "";
  topicDisplay.hidden = true;
  topicActions.hidden = true;
  topicEditWrap.hidden = false;
  topicInput.focus();
  topicInput.select();
}

function exitTopicEdit() {
  topicDisplay.hidden = false;
  topicActions.hidden = false;
  topicEditWrap.hidden = true;
}

function saveTopic() {
  if (activeSession) {
    const value = topicInput.value.trim();
    activeSession.topic = value || activeSession.topic || "학습 중";
    topicNameEl.textContent = activeSession.topic;
    store
      .saveSession(activeSession)
      .catch((err) => showAlert(`주제 이름을 저장하지 못했어요. (${err.message})`));
  }
  exitTopicEdit();
}

editTopicBtn.addEventListener("click", enterTopicEdit);
topicSaveBtn.addEventListener("click", saveTopic);
topicInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveTopic();
  }
  if (e.key === "Escape") {
    exitTopicEdit();
  }
});

easierBtn.addEventListener("click", () => {
  if (isSending) return;
  // "더 쉽게" 를 눌렀다 = 이 주제를 어려워한다. 모르는 개념(개념 이름 = 세션 주제)에 기록한다.
  if (activeSession?.topic) {
    store
      .recordGap(activeSession.topic, "easy")
      .catch((err) => console.warn("모르는 개념을 저장하지 못했어요:", err));
  }
  // 내 수준(users.level_current)도 한 단계 내린다. 저장을 기다리지 않고 바로 하쿠에게 보낸다.
  lowerLevel().catch((err) => console.warn("수준을 낮추지 못했어요:", err));
  sendMessage(EASIER_MESSAGE, { skipLevel: true });
});
dontKnowBtn.addEventListener("click", () => sendMessage(DONT_KNOW_MESSAGE, { skipLevel: true }));

quizBtn.addEventListener("click", () => {
  if (!activeSession || countExplanations(activeSession) < MIN_EXPLANATIONS_FOR_QUIZ) return;
  // 퀴즈 화면이 어느 세션으로 문제를 낼지 알 수 있게 세션 id 를 같이 넘긴다.
  const params = new URLSearchParams({ session: activeSession.id });
  if (activeSession.topic) params.set("topic", activeSession.topic);
  window.location.href = `./quiz.html?${params}`;
});

// ─────────────────────────────────────────────
// 닉네임: 아직 정하지 않았으면 이름 정하기 화면(nickname.html)에서 먼저 정하고 온다.
// 하쿠에게 질문할 때 같이 보내서 하쿠가 그 이름으로 부르게 한다 (app.py 의 ask_haku).
// 빈 화면 인사말은 시안 문구 그대로 "안녕!" 고정이라 여기서는 쓰지 않는다.
// ─────────────────────────────────────────────

/** 닉네임을 불러온다. 아직 없으면 이름 정하기 화면으로 보내고 true 를 돌려준다. */
async function loadNickname() {
  try {
    nickname = await getNickname();
  } catch (err) {
    // 못 불러와도 채팅은 할 수 있어야 하므로, 닉네임 없이 그냥 진행한다.
    console.warn("닉네임을 불러오지 못했어요:", err);
    return false;
  }

  if (!nickname) {
    window.location.replace(NICKNAME_PAGE);
    return true;
  }
  return false;
}

/**
 * 어떤 세션을 열지 정한다.
 *   ?session=<id>  학습 기록에서 눌렀거나, 보던 세션에서 새로고침한 경우 → 그 세션
 *   ?new           "새 주제" 를 누른 경우 → 빈 화면 (첫 메시지를 보낼 때 세션을 만든다)
 *   아무것도 없음   하단 탭으로 들어온 경우 → 가장 최근에 대화한 세션
 */
async function loadSession() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("new")) return;

  try {
    const requestedId = params.get("session");
    activeSession = requestedId ? await store.getSession(requestedId) : await store.getLatestSession();
  } catch (err) {
    showAlert(`대화를 불러오지 못했어요. 새로고침해 주세요. (${err.message})`);
    return;
  }

  if (activeSession) showSessionInUrl(activeSession.id);
  render();
}

// 퀴즈 화면이 "낼 문제가 없다" 며 돌려보낼 때 주소에 붙이는 값 (quiz.js) 과 그때 띄울 알림.
const QUIZ_NOTICES = {
  "need-more": "아직 문제를 만들 수 없어요. 조금만 더 하쿠와 대화해 주세요.",
};

async function init() {
  // 주소의 ?notice= 는 세션을 불러오면서 주소가 바뀌기 전에 먼저 읽어 둔다.
  const quizNotice = QUIZ_NOTICES[new URLSearchParams(window.location.search).get("notice")];
  render();

  // 불러오는 동안 입력을 막는다.
  setSending(true);
  try {
    // 닉네임이 없으면 이름 정하기 화면으로 넘어가므로 세션은 불러오지 않는다.
    const leaving = await loadNickname();
    if (!leaving) await loadSession();
  } finally {
    setSending(false);
    composerInput.focus();
  }

  // 알림은 저장하지 않는다. loadSession() 이 주소를 ?session= 만 남기고 바꾸므로 새로고침하면 다시 뜨지 않는다.
  if (quizNotice) showAlert(quizNotice);
}

document.addEventListener("DOMContentLoaded", init);
