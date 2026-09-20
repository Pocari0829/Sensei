# Sensei — 하쿠에게 설명하기

아무것도 모르는 앵무새 **하쿠**에게 개념을 설명하면, 하쿠가 그 범위 안에서 꼬리질문을 되돌려줍니다.

---

## 1. 가상환경 만들기

`venv` 폴더는 용량이 크고 컴퓨터마다 경로가 달라 저장소에 올리지 않았습니다.
아래 명령으로 직접 만들어야 합니다.

**Windows (PowerShell)**

```powershell
py -3.12 -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**Mac / Linux**

```bash
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

> PowerShell 에서 `Activate.ps1` 실행이 막히면 한 번만 실행하세요.
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

---

## 2. 실행

```powershell
python app.py
```

아래가 뜨면 성공입니다.

```
 * Running on http://127.0.0.1:5000
```

브라우저에서 접속합니다.

```
http://localhost:5000/static/index.html
```

`F12` → **Console** 탭을 열어두면 하쿠의 응답이 그대로 출력됩니다.

> `WARNING: This is a development server...` 는 오류가 아니라 정상 안내입니다.

> 실행 시 `ValueError: No API key was provided.` 가 나오면 `.env` 파일이 없는 것입니다.
> `.env.example` 을 복사해 `.env` 로 만들고 `GEMINI_API_KEY` 를 채우세요.
