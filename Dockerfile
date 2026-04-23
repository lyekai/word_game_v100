# 1. 使用輕量的 Python 映像檔
FROM python:3.11-slim

# 2. 設定工作目錄
WORKDIR /app

# 3. 複製並安裝套件（利用快取節省部署時間）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 4. 複製程式碼
COPY . .

# 5. 設定環境變數
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=True

# 6. 強化的啟動指令
# - 移除 --keep-alive 以減少與 Load Balancer 的衝突
# - 確保 $PORT 有被讀取
# - 建議 workers 維持 1，threads 維持 12，這對 1 vCPU 的 Cloud Run 最穩
CMD ["sh", "-c", "gunicorn --bind :$PORT --workers 1 --threads 12 --worker-class gthread --timeout 120 --preload app:app"]
