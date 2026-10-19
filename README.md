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

> `python -m http.server 8000` 으로도 열리지만, 그러면 브라우저가 예전 js 파일을 계속 써서
> 코드를 고쳐도 화면이 안 바뀝니다 (매번 Ctrl+Shift+R 필요). `serve_frontend.py` 는 항상 최신 파일을 줍니다.

**브라우저**

```
http://localhost:8000/src/pages/chat.html
```
