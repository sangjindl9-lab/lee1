package kr.eumsoft.filemanager2.connect

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Android 키 저장소(하드웨어 보안 영역) 키로 문자열을 암호화합니다. 키는 기기 밖으로 나가지 않습니다. */
object SecureStore {
    private const val ALIAS = "fm2_secure_key"
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return g.generateKey()
    }
    fun encrypt(s: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        return "v1:" + Base64.encodeToString(c.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(c.doFinal(s.toByteArray()), Base64.NO_WRAP)
    }
    fun decrypt(s: String?): String? {
        if (s == null || !s.startsWith("v1:")) return null
        return runCatching {
            val (iv, data) = s.removePrefix("v1:").split(".").map { Base64.decode(it, Base64.NO_WRAP) }
            val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(c.doFinal(data))
        }.getOrNull()
    }
}
