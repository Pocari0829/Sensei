-- =============================================================
-- 온보딩 설문 + 퀴즈 채점에 필요한 칸 추가
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 붙여넣고 Run.
-- 이미 칸이 있으면 건너뛰므로 여러 번 실행해도 괜찮다.
-- 실행 전에도 앱은 동작한다. (설문 화면이 안 뜨고, 채점 결과가 저장되지 않을 뿐)
-- =============================================================

-- 설문 5문항의 답. {purpose, level, subject, daily_time, concern}
-- 비어 있으면 아직 설문 전이라서 채팅에 들어갈 때 설문 화면으로 간다. (frontend/src/scripts/chat.js)
alter table public.users
  add column if not exists survey jsonb;

-- 채점 결과. 제출하기 전에는 비어 있다. (frontend/src/scripts/quiz.js)
alter table public.quiz_items
  add column if not exists is_correct boolean;
