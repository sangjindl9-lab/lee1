plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "kr.eumsoft.quick"
    compileSdk = 35
    defaultConfig {
        applicationId = "kr.eumsoft.quick"
        minSdk = 30          // 접근성 takeScreenshot(공식 캡처 API)이 Android 11(API 30)부터 지원
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
}
dependencies {
    // 기기 내부 한국어·영어·숫자 OCR (모델이 APK에 포함되어 별도 다운로드 없음)
    implementation("com.google.mlkit:text-recognition-korean:16.0.1")
    testImplementation("junit:junit:4.13.2")
}
