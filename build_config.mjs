// ─────────────────────────────────────────────
// 배포(Vercel)용: 환경변수로 frontend/src/scripts/config.js 를 만든다.
// 개발할 때는 serve_frontend.py 가 .env 로 같은 내용을 그때그때 만들어 주므로 이 파일을 쓰지 않는다.
// 내보내는 값을 바꾸면 serve_frontend.py 의 build_config_js() 도 같이 고칠 것.
//
// Vercel 이 배포할 때마다 실행한다 (vercel.json 의 buildCommand). 직접 실행해 보려면:
//   node build_config.mjs
// 만들어진 config.js 는 .gitignore 에 있어서 git 에 올라가지 않는다.
// ─────────────────────────────────────────────

import { writeFileSync } from "node:fs";

// 브라우저에 보여도 되는 값만. (SUPABASE_SERVICE_KEY 같은 비밀 키는 절대 넣지 않는다)
const values = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_KEY: process.env.SUPABASE_ANON_KEY ?? "",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
  API_BASE_URL: process.env.API_BASE_URL ?? "",
};

const missing = Object.entries(values)
  .filter(([, value]) => !value)
  .map(([name]) => (name === "SUPABASE_KEY" ? "SUPABASE_ANON_KEY" : name));
if (missing.length > 0) {
  // 배포는 계속하되 로그에 남긴다. (비어 있으면 로그인이나 하쿠 대화가 안 된다)
  console.warn(`환경변수가 비어 있어요: ${missing.join(", ")}`);
}

const body = Object.entries(values)
  .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
  .join("\n");

writeFileSync(new URL("./frontend/src/scripts/config.js", import.meta.url), `${body}\n`);
console.log("frontend/src/scripts/config.js 를 만들었어요.");
