# Railway 에서 서명된 릴리스 AAB/APK 를 빌드하고 잠시 내려받을 수 있게 제공하는 빌더.
# 서비스 변수: APP_URL, KEYSTORE_B64, KEYSTORE_PASSWORD, DL_TOKEN (빌드 인자로 전달됨)
FROM eclipse-temurin:17-jdk
RUN apt-get update && apt-get install -y --no-install-recommends unzip curl python3 && rm -rf /var/lib/apt/lists/*
ENV ANDROID_HOME=/opt/android ANDROID_SDK_ROOT=/opt/android
RUN mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -sSLo /tmp/c.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && unzip -q /tmp/c.zip -d $ANDROID_HOME/cmdline-tools && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest && rm /tmp/c.zip \
 && yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses >/dev/null \
 && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools" >/dev/null
WORKDIR /src
COPY . .
ARG APP_URL
ARG KEYSTORE_B64
ARG KEYSTORE_PASSWORD
ARG DL_TOKEN
RUN echo "$KEYSTORE_B64" | base64 -d > /tmp/upload.jks \
 && chmod +x gradlew \
 && ./gradlew --no-daemon -q bundleRelease assembleRelease \
      -PappUrl="$APP_URL" -PreleaseStoreFile=/tmp/upload.jks \
      -PreleaseStorePassword="$KEYSTORE_PASSWORD" -PreleaseKeyAlias=upload -PreleaseKeyPassword="$KEYSTORE_PASSWORD" \
 && rm -f /tmp/upload.jks \
 && mkdir -p /out/$DL_TOKEN \
 && cp app/build/outputs/bundle/release/app-release.aab /out/$DL_TOKEN/family-album-release.aab \
 && cp app/build/outputs/apk/release/app-release.apk /out/$DL_TOKEN/family-album-release.apk \
 && rm -rf /src/app/build /root/.gradle
CMD ["sh", "-c", "python3 -m http.server ${PORT:-8080} --directory /out"]
