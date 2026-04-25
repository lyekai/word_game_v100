# 1-6 步維持原樣
# 1. 使用輕量的 Python 映像檔
FROM python:3.11-slim

# 2. 設定工作目錄
WORKDIR /app

# 3. 複製必要文件
COPY requirements.txt .

# 4. 安裝套件
RUN pip install --no-cache-dir -r requirements.txt

# 5. 複製所有程式碼
COPY . .

# 6. 設定環境變數
# 移除 FLASK_ENV，改用 FastAPI 習慣的變數（非必要，但較乾淨）
ENV PYTHONUNBUFFERED=True

# 7. 最終強化的啟動指令
# --workers 1: 在 Cloud Run 建議設為 1，靠 Cloud Run 的「自動擴展實例」來扛大流量
# --loop httptools: 加速事件迴圈處理
# --http h11: 確保與 HTTP/1.1 的相容性
# --timeout-keep-alive: 類似之前的 keep-alive，維持連線反應速度
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "5"]
