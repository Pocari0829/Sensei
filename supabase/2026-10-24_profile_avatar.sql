-- =============================================================
-- 프로필 사진 칸 추가
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 붙여넣고 Run.
-- 이미 칸이 있으면 건너뛰므로 여러 번 실행해도 괜찮다.
-- 실행 전에도 앱은 동작한다. (프로필 화면에 기본 사진만 나오고, 사진을 바꾸면 저장 실패 안내가 뜰 뿐)
-- =============================================================

-- 프로필 사진. 파일 저장소(Storage)가 아니라 이 칸에 글자(data URL: "data:image/webp;base64,...")로 바로 넣는다.
-- 프로필 화면이 256x256 으로 줄여서 넣으므로 보통 20~40KB 다. 비어 있으면 기본 사진을 보여준다.
-- (frontend/src/scripts/profile.js, user.js 의 saveAvatar)
alter table public.users
  add column if not exists avatar text;

-- 사진이 아닌 값이나 너무 큰 사진이 들어가지 않게 막는다. (200000 은 user.js 의 AVATAR_MAX_LENGTH 와 같은 값)
alter table public.users
  drop constraint if exists users_avatar_check;
alter table public.users
  add constraint users_avatar_check
  check (avatar is null or (avatar like 'data:image/%' and length(avatar) <= 200000));
