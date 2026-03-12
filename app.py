import os
import json
import requests
import time
from flask import Flask, render_template, request, jsonify
import base64
import csv
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# 初始化 Flask 應用
app = Flask(__name__)

# --- API 配置 ---
API_KEY = os.getenv("GEMINI_API_KEY") 

# 確保使用你測試成功的 2.5 版本
GEMINI_TEXT_MODEL = "gemini-2.5-flash" 
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/"

# --- Hugging Face 配置 ---
HF_TOKEN = os.getenv("HF_TOKEN")
HF_API_URL = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"

# --- 核心 AI 呼叫函式 ---

def call_gemini_api(prompt: str, system_instruction: str) -> str:
    """呼叫 Gemini API，加入重試機制與精準錯誤處理。"""
    if not API_KEY:
        return "回饋失敗：AI 服務未配置 (API Key 缺失)。"

    url = f"{GEMINI_API_BASE}{GEMINI_TEXT_MODEL}:generateContent?key={API_KEY}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{ "text": system_instruction }]},
        "generationConfig": {"temperature": 0.5}
    }

    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=20)
            
            # 處理 429 流量限制
            if response.status_code == 429:
                if attempt == max_retries - 1:
                    return "回饋失敗：AI 老師現在學生太多了，請稍等幾秒再試。"
                wait_time = (attempt + 1) * 3
                time.sleep(wait_time)
                continue
                
            response.raise_for_status()
            result = response.json()
            
            candidates = result.get('candidates', [])
            if not candidates:
                return "回饋失敗：AI 老師暫時說不出話（內容可能被過濾）。"

            generated_text = candidates[0].get('content', {}).get('parts', [{}])[0].get('text')
            return generated_text.strip() if generated_text else "回饋失敗：內容生成空值。"
            
        except Exception as e:
            print(f"API 詳細錯誤訊息: {str(e)}")
            if attempt == max_retries - 1:
                return "回饋失敗：AI 老師連線異常，請稍後再試。"
            time.sleep(1)
    return "回饋失敗。"

def call_hf_image_api(user_sentence: str) -> str:
    """
    取代原有的 Pollinations AI，改用 Hugging Face Flux 生成圖片。
    回傳 Base64 字串供前端直接顯示。
    """
    if not user_sentence:
        return None
    
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    
    try:
        # 呼叫 Hugging Face API
        response = requests.post(HF_API_URL, headers=headers, json={"inputs": user_sentence}, timeout=30)
        
        if response.status_code == 503:
            print("HF 模型正在加載中...")
            return None # 或者可以丟出特定錯誤讓前端提示稍候
            
        if response.status_code == 200:
            # 將圖片二進位轉成 Base64
            img_base64 = base64.b64encode(response.content).decode('utf-8')
            return f"data:image/jpeg;base64,{img_base64}"
        else:
            print(f"HF API 報錯: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        print(f"HF 請求異常: {e}")
        return None

# --- CSV 紀錄功能 ---
def save_to_csv(data_dict):
    file_path = 'record.csv'
    fieldnames = [
        'timestamp', 'level', 'feedback_round', 'selected_words', 
        'user_sentence', 'ai_feedback', 'word_stars', 'sentence_stars', 'total_stars'
    ]
    
    file_exists = os.path.isfile(file_path)
    try:
        with open(file_path, mode='a', newline='', encoding='utf-8-sig') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            writer.writerow(data_dict)
    except Exception as e:
        print(f"CSV 寫入失敗: {e}")

# --- AI 分析分析功能 ---
# --- AI 分析分析功能 (修正參數數量，補上 round_index) ---
def get_sentence_analysis(user_sentence: str, correct_selected: list, wrong_selected: list, missing_words: list, target_answers: list, sentence_prompt: str, round_index: int) -> str:
    system_instruction = (
        "你是一位國中一年級英文老師。請根據『原始圖片包含的正確單字』進行回饋。"
        "1. 禁止使用任何 Markdown 符號（如 ** 或 __）。"
        "2. 單字提示：請針對『學生遺漏的所有正確單字』逐一提供外觀、特徵或位置線索，不准說出英文單字本身。"
        "3. 畫面引導：必須嚴格參考『原始圖片正確單字』。每次建議增加一個簡單細節。"
    )

    # 這裡可以用 round_index 來微調 Prompt 內容 (選用)
    prompt = (
        f"【教學現況】這是第 {round_index + 1} 次回饋。\n"
        f"圖片中真實存在的正確單字: {', '.join(target_answers)}\n"
        f"學生選中的正確單字: {', '.join(correct_selected)}\n"
        f"學生選錯的單字: {', '.join(wrong_selected)}\n"
        f"學生遺漏的單字: {', '.join(missing_words)}\n"
        f"學生目前造句: 『{user_sentence}』\n"
        f"要求句型: 『{sentence_prompt}』\n\n"
        "請務必依照以下編號順序回報，以下三個段落每段之間換一行即可：\n"
        "1. 單字提示：針對遺漏單字提供線索\n"
        "2. 文法修正：檢查句子文法與單字拼法\n"
        "3. 畫面引導建議：如何讓句子更接近圖片內容"
    )

    ai_critique = call_gemini_api(prompt, system_instruction)
    return ai_critique.replace("1. ", "\n1. ")

# --- Flask 路由 ---

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/easy")
def easy_mode():
    return render_template("easy_mode.html")

@app.route("/hard")
def hard_mode():
    return render_template("hard_mode.html")

@app.route('/portfolio.html')
def portfolio():
    return render_template('portfolio.html')

@app.route("/api/ai_feedback", methods=["POST"])
def get_ai_feedback():
    try:
        data = request.get_json()
        mode = data.get('mode', 'easy')
        level_idx = data.get('level', 1)
        user_sentence = data.get('user_sentence', '').strip()
        sentence_prompt = data.get('sentence_prompt', '').strip()
        selected_cards = data.get('correct_words', []) 
        round_index = int(data.get('feedback_count', 0)) # 0 或 1
        
        word_stars = int(data.get('word_stars', 0))
        sentence_stars = int(data.get('sentence_stars', 0))
        total_stars = word_stars + sentence_stars

        json_file = f'static/data/{mode}_mode.json'
        with open(json_file, 'r', encoding='utf-8') as f:
            full_data = json.load(f)
        
        current_level_data = next((item for item in full_data if item["level"] == int(level_idx)), None)
        standard_answers = [a.lower() for a in current_level_data["answer"]] if current_level_data else []
        
        correct_selected = [w for w in selected_cards if w.lower() in standard_answers]
        wrong_selected = [w for w in selected_cards if w.lower() not in standard_answers]
        missing_words = [w for w in standard_answers if w.lower() not in [x.lower() for x in selected_cards]]

        # 呼叫分析，傳入 round_index 讓 AI 調整語氣
        feedback = get_sentence_analysis(
            user_sentence, correct_selected, wrong_selected, 
            missing_words, standard_answers, sentence_prompt, round_index
        )

        # 紀錄至 CSV
        log_data = {
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'level': f"{mode}_{level_idx}",
            'feedback_round': f"第 {round_index + 1} 次回饋 (總共 2 次)",
            'selected_words': ",".join(selected_cards),
            'user_sentence': user_sentence,
            'ai_feedback': feedback.replace('\n', ' '), # 移除換行避免 CSV 跑版
            'word_stars': word_stars,
            'sentence_stars': sentence_stars,
            'total_stars': total_stars
        }
        save_to_csv(log_data)

        return jsonify({"feedback": feedback})
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"feedback": "伺服器處理錯誤。"}), 500

@app.route("/api/generate_image", methods=["POST"])
def generate_image():
    try:
        data = request.get_json()
        user_sentence = data.get('user_sentence', '').strip()
        mode = data.get('mode', 'easy')
        level_idx = data.get('level', 1)
        word_stars = int(data.get('word_stars', 0))
        sentence_stars = int(data.get('sentence_stars', 0))

        # --- 這裡改用 Hugging Face 工具 ---
        image_base64_url = call_hf_image_api(user_sentence)
        
        log_data = {
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'level': f"{mode}_{level_idx}",
            'feedback_round': '生成圖片階段',
            'selected_words': ",".join(data.get('correct_words', [])),
            'user_sentence': user_sentence,
            'ai_feedback': 'HuggingFace Image Generated' if image_base64_url else 'Failed',
            'word_stars': word_stars,
            'sentence_stars': sentence_stars,
            'total_stars': word_stars + sentence_stars
        }
        save_to_csv(log_data)

        if not image_base64_url:
            return jsonify({"error": "image_failed"}), 200

        # 回傳 Base64 URL 給前端 JS
        return jsonify({
            "image_url": image_base64_url,
            "status": "success"
        })
    except Exception as e:
        print(f"路由報錯: {e}")
        return jsonify({"error": "server_error"}), 500
    
if __name__ == "__main__":
    app.run(debug=True, host='0.0.0.0', port=5000)
