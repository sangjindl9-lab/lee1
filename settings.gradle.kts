pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // AdGuard DnsLibs AAR — eum-security-dnslibs 워크플로가 소스에서 빌드한 로컬 Maven 저장소
        maven { url = uri("${rootDir}/m2") }
    }
}
rootProject.name = "EumSecurityPro"
include(":app")
