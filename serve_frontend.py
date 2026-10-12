"""프론트(frontend 폴더)를 브라우저로 보여주는 개발용 서버.

`python -m http.server 8000` 과 하는 일은 같지만 한 가지가 다르다:
브라우저가 예전 파일을 기억(캐시)해 두고 계속 쓰지 못하게 한다.

`python -m http.server` 는 캐시에 대해 아무 말도 하지 않는다. 그러면 Chrome 은 한 번 받은
js 파일을 한동안(길면 며칠) 서버에 다시 묻지 않고 그대로 쓴다. 그래서 코드를 고쳐도
화면은 예전 동작 그대로이고, F5 로도 안 바뀐다 (Ctrl+Shift+R 을 눌러야만 바뀐다).
이 서버는 모든 응답에 "저장하지 마"(Cache-Control: no-store) 를 붙여서 항상 최신 파일이 뜨게 한다.

실행 (프로젝트 폴더에서):
    python serve_frontend.py          # http://localhost:8000/src/pages/chat.html
    python serve_frontend.py 8001     # 포트를 바꾸고 싶을 때
"""

import contextlib
import errno
import functools
import http.server
import os
import socket
import sys

# 이 파일 옆의 frontend 폴더를 보여준다. 어느 폴더에서 실행해도 같다.
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
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
    print(f"  http://localhost:{port}/src/pages/chat.html")

    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n프론트 서버를 껐어요.")
