import os

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, jsonify, request
from google import genai             
from google.genai import types

import prompts

app = Flask(__name__)

# Gemini 통신 객체. 함수 밖에 두어 서버 시작 시 1회만 생성하고 계속 재사용한다.
# 함수 안에 넣으면 요청마다 새로 만들어져 느려진다.

# 괄호를 비워두면 라이브러리가 알아서 환경변수에서 'GEMINI_API_KEY'를 찾아서 사용합니다.
client = genai.Client()

# 이쪽은 getenv + 기본값. .env 에 없어도 일단 돌아가야 하므로.
# 모델명은 자주 바뀌니 코드에 박지 말고 .env 에서만 관리한다.
HAKU_MODEL = os.getenv("HAKU_MODEL", "gemini-3-flash-preview")
CHECK_MODEL = os.getenv("CHECK_MODEL", "gemini-3-flash-preview")


@app.post("/ask-haku")
def ask_haku():
    """하쿠 꼬리질문 반환"""
    # 프론트가 보낸 JSON을 파이썬 딕셔너리로 변환
    data = request.get_json()

    # 사용자가 방금 한 말을 꺼낸다.
    message = data.get("message")

    # message 가 비어 있으면 Gemini 호출 자체가 400 으로 터진다.
    # 여기서 미리 걸러서 프론트가 읽을 수 있는 형태로 돌려준다.
    if not message:
        return jsonify(ok=False, error="message 가 비어 있습니다."), 400

    res = client.models.generate_content(
        model=HAKU_MODEL,
        # contents = 매번 바뀌는 값 (사용자가 방금 한 말)
        contents=message,

        config=types.GenerateContentConfig(
            # system_instruction = 항상 같은 값 (하쿠의 역할 지시)
            # 프롬프트를 contents 에 사용자 말과 같이 붙여 보내면
            # Gemini 가 그걸 '사용자가 한 말'로 취급해 캐릭터가 무너진다.
            # 반드시 여기로 분리해서 넣을 것.
            system_instruction=prompts.SYSTEM_PROMPT,
        ),
    )

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