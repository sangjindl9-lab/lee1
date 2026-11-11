plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

// 릴리스 서명: 환경변수(EUM_KEYSTORE, EUM_KEYSTORE_PASSWORD, EUM_KEY_ALIAS, EUM_KEY_PASSWORD)가 있을 때만 서명한다.
// 키 파일은 저장소에 넣지 않는다. (docs/RELEASE_SIGNING.md 참고)
val ksPath: String? = System.getenv("EUM_KEYSTORE")

android {
    namespace = "kr.eumsoft.kidscoloring"
    compileSdk = 35
    defaultConfig {
        applicationId = "kr.eumsoft.kidscoloring"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
    signingConfigs {
        if (ksPath != null) create("release") {
            storeFile = file(ksPath)
            storePassword = System.getenv("EUM_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("EUM_KEY_ALIAS")
            keyPassword = System.getenv("EUM_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (ksPath != null) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    androidResources { noCompress += listOf("png", "webp") }
    testOptions { unitTests.isReturnDefaultValues = true }
}

ksp { arg("room.schemaLocation", "$projectDir/schemas") }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
