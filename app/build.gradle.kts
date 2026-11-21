plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "kr.eumsoft.notepro"
    compileSdk = 36
    defaultConfig {
        applicationId = "kr.eumsoft.notepro"
        minSdk = 26
        targetSdk = 36
        versionCode = 5
        versionName = "0.5.0-stage5"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        val server = (project.findProperty("noteproServer") as String?) ?: System.getenv("NOTEPRO_SERVER_URL") ?: ""
        buildConfigField("String", "SERVER_URL", "\"$server\"")
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
    lint { abortOnError = false }
}
dependencies {
    val compose = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(compose)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    // PDF 원본 보존 내보내기·글자 추출·병합 (Apache PDFBox 안드로이드판, Apache-2.0)
    implementation("com.tom-roush:pdfbox-android:2.0.27.0")
    // 기기 안 인식(손글씨: 모델은 처음 사용 시 내려받음 / 글자 인식: 한국어·라틴 모델 포함)
    implementation("com.google.mlkit:digital-ink-recognition:18.1.0")
    implementation("com.google.mlkit:text-recognition-korean:16.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
}
