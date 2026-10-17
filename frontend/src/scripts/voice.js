// ─────────────────────────────────────────────
// 말로 보내기 전용 모듈.
// chat.js 가 setupVoiceInput(...) 을 한 번 불러서 채팅 화면에 연결한다.
//
// 브라우저에 들어 있는 음성 인식(Web Speech API)을 쓴다. Gemini 를 부르지 않으므로 무료이고 한도도 쓰지 않는다.
// Chrome·Edge 에서 동작한다. (Chrome 은 소리를 Google 서버로 보내 받아쓰므로 인터넷 연결이 필요하다)
//
// 마이크 버튼을 누르고 말하면 입력창에 글자가 바로바로 채워지고,
// 한 번 더 누르면 입력창에 적힌 그대로 하쿠에게 전송된다.
// 글로 보낼 때와 같은 sendMessage 를 쓰므로 정오 판별 → 하쿠 흐름도 똑같다.
// ─────────────────────────────────────────────

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/** 이 브라우저에서 음성 인식을 쓸 수 있는지. */
export const canListen = Boolean(SpeechRecognition);

// 한 번에 들을 수 있는 최대 시간(ms). 넘으면 알아서 멈추고 보낸다.
const MAX_LISTEN_MS = 60_000;

// 음성 인식이 알려주는 오류 → 사용자에게 보여줄 문구. [긴 글(시스템 알림용), 짧은 글(입력창용)]
const ERROR_MESSAGES = {
  "not-allowed": ["마이크를 쓸 수 없어요. 브라우저 주소창 옆에서 마이크 사용을 허용해 주세요.", "마이크 사용을 허용해 주세요."],
  "service-not-allowed": ["마이크를 쓸 수 없어요. 브라우저 주소창 옆에서 마이크 사용을 허용해 주세요.", "마이크 사용을 허용해 주세요."],
  "audio-capture": ["마이크를 찾지 못했어요. 마이크가 연결돼 있는지 확인해 주세요.", "마이크를 찾지 못했어요."],
  network: ["음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.", "인터넷 연결을 확인해 주세요."],
  "language-not-supported": ["이 브라우저는 한국어 음성 인식을 지원하지 않아요.", "한국어 음성 인식을 못 써요."],
};
const NO_SPEECH = ["말소리가 들리지 않았어요. 마이크에 대고 다시 말해 주세요.", "말소리가 안 들렸어요. 다시 말해 주세요."];

const MIC_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
  </svg>`;
const STOP_ICON = `
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>`;

/**
 * 채팅 화면에 말로 보내기를 붙인다.
 * 마이크 버튼은 두 곳이다.
 *   - 대화 시작 전 헤더에 원래 있던 "음성으로 설명하기" 버튼(chat.html)에 기능을 연결한다.
 *   - 그 헤더는 대화가 시작되면 숨겨지므로, 입력창의 보내기 버튼 앞에도 마이크를 하나 끼워 넣는다.
 *
 * @param {object} chat - chat.js 가 넘겨주는 채팅 화면의 요소와 함수들
 * @param {HTMLButtonElement} chat.sendBtn - 보내기 버튼 (이 앞에 마이크를 끼워 넣는다)
 * @param {HTMLInputElement} chat.composerInput - 입력창 (듣는 동안 받아쓴 글자를 여기에 채운다)
 * @param {HTMLElement} chat.messageList - 말풍선 목록 (대화 중이면 여기에 시스템 알림을 띄운다)
 * @param {HTMLButtonElement | null} chat.headerMicBtn - 대화 시작 전 헤더의 "음성으로 설명하기" 버튼
 * @param {(text: string) => string} chat.systemAlert - 시스템 알림 HTML 을 만드는 함수
 * @param {() => boolean} chat.isSending - 하쿠의 대답을 기다리는 중인지
 * @param {(text: string) => void} chat.sendMessage - 글로 보낼 때와 같은 전송 함수
 */
export function setupVoiceInput(chat) {
  const { sendBtn, composerInput, messageList, headerMicBtn, systemAlert, isSending, sendMessage } = chat;

  const micButtons = [];
  const micIcons = new Map(); // 버튼마다 원래 아이콘 (듣기가 끝나면 되돌린다)

  // 듣는 중일 때만 값이 있다.
  //   typed: 마이크를 누르기 전에 입력창에 써 둔 글
  //   heard: 확정된 말,  interim: 아직 말하는 중이라 바뀔 수 있는 말
  //   stopping: 멈춰 달라고 했고 마지막 결과를 기다리는 중,  cancelled: 보내지 않고 버림
  let session = null;
  let listenTimer = null;

  const defaultPlaceholder = composerInput.placeholder;
  let hintTimer = null;

  /** 입력창의 안내 글을 바꾼다. text 가 없으면 원래대로, ms 를 주면 그 시간이 지난 뒤 원래대로 돌아간다. */
  function setHint(text, ms) {
    clearTimeout(hintTimer);
    composerInput.placeholder = text || defaultPlaceholder;
    if (text && ms) hintTimer = setTimeout(() => setHint(null), ms);
  }

  /**
   * 말로 보내기에서 생긴 문제를 알린다. 대화 중이면 "시스템 알림" 박스로, 대화 시작 전이면 입력창 안내 글로.
   * 입력창에는 긴 글이 다 안 들어가므로, 그때는 짧은 글을 쓴다.
   */
  function voiceNotice([text, short]) {
    if (!messageList.hidden) {
      messageList.insertAdjacentHTML("beforeend", systemAlert(text));
      messageList.scrollTop = messageList.scrollHeight;
    } else {
      setHint(short || text, 5000);
    }
  }

  /** 듣는 중 / 마무리 중 / 기다리는 중에 맞춰 마이크 버튼들의 모양을 바꾼다. */
  function updateMicButtons() {
    const listening = Boolean(session);
    for (const btn of micButtons) {
      btn.classList.toggle("is-recording", listening);
      btn.setAttribute("aria-pressed", String(listening));
      btn.setAttribute("aria-label", listening ? "말 끝내고 보내기" : "음성으로 설명하기");
      btn.innerHTML = listening ? STOP_ICON : micIcons.get(btn);
      // 하쿠의 대답을 기다리는 중이거나 마지막 결과를 기다리는 중에는 누를 수 없다.
      btn.disabled = listening ? session.stopping : isSending();
    }
  }

  /** 듣는 동안: 마이크를 누르기 전에 써 둔 글 + 지금까지 받아쓴 말을 입력창에 보여준다. */
  function showLiveText() {
    const spoken = (session.heard + session.interim).trim();
    composerInput.value = [session.typed, spoken].filter(Boolean).join(" ");
  }

  function startListening() {
    const rec = new SpeechRecognition();
    rec.lang = "ko-KR";
    rec.continuous = true; // 버튼을 다시 누를 때까지 계속 듣는다
    rec.interimResults = true; // 말하는 도중의 글자도 바로 보여준다

    session = { rec, typed: composerInput.value.trim(), heard: "", interim: "", error: null, stopping: false, cancelled: false };

    rec.onresult = (e) => {
      // 지금까지 들은 결과가 전부 들어 있으므로 매번 처음부터 다시 이어 붙인다.
      let heard = "";
      let interim = "";
      for (const result of e.results) {
        if (result.isFinal) heard += result[0].transcript;
        else interim += result[0].transcript;
      }
      session.heard = heard;
      session.interim = interim;
      showLiveText();
    };
    rec.onerror = (e) => {
      session.error = e.error;
    };
    rec.onend = finishListening;

    try {
      rec.start();
    } catch {
      session = null;
      voiceNotice(ERROR_MESSAGES["audio-capture"]);
      return;
    }

    listenTimer = setTimeout(stopListening, MAX_LISTEN_MS);
    setHint("듣는 중... 다 말하면 다시 누르세요");
    updateMicButtons();
  }

  /** 멈춰 달라고 한다. 마지막 결과까지 받은 뒤 finishListening 이 불린다. */
  function stopListening() {
    if (!session || session.stopping) return;
    session.stopping = true;
    setHint("받아쓰는 중이에요...");
    updateMicButtons();
    session.rec.stop();
  }

  /** 음성 인식이 끝나면(멈췄거나, 오류이거나, 저절로 끝났거나) 불린다. */
  async function finishListening() {
    const { typed, heard, interim, error, cancelled } = session;
    session = null;
    clearTimeout(listenTimer);
    setHint(null);
    updateMicButtons();

    if (cancelled) return;

    const spoken = (heard + interim).trim();

    if (error && ERROR_MESSAGES[error]) {
      composerInput.value = typed;
      voiceNotice(ERROR_MESSAGES[error]);
      return;
    }
    if (!spoken) {
      composerInput.value = typed;
      voiceNotice(NO_SPEECH);
      return;
    }

    // 입력창에 보이던 그대로(써 둔 글 + 받아쓴 말) 보낸다. 받아쓴 말은 고치지 않는다.
    const text = [typed, spoken].filter(Boolean).join(" ");
    composerInput.value = text;

    // 다른 메시지가 아직 하쿠의 대답을 기다리는 중이면, 끝날 때까지 기다렸다가 보낸다.
    while (isSending()) await new Promise((resolve) => setTimeout(resolve, 200));
    sendMessage(text);
  }

  function toggleListening() {
    if (session) stopListening();
    else if (!isSending()) startListening();
  }

  if (!canListen) {
    headerMicBtn?.addEventListener("click", () =>
      voiceNotice([
        "이 브라우저에서는 말로 보내기를 쓸 수 없어요. Chrome 이나 Edge 로 열어 주세요.",
        "이 브라우저는 말로 보내기를 못 써요.",
      ]),
    );
    return;
  }

  // 입력창에 끼워 넣는 마이크 버튼. 모양은 style.css 의 .mic 을 쓴다.
  const composerMicBtn = document.createElement("button");
  composerMicBtn.type = "button";
  composerMicBtn.className = "mic";
  composerMicBtn.id = "mic-btn";
  sendBtn.insertAdjacentElement("beforebegin", composerMicBtn);

  micButtons.push(composerMicBtn);
  if (headerMicBtn) micButtons.push(headerMicBtn);

  for (const btn of micButtons) {
    micIcons.set(btn, btn.innerHTML.trim() ? btn.innerHTML : MIC_ICON);
    btn.addEventListener("click", toggleListening);
  }

  // 듣는 도중에 보내기 버튼(또는 Enter)으로 직접 보내면, 듣기를 그만두고 그 글만 보낸다. (두 번 보내지 않게)
  sendBtn.form?.addEventListener(
    "submit",
    () => {
      if (!session) return;
      session.cancelled = true;
      session.rec.abort();
    },
    true,
  );

  // 하쿠의 대답을 기다리는 동안(보내기 버튼이 꺼져 있는 동안)에는 마이크도 같이 끈다.
  new MutationObserver(updateMicButtons).observe(sendBtn, {
    attributes: true,
    attributeFilter: ["disabled"],
  });
  updateMicButtons();
}
