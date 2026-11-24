package kr.eumsoft.filemanager2.connect

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.OpenableColumns
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

data class CloudProvider(val id: String, val label: String, val ready: Boolean)
data class CloudConn(val id: String, val provider: String, val label: String, val account: String, val ready: Boolean)
data class CloudItem(val id: String, val name: String, val dir: Boolean, val size: Long, val mtime: Long, val native: Boolean)
data class ShareInfo(val id: String, val url: String, val name: String, val size: Long, val kind: String, val expiresAt: String,
                     val maxDownloads: Int?, val downloads: Int, val hasPassword: Boolean, val active: Boolean)

/** 클라우드(Google Drive·Dropbox) — 서버가 공급자와 통신하고 파일은 저장 없이 중계합니다 */
object CloudApi {
    private val bigHttp: OkHttpClient = ConnectApi.http.newBuilder().readTimeout(0, TimeUnit.SECONDS).writeTimeout(0, TimeUnit.SECONDS).build()
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun providers(ctx: Context): List<CloudProvider> {
        val a = ConnectApi.call(ctx, "GET", "/api/cloud/providers", auth = false) as JSONArray
        return (0 until a.length()).map { a.getJSONObject(it) }.map { CloudProvider(it.getString("id"), it.getString("label"), it.optBoolean("ready")) }
    }
    suspend fun connections(ctx: Context): List<CloudConn> {
        val a = ConnectApi.call(ctx, "GET", "/api/cloud") as JSONArray
        return (0 until a.length()).map { a.getJSONObject(it) }.map { CloudConn(it.getString("id"), it.getString("provider"), it.optString("label"), it.optString("account"), it.optBoolean("ready")) }
    }
    suspend fun startUrl(ctx: Context, provider: String): String =
        (ConnectApi.call(ctx, "POST", "/api/cloud/$provider/start") as JSONObject).getString("url")
    suspend fun disconnect(ctx: Context, id: String) { ConnectApi.call(ctx, "DELETE", "/api/cloud/$id") }
    suspend fun list(ctx: Context, conn: String, ref: String): List<CloudItem> {
        val o = ConnectApi.call(ctx, "GET", "/api/cloud/$conn/list?id=${enc(ref)}") as JSONObject
        val a = o.getJSONArray("items")
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            CloudItem(it.getString("id"), it.getString("name"), it.optBoolean("dir"), it.optLong("size"), it.optLong("mtime"), it.optBoolean("native"))
        }
    }
    suspend fun mkdir(ctx: Context, conn: String, parent: String, name: String) {
        ConnectApi.call(ctx, "POST", "/api/cloud/$conn/mkdir", JSONObject().put("parent", parent).put("name", name))
    }
    suspend fun rename(ctx: Context, conn: String, id: String, name: String) {
        ConnectApi.call(ctx, "POST", "/api/cloud/$conn/rename", JSONObject().put("id", id).put("name", name))
    }
    suspend fun delete(ctx: Context, conn: String, id: String) {
        ConnectApi.call(ctx, "POST", "/api/cloud/$conn/delete", JSONObject().put("id", id))
    }
    suspend fun share(ctx: Context, conn: String, id: String, hours: Int, password: String?, maxDownloads: Int?): ShareInfo {
        val b = JSONObject().put("kind", "cloud").put("connId", conn).put("id", id).put("expiresHours", hours)
        if (!password.isNullOrBlank()) b.put("password", password)
        if (maxDownloads != null) b.put("maxDownloads", maxDownloads)
        return parseShare(ConnectApi.call(ctx, "POST", "/api/shares", b) as JSONObject)
    }
    suspend fun shares(ctx: Context): List<ShareInfo> {
        val a = ConnectApi.call(ctx, "GET", "/api/shares") as JSONArray
        return (0 until a.length()).map { parseShare(a.getJSONObject(it)) }
    }
    suspend fun revokeShare(ctx: Context, id: String) { ConnectApi.call(ctx, "POST", "/api/shares/$id/revoke") }
    private fun parseShare(o: JSONObject) = ShareInfo(o.getString("id"), o.getString("url"), o.optString("name"), o.optLong("size"), o.optString("kind"),
        o.optString("expiresAt"), if (o.isNull("maxDownloads")) null else o.optInt("maxDownloads"), o.optInt("downloads"), o.optBoolean("hasPassword"), o.optBoolean("active"))

    /** 받기: 휴대폰 Download/FileManager2 폴더로 저장 (같은 이름이 있으면 번호를 붙임) */
    fun download(ctx: Context, conn: String, item: CloudItem, progress: (Long) -> Unit, canceled: () -> Boolean): File {
        val dir = File(Environment.getExternalStorageDirectory(), "Download/FileManager2").apply { mkdirs() }
        var dest = File(dir, item.name)
        var i = 1
        while (dest.exists()) { val dot = item.name.lastIndexOf('.'); dest = File(dir, if (dot > 0) "${item.name.substring(0, dot)} ($i)${item.name.substring(dot)}" else "${item.name} ($i)"); i++ }
        val part = File(dir, ".${dest.name}.fm2part")
        val req = Request.Builder().url("${ConnectConfig.SERVER_URL}/api/cloud/$conn/download?id=${enc(item.id)}")
            .header("Authorization", "Bearer ${ConnectState.token(ctx)}").build()
        bigHttp.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw ApiException("http_${r.code}", runCatching { JSONObject(r.body!!.string()).optString("message") }.getOrNull()?.ifBlank { null } ?: "받지 못했습니다 (${r.code})")
            r.body!!.byteStream().use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(256 * 1024); var done = 0L
                    while (true) {
                        if (canceled()) { out.close(); part.delete(); throw ApiException("canceled", "취소했습니다") }
                        val n = input.read(buf); if (n < 0) break
                        out.write(buf, 0, n); done += n; progress(done)
                    }
                }
            }
        }
        if (!part.renameTo(dest)) throw ApiException("io", "저장하지 못했습니다")
        return dest
    }

    /** 올리기: 휴대폰 파일(content:// 또는 파일)을 스트리밍으로 전송 */
    fun upload(ctx: Context, conn: String, parent: String, uri: Uri, name: String, size: Long, progress: (Long) -> Unit, canceled: () -> Boolean) {
        val body = object : RequestBody() {
            override fun contentType(): MediaType = "application/octet-stream".toMediaType()
            override fun contentLength(): Long = size
            override fun writeTo(sink: BufferedSink) {
                ctx.contentResolver.openInputStream(uri)!!.use { input ->
                    val buf = ByteArray(256 * 1024); var done = 0L
                    while (true) {
                        if (canceled()) throw java.io.IOException("취소했습니다")
                        val n = input.read(buf); if (n < 0) break
                        sink.write(buf, 0, n); done += n; progress(done)
                    }
                }
            }
        }
        val req = Request.Builder().url("${ConnectConfig.SERVER_URL}/api/cloud/$conn/upload?parent=${enc(parent)}&name=${enc(name)}")
            .header("Authorization", "Bearer ${ConnectState.token(ctx)}").post(body).build()
        bigHttp.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw ApiException("http_${r.code}", runCatching { JSONObject(r.body!!.string()).optString("message") }.getOrNull()?.ifBlank { null } ?: "올리지 못했습니다 (${r.code})")
        }
    }

    fun nameAndSize(ctx: Context, uri: Uri): Pair<String, Long> {
        if (uri.scheme == "file") { val f = File(uri.path!!); return f.name to f.length() }
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) return (c.getString(0) ?: "file") to (if (c.isNull(1)) -1L else c.getLong(1))
        }
        return (uri.lastPathSegment ?: "file") to -1L
    }
}

/** 클라우드 전송 목록 (화면을 나가도 계속 진행) */
object CloudTransfers {
    data class T(val id: Long, val up: Boolean, val name: String, val size: Long) {
        var done by mutableStateOf(0L)
        var status by mutableStateOf("대기")   // 대기·진행·완료·실패·취소
        var error by mutableStateOf<String?>(null)
        var savedPath by mutableStateOf<String?>(null)
        @Volatile var cancel = false
    }
    val items = mutableStateListOf<T>()
    var onFinished: ((T) -> Unit)? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var seq = 0L

    fun download(ctx: Context, conn: String, item: CloudItem) {
        val t = T(++seq, false, item.name, item.size); items.add(0, t)
        scope.launch { run(t) { t.savedPath = CloudApi.download(ctx.applicationContext, conn, item, { t.done = it }, { t.cancel }).absolutePath } }
    }
    fun upload(ctx: Context, conn: String, parent: String, uri: Uri) {
        val (name, size) = CloudApi.nameAndSize(ctx, uri)
        val t = T(++seq, true, name, size); items.add(0, t)
        scope.launch {
            run(t) {
                if (size < 0) throw ApiException("size", "파일 크기를 알 수 없어 올릴 수 없습니다")
                CloudApi.upload(ctx.applicationContext, conn, parent, uri, name, size, { t.done = it }, { t.cancel })
            }
        }
    }
    private suspend fun run(t: T, block: suspend () -> Unit) {
        withContext(Dispatchers.Main) { t.status = "진행" }
        try { block(); withContext(Dispatchers.Main) { t.status = "완료"; t.done = t.size.coerceAtLeast(t.done) } }
        catch (e: Exception) { withContext(Dispatchers.Main) { if (t.cancel) t.status = "취소" else { t.status = "실패"; t.error = e.message } } }
        withContext(Dispatchers.Main) { onFinished?.invoke(t) }
    }
    /** NAS 등 다른 출처의 전송 */
    fun startDownload(name: String, size: Long, block: (progress: (Long) -> Unit, canceled: () -> Boolean) -> File) {
        val t = T(++seq, false, name, size); items.add(0, t)
        scope.launch { run(t) { t.savedPath = block({ t.done = it }, { t.cancel }).absolutePath } }
    }
    fun startUpload(ctx: Context, uri: Uri, block: (name: String, size: Long, progress: (Long) -> Unit, canceled: () -> Boolean) -> Unit) {
        val (name, size) = CloudApi.nameAndSize(ctx, uri)
        val t = T(++seq, true, name, size); items.add(0, t)
        scope.launch {
            run(t) {
                if (size < 0) throw ApiException("size", "파일 크기를 알 수 없어 올릴 수 없습니다")
                block(name, size, { t.done = it }, { t.cancel })
            }
        }
    }
    fun clearFinished() { items.removeAll { it.status != "진행" && it.status != "대기" } }
}
