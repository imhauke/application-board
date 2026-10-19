# Runs the Alembic migrations against the app's Postgres (docker compose runs it before the app starts).
FROM python:3.12-slim
WORKDIR /db
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["alembic", "upgrade", "head"]
