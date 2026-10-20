FROM python:3.11-slim

WORKDIR /app

# Все зависимости ставятся из wheels — компилятор в образе не нужен.
# Благодаря этому сборка не требует apt/deb.debian.org (в закрытых сетях он недоступен).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
