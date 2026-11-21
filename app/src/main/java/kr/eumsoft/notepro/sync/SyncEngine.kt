package kr.eumsoft.notepro.sync

import android.content.ContentValues
import android.database.Cursor
import android.util.Base64
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kr.eumsoft.notepro.core.CorruptDataException
import kr.eumsoft.notepro.core.StrokeCodec
import kr.eumsoft.notepro.data.FileStore
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.data.getStringOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

data class SyncStatus(
    val loggedIn: Boolean = false,
    val running: Boolean = false,
    val pending: Int = 0,
    val lastSyncAt: Long = 0,
    val lastError: String? = null,
    val conflicts: Int = 0,
)

/**
 * 기기 ↔ 서버 동기화.
 * - 네트워크는 전용 스레드, DB 읽기·쓰기는 Io 스레드(Io.call)에서만 → 필기 저장과 충돌하지 않음
 * - 기기 원본은 서버 결과와 관계없이 지우지 않는다. 서버 오류 시 다음 주기에 실패한 것만 다시 보낸다.
 */
class SyncEngine(
    private val repo: NoteRepository,
    private val files: FileStore,
    val tokens: TokenStore,
    val api: Api,
    private val onRemoteChange: (Set<String>) -> Unit,
) {
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "notepro-sync") }
    private val running = AtomicBoolean(false)
    private val _status = MutableStateFlow(SyncStatus(loggedIn = tokens.refreshToken != null))
    val status: StateFlow<SyncStatus> = _status

    private fun post(f: (SyncStatus) -> SyncStatus) { Io.main.post { _status.value = f(_status.value) } }

    fun refreshPending() {
        Io.async({ repo.pendingSyncOps() }) { r -> r.getOrNull()?.let { n -> _status.value = _status.value.copy(pending = n, loggedIn = tokens.refreshToken != null) } }
    }

    /** 동기화 요청(이미 돌고 있으면 무시). */
    fun requestSync(done: ((Throwable?) -> Unit)? = null) {
        if (tokens.refreshToken == null || !api.configured) { refreshPending(); done?.invoke(null); return }
        if (!running.compareAndSet(false, true)) { done?.let { Io.main.post { it(null) } }; return }
        post { it.copy(running = true) }
        worker.execute {
            var err: Throwable? = null
            try { syncOnce() } catch (e: Throwable) { err = e; Io.run { repo.logError("sync", e.toString(), e.stackTraceToString()) } }
            running.set(false)
            val pending = try { Io.call { repo.pendingSyncOps() } } catch (e: Exception) { 0 }
            val msg = err?.let { (it as? ApiException)?.code ?: it.javaClass.simpleName }
            post { it.copy(running = false, pending = pending, lastError = msg, lastSyncAt = if (err == null) System.currentTimeMillis() else it.lastSyncAt, loggedIn = tokens.refreshToken != null) }
            done?.let { d -> Io.main.post { d(err) } }
        }
    }

    // ===================== 한 번의 동기화 =====================
    private fun syncOnce() {
        val touched = HashSet<String>()
        for (i in 0 until 1000) if (!pushBatch(touched)) break
        pull(touched)
        if (touched.isNotEmpty()) Io.main.post { onRemoteChange(touched) }
    }

    private class Pending(val type: String, val id: String, val nbId: String, val opIds: MutableList<String>, var latestOp: String, var opType: String, var maxCreated: Long)

    /** 대기 중인 변경을 대상별 최신 상태로 묶어 전송. 보낼 것이 있었으면 true. */
    private fun pushBatch(touched: MutableSet<String>): Boolean {
        val batch: List<Pair<Pending, JSONObject>> = Io.call {
            val map = LinkedHashMap<String, Pending>()
            repo.db.rawQuery(
                "SELECT op_id, entity_type, entity_id, notebook_id, op_type, created_at FROM sync_operations WHERE status='pending' AND entity_type IS NOT NULL ORDER BY created_at, rowid LIMIT 3000", null,
            ).use { c ->
                while (c.moveToNext()) {
                    val key = c.getString(1) + ":" + c.getString(2)
                    val p = map.getOrPut(key) { Pending(c.getString(1), c.getString(2), c.getString(3), ArrayList(), c.getString(0), c.getString(4), 0) }
                    p.opIds.add(c.getString(0)); p.latestOp = c.getString(0); p.opType = c.getString(4); p.maxCreated = c.getLong(5)
                }
            }
            map.values.take(300).map { it to stateOf(it) }
        }
        if (batch.isEmpty()) return false
        // 첨부 파일은 먼저 올린다(조각 업로드, 이미 있으면 생략)
        for ((p, data) in batch) if (p.type == "attachment" && !data.optBoolean("deleted")) uploadAttachment(p.id, data)
        val ops = JSONArray()
        for ((p, data) in batch) {
            ops.put(JSONObject().put("opId", p.latestOp).put("entityType", p.type).put("entityId", p.id)
                .put("opType", if (data.optBoolean("deleted")) "delete" else "upsert").put("baseRev", data.optInt("_rev", 0))
                .put("data", data.apply { remove("_rev") }).put("createdAt", p.maxCreated))
        }
        val res = api.request("POST", "/v1/sync/push", JSONObject().put("ops", ops)).getJSONArray("results")
        val byOp = HashMap<String, JSONObject>()
        for (i in 0 until res.length()) res.getJSONObject(i).let { byOp[it.getString("opId")] = it }
        val needFetch = ArrayList<Pair<String, String>>()
        var progressed = false
        Io.call {
            repo.tx {
                for ((p, _) in batch) {
                    val r = byOp[p.latestOp] ?: continue
                    val placeholders = p.opIds.joinToString(",") { "?" }
                    when (r.getString("status")) {
                        "applied", "duplicate", "conflict" -> {
                            progressed = true
                            setServerRev(p.type, p.id, r.optInt("rev", 0))
                            repo.db.execSQL("UPDATE sync_operations SET status='done' WHERE op_id IN ($placeholders)", p.opIds.toTypedArray())
                            if (r.getString("status") == "conflict") {
                                val copy = r.optString("copyId", "")
                                if (p.type == "stroke" && copy.isNotBlank()) {
                                    // 내 버전은 서버에서 사본이 되었으므로 이쪽도 사본 ID로 바꾸고, 원본(다른 기기 버전)은 받아온다
                                    repo.db.execSQL("UPDATE pen_strokes SET id=?, server_rev=1 WHERE id=?", arrayOf(copy, p.id))
                                }
                                needFetch.add(p.type to p.id)
                                touched.add(p.nbId)
                            }
                        }
                        else -> {
                            repo.db.execSQL("UPDATE sync_operations SET attempts=attempts+1, last_error=?, status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE status END WHERE op_id IN ($placeholders)",
                                (listOf<Any>(r.optString("reason", "rejected")) + p.opIds).toTypedArray())
                        }
                    }
                }
            }
        }
        for ((type, id) in needFetch) {
            try {
                val e = api.request("GET", "/v1/sync/entity/$type/$id")
                Io.call { repo.tx { applyChange(type, e.getInt("rev"), e.getJSONObject("data"), force = true)?.let { touched.add(it) } } }
            } catch (ex: ApiException) { if (ex.status != 404) throw ex }
        }
        if (!progressed) return false
        post { it.copy(conflicts = it.conflicts + needFetch.size) }
        return true
    }

    private fun setServerRev(type: String, id: String, rev: Int) {
        val t = table(type) ?: return
        repo.db.execSQL("UPDATE $t SET server_rev=? WHERE id=?", arrayOf<Any>(rev, id))
    }

    private fun table(type: String) = when (type) {
        "folder" -> "notebook_folders"; "notebook" -> "notebooks"; "attachment" -> "attachments"; "page" -> "pages"; "stroke" -> "pen_strokes"; else -> null
    }

    /** 대상의 현재 상태(JSON). 행이 없으면(영구 삭제) 삭제로 보낸다. "_rev" = 마지막으로 받은 서버 rev */
    private fun stateOf(p: Pending): JSONObject {
        val d = JSONObject()
        val db = repo.db
        fun q(sql: String, f: (Cursor) -> Unit): Boolean = db.rawQuery(sql, arrayOf(p.id)).use { c -> if (c.moveToFirst()) { f(c); true } else false }
        val found = when (p.type) {
            "folder" -> q("SELECT parent_id,name,deleted,server_rev FROM notebook_folders WHERE id=?") { c ->
                d.put("parentId", c.getStringOrNull(0) ?: JSONObject.NULL).put("name", c.getString(1)).put("deleted", c.getInt(2) == 1).put("_rev", c.getInt(3)) }
            "notebook" -> q("SELECT folder_id,title,description,cover_color,favorite,locked,is_infinite,deleted,server_rev FROM notebooks WHERE id=?") { c ->
                d.put("folderId", c.getStringOrNull(0) ?: JSONObject.NULL).put("title", c.getString(1)).put("description", c.getString(2)).put("coverColor", c.getInt(3))
                    .put("favorite", c.getInt(4) == 1).put("locked", c.getInt(5) == 1).put("infinite", c.getInt(6) == 1).put("deleted", c.getInt(7) == 1).put("_rev", c.getInt(8))
                    .put("tags", JSONArray(repo.tagsOf(p.id))) }
            "attachment" -> q("SELECT notebook_id,kind,file_name,mime,size,sha256,deleted,server_rev FROM attachments WHERE id=?") { c ->
                d.put("notebookId", c.getString(0)).put("kind", c.getString(1)).put("fileName", c.getString(2)).put("mime", c.getString(3))
                    .put("size", c.getLong(4)).put("sha256", c.getString(5)).put("deleted", c.getInt(6) == 1).put("_rev", c.getInt(7)) }
            "page" -> q("SELECT notebook_id,page_index,width,height,paper,template,bg_type,attachment_id,pdf_page,deleted,server_rev FROM pages WHERE id=?") { c ->
                d.put("notebookId", c.getString(0)).put("index", c.getInt(1)).put("width", c.getDouble(2)).put("height", c.getDouble(3)).put("paper", c.getString(4))
                    .put("template", c.getString(5)).put("bgType", c.getInt(6)).put("attachmentId", c.getStringOrNull(7) ?: JSONObject.NULL).put("pdfPage", c.getInt(8))
                    .put("deleted", c.getInt(9) == 1).put("_rev", c.getInt(10)) }
            "stroke" -> q("SELECT page_id,notebook_id,pen,color,width,opacity,shape,points,deleted,server_rev FROM pen_strokes WHERE id=?") { c ->
                d.put("pageId", c.getString(0)).put("notebookId", c.getString(1)).put("pen", c.getInt(2)).put("color", c.getInt(3)).put("width", c.getDouble(4))
                    .put("opacity", c.getDouble(5)).put("shape", c.getInt(6)).put("points", Base64.encodeToString(c.getBlob(7), Base64.NO_WRAP))
                    .put("deleted", c.getInt(8) == 1).put("_rev", c.getInt(9)) }
            else -> false
        }
        if (!found) d.put("deleted", true).put("notebookId", p.nbId)
        return d
    }

    private fun uploadAttachment(id: String, data: JSONObject) {
        val sha = data.getString("sha256")
        val f = files.attachmentFile(id)
        if (!f.exists()) return
        val st = api.request("GET", "/v1/files/$sha/status")
        if (!st.optBoolean("complete")) {
            val chunk = st.optInt("chunkSize", 8 * 1024 * 1024)
            val have = st.optJSONArray("received")?.let { a -> (0 until a.length()).map { a.getInt(it) }.toSet() } ?: emptySet()
            val total = ((f.length() + chunk - 1) / chunk).toInt().coerceAtLeast(1)
            f.inputStream().use { input ->
                val buf = ByteArray(chunk)
                for (i in 0 until total) {
                    var n = 0
                    while (n < chunk) { val r = input.read(buf, n, chunk - n); if (r < 0) break; n += r }
                    if (i in have) continue // 실패한 조각만 다시 보낸다
                    api.requestBytes("PUT", "/v1/files/$sha/chunks/$i?total=$total", raw = buf.copyOf(n))
                }
            }
            api.request("POST", "/v1/files/$sha/complete")
        }
        Io.call { repo.db.execSQL("UPDATE attachments SET uploaded=1 WHERE id=?", arrayOf(id)) }
    }

    // ===================== 받기 =====================
    private fun pull(touched: MutableSet<String>) {
        val key = "since:" + tokens.userId
        var since = Io.call { repo.db.rawQuery("SELECT value FROM sync_state WHERE key=?", arrayOf(key)).use { if (it.moveToFirst()) it.getString(0).toLong() else 0L } }
        val all = ArrayList<JSONObject>()
        var guard = 0
        while (guard++ < 40) {
            val r = api.request("GET", "/v1/sync/pull?since=$since&limit=500")
            val ch = r.getJSONArray("changes")
            for (i in 0 until ch.length()) all.add(ch.getJSONObject(i))
            since = r.getLong("nextSince")
            if (!r.optBoolean("hasMore")) break
        }
        val order = mapOf("folder" to 0, "notebook" to 1, "attachment" to 2, "page" to 3, "stroke" to 4)
        all.sortWith(compareBy({ order[it.getString("entityType")] ?: 9 }, { it.optLong("seq") }))
        // 첨부 파일 먼저 내려받기
        for (c in all) if (c.getString("entityType") == "attachment") downloadAttachment(c.getJSONObject("data"))
        val newSince = since
        Io.call {
            repo.tx {
                for (c in all) {
                    try { applyChange(c.getString("entityType"), c.getInt("rev"), c.getJSONObject("data"), force = false)?.let { touched.add(it) } }
                    catch (e: Exception) { repo.logError("sync.apply", "${c.optString("entityType")} ${e.message}") }
                }
                repo.db.execSQL("INSERT OR REPLACE INTO sync_state(key,value) VALUES(?,?)", arrayOf(key, newSince.toString()))
            }
        }
    }

    private fun downloadAttachment(d: JSONObject) {
        val f = files.attachmentFile(d.getString("id"))
        if (f.exists() || d.optBoolean("deleted")) return
        val bytes = api.requestBytes("GET", "/v1/files/" + d.getString("sha256"))
        val sha = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        if (sha != d.getString("sha256")) throw CorruptDataException("attachment checksum mismatch")
        files.writeAtomic(f, bytes)
    }

    /** 서버 상태를 기기에 반영(동기화 기록을 새로 만들지 않음). 이 기기에 아직 안 보낸 변경이 있으면 force=false일 때 건너뜀. 반환: 노트 ID */
    private fun applyChange(type: String, rev: Int, d: JSONObject, force: Boolean): String? {
        val db = repo.db
        val id = d.getString("id")
        if (!force) {
            val pending = db.rawQuery("SELECT 1 FROM sync_operations WHERE entity_id=? AND status='pending' LIMIT 1", arrayOf(id)).use { it.moveToFirst() }
            if (pending) return null // 내 변경이 우선 전송되고, 충돌은 서버가 양쪽 보존 처리
        }
        val now = System.currentTimeMillis()
        val del = if (d.optBoolean("deleted")) 1 else 0
        fun nullable(k: String) = if (d.isNull(k)) null else d.optString(k).takeIf { it.isNotBlank() }
        return when (type) {
            "folder" -> {
                repo.upsert("notebook_folders", ContentValues().apply {
                    put("id", id); put("parent_id", nullable("parentId")?.takeIf { exists("notebook_folders", it) }); put("name", d.optString("name"))
                    put("updated_at", now); put("deleted", del); put("server_rev", rev)
                    if (!exists("notebook_folders", id)) put("created_at", now)
                }); null
            }
            "notebook" -> {
                val isNew = !exists("notebooks", id)
                repo.upsert("notebooks", ContentValues().apply {
                    put("id", id); put("folder_id", nullable("folderId")?.takeIf { exists("notebook_folders", it) }); put("title", d.optString("title"))
                    put("description", d.optString("description")); put("cover_color", d.optInt("coverColor")); put("favorite", if (d.optBoolean("favorite")) 1 else 0)
                    put("locked", if (d.optBoolean("locked")) 1 else 0); put("is_infinite", if (d.optBoolean("infinite")) 1 else 0)
                    put("deleted", del); put("updated_at", now); put("server_rev", rev)
                    if (isNew) put("created_at", d.optLong("createdAt", now))
                    if (del == 1) put("deleted_at", now)
                })
                d.optJSONArray("tags")?.let { a -> repo.setTagsInTx(id, (0 until a.length()).map { a.getString(it) }) }
                id
            }
            "attachment" -> {
                repo.upsert("attachments", ContentValues().apply {
                    put("id", id); put("notebook_id", d.getString("notebookId")); put("kind", d.optString("kind")); put("file_name", d.optString("fileName"))
                    put("mime", d.optString("mime")); put("size", d.optLong("size")); put("sha256", d.optString("sha256")); put("deleted", del)
                    put("updated_at", now); put("server_rev", rev); put("uploaded", 1)
                    if (!exists("attachments", id)) put("created_at", now)
                }); d.getString("notebookId")
            }
            "page" -> {
                repo.upsert("pages", ContentValues().apply {
                    put("id", id); put("notebook_id", d.getString("notebookId")); put("page_index", d.optInt("index")); put("width", d.optDouble("width", 595.0))
                    put("height", d.optDouble("height", 842.0)); put("paper", d.optString("paper", "blank")); put("template", d.optString("template", "none"))
                    put("bg_type", d.optInt("bgType")); put("attachment_id", nullable("attachmentId")?.takeIf { exists("attachments", it) }); put("pdf_page", d.optInt("pdfPage", -1))
                    put("deleted", del); put("updated_at", now); put("server_rev", rev)
                    if (!exists("pages", id)) put("created_at", now)
                    if (del == 1) put("deleted_at", now)
                }); d.getString("notebookId")
            }
            "stroke" -> {
                val blob = Base64.decode(d.getString("points"), Base64.NO_WRAP)
                StrokeCodec.decode(blob) // 손상 데이터는 저장하지 않음(예외)
                repo.upsert("pen_strokes", ContentValues().apply {
                    put("id", id); put("page_id", d.getString("pageId")); put("notebook_id", d.getString("notebookId")); put("pen", d.optInt("pen"))
                    put("color", d.optInt("color")); put("width", d.optDouble("width", 2.0)); put("opacity", d.optDouble("opacity", 1.0)); put("shape", d.optInt("shape"))
                    put("points", blob); put("deleted", del); put("updated_at", now); put("server_rev", rev)
                    if (!exists("pen_strokes", id)) put("created_at", d.optLong("createdAt", now))
                }); d.getString("notebookId")
            }
            else -> null
        }
    }

    private fun exists(table: String, id: String) = repo.db.rawQuery("SELECT 1 FROM $table WHERE id=?", arrayOf(id)).use { it.moveToFirst() }

    // ===================== 계정 =====================
    private fun deviceId(prefsDevice: String) = tokens.deviceId ?: prefsDevice.also { tokens.deviceId = it }

    fun signup(email: String, password: String, prefsDevice: String, locale: String): JSONObject {
        val body = api.deviceInfo(JSONObject().put("email", email).put("password", password).put("locale", locale), deviceId(prefsDevice))
        val r = withDeviceRetry(body) { api.request("POST", "/v1/auth/signup", it, auth = false) }
        api.saveTokens(r); tokens.email = email; post { it.copy(loggedIn = true) }
        return r
    }

    fun login(email: String, password: String, prefsDevice: String): JSONObject {
        val body = api.deviceInfo(JSONObject().put("email", email).put("password", password), deviceId(prefsDevice))
        val r = withDeviceRetry(body) { api.request("POST", "/v1/auth/login", it, auth = false) }
        api.saveTokens(r); tokens.email = email; post { it.copy(loggedIn = true) }
        return r
    }

    private fun withDeviceRetry(body: JSONObject, call: (JSONObject) -> JSONObject): JSONObject = try { call(body) } catch (e: ApiException) {
        if (e.code != "device_belongs_to_other_account") throw e
        val fresh = java.util.UUID.randomUUID().toString(); tokens.deviceId = fresh
        call(body.put("deviceId", fresh))
    }

    /** 로그아웃: 서버 세션만 끝낸다. 기기의 노트는 절대 지우지 않는다. */
    fun logout() {
        try { api.request("POST", "/v1/auth/logout") } catch (_: Exception) { }
        tokens.refreshToken = null; tokens.accessToken = null
        post { it.copy(loggedIn = false) }
    }

    /** 다른 계정으로 바꿀 때 이 기기 노트를 새 계정에 올리지 않기로 하면: 대기 기록을 'local_only'로 보관(삭제 아님). */
    fun keepLocalOnly() = Io.call { repo.db.execSQL("UPDATE sync_operations SET status='local_only' WHERE status='pending'") }

    /** 새 계정에 처음 연결: 받은 위치 초기화 + 모든 노트 전송 대기. */
    fun linkAllLocalNotes() = Io.call {
        repo.tx {
            repo.db.execSQL("UPDATE sync_operations SET status='pending' WHERE status='local_only'")
            repo.db.execSQL("UPDATE notebooks SET server_rev=0"); repo.db.execSQL("UPDATE pages SET server_rev=0")
            repo.db.execSQL("UPDATE pen_strokes SET server_rev=0"); repo.db.execSQL("UPDATE attachments SET server_rev=0, uploaded=0")
            repo.db.execSQL("UPDATE notebook_folders SET server_rev=0")
            val ids = repo.db.rawQuery("SELECT id FROM notebooks", null).use { c -> val l = ArrayList<String>(); while (c.moveToNext()) l.add(c.getString(0)); l }
            repo.db.rawQuery("SELECT id FROM notebook_folders", null).use { c -> while (c.moveToNext()) repo.opEntity("folder", c.getString(0), c.getString(0), "upsert") }
            ids.forEach { repo.recordAll(it) }
        }
    }

    // ===================== 클라우드 백업 =====================
    fun uploadBackup(file: File, kind: String): JSONObject {
        val sha = MessageDigest.getInstance("SHA-256").let { md -> file.inputStream().use { s -> val b = ByteArray(1 shl 16); while (true) { val n = s.read(b); if (n < 0) break; md.update(b, 0, n) } }; md.digest() }
            .joinToString("") { "%02x".format(it) }
        val st = api.request("GET", "/v1/files/$sha/status")
        if (!st.optBoolean("complete")) {
            val chunk = st.optInt("chunkSize", 8 * 1024 * 1024)
            val total = ((file.length() + chunk - 1) / chunk).toInt().coerceAtLeast(1)
            file.inputStream().use { input ->
                val buf = ByteArray(chunk)
                for (i in 0 until total) {
                    var n = 0; while (n < chunk) { val r = input.read(buf, n, chunk - n); if (r < 0) break; n += r }
                    api.requestBytes("PUT", "/v1/files/$sha/chunks/$i?total=$total", raw = buf.copyOf(n))
                }
            }
            api.request("POST", "/v1/files/$sha/complete")
        }
        return api.request("POST", "/v1/backups", JSONObject().put("sha256", sha).put("kind", kind))
    }

    fun listBackups(): JSONArray = api.request("GET", "/v1/backups").getJSONArray("backups")
    fun downloadFile(sha: String, target: File) { files.writeAtomic(target, api.requestBytes("GET", "/v1/files/$sha")) }
    fun devices(): JSONObject = api.request("GET", "/v1/devices")
    fun revokeDevice(id: String) { api.request("DELETE", "/v1/devices/$id") }
    fun deleteAccount() { api.request("DELETE", "/v1/account"); tokens.refreshToken = null; tokens.accessToken = null; post { it.copy(loggedIn = false) } }
    fun exportAccount(): ByteArray = api.requestBytes("GET", "/v1/account/export")
    fun requestPasswordReset(email: String) { api.request("POST", "/v1/auth/password-reset/request", JSONObject().put("email", email), auth = false) }
    fun confirmPasswordReset(token: String, pw: String) { api.request("POST", "/v1/auth/password-reset/confirm", JSONObject().put("token", token).put("password", pw), auth = false) }
}
