# 1. 使用輕量的 Python 映像檔
FROM python:3.11-slim

# 2. 設定工作目錄
WORKDIR /app

# 3. 複製必要文件到容器內
COPY requirements.txt .

# 4. 安裝套件（不快取安裝檔，縮小體積）
RUN pip install --no-cache-dir -r requirements.txt

# 5. 複製剩餘的所有程式碼（包含 templates, static 等）
COPY . .

# 6. 設定環境變數（讓 Flask 知道這是正式環境）
ENV FLASK_ENV=production

# 7. 啟動指令：使用 Gunicorn 執行，綁定 8080 端口（GCloud 預設端口）
# 這裡的 app:app 代表「檔名為 app.py，內部的實體變數叫 app」
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "app:app"]
