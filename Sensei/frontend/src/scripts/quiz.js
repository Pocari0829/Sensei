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
