#!/bin/bash
# 이음ZIP 빌드 (Android SDK 없이: javac + dx + aapt2 + 자체 서명)
#   dist/eumzip-<ver>.apk : 직접 설치용 (v2 서명)
#   dist/eumzip-<ver>.aab : 구글 플레이 업로드용 앱 번들 (업로드 키로 서명)
set -e
cd "$(dirname "$0")"
VER=$(grep -o 'versionName="[^"]*"' AndroidManifest.xml | cut -d'"' -f2)
AJ=third/plat/android-34/android.jar     # 리소스 링크용(이 aapt2 는 35 이상 SDK 를 읽지 못함). targetSdk 는 36.
AJ26=third/plat/android-26/android.jar   # 자바는 최소 지원 버전 API 로 컴파일(구형 기기 호환)
AAPT=$(python3 -c "import aapt2,os;print(os.path.join(os.path.dirname(aapt2.__file__),'bin/Linux/aapt2'))")
LINK="-I $AJ --manifest AndroidManifest.xml --min-sdk-version 26 --target-sdk-version 36 --custom-package kr.allzip.app"
rm -rf build/app build/gen build/res.zip build/base.apk build/proto.zip build/classes.dex build/aab; mkdir -p build/app build/gen dist
$AAPT compile --dir res -o build/res.zip
$AAPT link -o build/base.apk $LINK --java build/gen build/res.zip
$AAPT link --proto-format -o build/proto.zip $LINK build/res.zip
javac -nowarn -Xlint:-options -encoding UTF-8 -source 8 -target 8 -bootclasspath $AJ26 -cp lib-classes -d build/app $(find src build/gen -name '*.java') > build/javac.log 2>&1 || { grep -v "^Picked up" build/javac.log; echo "컴파일 실패"; exit 1; }
java -Xmx3g -cp tools/dxc com.android.dx.command.Main --dex --min-sdk-version=26 --output=build/classes.dex build/app lib-classes 2>&1 | grep -v "^Picked up" || true
python3 sign.py build/base.apk build/classes.dex dist/eumzip-$VER.apk signing-key.pem
python3 make_aab.py build/proto.zip build/classes.dex dist/eumzip-$VER.aab signing-key.pem
