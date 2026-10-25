# ---- 1단계: DWG→DXF 변환기 LibreDWG (GPLv3, 별도 실행 파일로만 호출) ----
FROM python:3.12-slim AS libredwg
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates && rm -rf /var/lib/apt/lists/*
# 0.13.3 릴리스는 AutoCAD 2007(AC1021) DWG 본문을 읽지 못해 개발판의 검증한 커밋으로 고정
RUN git init -q /src && cd /src && git remote add origin https://github.com/LibreDWG/libredwg.git \
 && git fetch -q --depth 1 origin a8ccb1f314d9feb2215be67d1f6f2a3d64b2c9a0 && git checkout -q FETCH_HEAD \
 && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DLIBREDWG_DISABLE_JSON=ON -DDISABLE_WERROR=ON \
 && cmake --build /build -j"$(nproc)" --target dwg2dxf dwgread \
 && mkdir -p /opt/libredwg/bin && cp /build/dwg2dxf /build/dwgread /opt/libredwg/bin/ \
 && /opt/libredwg/bin/dwg2dxf --version

# ---- 2단계: 앱 ----
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-kor fonts-noto-cjk libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY --from=libredwg /opt/libredwg /opt/libredwg
ENV PATH=/opt/libredwg/bin:$PATH
RUN dwg2dxf --version
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY frontend frontend
ENV KET_STORAGE_DIR=/app/storage PYTHONPATH=/app/backend OMP_THREAD_LIMIT=1
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir backend
