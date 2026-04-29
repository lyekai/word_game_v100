import os
import json
import asyncio
import httpx
import csv
import random
import threading  # 補回 csv_lock 需要的 threading
from datetime import datetime
from dotenv import load_dotenv
from urllib.parse import quote
from anyio import open_file, Lock as AsyncLock
import concurrent.futures

# FastAPI 核心組件
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, HTMLResponse  # 補上 HTMLResponse
from fastapi.staticfiles import StaticFiles             # 用於掛載靜態檔案
from fastapi.templating import Jinja2Templates
from fastapi import BackgroundTasks 
load_dotenv()

# 初始化 Flask 應用
app = FastAPI()

# --- 全域限流控制（核心關鍵） ---
GEMINI_SEMAPHORE = asyncio.Semaphore(5)   # 同時最多 5 個 Gemini 請求
IMAGE_SEMAPHORE = asyncio.Semaphore(1)    # 圖片生成一次只允許 1 個
LAST_GEMINI_CALL = 0
GEMINI_COOLDOWN = 5 

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

# --- 核心 AI 呼叫函式 ---
async def call_gemini_api(prompt: str, system_instruction: str) -> str:
    global LAST_GEMINI_CALL

    if not API_KEY:
        return "回饋失敗：API Key 缺失。"

    # 🔥 冷卻機制（避免 burst limit）
    now = asyncio.get_event_loop().time()
    elapsed = now - LAST_GEMINI_CALL

    if elapsed < GEMINI_COOLDOWN:
        wait_time = GEMINI_COOLDOWN - elapsed
        print(f"⏳ Gemini 冷卻中，等待 {wait_time:.2f} 秒")
        await asyncio.sleep(wait_time)

    LAST_GEMINI_CALL = asyncio.get_event_loop().time()

    url = f"{GEMINI_API_BASE}{GEMINI_TEXT_MODEL}:generateContent?key={API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system_instruction}]},
        "generationConfig": {"temperature": 0.5}
    }

    async with GEMINI_SEMAPHORE:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for attempt in range(3):
                try:
                    response = await client.post(url, json=payload)

                    print("status:", response.status_code)
                    print("response:", response.text[:200])

                    if response.status_code == 429:
                        if attempt == 2:
                            return "回饋失敗：AI 老師現在學生太多了。"

                        wait_time = (attempt + 1) * 5 + random.uniform(1, 2)
                        print(f"🔁 retry 等待 {wait_time:.2f} 秒")
                        await asyncio.sleep(wait_time)
                        continue

                    response.raise_for_status()

                    result = response.json()
                    parts = result.get('candidates', [{}])[0].get('content', {}).get('parts', [])
                    return parts[0].get('text', '').strip() if parts else "回饋失敗"

                except Exception as e:
                    print("🔥 Gemini exception:", repr(e))
                    if attempt == 2:
                        return "回饋失敗：連線異常"
                    await asyncio.sleep(2)
    return "回饋失敗"

async def call_pollinations_api(user_sentence: str) -> str:
    if not user_sentence:
        return None

    save_dir = "static/generated"
    if not os.path.exists(save_dir):
        os.makedirs(save_dir)

    clean_sentence = user_sentence.replace('\n', ' ').strip()
    seed = random.randint(0, 999999)
    encoded_prompt = quote(clean_sentence)

    api_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?seed={seed}&model=flux&width=512&height=512&nologo=true"

    file_name = f"gen_{datetime.now().strftime('%H%M%S')}_{seed}.jpg"
    file_path = os.path.join(save_dir, file_name)

    # 🔥🔥🔥 關鍵：圖片一定要排隊（否則一定爆）
    async with IMAGE_SEMAPHORE:
        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.get(api_url)

                if response.status_code == 200:
                    async with await open_file(file_path, "wb") as f:
                        await f.write(response.content)
                    return f"/static/generated/{file_name}"

                print(f"Pollinations 回傳錯誤碼: {response.status_code}")
                return None

            except Exception as e:
                print(f"生圖下載異常: {e}")
                return None

# --- CSV 紀錄功能 ---
csv_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

def sync_save_logic(data_dict):
    """這段跑在獨立執行緒，絕對不會卡住 FastAPI 主程式"""
    file_path = 'record.csv'
    fieldnames = ['timestamp', 'level', 'feedback_round', 'selected_words', 'user_sentence', 'ai_feedback', 'word_stars', 'sentence_stars', 'total_stars']
    file_exists = os.path.isfile(file_path)
    with csv_lock:
        with open(file_path, mode='a', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            writer.writerow(data_dict)

async def save_to_csv(data_dict):
    """改為呼叫 executor"""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(csv_executor, sync_save_logic, data_dict)

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
async def get_ai_feedback(request: Request, background_tasks: BackgroundTasks):
    try:
        data = await request.json()
        mode = data.get('mode', 'easy')
        level_idx = data.get('level', 1)
        user_sentence = data.get('user_sentence', '').strip()
        sentence_prompt = data.get('sentence_prompt', '').strip()
        selected_cards = data.get('correct_words', []) 
        round_index = int(data.get('feedback_count', 0))

        current_level_data = get_level_data(mode, level_idx)
        if not current_level_data:
            return JSONResponse(status_code=404, content={"feedback": "找不到關卡。"})
        
        standard_answers = [a.lower() for a in current_level_data["answer"]]
        correct_selected = [w for w in selected_cards if w.lower() in standard_answers]
        wrong_selected = [w for w in selected_cards if w.lower() not in standard_answers]
        missing_words = [w for w in standard_answers if w.lower() not in [x.lower() for x in selected_cards]]

        # 1. 優先執行 AI 分析 (這是學生最在意的)
        feedback = await get_sentence_analysis(
            user_sentence, correct_selected, wrong_selected, 
            missing_words, standard_answers, sentence_prompt, round_index
        )

        # 2. 將紀錄丟到背景執行，不准它影響 return 速度
        log_data = {
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'level': f"{mode}_{level_idx}",
            'feedback_round': f"第 {round_index + 1} 次回饋",
            'selected_words': ",".join(selected_cards),
            'user_sentence': user_sentence,
            'ai_feedback': feedback.replace('\n', ' '),
            'word_stars': int(data.get('word_stars', 0)),
            'sentence_stars': int(data.get('sentence_stars', 0)),
            'total_stars': int(data.get('word_stars', 0)) + int(data.get('sentence_stars', 0))
        }
        background_tasks.add_task(save_to_csv, log_data)

        # 3. 秒噴結果
        return {"feedback": feedback}
    except Exception as e:
        print(f"文字回饋異常: {e}")
        print("Gemini error:", repr(e))
        return JSONResponse(status_code=500, content={"feedback": "老師目前學生太多，請再試一次。"})

@app.post("/api/generate_image")
async def generate_image(request: Request, background_tasks: BackgroundTasks):
    try:
        data = await request.json()
        user_sentence = data.get('user_sentence', '').strip()
        
        # 1. 執行圖片下載
        image_url = await call_pollinations_api(user_sentence)
        if not image_url:
            return {"error": "image_failed"}

        # 2. 準備紀錄並丟入背景
        log_data = {
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'level': f"{data.get('mode', 'easy')}_{data.get('level', 1)}",
            'feedback_round': '生成圖片階段',
            'selected_words': ",".join(data.get('correct_words', [])),
            'user_sentence': user_sentence,
            'ai_feedback': f'Local Path: {image_url}',
            'word_stars': int(data.get('word_stars', 0)),
            'sentence_stars': int(data.get('sentence_stars', 0)),
            'total_stars': int(data.get('word_stars', 0)) + int(data.get('sentence_stars', 0))
        }
        background_tasks.add_task(save_to_csv, log_data)

        return {"image_url": image_url, "status": "success"}
    except Exception as e:
        print(f"生圖異常: {e}")
        return JSONResponse(status_code=500, content={"error": "server_error"})

# FastAPI 啟動方式 (本地測試用，部署到 Cloud Run 會用 Dockerfile 裡的 uvicorn)
if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
