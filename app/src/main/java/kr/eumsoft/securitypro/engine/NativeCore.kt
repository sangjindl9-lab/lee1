package kr.eumsoft.securitypro.engine

import android.util.Log

/**
 * Rust 네이티브 모듈 연결.
 * - libeumyara.so : YARA-X 규칙 컴파일·검사 (빌드되지 않은 ABI 에서는 경량 패턴 엔진으로 대체)
 * - libeumcrypto.so : 위협 DB Ed25519 서명 검증 (모든 ABI)
 */
object NativeCore {
    private var error: String? = null
    val available: Boolean = try {
        System.loadLibrary("eumyara"); true
    } catch (t: Throwable) {
        error = t.message; Log.w("EUM", "YARA-X 네이티브 모듈 로드 실패: ${t.message}"); false
    }
    val loadError: String? get() = if (available) null else "이 기기(${android.os.Build.SUPPORTED_ABIS.firstOrNull()})용 YARA-X 모듈 없음: $error"

    @JvmStatic external fun nativeVersion(): String
    @JvmStatic external fun nativeCompile(source: String): Long
    @JvmStatic external fun nativeScan(handle: Long, data: ByteArray, timeoutSecs: Int): String
    @JvmStatic external fun nativeFree(handle: Long)
}

object NativeCrypto {
    val available: Boolean = try { System.loadLibrary("eumcrypto"); true } catch (t: Throwable) { Log.e("EUM", "서명 검증 모듈 로드 실패", t); false }
    @JvmStatic external fun nativeVerifyEd25519(publicKey: ByteArray, msg: ByteArray, sig: ByteArray): Boolean
}
