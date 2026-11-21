import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * 앱이 열 웹앱 주소를 정한다. (우선순위)
 *  1. -PappUrl=... 빌드 인자
 *  2. APP_URL 환경변수
 *  3. local.properties 의 appUrl
 *  4. 기본값(아래 defaultAppUrl)
 */
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) FileInputStream(file).use { load(it) }
}

val defaultAppUrl = "https://balju.ieumerp.kr"
val resolvedAppUrl: String =
    (findProperty("appUrl") as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?: System.getenv("APP_URL")?.trim()?.takeIf { it.isNotEmpty() }
        ?: localProperties.getProperty("appUrl")?.trim()?.takeIf { it.isNotEmpty() }
        ?: defaultAppUrl

/** 릴리스 서명 키(선택). 없으면 디버그 키로 서명해 설치 가능한 APK 를 만든다. */
val releaseStorePath: String? =
    (findProperty("releaseStoreFile") as String?)?.trim()?.takeIf { it.isNotEmpty() }
        ?: System.getenv("RELEASE_STORE_FILE")?.trim()?.takeIf { it.isNotEmpty() }
val hasReleaseKey: Boolean = releaseStorePath != null && File(releaseStorePath).exists()

android {
    namespace = "kr.eumsoft.balju"
    compileSdk = 36

    defaultConfig {
        applicationId = "kr.eumsoft.balju"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "1.1.1"

        // 웹앱 주소를 앱 코드의 BuildConfig.APP_URL 로 넣는다.
        buildConfigField("String", "APP_URL", "\"$resolvedAppUrl\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = File(releaseStorePath!!)
                storePassword = (findProperty("releaseStorePassword") as String?)
                    ?: System.getenv("RELEASE_STORE_PASSWORD")
                keyAlias = (findProperty("releaseKeyAlias") as String?)
                    ?: System.getenv("RELEASE_KEY_ALIAS")
                keyPassword = (findProperty("releaseKeyPassword") as String?)
                    ?: System.getenv("RELEASE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            // 릴리스 키가 설정되지 않은 CI 에서도 설치 가능한 APK 가 나오도록 디버그 키로 서명한다.
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
