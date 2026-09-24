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

**터미널 2 — 프론트**

```powershell
cd frontend
python -m http.server 8000
```

**브라우저**

```
http://localhost:8000/src/pages/chat.html
```
