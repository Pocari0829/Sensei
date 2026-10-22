"""프론트(frontend 폴더)를 브라우저로 보여주는 개발용 서버.

`python -m http.server 8000` 과 하는 일은 같지만 두 가지가 다르다.

1) 브라우저가 예전 파일을 기억(캐시)해 두고 계속 쓰지 못하게 한다.
   `python -m http.server` 는 캐시에 대해 아무 말도 하지 않는다. 그러면 Chrome 은 한 번 받은
   js 파일을 한동안(길면 며칠) 서버에 다시 묻지 않고 그대로 쓴다. 그래서 코드를 고쳐도
   화면은 예전 동작 그대로이고, F5 로도 안 바뀐다 (Ctrl+Shift+R 을 눌러야만 바뀐다).
   이 서버는 모든 응답에 "저장하지 마"(Cache-Control: no-store) 를 붙여서 항상 최신 파일이 뜨게 한다.

2) /src/scripts/config.js 를 .env 에서 만들어 준다.
   프론트가 Supabase(로그인 / DB)에 접속할 때 쓰는 주소와 키, 그리고 Google 클라이언트 ID 다.
   키를 git 에 올리지 않으려고 파일로 두지 않고, 요청이 올 때마다 .env 를 읽어서 만든다.
   그래서 `python -m http.server` 로 열면 로그인이 동작하지 않는다.

실행 (프로젝트 폴더에서):
    python serve_frontend.py          # http://localhost:8000/src/pages/index.html
    python serve_frontend.py 8001     # 포트를 바꾸고 싶을 때
"""

import contextlib
import errno
import functools
import http.server
import json
import os
import socket
import sys

from dotenv import dotenv_values

# 이 파일 옆의 frontend 폴더를 보여준다. 어느 폴더에서 실행해도 같다.
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
ENV_PATH = os.path.join(BASE_DIR, ".env")

CONFIG_JS_PATH = "/src/scripts/config.js"


def build_config_js():
    """.env 를 읽어서 config.js 내용을 만든다. 매번 새로 읽으므로 .env 를 고치면 새로고침만 하면 된다.

    브라우저에 보여도 되는 값만 내보낸다. (Supabase publishable 키, Google 클라이언트 ID)
    SUPABASE_SERVICE_KEY 는 DB 를 마음대로 다룰 수 있는 키라서 절대 여기에 넣으면 안 된다.
    """
    env = dotenv_values(ENV_PATH)
    url = env.get("SUPABASE_URL") or ""
    key = env.get("SUPABASE_ANON_KEY") or ""
    google_client_id = env.get("GOOGLE_CLIENT_ID") or ""
    return (
        f"export const SUPABASE_URL = {json.dumps(url)};\n"
        f"export const SUPABASE_KEY = {json.dumps(key)};\n"
        f"export const GOOGLE_CLIENT_ID = {json.dumps(google_client_id)};\n"
    )


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] == CONFIG_JS_PATH:
            body = build_config_js().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # Windows 에서는 이 값이 True 면 같은 포트에 서버가 "두 개" 떠도 오류가 안 난다.
    # 그러면 요청이 예전 서버로 가버릴 수 있으므로, Windows 에서는 꺼서 중복 실행을 막는다.
    allow_reuse_address = os.name != "nt"


class DualStackServer(Server):
    """localhost 가 127.0.0.1(IPv4) 로 오든 ::1(IPv6) 로 오든 받는다. (python -m http.server 와 같은 방식)"""

    address_family = socket.AF_INET6

    def server_bind(self):
        with contextlib.suppress(Exception):
            self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        return super().server_bind()


def _port_in_use(error):
    return error.errno == errno.EADDRINUSE or getattr(error, "winerror", None) == 10048


def make_server(port, handler):
    try:
        return DualStackServer(("::", port), handler)
    except OSError as e:
        if _port_in_use(e):
            raise
        # IPv6 를 못 쓰는 컴퓨터면 IPv4 로만 연다.
        return Server(("", port), handler)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(NoCacheHandler, directory=FRONTEND_DIR)

    try:
        httpd = make_server(port, handler)
    except OSError as e:
        if not _port_in_use(e):
            raise
        sys.exit(
            f"포트 {port} 을(를) 이미 다른 서버가 쓰고 있어요. "
            "그 서버를 먼저 끄고(그 터미널에서 Ctrl+C) 다시 실행하세요."
        )

    print("프론트 서버 실행 중 (끄려면 Ctrl+C)")
    print(f"  http://localhost:{port}/src/pages/index.html")

    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n프론트 서버를 껐어요.")
