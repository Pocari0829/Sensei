// ─────────────────────────────────────────────
// Supabase 연결 객체. 로그인(auth.js)과 앞으로 붙일 DB 저장이 모두 이 하나를 같이 쓴다.
//
// 주소와 키는 config.js 에서 온다. config.js 는 실제 파일이 아니라,
// serve_frontend.py 가 .env 의 SUPABASE_URL / SUPABASE_ANON_KEY 를 읽어 그때그때 만들어 준다.
// (키를 git 에 올리지 않으려고. 그래서 프론트는 반드시 serve_frontend.py 로 열어야 한다)
// ─────────────────────────────────────────────

// 빌드 도구가 없으므로 npm 대신 CDN 에서 바로 불러온다. 버전을 고정해서 갑자기 바뀌지 않게 한다.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Supabase 주소/키가 비어 있어요. .env 의 SUPABASE_URL, SUPABASE_ANON_KEY 와 serve_frontend.py 로 열었는지 확인하세요.",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // 카카오 로그인에서 돌아올 때 주소에 토큰 대신 일회용 code 가 붙어 오는 방식.
    // 주소창(방문 기록)에 토큰이 남지 않아서 더 안전하다. (Google 로그인에는 영향 없음)
    flowType: "pkce",
  },
});
