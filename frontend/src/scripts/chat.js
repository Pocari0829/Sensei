// ─────────────────────────────────────────────
// chat.html 전용 스크립트.
// 예전에는 chat.html(학습 시작) → conversation.html(대화) → teaching.html(가르치는 중)
// 세 개의 "정적" 페이지를 하드코딩된 말풍선과 함께 오가는 구조였다.
// 지금은 이 페이지 하나에서, 실제로 보낸 메시지에 맞춰 말풍선을 그때그때 그리고
// 백엔드(/ask-haku)를 호출해 하쿠의 대답을 실시간으로 붙인다.
// ─────────────────────────────────────────────

import * as store from "./store.js";
import { askHaku } from "./api.js";

const phoneEl = document.querySelector(".phone");
const dragHint = document.getElementById("drag-hint");
const idleHeader = document.getElementById("idle-header");
const topicHeader = document.getElementById("topic-header");
const topicNameEl = document.getElementById("topic-name");
const emptyState = document.getElementById("empty-state");
const messageList = document.getElementById("message-list");
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

function typingRow() {
  return `
    <div class="bubble-row" id="typing-row">
      <img class="avatar" src="../../public/mascot.png" alt="" />
      <div class="bubble bubble--sensei typing-dots" aria-label="하쿠가 생각하는 중">
        <span></span><span></span><span></span>
      </div>
    </div>`;
}

function systemAlert(text) {
  return `
    <div class="system">
      <p class="system__title">시스템 알림</p>
      <p class="system__text">${escapeHtml(text)}</p>
    </div>`;
}

/** 현재 세션 상태(activeSession)에 맞춰 화면 전체를 다시 그린다. */
function render() {
  const hasMessages = Boolean(activeSession && activeSession.messages.length > 0);

  // 대화가 시작되면 conversation.html 이 쓰던 톤(연보라 배경)으로,
  // 아직 시작 전이면 chat.html 이 쓰던 흰 배경으로 — 기존 두 디자인을 상태로 재현한다.
  phoneEl.classList.toggle("phone--tinted", hasMessages);

  dragHint.hidden = !hasMessages;
  idleHeader.hidden = hasMessages;
  topicHeader.hidden = !hasMessages;
  emptyState.hidden = hasMessages;
  messageList.hidden = !hasMessages;
  quickActions.hidden = !hasMessages;

  if (!hasMessages) return;

  topicNameEl.textContent = activeSession.topic || "학습 중";
  messageList.innerHTML =
    `<p class="day-divider">오늘</p>` +
    activeSession.messages
      .map((m) => (m.role === "user" ? bubbleRowUser(m.text) : bubbleRowSensei(m.text)))
      .join("");
  messageList.scrollTop = messageList.scrollHeight;
}

function setSending(sending) {
  isSending = sending;
  composerInput.disabled = sending;
  sendBtn.disabled = sending;
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if (!text || isSending) return;

  if (!activeSession) {
    activeSession = store.createSession();
    store.setActiveSessionId(activeSession.id);
  }

  // 하쿠에게는 "이번 메시지 이전까지"의 대화만 history로 넘긴다.
  const historyBeforeThisTurn = activeSession.messages.map((m) => ({
    role: m.role,
    text: m.text,
  }));

  setSending(true);
  composerInput.value = "";

  store.addMessage(activeSession, "user", text);
  render();

  messageList.insertAdjacentHTML("beforeend", typingRow());
  messageList.scrollTop = messageList.scrollHeight;

  const result = await askHaku(text, historyBeforeThisTurn);

  document.getElementById("typing-row")?.remove();

  if (result.ok) {
    store.addMessage(activeSession, "sensei", result.question);
    render();
  } else {
    messageList.insertAdjacentHTML(
      "beforeend",
      systemAlert(result.error || "답변을 가져오지 못했어요. 다시 시도해주세요."),
    );
    messageList.scrollTop = messageList.scrollHeight;
  }

  setSending(false);
  composerInput.focus();
}

composerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(composerInput.value);
});

newTopicBtn.addEventListener("click", () => {
  activeSession = store.createSession();
  render();
  composerInput.focus();
});

easierBtn.addEventListener("click", () => sendMessage("방금 질문을 더 쉽게 다시 물어봐줄래?"));
dontKnowBtn.addEventListener("click", () => sendMessage("음... 모르겠어. 힌트를 줄 수 있어?"));

quizBtn.addEventListener("click", () => {
  const topic = activeSession?.topic ?? "";
  const query = topic ? `?topic=${encodeURIComponent(topic)}` : "";
  window.location.href = `./quiz.html${query}`;
});

function init() {
  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get("session");

  // 1) 학습 기록에서 특정 세션을 눌러 들어온 경우
  if (requestedId) {
    activeSession = store.getSession(requestedId);
  }

  // 2) 그게 아니면, 마지막으로 보던 진행 중 세션을 이어서 연다.
  if (!activeSession) {
    const activeId = store.getActiveSessionId();
    activeSession = activeId ? store.getSession(activeId) : null;
  }

  if (activeSession) {
    store.setActiveSessionId(activeSession.id);
  }

  render();
  composerInput.focus();
}

document.addEventListener("DOMContentLoaded", init);
