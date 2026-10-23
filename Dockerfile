# ---- 1단계: DWG→DXF 변환기 LibreDWG (GPLv3, 별도 실행 파일로만 호출) ----
FROM python:3.12-slim AS libredwg
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 0.13.3 https://github.com/LibreDWG/libredwg.git /src \
 && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DLIBREDWG_DISABLE_JSON=ON -DCMAKE_C_FLAGS="-Wno-error -O2" -DENABLE_WERROR=OFF \
 && cmake --build /build -j"$(nproc)" --target dwg2dxf \
 && mkdir -p /opt/libredwg/bin && cp /build/dwg2dxf /opt/libredwg/bin/ \
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
ENV KET_STORAGE_DIR=/app/storage PYTHONPATH=/app/backend
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --app-dir backend
