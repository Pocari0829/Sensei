// ─────────────────────────────────────────────
// survey.html 전용 스크립트. 처음 로그인했을 때 한 번 답하는 5문항 설문.
// 답은 DB(users.survey)에 저장하고, "지금 내 수준" 은 하쿠가 질문 난이도를 맞추는 수준(level_init / level_current)이 된다.
// 저장하면 채팅으로 간다. (닉네임은 채팅에서 하쿠가 첫 인사로 묻는다)
//
// [팀 논의 필요 D10]
//   - 순서: 지금은 설문 → 닉네임(채팅의 첫 인사). 기획서는 닉네임을 "회원가입 직후" 라고 해서 반대일 수도 있다.
//   - 건너뛰기: 지금은 5문항을 다 답해야 시작할 수 있다. [나중에 하기] 를 둘지.
//   - 기존 사용자: 설문 칸이 비어 있는 계정은 모두 이 화면을 한 번 보게 된다 (베타 테스터 포함).
//   - 활용: 학습 목적 / 과목 / 하루 목표 시간 / 고민은 지금 저장만 한다. 하쿠나 시험지에 어떻게 쓸지 정해야 한다.
//   - 프로필에서 설문을 다시 할 수 있게 할지.
// ─────────────────────────────────────────────

import { hasSurvey, saveSurvey } from "./user.js";

const CHAT_PAGE = "./chat.html";
const QUESTIONS = ["purpose", "level", "subject", "daily_time", "concern"];

const form = document.getElementById("survey-form");
const submitBtn = document.getElementById("survey-submit");
const errorEl = document.getElementById("survey-error");
const progressEl = document.getElementById("survey-progress");

/** 폼에 적힌 답. 아직 답하지 않은 문항은 빈 문자열. */
function readAnswers() {
  const data = new FormData(form);
  return Object.fromEntries(QUESTIONS.map((name) => [name, String(data.get(name) ?? "").trim()]));
}

function answeredCount(answers) {
  return QUESTIONS.filter((name) => answers[name]).length;
}

function showError(text) {
  errorEl.textContent = text;
  errorEl.hidden = !text;
}

form.addEventListener("input", () => {
  progressEl.textContent = `${answeredCount(readAnswers())} / ${QUESTIONS.length}`;
  showError("");
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const answers = readAnswers();

  const missing = QUESTIONS.findIndex((name) => !answers[name]);
  if (missing !== -1) {
    showError(`Q ${missing + 1} 에 아직 답하지 않았어요.`);
    form.querySelector(`[name="${QUESTIONS[missing]}"]`)?.closest(".q-card")?.scrollIntoView({ behavior: "smooth" });
    return;
  }

  submitBtn.disabled = true;
  try {
    await saveSurvey({ ...answers, level: Number(answers.level) });
    window.location.replace(CHAT_PAGE);
  } catch (err) {
    showError(`설문을 저장하지 못했어요. 다시 시도해주세요. (${err.message})`);
    submitBtn.disabled = false;
  }
});

// 이미 답했으면(뒤로 가기 등으로 다시 들어옴) 채팅으로 보낸다.
hasSurvey()
  .then((done) => {
    if (done) window.location.replace(CHAT_PAGE);
  })
  .catch((err) => console.warn("설문 여부를 확인하지 못했어요:", err));
