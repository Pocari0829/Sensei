import os

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, jsonify, request
from google import genai             
from google.genai import types
from flask_cors import CORS

import backend.prompts as prompts

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


if __name__ == "__main__":
    # debug=True 면 파일 저장 시 서버가 자동 재시작된다. 개발 중에만 켤 것.
    app.run(debug=True, port=5000)