# 1-6 步維持原樣
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=True

# 7. 修正後的啟動指令
# 修改 1: 改成 :$PORT，讓 Cloud Run 動態對接埠號
# 修改 2: 將 --threads 降到 12。這非常重要！
#        這會讓 Cloud Run 在超過 12 人連線時，自動幫你啟動第二個容器，分擔生圖壓力。
# 修改 3: 移除 --keep-alive 5。在高併發生圖時，維持長連線反而容易造成 Load Balancer 502 報錯。
CMD ["sh", "-c", "gunicorn --bind :$PORT --workers 1 --threads 12 --worker-class gthread --timeout 120 --preload app:app"]
