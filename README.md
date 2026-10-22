# Sensei — 실행 방법

## 1. 준비 (처음 한 번만)

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

## 2. 실행

터미널 **2개**가 필요합니다.

**터미널 1 — 백엔드**

```powershell
.\venv\Scripts\Activate.ps1
python -m backend.app
```

**터미널 2 — 프론트** (프로젝트 폴더에서, `cd frontend` 하지 않습니다)

```powershell
.\venv\Scripts\Activate.ps1
python serve_frontend.py
```

> 반드시 `serve_frontend.py` 로 여세요. 로그인에 필요한 Supabase 주소/키(`config.js`)를
> `.env` 에서 만들어 주고, 브라우저가 예전 js 파일을 쓰지 않게 막아줍니다.
> `python -m http.server 8000` 으로 열면 로그인이 동작하지 않습니다.

**브라우저** (로그인 화면부터 시작합니다. 로그인하지 않으면 다른 화면은 로그인 화면으로 돌아옵니다)

```
http://localhost:8000/src/pages/index.html
```

`127.0.0.1` 이 아니라 `localhost` 로 여세요. 로그인 상태는 주소별로 따로 저장되고,
Google Cloud 에 등록한 주소(승인된 자바스크립트 원본)도 `localhost` 기준입니다.
