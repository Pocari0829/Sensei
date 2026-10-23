"""Sensei 백엔드 (Flask + Gemini).

주소는 4개다.
    POST /ask-haku       사용자의 설명 → 하쿠의 꼬리질문 (정오 판별을 먼저 거친다)
    POST /check-system   정오 판별만 따로
    POST /generate-quiz  지금까지의 대화 → 문제 1개 (빈칸 또는 객관식)
    POST /judge-level    사용자의 대답 하나 → 어느 학교급 수준의 설명인지 (레벨 1~5)

/ask-haku 로 메시지가 오면 아래 순서로 지나간다. 이 파일도 같은 순서로 적혀 있다.
    1) check_before_haku()    정오 판별. 결과는 g.check 에 담아 두기만 한다.
    2) ask_haku()             맞든 틀리든 하쿠가 꼬리질문을 한다. (하쿠는 판정을 모른다)
                              판정은 응답의 is_correct / feedback 으로 따로 보내고, 프론트가 "시스템 알림" 박스에 띄운다.
    3) replace_quota_error()  Gemini 사용량 초과였다면 긴 영어 오류를 짧은 안내 문구로 바꾼다.

하쿠 / 정오 판별 / 문제 생성 / 수준 판단은 서로 다른 Gemini 호출이고, 각자의 프롬프트는 prompts.py 에 있다.
"""

import json
import os
import re
import time
from typing import Literal

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, g, jsonify, request
from google import genai             
from google.genai import types
from flask_cors import CORS
from pydantic import BaseModel, Field

import backend.prompts as prompts


# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app);
# Gemini 통신 객체. 함수 밖에 두어 서버 시작 시 1회만 생성하고 계속 재사용한다.
# 함수 안에 넣으면 요청마다 새로 만들어져 느려진다.

# 괄호를 비워두면 라이브러리가 알아서 환경변수에서 'GEMINI_API_KEY'를 찾아서 사용합니다.
client = genai.Client()

# 이쪽은 getenv + 기본값. .env 에 없어도 일단 돌아가야 하므로.
# 모델명은 자주 바뀌니 코드에 박지 말고 .env 에서만 관리한다.
HAKU_MODEL = os.getenv("HAKU_MODEL", "gemini-3-flash-preview")
CHECK_MODEL = os.getenv("CHECK_MODEL", "gemini-3-flash-preview")
# 문제 생성 전용 모델. .env 에 QUIZ_MODEL 이 없으면 CHECK_MODEL 을 같이 쓴다.
# 쉼표로 여러 개를 적으면 앞에서부터 시도하고, 사용량 초과·혼잡·시간 초과면 다음 모델로 넘어간다.
#   예) QUIZ_MODEL=gemini-3.5-flash,gemini-3.6-flash,gemini-3.1-flash-lite
# 무료 사용량은 모델마다 따로라서, 여러 개를 적으면 한도를 합쳐 쓰는 효과가 난다.
# 맨 뒤 모델은 "마지막 수단" 이다. 여러 개 중 맨 뒤 모델로 만들었으면 퀴즈 화면에 QUIZ_FALLBACK_NOTICE 를 띄운다.
QUIZ_MODELS = [m.strip() for m in os.getenv("QUIZ_MODEL", CHECK_MODEL).split(",") if m.strip()]
# 한 모델을 기다리는 최대 시간(ms). 앞의 모델들은 짧게 기다리고 다음 모델로 넘어간다.
# 맨 뒤 모델은 넘어갈 곳이 없으므로 더 기다린다. 합쳐도 gunicorn 의 --timeout 120(초) 안에 끝나게 잡았다.
QUIZ_MODEL_TIMEOUT_MS = 25_000
QUIZ_LAST_MODEL_TIMEOUT_MS = 60_000
QUIZ_FALLBACK_NOTICE = "오늘 사용량이 많아서 문제 품질이 조금 떨어질 수 있어요."
# 문제 유형(빈칸 주관식 / 객관식) 고르기 전용 모델. 문제를 만드는 QUIZ_MODEL 보다 먼저 한 번 부른다.
QUIZ_TYPE_MODEL = os.getenv("QUIZ_TYPE_MODEL", "gemini-3.1-flash-lite")
# 대답 수준 판단 전용 모델. 메시지마다 불리고, 하쿠의 대답과 따로(기다리지 않고) 돈다.
# 판단 결과는 채팅 화면이 저장하므로, 화면을 옮기기 전에 끝나야 기록된다. 그래서 빠른 모델을 쓴다.
# (3.1-flash-lite 는 하루 한도를 따로 쓰지만 가끔 1분 넘게 걸려서, 그사이 화면을 옮기면 기록이 사라졌다)
LEVEL_MODEL = os.getenv("LEVEL_MODEL", "gemini-3.5-flash-lite")
# 정리:  HAKU_MODEL = 하쿠 꼬리질문 / CHECK_MODEL = 정오 판별 / QUIZ_MODEL = 문제 생성
#        QUIZ_TYPE_MODEL = 문제 유형 고르기 / LEVEL_MODEL = 대답 수준 판단
# 무료 사용량은 모델마다 따로 계산되므로, 서로 다른 모델로 두면 하루에 더 많이 쓸 수 있다.


# ─────────────────────────────────────────────
# Gemini 응답 형식
# Gemini 가 아무 형식으로나 말하지 않도록 "이 모양의 JSON 으로만 답해라" 고 강제하는 틀.
# Field 의 description 도 Gemini 에게 그대로 전달되어 지시문 역할을 한다.
# (클래스 독스트링도 설명으로 같이 전달될 수 있으므로, 사람용 설명은 주석으로만 적는다)
# ─────────────────────────────────────────────
# 정오 판별 결과
class CheckResult(BaseModel):
    is_correct: bool = Field(
        description="사용자의 설명에 사실과 다른 내용이 있으면 false. "
        "틀린 내용이 없거나, 질문·모르겠다는 말·힌트 요청처럼 사실을 설명하는 말이 아니거나, "
        "맛·식감·느낌·비유·의견처럼 사람마다 다를 수 있는 말이면 true."
    )
    feedback: str = Field(
        description="is_correct 가 false 일 때 어디가 틀렸는지 짧게 짚는 한두 문장. 정답은 알려주지 않는다. true 면 빈 문자열."
    )


# 문제 하나
class QuizItem(BaseModel):
    question: str = Field(
        description="빈칸에 들어갈 말은? 뒤에 문장이 오는 형식. 빈칸은 (    ) 로 표시한다."
    )
    answers: list[str] = Field(description="빈칸의 정답들. 문장 속 빈칸 순서대로, 빈칸 수만큼.")


# 시험지 (문제 목록)
class QuizResult(BaseModel):
    items: list[QuizItem] = Field(description="문제는 최대 1개. 낼 만한 내용이 없으면 억지로 만들지 말고 빈 목록.")


# 객관식 문제 하나
class ChoiceItem(BaseModel):
    question: str = Field(description="물음으로 끝나는 객관식 문제의 지문.")
    choices: list[str] = Field(description="보기 4개. 정답은 딱 하나이고, 나머지는 그럴듯하지만 틀린 보기.")
    answer_index: int = Field(description="choices 중 정답의 위치 (0부터 시작).")


# 객관식 시험지 (문제 목록)
class ChoiceResult(BaseModel):
    items: list[ChoiceItem] = Field(description="문제는 최대 1개. 낼 만한 내용이 없으면 억지로 만들지 말고 빈 목록.")


# 문제 유형 고르기 결과 (generate_quiz 가 문제를 만들기 전에 QUIZ_TYPE_MODEL 에게 받는다)
# Gemini 는 칸을 적힌 순서대로 채우므로, 이유(reason)를 먼저 쓰게 해서 내용을 따져 본 뒤에 유형을 고르게 한다.
class QuizTypeResult(BaseModel):
    reason: str = Field(description="이 유형을 고른 이유. 대화 내용을 근거로 짧은 한 문장.")
    type: Literal["blank", "choice"] = Field(
        description="다음 문제의 유형. blank = 빈칸 주관식 (빈칸에 들어갈 말을 직접 쓴다), "
        "choice = 객관식 (보기 중 정답 하나를 고른다)."
    )


# 대답 수준 판단 결과 (judge_level 이 LEVEL_MODEL 에게 받는다)
# 레벨은 users 의 레벨과 같은 단계: 1 초등 저학년 / 2 초등 고학년 / 3 중학생 / 4 고등학생 / 5 대학생 이상
# 유형 고르기와 같은 이유로 근거(reason)를 먼저 쓰게 한다.
class LevelResult(BaseModel):
    reason: str = Field(description="이 수준으로 판단한 근거. 대답에 쓴 용어와 설명의 깊이를 근거로 짧은 한 문장.")
    is_explanation: bool = Field(
        description="설명이면 짧아도 true. 질문, 모르겠다는 말, 힌트 요청, 인사, 맞장구처럼 설명이 아니거나, "
        "색·이름·숫자처럼 한 단어로 답하는 질문에 그 답만 한 경우라 수준을 알 수 없으면 false."
    )
    level: int = Field(
        description="1 초등학교 저학년, 2 초등학교 고학년, 3 중학생, 4 고등학생, 5 대학생 이상. 1~5 중 하나."
    )


# ─────────────────────────────────────────────
# 공통 도구 (세 주소가 같이 쓴다)
# ─────────────────────────────────────────────
def _history_to_contents(history, include_system=False):
    """프론트가 보낸 대화 기록을 Gemini 의 Content 리스트로 바꾼다.

    history 는 [{role: "user" | "sensei" | "system" | "check", text: "..."}, ...] 형태.
    role 이 "sensei" 면 Gemini 기준으로는 모델(model)이 한 말이 된다.
    role 이 "system" 이면 정오 판별 알림이다. 기획서상 하쿠는 판정을 모르므로 기본으로는 뺀다.
    include_system=True (문제 생성) 일 때만 "[시스템 알림] ..." 으로 붙여서 어느 설명이 틀렸는지 알게 한다.
    "check" 는 예전 방식의 정오 판별 알림("틀렸어요.") 이라 "system" 과 똑같이 다룬다. (이미 저장된 대화용)
    형식이 이상한 항목은 조용히 건너뛴다 (프론트 버그 때문에 500 나면 안 되니까).
    """
    contents = []
    if not isinstance(history, list):
        return contents

    for turn in history:
        if not isinstance(turn, dict):
            continue

        text = turn.get("text")
        if not text or not str(text).strip():
            continue

        if turn.get("role") in ("system", "check"):
            if not include_system:
                continue
            text = f"[시스템 알림] {text}"

        role = "model" if turn.get("role") == "sensei" else "user"
        contents.append(types.Content(role=role, parts=[types.Part(text=str(text))]))

    return contents


def _parse(res, schema):
    """Gemini 응답을 schema(위의 응답 형식) 객체로 바꾼다.

    보통은 라이브러리가 res.parsed 에 이미 만들어 둔다. 없으면 res.text 를 직접 JSON 으로 읽는다.
    """
    if isinstance(res.parsed, schema):
        return res.parsed
    return schema.model_validate(json.loads(res.text))


def _generate_with_retry(attempts=3, **kwargs):
    """Gemini 가 잠깐 혼잡(503 UNAVAILABLE)하면 조금 기다렸다가 다시 시도한다. (기본 최대 3번)

    정오 판별과 문제 생성이 쓴다. (하쿠 쪽 ask_haku 는 재시도 없이 한 번만 부른다)
    문제 유형 고르기는 실패해도 대신 정할 수 있어서 attempts 를 줄여 오래 기다리지 않는다.
    """
    for attempt in range(attempts):
        try:
            return client.models.generate_content(**kwargs)
        except Exception as e:
            busy = "503" in str(e) or "UNAVAILABLE" in str(e)
            if not busy or attempt == attempts - 1:
                raise
            # 첫 실패 뒤 2초, 두 번째 실패 뒤 4초를 기다린다.
            time.sleep(2 * (attempt + 1))


# Gemini 무료 사용량을 다 썼을 때 화면에 보여줄 문구.
QUOTA_MESSAGE = "오늘 Gemini 무료 사용량이 초과됐어요. (한도는 모델마다 따로) 내일 다시 시도하거나 .env 에서 모델을 바꿔주세요."


def _is_quota_error(e):
    """오류(또는 오류 문구)가 Gemini 사용량 초과(429)인지 본다."""
    text = str(e)
    return "RESOURCE_EXHAUSTED" in text or "429" in text


# ─────────────────────────────────────────────
# 1) 정오 판별: /ask-haku 로 온 메시지는 여기를 가장 먼저 지난다
# ─────────────────────────────────────────────
def _check(message, history):
    """정오 판별. 구조는 ask_haku 와 같고 프롬프트 / 모델 / 응답 형식만 다르다.

    시스템은 하쿠의 답을 모르고, 하쿠는 판정을 모른다 (서로 다른 Gemini 호출).
    돌려주는 것은 CheckResult(is_correct, feedback). Gemini 호출이 실패하면 예외가 그대로 올라간다.
    """
    contents = _history_to_contents(history)
    contents.append(types.Content(role="user", parts=[types.Part(text=str(message))]))

    res = _generate_with_retry(
        model=CHECK_MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=prompts.ASK_HAKU,  # prompts.py 의 정오 판별 프롬프트
            response_mime_type="application/json",
            response_schema=CheckResult,
        ),
    )
    return _parse(res, CheckResult)


@app.before_request
def check_before_haku():
    """/ask-haku 가 실행되기 "전에" 정오 판별을 먼저 한다.

    - 판별 결과는 g.check 에 담아 두고 None 을 돌려준다. 맞든 틀리든 ask_haku() 가 그대로 실행된다.
      (기획서: 하쿠는 판정을 모르고 꼬리질문을 계속한다. 판정은 시스템 알림 박스에 따로 뜬다)
    - 판별 자체가 실패하면(사용량 초과 등): ok=False 로 돌려줘서 "시스템 알림" 박스에 뜬다.
    """
    # CORS 사전 요청(OPTIONS) 이나 다른 주소는 건드리지 않는다.
    if request.method != "POST" or request.path != "/ask-haku":
        return None

    data = request.get_json(silent=True) or {}
    message = data.get("message")

    # 빈 메시지 처리는 ask_haku() 가 원래 하던 대로 맡긴다.
    if not message or not str(message).strip():
        return None

    try:
        result = _check(message, data.get("history", []))
    except Exception as e:
        # 판별을 못 했는데 하쿠로 넘기면 "틀린 말도 통과"된 것처럼 보이므로 여기서 멈춘다.
        app.logger.warning("정오 판별 실패: %s", e)
        busy = "정오 판별 서버가 지금 바빠요. 잠시 후 다시 보내주세요."
        return jsonify(ok=False, error=QUOTA_MESSAGE if _is_quota_error(e) else busy)

    # 하쿠에게는 넘기지 않는다. ask_haku() 가 응답을 만들 때 is_correct / feedback 으로만 붙인다.
    g.check = result
    return None


# ─────────────────────────────────────────────
# 2) 하쿠 꼬리질문: 정오 판별 결과와 상관없이 실행된다
# ─────────────────────────────────────────────
@app.post("/ask-haku")
def ask_haku():
    """하쿠 꼬리질문 반환"""
    # 프론트가 보낸 JSON을 파이썬 딕셔너리로 변환
    data = request.get_json(silent=True) or {}

    # 사용자가 방금 한 말을 꺼낸다.
    message = data.get("message")

    # 지금까지의 대화 기록 (선택). 프론트가 안 보내면 그냥 이번 메시지 하나로만 대화한다.
    history = data.get("history", [])

    # 하쿠가 사용자를 부를 이름 (선택). 처음 로그인할 때 이름 정하기 화면에서 정한 닉네임이다.
    # 프롬프트에 그대로 들어가므로 프론트의 최대 길이(16글자)를 넘는 부분은 자른다.
    nickname = str(data.get("nickname") or "").strip()[:16]
    system_instruction = prompts.SYSTEM_PROMPT
    if nickname:
        system_instruction += prompts.NICKNAME_PROMPT.format(nickname=nickname)

    # 사용자 수준 1~5 (선택). 설문의 level_init / 이후 level_current. 범위 밖이거나 숫자가 아니면 무시한다.
    level = data.get("level")
    if isinstance(level, int) and 1 <= level <= 5:
        system_instruction += prompts.LEVEL_PROMPT.format(level=level)

    # message 가 비어 있으면 Gemini 호출 자체가 400 으로 터진다.
    # 여기서 미리 걸러서 프론트가 읽을 수 있는 형태로 돌려준다.
    if not message or not str(message).strip():
        return jsonify(ok=False, error="message 가 비어 있습니다."), 400

    # 이전 대화 + 이번 메시지를 순서대로 이어 붙여서 맥락을 유지한다.
    contents = _history_to_contents(history)
    contents.append(types.Content(role="user", parts=[types.Part(text=str(message))]))

    try:
        res = client.models.generate_content(
            model=HAKU_MODEL,
            # contents = 매번 바뀌는 값 (지금까지의 대화 + 사용자가 방금 한 말)
            contents=contents,
            config=types.GenerateContentConfig(
                # system_instruction = 대화 내내 같은 값 (하쿠의 역할 지시 + 사용자 호칭)
                # 프롬프트를 contents 에 사용자 말과 같이 붙여 보내면
                # Gemini 가 그걸 '사용자가 한 말'로 취급해 캐릭터가 무너진다.
                # 반드시 여기로 분리해서 넣을 것.
                system_instruction=system_instruction,
            ),
        )
    except Exception as e:
        # Gemini 쪽 오류(키 문제, 네트워크, 모델명 오타 등)를 그대로 500 HTML 로 터뜨리면
        # 프론트의 res.json() 이 깨진다. JSON 으로 감싸서 돌려준다.
        return jsonify(ok=False, error=f"하쿠가 응답하지 못했어요: {e}"), 500

    # res.text 가 실제 하쿠의 문장이다.
    # 정오 판별 결과(check_before_haku 가 g.check 에 담음)는 하쿠의 말과 따로 보낸다.
    # 틀렸으면 chat.js 가 feedback 을 하쿠 말풍선이 아니라 "시스템 알림" 박스로 띄운다.
    check = g.get("check")
    if check is not None and not check.is_correct:
        feedback = check.feedback or "방금 설명에 틀린 부분이 있어요."
        return jsonify(ok=True, question=res.text, is_correct=False, feedback=feedback)
    return jsonify(ok=True, question=res.text, is_correct=True)


# ─────────────────────────────────────────────
# 3) 응답 다듬기: 모든 주소의 응답이 나가기 직전에 실행된다
# ─────────────────────────────────────────────
@app.after_request
def replace_quota_error(response):
    """어느 주소든(원래 있던 /ask-haku 포함) 사용량 초과로 실패하면 에러 문구를 QUOTA_MESSAGE 로 바꾼다."""
    if not response.is_json:
        return response

    data = response.get_json(silent=True) or {}
    if data.get("ok") is False and _is_quota_error(data.get("error", "")):
        response.set_data(json.dumps({"ok": False, "error": QUOTA_MESSAGE}, ensure_ascii=False))
        response.status_code = 429

    return response


# ─────────────────────────────────────────────
# (예전 코드) 아래 주석 두 덩어리는 처음에 만들어 둔 빈 틀이다. 지금은 실행되지 않는다.
# 실제로 동작하는 /check-system, /generate-quiz 는 바로 아래 "그 밖의 주소" 에 있다.
# ─────────────────────────────────────────────
# @app.post("/check-system")
# def check_system():
#     """정오 판별 반환"""
#     data = request.get_json()
#     message = data.get("message")

#     res = client.models.generate_content(
#          model=HAKU_MODEL,
#         contents=message,
#          config=types.GenerateContentConfig(
#              system_instruction=prompts.SYSTEM_PROMPT,
#          ),
#     )

#     return jsonify(ok=True, feedback=res.text) 


# @app.post("/generate-quiz")
# def generate_quiz():
#     """시험지 생성"""
#     data = request.get_json()
#     return jsonify(ok=True, items=[])


# ─────────────────────────────────────────────
# 그 밖의 주소
# ─────────────────────────────────────────────
@app.post("/check-system")
def check_system():
    """정오 판별만 따로 해보고 싶을 때 쓰는 주소. (채팅에서는 위의 check_before_haku 가 알아서 한다)

    받는 것:     {message, history?}
    돌려주는 것: {ok: true, is_correct: true | false, feedback: "..."}
    """
    data = request.get_json(silent=True) or {}
    message = data.get("message")

    if not message or not str(message).strip():
        return jsonify(ok=False, error="message 가 비어 있습니다."), 400

    try:
        result = _check(message, data.get("history", []))
    except Exception as e:
        return jsonify(ok=False, error=f"정오 판별에 실패했어요: {e}"), 500

    return jsonify(ok=True, is_correct=result.is_correct, feedback=result.feedback)


# 문제 검사: Gemini 가 만든 문제가 시험지에 저장해도 되는 모양인지 확인하고, 프론트가 쓰는 모양으로 바꾼다.
# 쓸 수 없는 문제면 ValueError 를 낸다. 깨진 문제가 DB 에 한 번 저장되면 시험지에 계속 남기 때문이다.
# 빈칸 표시는 괄호 안이 공백뿐인 것: (    ), ( ), 전각 （  ） 등. "print()" 처럼 아예 빈 괄호는 빈칸이 아니다.
BLANK_PATTERN = re.compile(r"[(（]\s+[)）]")
# Gemini 가 혼잡할 때 한글을 조합용 자모(U+1100~U+11FF)로 쪼개서 뜻이 깨진 글을 낸 적이 있다.
# 보통 글에는 나오지 않는 글자라서, 이것이 섞여 있으면 깨진 문제로 본다. ("ㄱ", "ㅏ" 같은 보통 자모는 괜찮다)
BROKEN_HANGUL_PATTERN = re.compile(r"[\u1100-\u11ff]")


def _blank_item(question, answers):
    """빈칸 문제 → {type: "blank", question, answers}. 빈칸이 없거나 정답 수가 빈칸 수와 다르면 ValueError."""
    question = question.strip()
    answers = [a.strip() for a in answers if a.strip()]
    blanks = len(BLANK_PATTERN.findall(question))
    if blanks == 0:
        raise ValueError("빈칸 (    ) 이 없는 빈칸 문제가 나왔어요.")
    if len(answers) != blanks:
        raise ValueError(f"빈칸은 {blanks}개인데 정답은 {len(answers)}개인 문제가 나왔어요.")
    return {"type": "blank", "question": question, "answers": answers}


def _choice_item(question, choices, answer_index):
    """객관식 문제 → {type: "choice", question, choices, answers: [정답 보기의 글]}.

    지문이 비었거나, 정답 번호가 올바르지 않거나, 보기가 2개 미만이면 ValueError.
    """
    question = question.strip()
    choices = [c.strip() for c in choices]
    if not question:
        raise ValueError("지문이 비어 있는 객관식 문제가 나왔어요.")
    if not 0 <= answer_index < len(choices) or not choices[answer_index]:
        raise ValueError("정답 번호가 올바르지 않은 객관식 문제가 나왔어요.")
    answer = choices[answer_index]
    # 빈 보기와 겹치는 보기는 뺀다. 정답 글은 위에서 먼저 꺼내 두었으므로 번호가 밀려도 정답은 그대로다.
    choices = list(dict.fromkeys(c for c in choices if c))
    if len(choices) < 2:
        raise ValueError("보기가 2개도 안 되는 객관식 문제가 나왔어요.")
    return {"type": "choice", "question": question, "choices": choices, "answers": [answer]}


def _fallback_quiz_type(previous):
    """유형 고르기가 실패했을 때 쓸 유형: 이미 낸 문제 중 더 적게 나온 유형. (같으면 객관식)

    이미 낸 문제의 유형은 지문으로 안다. 빈칸 표시 (    ) 가 있으면 빈칸 주관식, 없으면 객관식.
    """
    blanks = sum(1 for q in previous if BLANK_PATTERN.search(q))
    return "blank" if blanks < len(previous) - blanks else "choice"


def _choose_quiz_type(history, previous):
    """다음 문제를 빈칸 주관식(blank) / 객관식(choice) 중 어느 유형으로 낼지 QUIZ_TYPE_MODEL 에게 고르게 한다.

    문제를 만드는 호출과 나눈 이유: 유형 고르기 프롬프트(CHOOSE_QUIZ_TYPE)와 문제 프롬프트를 따로 다듬으려고.
    고르기에 실패해도(혼잡, 사용량 초과 등) 퀴즈가 막히지 않게, 이미 낸 문제 중 더 적게 나온 유형으로 정한다.
    """
    contents = _history_to_contents(history, include_system=True)
    request_text = "지금까지 대화로 다음 시험 문제의 유형을 골라줘."
    if previous:
        request_text += "\n아래는 이미 낸 문제야. ([ ] 안은 그 문제의 유형)\n" + "\n".join(
            f"- [{'빈칸 주관식' if BLANK_PATTERN.search(q) else '객관식'}] {q}" for q in previous
        )
    contents.append(types.Content(role="user", parts=[types.Part(text=request_text)]))

    try:
        res = _generate_with_retry(
            attempts=2,
            model=QUIZ_TYPE_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=prompts.CHOOSE_QUIZ_TYPE,  # prompts.py 의 유형 고르기 프롬프트
                response_mime_type="application/json",
                response_schema=QuizTypeResult,
            ),
        )
        result = _parse(res, QuizTypeResult)
    except Exception as e:
        fallback = _fallback_quiz_type(previous)
        app.logger.warning("문제 유형을 고르지 못해서 %s 로 정함: %s", fallback, e)
        return fallback

    app.logger.info("문제 유형: %s (%s)", result.type, result.reason)
    return result.type


def _generate_quiz(contents, prompt, schema):
    """QUIZ_MODELS 를 앞에서부터 시도해서 문제를 만든다. 돌려주는 것: (결과, 맨 뒤 모델로 만들었는지).

    한 모델이 실패하면(사용량 초과, 혼잡, 시간 초과, 응답이 깨짐 등) 기다리지 않고 바로 다음 모델로 넘어간다.
    모델이 하나뿐이면 예전처럼 혼잡할 때 잠깐 기다렸다가 다시 시도한다. 모두 실패하면 마지막 오류를 그대로 올린다.
    """
    if len(QUIZ_MODELS) == 1:
        res = _generate_with_retry(
            model=QUIZ_MODELS[0],
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=prompt,
                response_mime_type="application/json",
                response_schema=schema,
                http_options=types.HttpOptions(timeout=QUIZ_LAST_MODEL_TIMEOUT_MS),
            ),
        )
        return _parse(res, schema), False

    last = len(QUIZ_MODELS) - 1
    for i, model in enumerate(QUIZ_MODELS):
        timeout = QUIZ_LAST_MODEL_TIMEOUT_MS if i == last else QUIZ_MODEL_TIMEOUT_MS
        try:
            res = client.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=prompt,
                    response_mime_type="application/json",
                    response_schema=schema,
                    http_options=types.HttpOptions(timeout=timeout),
                ),
            )
            return _parse(res, schema), i == last
        except Exception as e:
            if i == last:
                raise
            app.logger.warning("문제 생성 모델 %s 실패, 다음 모델로 넘어감: %s", model, str(e)[:200])


@app.post("/generate-quiz")
def generate_quiz():
    """지금까지의 대화로 시험지 문제를 하나 만든다. [퀴즈 풀기] 를 눌렀을 때 호출된다.

    받는 것:     {history, previous?, type?}  (previous = 이미 낸 문제의 지문들)
        type 을 안 보내면(지금의 quiz.js) 두 단계로 만든다.
          ① _choose_quiz_type(): QUIZ_TYPE_MODEL 이 대화 내용을 보고 빈칸 주관식 / 객관식 중 더 맞는 유형을 고른다.
          ② QUIZ_MODELS 가 (앞에서부터 차례로) 고른 유형의 프롬프트(GENERATE_QUIZ / GENERATE_CHOICE_QUIZ)로 문제를 만든다.
        type 에 "blank" | "choice" 를 보내면 ① 없이 그 유형으로만 만든다. (예전 방식. 옛 화면이 보내도 동작하게 남겨 둔다)
    돌려주는 것: {ok: true, items: [{type, question: "...", answers: ["...", ...], choices?: [...]}]}  (문제는 최대 1개)
        type 이 "choice"(객관식)면 choices 에 보기들이 오고, answers 에는 정답 보기 1개만 담긴다.
        대화에 문제로 낼 내용이 없으면 items 가 빈 목록이고, Gemini 가 깨진 문제를 주면 ok: false 다.
        맨 뒤(마지막 수단) 모델로 만들었으면 notice 에 QUIZ_FALLBACK_NOTICE 가 같이 온다.
    """
    data = request.get_json(silent=True) or {}
    history = data.get("history", [])
    contents = _history_to_contents(history, include_system=True)

    if not contents:
        return jsonify(ok=False, error="대화 기록이 없어서 문제를 만들 수 없어요."), 400

    # 이미 낸 문제들 (선택). 프론트가 보내주면 그것과 겹치지 않는 새 문제를 만들게 한다.
    # 시험지에 문제가 쌓여 갈 때, 같은 문제가 또 나오지 않게 하기 위한 것.
    previous = data.get("previous", [])
    if not isinstance(previous, list):
        previous = []
    previous = [q.strip() for q in previous if isinstance(q, str) and q.strip()]

    # ① 유형: 정해서 보냈으면 그대로, 안 보냈으면(이상한 값 포함) Gemini 에게 먼저 고르게 한다.
    quiz_type = data.get("type")
    if quiz_type not in ("blank", "choice"):
        quiz_type = _choose_quiz_type(history, previous)

    # 대화가 하쿠(model) 의 말로 끝나면 Gemini 가 "무엇을 하라는 건지" 모르므로
    # 마지막에 사용자 요청 한 줄을 붙인다.
    request_text = "지금까지 대화로 시험지를 만들어줘."
    if previous:
        request_text += (
            "\n아래는 이미 낸 문제야. 이 문제들과 겹치지 않게, 대화의 다른 내용으로 새 문제를 만들어줘.\n"
            + "\n".join(f"- {q}" for q in previous)
        )
    contents.append(types.Content(role="user", parts=[types.Part(text=request_text)]))

    # ② 고른 유형의 프롬프트와 응답 형식으로 문제를 만든다.
    if quiz_type == "choice":
        prompt, schema = prompts.GENERATE_CHOICE_QUIZ, ChoiceResult
    else:
        prompt, schema = prompts.GENERATE_QUIZ, QuizResult

    try:
        result, used_fallback = _generate_quiz(contents, prompt, schema)
    except Exception as e:
        return jsonify(ok=False, error=f"문제를 만들지 못했어요: {e}"), 500

    # 마지막 수단 모델로 만들었으면 퀴즈 화면에 안내 문구를 같이 띄운다.
    notice = {"notice": QUIZ_FALLBACK_NOTICE} if used_fallback else {}

    # 시험지는 한 문제만 낸다. Gemini 가 여러 개를 줘도 첫 번째만 쓴다.
    # 대화에 문제로 낼 내용이 없어서 빈 목록이 오면 그대로 돌려준다. (quiz.js 가 안내 문구를 띄운다)
    if not result.items:
        return jsonify(ok=True, items=[], **notice)
    item = result.items[0]

    try:
        if quiz_type == "choice":
            quiz_item = _choice_item(item.question, item.choices, item.answer_index)
        else:
            quiz_item = _blank_item(item.question, item.answers)
        texts = [quiz_item["question"], *quiz_item["answers"], *quiz_item.get("choices", [])]
        if any(BROKEN_HANGUL_PATTERN.search(text) for text in texts):
            raise ValueError("글자가 깨진 문제가 나왔어요.")
    except ValueError as e:
        # 실패로 돌려보내면 quiz.js 가 저장하지 않으므로, 다음에 퀴즈 화면을 열 때 다시 만든다.
        app.logger.warning("쓸 수 없는 문제라서 버림: %s %r", e, item)
        return jsonify(ok=False, error=f"문제를 만들지 못했어요: {e} 새로고침하면 다시 만들어요."), 500

    return jsonify(ok=True, items=[quiz_item], **notice)


# 레벨의 범위. 프론트(user.js)의 LEVEL_MIN / LEVEL_MAX 와 같은 값.
LEVEL_MIN, LEVEL_MAX = 1, 5


@app.post("/judge-level")
def judge_level():
    """사용자의 대답 하나가 어느 학교급 학생이 할 만한 설명인지 판단한다. (레벨 1~5)

    채팅에서 사용자가 메시지를 보낼 때마다 chat.js 가 하쿠의 대답과 따로 부른다. (하쿠는 이 결과를 기다리지 않는다)
    받는 것:     {message, question?}  (question = 이 대답 바로 전에 하쿠가 한 말. 무엇에 대한 대답인지 알려준다)
    돌려주는 것: {ok: true, is_explanation: true | false, level: 1~5, reason: "..."}
        is_explanation 이 false(질문, "모르겠어" 같은 말, "무슨 색이야?" 에 "초록색이야" 처럼 한 단어 답)면 level 은 쓰지 않는다.
    판단한 레벨을 DB 에 기록하고 사용자의 레벨을 움직이는 것은 프론트(store.js / user.js)가 한다.
    """
    data = request.get_json(silent=True) or {}
    message = str(data.get("message") or "").strip()
    question = str(data.get("question") or "").strip()

    if not message:
        return jsonify(ok=False, error="message 가 비어 있습니다."), 400

    # 대화 전체가 아니라 하쿠의 마지막 질문과 이번 대답만 보낸다. 판단할 대답이 무엇인지 헷갈리지 않게.
    text = f"하쿠의 질문: {question}\n사용자의 대답: {message}" if question else f"사용자의 설명: {message}"

    try:
        res = _generate_with_retry(
            attempts=2,
            model=LEVEL_MODEL,
            contents=[types.Content(role="user", parts=[types.Part(text=text)])],
            config=types.GenerateContentConfig(
                system_instruction=prompts.JUDGE_LEVEL,  # prompts.py 의 대답 수준 판단 프롬프트
                response_mime_type="application/json",
                response_schema=LevelResult,
            ),
        )
        result = _parse(res, LevelResult)
    except Exception as e:
        app.logger.warning("대답 수준을 판단하지 못함: %s", e)
        return jsonify(ok=False, error=f"대답 수준을 판단하지 못했어요: {e}"), 500

    # Gemini 가 범위 밖의 숫자를 줘도 1~5 안으로 맞춘다.
    level = min(max(result.level, LEVEL_MIN), LEVEL_MAX)
    app.logger.info("대답 수준: %d (%s)", level, result.reason)
    return jsonify(ok=True, is_explanation=result.is_explanation, level=level, reason=result.reason)


if __name__ == "__main__":
    # debug=True 면 파일 저장 시 서버가 자동 재시작된다. 개발 중에만 켤 것.
    app.run(debug=True, port=5000)