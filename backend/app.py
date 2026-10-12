"""Sensei 백엔드 (Flask + Gemini).

주소는 3개다.
    POST /ask-haku       사용자의 설명 → 하쿠의 꼬리질문 (정오 판별을 먼저 거친다)
    POST /check-system   정오 판별만 따로
    POST /generate-quiz  지금까지의 대화 → 빈칸 문제 1개

/ask-haku 로 메시지가 오면 아래 순서로 지나간다. 이 파일도 같은 순서로 적혀 있다.
    1) check_before_haku()    정오 판별. 틀렸으면 여기서 "틀렸어요. ..." 로 바로 응답하고 끝난다.
    2) ask_haku()             맞았을 때만 실행된다. 하쿠가 꼬리질문을 한다.
    3) replace_quota_error()  Gemini 사용량 초과였다면 긴 영어 오류를 짧은 안내 문구로 바꾼다.

하쿠 / 정오 판별 / 문제 생성은 서로 다른 Gemini 호출이고, 각자의 프롬프트는 prompts.py 에 있다.
"""

import json
import os
import time

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, jsonify, request
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
QUIZ_MODEL = os.getenv("QUIZ_MODEL", CHECK_MODEL)
# 정리:  HAKU_MODEL = 하쿠 꼬리질문 / CHECK_MODEL = 정오 판별 / QUIZ_MODEL = 문제 생성
# 무료 사용량은 모델마다 따로 계산되므로, 셋을 다른 모델로 두면 하루에 더 많이 쓸 수 있다.


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
        "틀린 내용이 없거나, 질문·모르겠다는 말·힌트 요청처럼 사실을 설명하는 말이 아니면 true."
    )
    feedback: str = Field(
        description="is_correct 가 false 일 때 어디가 틀렸는지 짧게 짚는 한두 문장. 정답은 알려주지 않는다. true 면 빈 문자열."
    )


# 문제 하나
class QuizItem(BaseModel):
    question: str = Field(
        description="빈칸에 들어갈 말은? 뒤에 문장이 오는 형식. 빈칸은 (    ) 로 표시한다."
    )
    answers: list[str] = Field(description="빈칸의 정답들. 문장 속 빈칸 순서대로.")


# 시험지 (문제 목록)
class QuizResult(BaseModel):
    items: list[QuizItem] = Field(description="문제는 딱 1개만 담는다.")


# ─────────────────────────────────────────────
# 공통 도구 (세 주소가 같이 쓴다)
# ─────────────────────────────────────────────
def _history_to_contents(history):
    """프론트가 보낸 대화 기록을 Gemini 의 Content 리스트로 바꾼다.

    history 는 [{role: "user" | "sensei", text: "..."}, ...] 형태.
    role 이 "sensei" 면 Gemini 기준으로는 모델(model)이 한 말이 된다.
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


def _generate_with_retry(**kwargs):
    """Gemini 가 잠깐 혼잡(503 UNAVAILABLE)하면 조금 기다렸다가 최대 3번까지 다시 시도한다.

    정오 판별과 문제 생성이 쓴다. (하쿠 쪽 ask_haku 는 재시도 없이 한 번만 부른다)
    """
    for attempt in range(3):
        try:
            return client.models.generate_content(**kwargs)
        except Exception as e:
            busy = "503" in str(e) or "UNAVAILABLE" in str(e)
            if not busy or attempt == 2:
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

    - 틀렸으면: 하쿠 모델을 부르지 않고 여기서 바로 응답을 돌려준다.
      ok=True + question="틀렸어요. ..." 라서, 프론트(chat.js)는 기존 코드 그대로 하쿠 말풍선으로 띄운다.
    - 맞았으면: None 을 돌려줘서 원래의 ask_haku() (SYSTEM_PROMPT) 가 그대로 실행된다.
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

    if result.is_correct:
        return None

    # 틀렸으면 하쿠의 말풍선으로 "틀렸다" 고 그대로 말한다.
    # ok=True + question 이라서 chat.js 는 평소 하쿠 대답과 똑같이 그리고, 대화 기록에도 남는다.
    feedback = result.feedback or "방금 설명에 틀린 부분이 있어요."
    return jsonify(
        ok=True,
        is_correct=False,
        feedback=feedback,
        question=f"틀렸어요. {feedback}",
    )


# ─────────────────────────────────────────────
# 2) 하쿠 꼬리질문: 정오 판별을 통과했을 때만 실행된다
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
                # system_instruction = 항상 같은 값 (하쿠의 역할 지시)
                # 프롬프트를 contents 에 사용자 말과 같이 붙여 보내면
                # Gemini 가 그걸 '사용자가 한 말'로 취급해 캐릭터가 무너진다.
                # 반드시 여기로 분리해서 넣을 것.
                system_instruction=prompts.SYSTEM_PROMPT,
            ),
        )
    except Exception as e:
        # Gemini 쪽 오류(키 문제, 네트워크, 모델명 오타 등)를 그대로 500 HTML 로 터뜨리면
        # 프론트의 res.json() 이 깨진다. JSON 으로 감싸서 돌려준다.
        return jsonify(ok=False, error=f"하쿠가 응답하지 못했어요: {e}"), 500

    # res.text 가 실제 하쿠의 문장이다.
    return jsonify(ok=True, question=res.text)


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


@app.post("/generate-quiz")
def generate_quiz():
    """지금까지의 대화로 시험지(빈칸 문제)를 만든다. [퀴즈 풀기] 를 눌렀을 때 호출된다.

    받는 것:     {history, previous?}  (previous = 이미 낸 문제의 지문들)
    돌려주는 것: {ok: true, items: [{question: "...", answers: ["...", ...]}]}  (문제는 항상 1개)
    """
    data = request.get_json(silent=True) or {}
    contents = _history_to_contents(data.get("history", []))

    if not contents:
        return jsonify(ok=False, error="대화 기록이 없어서 문제를 만들 수 없어요."), 400

    # 이미 낸 문제들 (선택). 프론트가 보내주면 그것과 겹치지 않는 새 문제를 만들게 한다.
    # 시험지에 문제가 쌓여 갈 때, 같은 문제가 또 나오지 않게 하기 위한 것.
    previous = data.get("previous", [])
    if not isinstance(previous, list):
        previous = []
    previous = [q.strip() for q in previous if isinstance(q, str) and q.strip()]

    # 대화가 하쿠(model) 의 말로 끝나면 Gemini 가 "무엇을 하라는 건지" 모르므로
    # 마지막에 사용자 요청 한 줄을 붙인다.
    request_text = "지금까지 대화로 시험지를 만들어줘."
    if previous:
        request_text += (
            "\n아래는 이미 낸 문제야. 이 문제들과 겹치지 않게, 대화의 다른 내용으로 새 문제를 만들어줘.\n"
            + "\n".join(f"- {q}" for q in previous)
        )
    contents.append(types.Content(role="user", parts=[types.Part(text=request_text)]))

    try:
        res = _generate_with_retry(
            model=QUIZ_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=prompts.GENERATE_QUIZ,
                response_mime_type="application/json",
                response_schema=QuizResult,
            ),
        )
        result = _parse(res, QuizResult)
    except Exception as e:
        return jsonify(ok=False, error=f"문제를 만들지 못했어요: {e}"), 500

    # 시험지는 한 문제만 낸다. Gemini 가 여러 개를 줘도 첫 번째만 쓴다.
    return jsonify(ok=True, items=[item.model_dump() for item in result.items[:1]])


if __name__ == "__main__":
    # debug=True 면 파일 저장 시 서버가 자동 재시작된다. 개발 중에만 켤 것.
    app.run(debug=True, port=5000)