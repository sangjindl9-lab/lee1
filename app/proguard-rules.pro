# AdGuard DnsLibs: JNI 에서 이름으로 찾는 클래스·필드 유지
-keep class com.adguard.dnslibs.** { *; }
# Rust JNI 진입점
-keep class kr.eumsoft.securitypro.engine.NativeCore { *; }
-keep class kr.eumsoft.securitypro.engine.NativeCrypto { *; }
-dontwarn org.slf4j.**
