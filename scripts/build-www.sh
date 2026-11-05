#!/usr/bin/env bash
# app/www 의 편집기(오픈소스 rhwp-studio, MIT)를 다시 만드는 스크립트.
# app/www/eum/ (우리 앱 화면 코드)은 건드리지 않는다.
#
# 사용법: scripts/build-www.sh [작업폴더]
#   - rhwp 소스(v0.8.7)를 받아 작은 패치를 적용하고 빌드한 뒤 app/www 로 복사한다.
#   - HWP 엔진(Rust→WASM)은 npm 의 @rhwp/core 미리 빌드본을 쓴다(Rust 설치 불필요).
set -euo pipefail

RHWP_TAG=v0.8.7
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${1:-$(mktemp -d)}"
WWW="$ROOT/app/www"

mkdir -p "$WORK"
cd "$WORK"
if [ ! -d rhwp ]; then
  git clone --depth 1 --branch "$RHWP_TAG" https://github.com/edwardkim/rhwp
fi
if [ ! -f rhwp/pkg/rhwp_bg.wasm ]; then
  mkdir -p core rhwp/pkg
  (cd core && npm init -y >/dev/null && npm i "@rhwp/core@${RHWP_TAG#v}")
  cp core/node_modules/@rhwp/core/rhwp* rhwp/pkg/
fi

cd rhwp/rhwp-studio
git checkout -- src/main.ts
# 패치 1: 앱 화면(eum-shell.js)이 문서 상태·확대 배율을 읽을 수 있게 내부 객체를 노출
sed -i '/E2E 테스트용 전역 노출/{n;s/if (import\.meta\.env\.DEV) {/if (true) {/}' src/main.ts
grep -c 'if (true) {' src/main.ts | grep -qx 2

npm ci
# 오프라인 앱이므로 외부 웹폰트(CDN)는 끈다
RHWP_DISABLE_EXTERNAL_WEBFONTS=1 npx vite build --base=./

cd dist
# 앱에서는 서비스워커·PWA·샘플이 필요 없다
rm -rf sw.js registerSW.js workbox-*.js manifest.webmanifest samples rhwp.js rhwp.d.ts rhwp_bg.wasm.d.ts
sed -i 's#<script id="vite-plugin-pwa:register-sw"[^>]*></script>##; s#<link rel="manifest"[^>]*>##' index.html
# 패치 2: 우리 앱 화면 코드를 편집기보다 먼저 싣는다
sed -i 's#<head>#<head>\n  <link rel="stylesheet" href="eum/eum-shell.css">\n  <script src="eum/eum-shell.js"></script>#' index.html
grep -q 'eum/eum-shell.js' index.html

find "$WWW" -mindepth 1 -maxdepth 1 ! -name eum -exec rm -rf {} +
cp -r . "$WWW/"
echo "완료: $WWW"
