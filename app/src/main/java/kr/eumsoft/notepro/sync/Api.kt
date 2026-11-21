package kr.eumsoft.notepro.sync

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kr.eumsoft.notepro.BuildConfig
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class ApiException(val status: Int, val code: String) : IOException("$status $code")

/** 리프레시 토큰은 Android Keystore 키(AES-GCM)로 암호화해 저장. */
class TokenStore(context: Context) {
    private val sp = context.getSharedPreferences("notepro_account", Context.MODE_PRIVATE)
    private val alias = "notepro_tokens"

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return g.generateKey()
    }

    var refreshToken: String?
        get() = sp.getString("rt", null)?.let { enc ->
            try {
                val raw = Base64.decode(enc, Base64.NO_WRAP)
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
                String(c.doFinal(raw, 12, raw.size - 12))
            } catch (e: Exception) { null }
        }
        set(v) {
            if (v == null) { sp.edit().remove("rt").apply(); return }
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            sp.edit().putString("rt", Base64.encodeToString(c.iv + c.doFinal(v.toByteArray()), Base64.NO_WRAP)).apply()
        }

    var accessToken: String? = null
    var accessExpiresAt = 0L
    var userId: String? get() = sp.getString("uid", null); set(v) { sp.edit().putString("uid", v).apply() }
    var email: String? get() = sp.getString("email", null); set(v) { sp.edit().putString("email", v).apply() }
    /** 이 기기의 노트를 올린 마지막 계정(다른 계정으로 바꿀 때 확인용) */
    var lastLinkedUser: String? get() = sp.getString("linked", null); set(v) { sp.edit().putString("linked", v).apply() }
    var serverUrl: String
        get() = sp.getString("server", null)?.takeIf { it.isNotBlank() } ?: BuildConfig.SERVER_URL
        set(v) { sp.edit().putString("server", v.trim().trimEnd('/')).apply() }
    var deviceId: String? get() = sp.getString("dev", null); set(v) { sp.edit().putString("dev", v).apply() }
}

/** 서버 API(HttpURLConnection, 백그라운드 스레드 전용). */
class Api(private val tokens: TokenStore) {

    val configured get() = tokens.serverUrl.startsWith("http")

    fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = true, raw: ByteArray? = null): JSONObject {
        val bytes = requestBytes(method, path, body, auth, raw)
        return if (bytes.isEmpty()) JSONObject() else JSONObject(String(bytes))
    }

    fun requestBytes(method: String, path: String, body: JSONObject? = null, auth: Boolean = true, raw: ByteArray? = null, retried: Boolean = false): ByteArray {
        if (!configured) throw ApiException(0, "server_not_configured")
        if (auth) ensureAccess()
        val conn = (URL(tokens.serverUrl + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 15_000; readTimeout = 60_000
            setRequestProperty("Accept", "application/json")
            if (auth) setRequestProperty("Authorization", "Bearer ${tokens.accessToken}")
        }
        try {
            if (body != null || raw != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", if (raw != null) "application/octet-stream" else "application/json; charset=utf-8")
                val data = raw ?: body.toString().toByteArray()
                conn.setFixedLengthStreamingMode(data.size)
                conn.outputStream.use { it.write(data) }
            }
            val code = conn.responseCode
            val stream: InputStream? = if (code in 200..299) conn.inputStream else conn.errorStream
            val out = stream?.use { s -> ByteArrayOutputStream().also { s.copyTo(it) }.toByteArray() } ?: ByteArray(0)
            if (code == 401 && auth && !retried) { tokens.accessToken = null; return requestBytes(method, path, body, auth, raw, retried = true) }
            if (code !in 200..299) {
                val err = try { JSONObject(String(out)).optString("error", "http_$code") } catch (e: Exception) { "http_$code" }
                throw ApiException(code, err)
            }
            return out
        } finally { conn.disconnect() }
    }

    private fun ensureAccess() {
        if (tokens.accessToken != null && System.currentTimeMillis() < tokens.accessExpiresAt - 30_000) return
        val rt = tokens.refreshToken ?: throw ApiException(401, "not_logged_in")
        val r = request("POST", "/v1/auth/refresh", JSONObject().put("refreshToken", rt), auth = false)
        saveTokens(r)
    }

    fun saveTokens(r: JSONObject) {
        tokens.accessToken = r.getString("accessToken")
        tokens.accessExpiresAt = System.currentTimeMillis() + r.optLong("expiresIn", 900) * 1000
        tokens.refreshToken = r.getString("refreshToken")
        r.optString("userId").takeIf { it.isNotBlank() }?.let { tokens.userId = it }
    }

    fun deviceInfo(o: JSONObject, deviceId: String) = o.put("deviceId", deviceId).put("platform", "android")
        .put("model", Build.MANUFACTURER + " " + Build.MODEL).put("appVersion", BuildConfig.VERSION_NAME)
}
