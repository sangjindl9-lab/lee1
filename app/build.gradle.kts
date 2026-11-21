plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("com.google.dagger.hilt.android")
}

/** 릴리스 서명 키(선택). GitHub Secrets 로 넘겨받고, 없으면 디버그 키로 서명한 설치용 APK 를 만든다. */
val releaseStore: String? = System.getenv("RELEASE_STORE_FILE")?.takeIf { it.isNotBlank() && File(it).exists() }

android {
    namespace = "kr.eumsoft.securitypro"
    compileSdk = 36
    ndkVersion = "29.0.14206865"

    defaultConfig {
        applicationId = "kr.eumsoft.securitypro"
        minSdk = 29          // Android 10
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
        // 위협 DB 업데이트 주소 (서명 검증 후에만 적용)
        buildConfigField("String", "DB_UPDATE_URL",
            "\"https://raw.githubusercontent.com/sangjindl9-lab/lee1/eum-security-pro/db/manifest.json\"")
        ksp { arg("room.schemaLocation", "$projectDir/schemas") }
    }

    // play: Google Play 판 (Play 정책상 광고·추적 차단 제외 — 피싱·악성 사이트 차단 + 악성코드 검사)
    // full: 홈페이지 배포 판 (광고·추적 차단 포함)
    flavorDimensions += "dist"
    productFlavors {
        create("play") { dimension = "dist"; buildConfigField("boolean", "AD_BLOCK", "false") }
        create("full") { dimension = "dist"; applicationIdSuffix = ".full"; versionNameSuffix = "-full"; buildConfigField("boolean", "AD_BLOCK", "true") }
    }

    signingConfigs {
        if (releaseStore != null) create("release") {
            storeFile = File(releaseStore)
            storePassword = System.getenv("RELEASE_STORE_PASSWORD")
            keyAlias = System.getenv("RELEASE_KEY_ALIAS")
            keyPassword = System.getenv("RELEASE_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].jniLibs.srcDirs("src/main/jniLibs")
    sourceSets["androidTest"].assets.srcDirs("$projectDir/schemas", "$rootDir/fixtures")
    packaging { jniLibs { useLegacyPackaging = false } }
    testOptions { unitTests.isReturnDefaultValues = true }
    lint { abortOnError = false }
}

dependencies {
    val compose = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(compose)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    implementation("com.google.dagger:hilt-android:2.54")
    ksp("com.google.dagger:hilt-compiler:2.54")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")
    implementation("androidx.hilt:hilt-work:1.2.0")
    ksp("androidx.hilt:hilt-compiler:1.2.0")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    // AdGuard DnsLibs (Apache-2.0) — 소스 빌드 AAR
    implementation("com.adguard.corelibs:dns-libs:2.10.2-eum.f223ce8")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.bouncycastle:bcprov-jdk18on:1.79")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.room:room-testing:2.6.1")
    androidTestImplementation("org.bouncycastle:bcprov-jdk18on:1.79")
}
