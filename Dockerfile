# 현장통합 그룹웨어 — Render/일반 서버 공용 이미지
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Asia/Seoul
# WeasyPrint(PDF) 라이브러리 + 한글 폰트 + 백업용 pg 클라이언트
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-noto-cjk fonts-nanum postgresql-client tzdata \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY frontend frontend
COPY scripts scripts
WORKDIR /app/backend
ENV FILE_STORAGE_DIR=/app/data/files PORT=8000
CMD ["sh", "-c", "python -m app.cli ensure-db && alembic upgrade head && python -m app.cli init --if-empty --company \"${COMPANY_NAME:-우리회사}\" --admin-login \"${ADMIN_LOGIN:-admin}\" --admin-name 관리자 && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
