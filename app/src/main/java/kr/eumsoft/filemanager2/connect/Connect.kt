package kr.eumsoft.filemanager2.connect

import android.content.Context
import android.os.Build
import android.os.Environment
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/** PC CONNECT 서버 주소 (공식 다운로드 사이트와 같은 주소) */
object ConnectConfig {
    const val SERVER_URL = "https://fm2.ieumerp.kr"
    const val DOWNLOAD_URL = "$SERVER_URL/download"
    val WS_URL: String get() = SERVER_URL.replace("https://", "wss://") + "/ws"
}

class ApiException(val code: String, message: String) : Exception(message)

data class PermInfo(
    val id: String, val pcId: String, val pcName: String, val status: String,
    val folders: List<String>, val readOnly: Boolean, val pcOnline: Boolean, val createdAt: String,
)

data class DeviceInfo(val id: String, val kind: String, val name: String, val model: String, val online: Boolean, val self: Boolean, val lastSeen: String?)
data class LogInfo(val action: String, val detail: String, val deviceName: String?, val at: String)

/** 로그인 정보 보관 + 화면과 서비스가 같이 보는 상태 */
object ConnectState {
    var email by mutableStateOf<String?>(null)
    var deviceId by mutableStateOf<String?>(null)
    var enabled by mutableStateOf(false)          // 사용자가 '연결 켜기'를 눌렀는지
    var online by mutableStateOf(false)           // 서버와 실시간 연결됨
    var statusText by mutableStateOf("꺼짐")
    val pendingRequests = mutableStateListOf<PermInfo>()
    var activeTransfers by mutableStateOf(0)
    var lastActivity by mutableStateOf<String?>(null)
    var refreshTick by mutableStateOf(0)

    private const val P = "fm2_connect"
    fun load(ctx: Context) {
        val sp = ctx.getSharedPreferences(P, Context.MODE_PRIVATE)
        email = sp.getString("email", null)
        deviceId = sp.getString("deviceId", null)
        enabled = sp.getBoolean("enabled", false) && token(ctx) != null
    }
    fun token(ctx: Context): String? = ctx.getSharedPreferences(P, Context.MODE_PRIVATE).getString("token", null)
    fun installId(ctx: Context): String {
        val sp = ctx.getSharedPreferences(P, Context.MODE_PRIVATE)
        return sp.getString("installId", null) ?: UUID.randomUUID().toString().also { sp.edit().putString("installId", it).apply() }
    }
    fun saveLogin(ctx: Context, token: String, email: String, deviceId: String) {
        ctx.getSharedPreferences(P, Context.MODE_PRIVATE).edit()
            .putString("token", token).putString("email", email).putString("deviceId", deviceId).apply()
        this.email = email; this.deviceId = deviceId
    }
    fun setEnabled(ctx: Context, v: Boolean) {
        enabled = v
        ctx.getSharedPreferences(P, Context.MODE_PRIVATE).edit().putBoolean("enabled", v).apply()
    }
    fun clear(ctx: Context) {
        val iid = installId(ctx)
        ctx.getSharedPreferences(P, Context.MODE_PRIVATE).edit().clear().putString("installId", iid).apply()
        email = null; deviceId = null; enabled = false; online = false; statusText = "꺼짐"; pendingRequests.clear()
    }
}

/** 서버 REST API */
object ConnectApi {
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private val JSON_T = "application/json; charset=utf-8".toMediaType()

    internal suspend fun call(ctx: Context, method: String, path: String, body: JSONObject? = null, auth: Boolean = true): Any? =
        withContext(Dispatchers.IO) {
            val b = Request.Builder().url(ConnectConfig.SERVER_URL + path)
            if (auth) ConnectState.token(ctx)?.let { b.header("Authorization", "Bearer $it") }
            val rb = (body ?: JSONObject()).toString().toRequestBody(JSON_T)
            when (method) { "POST" -> b.post(rb); "DELETE" -> b.delete(rb); else -> b.get() }
            val res = try { http.newCall(b.build()).execute() } catch (e: Exception) {
                throw ApiException("network", "서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요")
            }
            res.use {
                val text = it.body?.string().orEmpty()
                val parsed: Any? = runCatching { if (text.trim().startsWith("[")) JSONArray(text) else JSONObject(text) }.getOrNull()
                if (!it.isSuccessful) {
                    val o = parsed as? JSONObject
                    if (it.code == 401 && auth) { ConnectState.clear(ctx) }
                    throw ApiException(o?.optString("error") ?: "http_${it.code}", o?.optString("message")?.takeIf { m -> m.isNotBlank() } ?: "요청을 처리하지 못했습니다 (${it.code})")
                }
                parsed
            }
        }

    private fun deviceJson(ctx: Context) = JSONObject()
        .put("kind", "android")
        .put("name", (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).trim())
        .put("model", Build.MODEL).put("platform", "Android ${Build.VERSION.RELEASE}")
        .put("appVersion", runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "")
        .put("installId", ConnectState.installId(ctx))

    suspend fun register(ctx: Context, email: String, pw: String, name: String): Boolean {
        val r = call(ctx, "POST", "/api/auth/register", JSONObject().put("email", email).put("password", pw).put("name", name), auth = false) as JSONObject
        return r.optBoolean("needsVerification")
    }
    suspend fun verify(ctx: Context, email: String, code: String) {
        call(ctx, "POST", "/api/auth/verify", JSONObject().put("email", email).put("code", code), auth = false)
    }
    suspend fun login(ctx: Context, email: String, pw: String) {
        val r = call(ctx, "POST", "/api/auth/login", JSONObject().put("email", email).put("password", pw).put("device", deviceJson(ctx)), auth = false) as JSONObject
        ConnectState.saveLogin(ctx, r.getString("token"), r.getJSONObject("user").getString("email"), r.getJSONObject("device").getString("id"))
    }
    suspend fun forgot(ctx: Context, email: String) { call(ctx, "POST", "/api/auth/forgot", JSONObject().put("email", email), auth = false) }
    suspend fun reset(ctx: Context, email: String, code: String, pw: String) {
        call(ctx, "POST", "/api/auth/reset", JSONObject().put("email", email).put("code", code).put("password", pw), auth = false)
    }
    suspend fun logout(ctx: Context) { runCatching { call(ctx, "POST", "/api/auth/logout") }; ConnectState.clear(ctx) }
    suspend fun deleteAccount(ctx: Context, pw: String) { call(ctx, "DELETE", "/api/account", JSONObject().put("password", pw)); ConnectState.clear(ctx) }

    fun parsePerm(o: JSONObject): PermInfo {
        val f = o.optJSONArray("folders") ?: JSONArray()
        return PermInfo(o.getString("id"), o.getString("pcId"), o.optString("pcName"), o.getString("status"),
            (0 until f.length()).map { f.getString(it) }, o.optBoolean("readOnly"), o.optBoolean("pcOnline"), o.optString("createdAt"))
    }
    suspend fun permissions(ctx: Context): List<PermInfo> {
        val a = call(ctx, "GET", "/api/permissions") as JSONArray
        return (0 until a.length()).map { parsePerm(a.getJSONObject(it)) }
    }
    suspend fun approve(ctx: Context, id: String, folders: List<String>, readOnly: Boolean) {
        call(ctx, "POST", "/api/permissions/$id/approve", JSONObject().put("folders", JSONArray(folders)).put("readOnly", readOnly))
    }
    suspend fun reject(ctx: Context, id: String) { call(ctx, "POST", "/api/permissions/$id/reject") }
    suspend fun revoke(ctx: Context, id: String) { call(ctx, "POST", "/api/permissions/$id/revoke") }
    suspend fun pairCode(ctx: Context, folders: List<String>, readOnly: Boolean): String {
        val r = call(ctx, "POST", "/api/pair/code", JSONObject().put("folders", JSONArray(folders)).put("readOnly", readOnly)) as JSONObject
        return r.getString("code")
    }
    suspend fun devices(ctx: Context): List<DeviceInfo> {
        val a = call(ctx, "GET", "/api/devices") as JSONArray
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            DeviceInfo(it.getString("id"), it.getString("kind"), it.optString("name"), it.optString("model"), it.optBoolean("online"), it.optBoolean("self"), it.optString("last_seen").takeIf { s -> s.isNotBlank() && s != "null" })
        }
    }
    suspend fun revokeDevice(ctx: Context, id: String) { call(ctx, "POST", "/api/devices/$id/revoke") }
    suspend fun logs(ctx: Context): List<LogInfo> {
        val a = call(ctx, "GET", "/api/logs") as JSONArray
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            LogInfo(it.optString("action"), it.optString("detail"), it.optString("device_name").takeIf { s -> s.isNotBlank() && s != "null" }, it.optString("at"))
        }
    }
}

/** 승인할 때 고를 수 있는 기본 폴더 */
object FolderPresets {
    fun list(): List<Pair<String, String>> {
        fun pub(t: String) = Environment.getExternalStoragePublicDirectory(t).absolutePath
        return listOf(
            "카메라 사진·동영상" to pub(Environment.DIRECTORY_DCIM),
            "사진" to pub(Environment.DIRECTORY_PICTURES),
            "다운로드" to pub(Environment.DIRECTORY_DOWNLOADS),
            "문서" to pub(Environment.DIRECTORY_DOCUMENTS),
            "동영상" to pub(Environment.DIRECTORY_MOVIES),
            "음악" to pub(Environment.DIRECTORY_MUSIC),
            "내부 저장소 전체" to Environment.getExternalStorageDirectory().absolutePath,
        )
    }
    fun label(path: String): String = list().firstOrNull { it.second == path }?.first ?: path.substringAfterLast('/')
}

fun actionLabel(a: String): String = when (a) {
    "login" -> "로그인"; "login_failed" -> "로그인 실패"; "register" -> "회원가입"
    "pair_request" -> "PC 연결 요청"; "pair_approved" -> "연결 승인"; "pair_rejected" -> "연결 거절"; "pair_revoked" -> "연결 해제"
    "pair_code_used" -> "연결 코드로 연결"; "device_revoked" -> "기기 로그아웃"; "password_reset" -> "비밀번호 재설정"
    "remote_delete" -> "PC에서 삭제"; "remote_rename" -> "PC에서 이름 변경"; "remote_mkdir" -> "PC에서 폴더 생성"
    else -> a
}
