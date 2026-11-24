package kr.eumsoft.filemanager2.connect

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.IBinder
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.filemanager2.MainActivity
import kr.eumsoft.filemanager2.R
import kr.eumsoft.filemanager2.data.FileOps
import kr.eumsoft.filemanager2.data.Trash
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

/**
 * PC 연결 포그라운드 서비스.
 * 서버와 WebSocket 을 유지하고, 승인된 PC 의 요청을 '허용된 폴더 안에서만' 처리합니다.
 */
class ConnectService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var ws: WebSocket? = null
    private var loopJob: Job? = null
    private var stopped = false
    private var backoff = 2_000L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannels(this)
        startFg("연결 준비 중…")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelfSafely(); return START_NOT_STICKY }
        ConnectState.load(this)
        if (ConnectState.token(this) == null) { stopSelfSafely(); return START_NOT_STICKY }
        if (loopJob?.isActive != true) loopJob = scope.launch { connectLoop() }
        return START_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Android 15+: dataSync 서비스 하루 사용 시간 초과
        notifySimple(this, 3, "PC 연결이 일시 중지되었습니다", "Android 정책상 오늘 백그라운드 연결 시간이 끝났습니다. 앱을 열면 다시 연결됩니다.")
        stopSelfSafely()
    }

    private fun startFg(text: String) {
        val n = buildNotif(text)
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
        ServiceCompat.startForeground(this, NOTIF_ID, n, type)
    }

    private fun buildNotif(text: String): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).putExtra("openConnect", true)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, ConnectService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CH_STATUS)
            .setSmallIcon(R.drawable.ic_stat_connect)
            .setContentTitle("PC 연결")
            .setContentText(text)
            .setOngoing(true).setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(0, "연결 끄기", stop)
            .build()
    }

    private fun updateNotif(text: String) {
        ConnectState.statusText = text
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotif(text))
    }

    private suspend fun connectLoop() {
        while (!stopped) {
            val token = ConnectState.token(this) ?: break
            val done = kotlinx.coroutines.CompletableDeferred<Unit>()
            withContext(Dispatchers.Main) { updateNotif("서버에 연결 중…") }
            val req = Request.Builder().url(ConnectConfig.WS_URL + "?token=" + token).build()
            ws = ConnectApi.http.newWebSocket(req, object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    backoff = 2_000L
                    ConnectState.online = true
                    scope.launch(Dispatchers.Main) { updateNotif("켜짐 · PC에서 접속할 수 있습니다") }
                    scope.launch { refreshPending() }
                }
                override fun onMessage(webSocket: WebSocket, text: String) { handle(webSocket, text) }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null) }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    ConnectState.online = false
                    if (code == 4001) { // 로그아웃/차단됨
                        ConnectState.clear(this@ConnectService); stopped = true
                    }
                    done.complete(Unit)
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    ConnectState.online = false
                    if (response?.code == 401) { ConnectState.clear(this@ConnectService); stopped = true }
                    done.complete(Unit)
                }
            })
            done.await()
            if (stopped) break
            withContext(Dispatchers.Main) { updateNotif("연결 끊김 · ${backoff / 1000}초 후 다시 연결") }
            delay(backoff)
            backoff = (backoff * 2).coerceAtMost(60_000L)
        }
        withContext(Dispatchers.Main) { stopSelfSafely() }
    }

    private suspend fun refreshPending() {
        runCatching { ConnectApi.permissions(this) }.onSuccess { list ->
            withContext(Dispatchers.Main) {
                ConnectState.pendingRequests.clear()
                ConnectState.pendingRequests.addAll(list.filter { it.status == "pending" })
                ConnectState.refreshTick++
            }
        }
    }

    private fun handle(socket: WebSocket, text: String) {
        val m = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (m.optString("t")) {
            "req" -> scope.launch { serve(socket, m) }
            "pair_request" -> {
                val p = ConnectApi.parsePerm(m.getJSONObject("permission"))
                scope.launch(Dispatchers.Main) {
                    ConnectState.pendingRequests.removeAll { it.id == p.id }
                    ConnectState.pendingRequests.add(p)
                    ConnectState.refreshTick++
                }
                notifyPair(this, p)
            }
            "perm_changed" -> scope.launch { refreshPending() }
            "security" -> notifySimple(this, 4, "보안 알림", m.optString("message"))
        }
    }

    private suspend fun serve(socket: WebSocket, m: JSONObject) {
        val id = m.getString("id")
        val res = JSONObject().put("t", "res").put("id", id)
        withContext(Dispatchers.Main) { ConnectState.activeTransfers++; ConnectState.lastActivity = "${m.optString("fromName")}: ${opLabel(m.optString("op"))}" }
        try {
            val perm = m.getJSONObject("perm")
            val serverFolders = perm.getJSONArray("folders").let { a -> (0 until a.length()).map { a.getString(it) } }
            // 서버가 보낸 허용 폴더라도 이 휴대폰에서 사용자가 직접 고른 적 없는 폴더는 거부
            val mine = ConnectState.allowedByUser(this@ConnectService)
            val folders = if (mine.isEmpty()) serverFolders else serverFolders.filter { f -> mine.any { u -> f == u || f.startsWith("$u/") } }
            if (folders.isEmpty()) throw BridgeError("forbidden", "휴대폰에서 허용한 폴더가 아닙니다")
            val data = FileBridge(this, folders, perm.optBoolean("readOnly")).run(m.getString("op"), m.optJSONObject("args") ?: JSONObject())
            res.put("ok", true).put("data", data)
        } catch (e: BridgeError) {
            res.put("ok", false).put("error", e.code).put("message", e.message)
        } catch (e: Exception) {
            res.put("ok", false).put("error", "io_error").put("message", e.message ?: "파일 작업 실패")
        } finally {
            withContext(Dispatchers.Main) { ConnectState.activeTransfers = (ConnectState.activeTransfers - 1).coerceAtLeast(0) }
        }
        socket.send(res.toString())
    }

    private fun stopSelfSafely() {
        stopped = true
        runCatching { ws?.close(1000, "bye") }
        ConnectState.online = false
        ConnectState.statusText = "꺼짐"
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        stopped = true
        runCatching { ws?.close(1000, "bye") }
        ConnectState.online = false
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val CH_STATUS = "connect_status"
        const val CH_ALERT = "connect_alert"
        const val NOTIF_ID = 2001
        const val ACTION_STOP = "kr.eumsoft.filemanager2.STOP_CONNECT"

        fun start(ctx: Context) {
            ConnectState.setEnabled(ctx, true)
            androidx.core.content.ContextCompat.startForegroundService(ctx, Intent(ctx, ConnectService::class.java))
        }
        fun stop(ctx: Context) {
            ConnectState.setEnabled(ctx, false)
            ctx.startService(Intent(ctx, ConnectService::class.java).setAction(ACTION_STOP))
        }

        fun ensureChannels(ctx: Context) {
            if (Build.VERSION.SDK_INT < 26) return
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_STATUS, "PC 연결 상태", NotificationManager.IMPORTANCE_LOW))
            nm.createNotificationChannel(NotificationChannel(CH_ALERT, "PC 연결 승인 요청", NotificationManager.IMPORTANCE_HIGH))
        }
        fun notifySimple(ctx: Context, id: Int, title: String, text: String) {
            ensureChannels(ctx)
            val open = PendingIntent.getActivity(ctx, id, Intent(ctx, MainActivity::class.java).putExtra("openConnect", true), PendingIntent.FLAG_IMMUTABLE)
            runCatching {
                ctx.getSystemService(NotificationManager::class.java).notify(id, NotificationCompat.Builder(ctx, CH_ALERT)
                    .setSmallIcon(R.drawable.ic_stat_connect).setContentTitle(title).setContentText(text)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(text)).setAutoCancel(true).setContentIntent(open).build())
            }
        }
        fun notifyPair(ctx: Context, p: PermInfo) =
            notifySimple(ctx, 2002, "PC 연결 승인 요청", "'${p.pcName}' 에서 이 휴대폰에 연결하려고 합니다. 눌러서 승인하거나 거절하세요.")

        fun opLabel(op: String) = when (op) {
            "list" -> "폴더 보기"; "read" -> "파일 받는 중"; "write" -> "파일 보내는 중"; "delete" -> "삭제"
            "rename" -> "이름 변경"; "mkdir" -> "폴더 만들기"; "copy" -> "복사"; "move" -> "이동"; "thumb" -> "미리보기"; "roots" -> "허용 폴더 보기"; else -> op
        }
    }
}

class BridgeError(val code: String, message: String) : Exception(message)

/** 실제 파일 작업. 모든 경로는 허용 폴더 안인지 검사합니다. */
class FileBridge(private val ctx: Context, folders: List<String>, private val readOnly: Boolean) {
    private val roots: List<File> = folders.map { File(it).canonicalFile }

    private fun resolve(path: String?): File {
        if (path.isNullOrBlank()) throw BridgeError("bad_path", "경로가 없습니다")
        val f = File(path).canonicalFile
        val p = f.path
        if (p.contains("/Android/data") || p.contains("/Android/obb")) throw BridgeError("forbidden", "다른 앱의 비공개 폴더에는 접근할 수 없습니다")
        if (roots.none { r -> p == r.path || p.startsWith(r.path + "/") }) throw BridgeError("forbidden", "휴대폰에서 허용하지 않은 폴더입니다")
        return f
    }
    private fun needWrite() { if (readOnly) throw BridgeError("read_only", "읽기 전용으로 허용된 연결입니다") }
    private fun item(f: File) = JSONObject().put("name", f.name).put("path", f.absolutePath).put("dir", f.isDirectory)
        .put("size", if (f.isFile) f.length() else 0).put("mtime", f.lastModified())
        .apply { if (f.isDirectory) put("count", f.list()?.size ?: 0) }

    fun run(op: String, a: JSONObject): Any = when (op) {
        "roots" -> JSONArray().apply {
            roots.forEach { r -> put(JSONObject().put("name", FolderPresets.label(r.path)).put("path", r.path).put("exists", r.exists())) }
        }
        "list" -> {
            val d = resolve(a.optString("path"))
            if (!d.isDirectory) throw BridgeError("not_dir", "폴더가 아닙니다")
            val items = (d.listFiles() ?: emptyArray())
                .filter { a.optBoolean("hidden") || !it.name.startsWith(".") }
                .sortedWith(compareBy<File> { !it.isDirectory }.thenBy { it.name.lowercase() })
            JSONObject().put("path", d.absolutePath).put("items", JSONArray().apply { items.take(5000).forEach { put(item(it)) } })
        }
        "stat" -> item(resolve(a.optString("path")).also { if (!it.exists()) throw BridgeError("not_found", "파일이 없습니다") })
        "read" -> {
            val f = resolve(a.optString("path"))
            if (!f.isFile) throw BridgeError("not_found", "파일이 없습니다")
            val off = a.optLong("offset"); val len = a.optInt("length", 512 * 1024).coerceIn(1, 1024 * 1024)
            val buf = RandomAccessFile(f, "r").use { raf ->
                raf.seek(off); val b = ByteArray(minOf(len.toLong(), (f.length() - off).coerceAtLeast(0)).toInt()); raf.readFully(b); b
            }
            JSONObject().put("b64", Base64.encodeToString(buf, Base64.NO_WRAP)).put("size", f.length()).put("eof", off + buf.size >= f.length())
        }
        "write" -> {
            needWrite()
            val target = resolve(a.optString("path"))
            val dir = target.parentFile ?: throw BridgeError("bad_path", "잘못된 경로")
            resolve(dir.absolutePath)
            val part = File(dir, ".${target.name}.fm2part")
            val off = a.optLong("offset")
            if (off == 0L) part.delete()
            if (part.length() != off) throw BridgeError("offset_mismatch", "전송 위치가 맞지 않습니다 (이어받기 위치 ${part.length()})")
            val bytes = Base64.decode(a.optString("b64"), Base64.DEFAULT)
            part.appendBytes(bytes)
            if (a.optBoolean("final")) {
                val dest = if (target.exists()) FileOps.uniqueTarget(dir, target.name) else target
                if (!part.renameTo(dest)) throw IOException("저장하지 못했습니다")
                dest.setLastModified(System.currentTimeMillis())
                JSONObject().put("path", dest.absolutePath).put("size", dest.length()).put("done", true)
            } else JSONObject().put("received", part.length())
        }
        "mkdir" -> {
            needWrite()
            val parent = resolve(a.optString("path"))
            val name = a.optString("name").trim()
            if (name.isEmpty() || name.contains('/')) throw BridgeError("bad_name", "폴더 이름이 올바르지 않습니다")
            item(FileOps.newFolder(parent, name).also { resolve(it.absolutePath) })
        }
        "rename" -> {
            needWrite()
            val f = resolve(a.optString("path"))
            if (roots.any { it.path == f.path }) throw BridgeError("forbidden", "허용 폴더 자체는 바꿀 수 없습니다")
            val n = a.optString("newName").trim()
            if (n.isEmpty() || n.contains('/')) throw BridgeError("bad_name", "이름이 올바르지 않습니다")
            item(FileOps.rename(f, n))
        }
        "delete" -> {
            needWrite()
            val f = resolve(a.optString("path"))
            if (roots.any { it.path == f.path }) throw BridgeError("forbidden", "허용 폴더 자체는 삭제할 수 없습니다")
            // 실수 방지: 휴대폰 휴지통으로 옮김 (휴대폰에서 복원 가능)
            Trash(ctx).add(f)
            JSONObject().put("trashed", true)
        }
        "copy", "move" -> {
            needWrite()
            val src = resolve(a.optString("path"))
            if (roots.any { it.path == src.path }) throw BridgeError("forbidden", "허용 폴더 자체는 ${if (op == "copy") "복사" else "이동"}할 수 없습니다")
            if (!src.exists()) throw BridgeError("not_found", "파일이 없습니다")
            val dest = resolve(a.optString("destDir"))
            if (!dest.isDirectory) throw BridgeError("bad_dest", "대상이 폴더가 아닙니다")
            if (src.isDirectory && (dest.path == src.path || dest.path.startsWith(src.path + "/"))) throw BridgeError("bad_dest", "폴더를 자기 안으로 옮길 수 없습니다")
            val out = if (op == "copy") FileOps.copy(src, dest) else FileOps.move(src, dest)
            resolve(out.absolutePath)
            item(out)
        }
        "thumb" -> {
            val f = resolve(a.optString("path"))
            val size = a.optInt("size", 160).coerceIn(48, 512)
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(f.path, o)
            if (o.outWidth <= 0) throw BridgeError("no_thumb", "미리보기를 만들 수 없습니다")
            var s = 1; while (o.outWidth / (s * 2) >= size && o.outHeight / (s * 2) >= size) s *= 2
            val bmp = BitmapFactory.decodeFile(f.path, BitmapFactory.Options().apply { inSampleSize = s }) ?: throw BridgeError("no_thumb", "미리보기를 만들 수 없습니다")
            val bos = ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.JPEG, 75, bos); bmp.recycle()
            JSONObject().put("b64", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)).put("mime", "image/jpeg")
        }
        else -> throw BridgeError("bad_op", "지원하지 않는 작업")
    }
}
