# 1-6 步維持你原本的，寫得很專業，不需要動
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=True

# 7. 最終強化的啟動指令
# 修改點：
# 1. 將 :8080 改為 :$PORT (Cloud Run 的黃金準則)
# 2. 執行緒 (threads) 建議降到 12-20，讓 Cloud Run 有機會觸發自動擴展
# 3. 增加 --preload 減少記憶體占用並加快啟動
CMD ["sh", "-c", "gunicorn --bind :$PORT --workers 1 --threads 12 --worker-class gthread --timeout 120 --keep-alive 5 --preload app:app"]
