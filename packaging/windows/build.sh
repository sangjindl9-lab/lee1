#!/bin/bash
# 윈도우 설치 프로그램(WebNVR-Setup-<버전>.exe) 만들기 — 리눅스에서 실행(교차 패키징).
#   필요: curl, unzip, tar, python3.12, uv(pip install uv), makensis(NSIS 3), node/npm(웹 화면 빌드)
#   사용: bash packaging/windows/build.sh [작업폴더]
# 외부 구성 요소는 deps.txt 의 주소에서 받아 SHA-256 을 확인한다(다르면 중단).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=${1:-$ROOT/build/windows}
VERSION=$(sed -n 's/^__version__ = "\(.*\)"/\1/p' "$ROOT/backend/nvr/__init__.py")
DL=$WORK/dl
STAGE=$WORK/stage/WebNVR
UV=${UV:-uv}
PY=${PY:-python3.12}   # pip·Pillow 가 있는 파이썬 3.12
mkdir -p "$DL"

fetch() {  # 이름 → 파일 경로
  local line url sum f
  line=$(grep "^$1|" "$HERE/deps.txt")
  url=$(echo "$line" | cut -d'|' -f2); sum=$(echo "$line" | cut -d'|' -f3)
  f="$DL/$(basename "${url%%\?*}")"
  if [ ! -s "$f" ] || ! echo "$sum  $f" | sha256sum -c --quiet - 2>/dev/null; then
    echo "[내려받기] $1" >&2
    curl -fsSL -o "$f" "$url"
  fi
  if ! echo "$sum  $f" | sha256sum -c --quiet -; then
    echo "SHA-256 불일치: $1 ($url). 새 버전이면 확인 후 deps.txt 를 갱신하세요." >&2
    exit 1
  fi
  echo "$f"
}

echo "== WebNVR $VERSION 윈도우 설치판 =="
rm -rf "$WORK/stage" && mkdir -p "$STAGE"/{app,bin,models,licenses}

# 1) Python(독립 실행형 CPython 3.12) + 윈도우용 패키지
tar -xzf "$(fetch python)" -C "$STAGE"
$UV pip install --python-platform x86_64-pc-windows-msvc --python-version 3.12 \
  --target "$STAGE/python/Lib/site-packages" -r "$ROOT/backend/requirements-windows.txt" -q
# 설치 폴더의 app\backend 를 파이썬 경로에 추가(바로가기·자동 실행에서 -m nvr.* 사용)
echo "../../../app/backend" > "$STAGE/python/Lib/site-packages/webnvr.pth"
# 2) 백엔드 소스·웹 화면
mkdir -p "$STAGE/app/backend" "$STAGE/app/deploy/mediamtx"
cp -r "$ROOT/backend/nvr" "$ROOT/backend/alembic" "$ROOT/backend/alembic.ini" "$STAGE/app/backend/"
cp "$ROOT/backend/requirements.txt" "$ROOT/backend/requirements-windows.txt" "$STAGE/app/backend/"
cp "$ROOT/deploy/mediamtx/mediamtx.base.yml" "$STAGE/app/deploy/mediamtx/"
(cd "$ROOT/frontend" && npm ci --no-audit --no-fund --silent && npm run build --silent)
cp -r "$ROOT/frontend/dist" "$STAGE/app/web"
# 3) 실행 파일
T=$(mktemp -d)
unzip -q "$(fetch ffmpeg)" -d "$T/ff"
cp "$T"/ff/*/bin/{ffmpeg.exe,ffprobe.exe} "$T"/ff/*/bin/*.dll "$STAGE/bin/"
cp "$T"/ff/*/LICENSE.txt "$STAGE/licenses/FFmpeg-LICENSE.txt" 2>/dev/null || true
unzip -q "$(fetch mediamtx)" -d "$T/mtx" && cp "$T/mtx/mediamtx.exe" "$STAGE/bin/" && cp "$T/mtx/LICENSE" "$STAGE/licenses/MediaMTX-LICENSE.txt"
unzip -q "$(fetch caddy)" -d "$T/caddy" && cp "$T/caddy/caddy.exe" "$STAGE/bin/" && cp "$T/caddy/LICENSE" "$STAGE/licenses/Caddy-LICENSE.txt"
cp "$(fetch winsw)" "$STAGE/bin/WinSW-x64.exe"
unzip -q "$(fetch postgresql)" -d "$T/pg"
mkdir -p "$STAGE/pgsql" && cp -r "$T"/pg/*/{bin,lib,share} "$STAGE/pgsql/" && cp "$T"/pg/*/LICENSE "$STAGE/licenses/PostgreSQL-LICENSE.txt"
cp "$(fetch yolox)" "$STAGE/models/yolox_s.onnx"
# PostgreSQL 이 쓰는 Visual C++ 런타임(앱 로컬 배포) — PyPI msvc-runtime 패키지에서 꺼냄
mkdir -p "$T/msvc" && "$PY" -m pip download msvc-runtime==14.51.36231 --platform win_amd64 --only-binary=:all: \
  --python-version 3.12 -d "$T/msvc" -q && (cd "$T/msvc" && unzip -q -o ./*.whl)
cp "$T"/msvc/msvc_runtime-*.data/data/Scripts/{msvcp140.dll,msvcp140_1.dll,msvcp140_2.dll,vcruntime140.dll,vcruntime140_1.dll} "$STAGE/pgsql/bin/"
rm -rf "$T"

# 4) 줄이기: 개발용 파일·다른 아키텍처·디버그 기호
rm -rf "$STAGE"/python/{include,libs,Scripts} "$STAGE"/python/Lib/{test,idlelib,ensurepip,tkinter,turtledemo}
find "$STAGE" -name "*.pdb" -delete
rm -rf "$STAGE"/python/Lib/site-packages/{pip,pip-*.dist-info,bin} "$STAGE"/python/Lib/site-packages/numpy/{tests,*/tests}
rm -f "$STAGE"/python/Lib/site-packages/*.whl "$STAGE"/python/Lib/site-packages/cv2/opencv_videoio_ffmpeg*.dll
rm -rf "$STAGE"/python/Lib/site-packages/webview/lib/runtimes/{win-arm64,win-x86} "$STAGE"/python/Lib/site-packages/webview/lib/*.jar
rm -f "$STAGE"/python/Lib/site-packages/webview/lib/WebBrowserInterop.x86.dll
find "$STAGE" -name "__pycache__" -type d -prune -exec rm -rf {} +
# 5) 미리 컴파일(.pyc) — 설치 폴더는 일반 사용자가 쓸 수 없어 실행 시 만들지 못함
"$PY" -m compileall -q -j0 --invalidation-mode unchecked-hash "$STAGE/python/Lib" "$STAGE/app/backend" >/dev/null || true

# 6) 설치판 보조 파일
cp "$HERE/nvrctl.cmd" "$STAGE/"
cp "$ROOT/LICENSE" "$STAGE/licenses/WebNVR-LICENSE.txt" 2>/dev/null || true
cp "$HERE/THIRD-PARTY.txt" "$STAGE/licenses/"
cp "$ROOT/docs/05-윈도우설치.md" "$STAGE/설치·운영 안내.md"
"$PY" "$HERE/make_icon.py" "$STAGE/webnvr.ico"
echo "$VERSION" > "$STAGE/VERSION"

# 7) 설치 프로그램
OUT="$ROOT/build/WebNVR-Setup-$VERSION.exe"
mkdir -p "$(dirname "$OUT")"
LC_ALL=C.UTF-8 makensis -V2 -INPUTCHARSET UTF8 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DOUTFILE="$OUT" "$HERE/installer.nsi"
sha256sum "$OUT" | tee "$OUT.sha256"
du -sh "$STAGE" "$OUT"
