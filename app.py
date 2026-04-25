import os
import json
import asyncio
import httpx
import base64
import csv
import random
import time
import threading  # 補回 csv_lock 需要的 threading
from datetime import datetime
from dotenv import load_dotenv
from urllib.parse import quote

# FastAPI 核心組件
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse  # 補上 HTMLResponse
from fastapi.staticfiles import StaticFiles             # 用於掛載靜態檔案
from fastapi.templating import Jinja2Templates

load_dotenv()

# 初始化 Flask 應用
app = FastAPI()

csv_lock = threading.Lock()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# 全域變數載入資料
try:
    with open('static/data/easy_mode.json', 'r', encoding='utf-8') as f:
        EASY_DATA = json.load(f)
    with open('static/data/hard_mode.json', 'r', encoding='utf-8') as f:
        HARD_DATA = json.load(f)
except Exception as e:
    print(f"警告：JSON 檔案載入失敗！{e}")
    EASY_DATA, HARD_DATA = [], []

def get_level_data(mode, level_idx):
    data_source = EASY_DATA if mode == 'easy' else HARD_DATA
    return next((item for item in data_source if item["level"] == int(level_idx)), None)

# --- API 配置 ---
API_KEY = os.getenv("GEMINI_API_KEY") 

# 確保使用你測試成功的 2.5 版本
GEMINI_TEXT_MODEL = "gemini-2.5-flash" 
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/"

# --- Hugging Face 配置 ---
HF_TOKEN = os.getenv("HF_TOKEN")
HF_API_URL = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"

# 限制同時呼叫 AI 的人數，避免沖垮 API 或佔滿後端執行緒
gemini_semaphore = asyncio.Semaphore(8)
# 生圖最吃資源，一台容器只准 3 個同時跑，剩下的去排隊觸發自動擴展
image_semaphore = asyncio.Semaphore(10)

# --- 核心 AI 呼叫函式 ---
async def call_gemini_api(prompt: str, system_instruction: str) -> str:
    if not API_KEY:
        return "回饋失敗：API Key 缺失。"

    url = f"{GEMINI_API_BASE}{GEMINI_TEXT_MODEL}:generateContent?key={API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "generationConfig": {"temperature": 0.5}
    }

    # 使用 AsyncClient 處理非同步請求
    async with httpx.AsyncClient(timeout=25.0) as client:
        for attempt in range(3):
            try:
                response = await client.post(url, json=payload)
                
                if response.status_code == 429:
                    if attempt == 2:
                        return "回饋失敗：AI 老師現在學生太多了。"
                    await asyncio.sleep((attempt + 1) * 2) # 非同步等待，不卡死線程
                    continue
                
                response.raise_for_status()
                result = response.json()
                
                # 取得回傳文字
                parts = result.get('candidates', [{}])[0].get('content', {}).get('parts', [])
                if not parts:
                    return "回饋失敗：AI 老師暫時說不出話。"
                
                return parts[0].get('text', '').strip()
                
            except Exception as e:
                print(f"Gemini 嘗試第 {attempt+1} 次失敗: {e}")
                if attempt == 2:
                    return "回饋失敗：AI 老師連線異常。"
                await asyncio.sleep(1)
    return "回饋失敗。"

async def call_pollinations_api(user_sentence: str) -> str:
    if not user_sentence: return None
    
    # 建立一個持久的 Client 避免重複建立連線消耗資源
    async with httpx.AsyncClient(timeout=30.0) as client: 
        for attempt in range(2):
            # 每次嘗試都換一個新 Seed，這比單純等待更有用
            seed = random.randint(0, 999999)
            modified_prompt = f"{user_sentence} [{seed}]" 
            encoded_prompt = quote(modified_prompt)
            url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?model=flux&width=512&height=512&nologo=true"
            
            try:
                response = await client.get(url)
                if response.status_code == 200:
                    img_base64 = base64.b64encode(response.content).decode('utf-8')
                    return f"data:image/jpeg;base64,{img_base64}"
                
                # 如果 429 或 500，稍微睡一下下立刻重試
                print(f"Pollinations 第 {attempt+1} 次嘗試失敗: {response.status_code}")
                await asyncio.sleep(0.5) 
            except Exception as e:
                print(f"Pollinations 異常 ({attempt+1}): {e}")
                await asyncio.sleep(0.5)
    return None

# --- CSV 紀錄功能 ---
def save_to_csv(data_dict):
    # 關鍵：一定要寫在 /tmp 目錄下
    file_path = '/tmp/record.csv'
    fieldnames = [
        'timestamp', 'level', 'feedback_round', 'selected_words', 
        'user_sentence', 'ai_feedback', 'word_stars', 'sentence_stars', 'total_stars'
    ]
    
    file_exists = os.path.isfile(file_path)
    try:
        # 非同步環境下若怕衝突，可搭配原本的 csv_lock
        with csv_lock:
            with open(file_path, mode='a', newline='', encoding='utf-8-sig') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                if not file_exists:
                    writer.writeheader()
                writer.writerow(data_dict)
    except Exception as e:
        print(f"CSV 寫入失敗 (權限或路徑問題): {e}")

# --- AI 分析分析功能 ---
async def get_sentence_analysis(user_sentence: str, correct_selected: list, wrong_selected: list, missing_words: list, target_answers: list, sentence_prompt: str, round_index: int) -> str:
    system_instruction = (
        "你是一位國中一年級英文老師。請根據『原始圖片包含的正確單字』進行回饋。"
        "1. 禁止使用任何 Markdown 符號（如 ** 或 __）。"
        "2. 單字提示：請針對『學生遺漏的所有正確單字』逐一提供外觀、特徵或位置線索，不准說出英文單字本身。"
        "3. 畫面引導：必須嚴格參考『原始圖片正確單字』。每次建議增加一個簡單細節。"
    )

    prompt = (
        f"【教學現況】這是第 {round_index + 1} 次回饋。\n"
        f"圖片中真實存在的正確單字: {', '.join(target_answers)}\n"
        f"學生選中的正確單字: {', '.join(correct_selected)}\n"
        f"學生選中的錯誤單字: {', '.join(wrong_selected)}\n"
        f"學生目前造句: 『{user_sentence}』\n"
        f"要求句型: 『{sentence_prompt}』\n\n"
        "請換行提供：1.單字提示、2.文法修正、3.畫面引導建議。"
    )

    # 關鍵：加上 await
    ai_critique = await call_gemini_api(prompt, system_instruction)
    return ai_critique.replace("1. ", "\n1. ")

# --- FastAPI 路由 ---

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/easy", response_class=HTMLResponse)
async def easy_mode(request: Request):
    return templates.TemplateResponse("easy_mode.html", {"request": request})

@app.get("/hard", response_class=HTMLResponse)
async def hard_mode(request: Request):
    return templates.TemplateResponse("hard_mode.html", {"request": request})

@app.get("/portfolio.html", response_class=HTMLResponse)
async def portfolio(request: Request):
    return templates.TemplateResponse("portfolio.html", {"request": request})

@app.post("/api/ai_feedback")
async def get_ai_feedback(request: Request):
    async with gemini_semaphore:
        try:
            data = await request.json()
            mode = data.get('mode', 'easy')
            level_idx = data.get('level', 1)
            user_sentence = data.get('user_sentence', '').strip()
            sentence_prompt = data.get('sentence_prompt', '').strip()
            selected_cards = data.get('correct_words', []) 
            round_index = int(data.get('feedback_count', 0))
            
            word_stars = int(data.get('word_stars', 0))
            sentence_stars = int(data.get('sentence_stars', 0))
            total_stars = word_stars + sentence_stars

            # --- 修改部分：直接使用預載入的資料 ---
            current_level_data = get_level_data(mode, level_idx)
            
            if not current_level_data:
                return JSONResponse(status_code=404, content={"feedback": "找不到關卡資料。"})
            
            standard_answers = [a.lower() for a in current_level_data["answer"]]
            # ------------------------------------

            correct_selected = [w for w in selected_cards if w.lower() in standard_answers]
            wrong_selected = [w for w in selected_cards if w.lower() not in standard_answers]
            missing_words = [w for w in standard_answers if w.lower() not in [x.lower() for x in selected_cards]]

            # 呼叫非同步分析
            feedback = await get_sentence_analysis(
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
                'ai_feedback': feedback.replace('\n', ' '),
                'word_stars': word_stars,
                'sentence_stars': sentence_stars,
                'total_stars': total_stars
            }
            save_to_csv(log_data)

            return {"feedback": feedback}
        except Exception as e:
            print(f"Error in ai_feedback: {e}")
            return JSONResponse(status_code=500, content={"feedback": "伺服器處理錯誤。"})

@app.post("/api/generate_image")
async def generate_image(request: Request):
    async with image_semaphore:
        try:
            data = await request.json()
            user_sentence = data.get('user_sentence', '').strip()
            mode = data.get('mode', 'easy')
            level_idx = data.get('level', 1)
            word_stars = int(data.get('word_stars', 0))
            sentence_stars = int(data.get('sentence_stars', 0))

            # 非同步呼叫 Pollinations
            image_base64_url = await call_pollinations_api(user_sentence)
            
            log_data = {
                'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'level': f"{mode}_{level_idx}",
                'feedback_round': '生成圖片階段',
                'selected_words': ",".join(data.get('correct_words', [])),
                'user_sentence': user_sentence,
                'ai_feedback': 'Pollinations Image Generated' if image_base64_url else 'Failed',
                'word_stars': word_stars,
                'sentence_stars': sentence_stars,
                'total_stars': word_stars + sentence_stars
            }
            save_to_csv(log_data)

            if not image_base64_url:
                return {"error": "image_failed"}

            return {
                "image_url": image_base64_url,
                "status": "success"
            }
        except Exception as e:
            print(f"路由報錯: {e}")
            return JSONResponse(status_code=500, content={"error": "server_error"})

# FastAPI 啟動方式 (本地測試用，部署到 Cloud Run 會用 Dockerfile 裡的 uvicorn)
if __name__ == "__main__":
    import uvicorn
    # 這裡要抓環境變數的 PORT，如果沒有就預設 8080
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
