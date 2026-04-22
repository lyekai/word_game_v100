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
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=True

# 7. 最終強化的啟動指令
# --worker-class gthread: 優化執行緒管理
# --keep-alive: 讓切換頁面反應更快
# :8080: 對接 Cloud Run 預設值
CMD ["gunicorn", "--bind", ":8080", "--workers", "1", "--threads", "60", "--worker-class", "gthread", "--timeout", "120", "--keep-alive", "5", "app:app"]
