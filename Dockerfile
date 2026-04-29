FROM python:3.11-slim

WORKDIR /app

# 安裝必要套件
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製程式碼
COPY . .

# --- [關鍵新增] ---
# 建立存放 AI 圖片的資料夾，並給予權限 (Cloud Run 預設為隨機使用者)
RUN mkdir -p /app/static/generated && chmod 777 /app/static/generated

ENV PYTHONUNBUFFERED=True

# --- [指令調整] ---
# 1. 移除 --loop 和 --http，除非你有安裝 httptools 和 h11 套件，否則預設最穩。
# 2. --timeout-keep-alive 建議調高。
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--timeout-keep-alive", "65"]
