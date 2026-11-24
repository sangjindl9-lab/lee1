package kr.eumsoft.filemanager2.connect

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import okhttp3.Credentials
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory
import java.io.File
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

data class NasProfile(val id: String, val name: String, val url: String, val user: String, val insecure: Boolean) {
    val root: String get() = if (url.endsWith("/")) url else "$url/"
}
data class NasItem(val name: String, val url: String, val dir: Boolean, val size: Long, val mtime: Long)

/** NAS(WebDAV) — 휴대폰에서 NAS로 직접 연결합니다. 비밀번호는 Android 키 저장소로 암호화해 이 기기에만 보관합니다. */
object Nas {
    private const val P = "fm2_nas"
    private const val KEY_ALIAS = "fm2_nas_key"

    fun profiles(ctx: Context): List<NasProfile> {
        val a = runCatching { JSONArray(ctx.getSharedPreferences(P, Context.MODE_PRIVATE).getString("list", "[]")) }.getOrDefault(JSONArray())
        return (0 until a.length()).map { a.getJSONObject(it) }.map { NasProfile(it.getString("id"), it.getString("name"), it.getString("url"), it.getString("user"), it.optBoolean("insecure")) }
    }
    fun save(ctx: Context, p: NasProfile, password: String?) {
        val l = profiles(ctx).filter { it.id != p.id } + p
        val a = JSONArray().apply { l.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("url", it.url).put("user", it.user).put("insecure", it.insecure)) } }
        val e = ctx.getSharedPreferences(P, Context.MODE_PRIVATE).edit().putString("list", a.toString())
        if (password != null) e.putString("pw_" + p.id, SecureStore.encrypt(password)).putString("pwroot_" + p.id, p.root)
        e.apply()
    }
    fun remove(ctx: Context, id: String) {
        val l = profiles(ctx).filter { it.id != id }
        val a = JSONArray().apply { l.forEach { put(JSONObject().put("id", it.id).put("name", it.name).put("url", it.url).put("user", it.user).put("insecure", it.insecure)) } }
        ctx.getSharedPreferences(P, Context.MODE_PRIVATE).edit().putString("list", a.toString()).remove("pw_$id").remove("pwroot_$id").apply()
    }
    fun newId() = "nas-" + UUID.randomUUID().toString()
    /** 저장된 비밀번호는 저장할 때의 NAS 주소에만 씁니다. 주소가 바뀌면 다시 입력해야 합니다. */
    private fun password(ctx: Context, p: NasProfile): String {
        val sp = ctx.getSharedPreferences(P, Context.MODE_PRIVATE)
        val bound = sp.getString("pwroot_${p.id}", null)
        if (bound == null) sp.edit().putString("pwroot_${p.id}", p.root).apply()   // 1.8 이전 저장분: 현재 주소에 묶음
        else if (!sameOrigin(bound, p.root) || !p.root.toHttpUrl().encodedPath.startsWith(bound.toHttpUrl().encodedPath))
            throw ApiException("password_bound", "NAS 주소가 바뀌어 저장된 비밀번호를 쓰지 않습니다. 비밀번호를 다시 입력해 주세요")
        return sp.getString("pw_${p.id}", null)?.let { SecureStore.decrypt(it) ?: decrypt(it) }
            ?: throw ApiException("no_password", "저장된 NAS 비밀번호가 없습니다. NAS 설정에서 다시 입력해 주세요")
    }

    // ---- 주소 범위 검사: 비밀번호는 등록한 NAS(같은 scheme·호스트·포트, 등록 경로 아래)에만 보냅니다 ----
    private fun sameOrigin(a: String, b: String): Boolean = runCatching {
        val x = a.toHttpUrl(); val y = b.toHttpUrl(); x.scheme == y.scheme && x.host.equals(y.host, true) && x.port == y.port
    }.getOrDefault(false)
    fun inScope(p: NasProfile, url: String): Boolean = runCatching {
        val r = p.root.toHttpUrl(); val u = url.toHttpUrl()
        val rp = r.encodedPath.let { if (it.endsWith("/")) it else "$it/" }
        val up = u.encodedPath
        u.username.isEmpty() && u.password.isEmpty() && sameOrigin(p.root, url) &&
            (up == rp.trimEnd('/') || up.startsWith(rp)) && u.pathSegments.none { it == ".." || it == "." } &&
            !up.contains("%2e%2e", true) && !up.contains("%2f", true) && !up.contains("%5c", true)
    }.getOrDefault(false)
    private fun guard(p: NasProfile, url: String) {
        if (!inScope(p, url)) throw ApiException("forbidden", "등록한 NAS 주소 밖으로는 요청하지 않습니다")
    }
    /** http(암호화 없음)와 '인증서 확인 안 함'은 내부망 주소에서만 허용합니다. */
    fun isPrivateHost(host: String): Boolean {
        val h = host.lowercase().trim('[', ']')
        if (h == "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true
        val v4 = h.split(".").mapNotNull { it.toIntOrNull() }
        if (v4.size == 4 && h.count { it == '.' } == 3) {
            val (a, b) = v4[0] to v4[1]
            return a == 10 || a == 127 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
        }
        if (h.contains(':')) return h == "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")
        return false
    }
    fun transportProblem(url: String, insecure: Boolean): String? {
        val u = runCatching { url.toHttpUrl() }.getOrNull() ?: return "주소 형식이 올바르지 않습니다"
        if (u.username.isNotEmpty()) return "주소에 아이디를 넣지 마세요"
        if (isPrivateHost(u.host)) return null
        if (u.scheme == "http") return "외부(인터넷) 주소는 HTTPS만 쓸 수 있습니다. http는 비밀번호가 그대로 노출됩니다"
        if (insecure) return "'인증서 확인 안 함'은 내부망 주소(192.168.x.x 등)에서만 쓸 수 있습니다"
        return null
    }

    // ---- 비밀번호 암호화 (Android Keystore AES-GCM) ----
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return g.generateKey()
    }
    private fun encrypt(s: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
        return Base64.encodeToString(c.iv, Base64.NO_WRAP) + "." + Base64.encodeToString(c.doFinal(s.toByteArray()), Base64.NO_WRAP)
    }
    private fun decrypt(s: String): String? = runCatching {
        val (iv, data) = s.split(".").map { Base64.decode(it, Base64.NO_WRAP) }
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        String(c.doFinal(data))
    }.getOrNull()

    // ---- HTTP ----
    private val base = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).connectTimeout(15, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).writeTimeout(0, TimeUnit.SECONDS).build()
    private val insecureClient: OkHttpClient by lazy {
        val tm = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
        val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(tm), SecureRandom()) }
        base.newBuilder().sslSocketFactory(ssl.socketFactory, tm).hostnameVerifier { _, _ -> true }.build()
    }
    private fun client(p: NasProfile) = if (p.insecure) insecureClient else base
    private fun req(ctx: Context, p: NasProfile, url: String, pw: String? = null): Request.Builder {
        guard(p, url)
        transportProblem(p.root, p.insecure)?.let { throw ApiException("insecure_transport", it) }
        return Request.Builder().url(url).header("Authorization", Credentials.basic(p.user, pw ?: password(ctx, p), Charsets.UTF_8))
    }

    private fun fail(code: Int, what: String): Nothing = throw ApiException("http_$code", when (code) {
        401 -> "NAS 로그인에 실패했습니다 (아이디·비밀번호 확인)"
        403 -> "권한이 없습니다 (NAS의 공유 폴더·WebDAV 권한 확인)"
        404 -> "경로를 찾을 수 없습니다 (주소 확인)"
        in 300..399 -> "NAS가 다른 주소로 이동을 요청했습니다. 보안을 위해 따라가지 않습니다 (주소·포트·https 확인)"
        405 -> "WebDAV가 꺼져 있거나 주소가 다릅니다"
        else -> "$what 실패 ($code)"
    })
    private fun net(e: Exception): Nothing = throw ApiException("network", when {
        e is javax.net.ssl.SSLException || e.cause is java.security.cert.CertificateException -> "인증서를 확인할 수 없습니다. 자체 서명 인증서라면 '인증서 확인 안 함'을 켜 주세요"
        else -> "NAS에 연결할 수 없습니다: ${e.message}"
    })

    fun list(ctx: Context, p: NasProfile, url: String, pw: String? = null): List<NasItem> {
        val body = """<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>"""
        val r = try {
            client(p).newCall(req(ctx, p, url, pw).header("Depth", "1").method("PROPFIND", body.toRequestBody("application/xml; charset=utf-8".toMediaType())).build()).execute()
        } catch (e: Exception) { net(e) }
        r.use {
            if (!it.isSuccessful) fail(it.code, "목록")
            return parse(url, it.body!!.string()).filter { item -> inScope(p, item.url) }
        }
    }
    private fun parse(baseUrl: String, xml: String): List<NasItem> {
        val baseH = baseUrl.toHttpUrl()
        val out = mutableListOf<NasItem>()
        val pp = XmlPullParserFactory.newInstance().apply { isNamespaceAware = true }.newPullParser()
        pp.setInput(xml.reader())
        var href = ""; var dir = false; var size = 0L; var mod = 0L; var tag = ""
        val df = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US)
        while (pp.eventType != XmlPullParser.END_DOCUMENT) {
            when (pp.eventType) {
                XmlPullParser.START_TAG -> { tag = pp.name; if (tag == "response") { href = ""; dir = false; size = 0; mod = 0 }; if (tag == "collection") dir = true }
                XmlPullParser.TEXT -> {
                    val t = pp.text.trim()
                    if (t.isNotEmpty()) when (tag) {
                        "href" -> href = t
                        "getcontentlength" -> size = t.toLongOrNull() ?: 0
                        "getlastmodified" -> mod = runCatching { df.parse(t)!!.time }.getOrDefault(0)
                    }
                }
                XmlPullParser.END_TAG -> {
                    if (pp.name == "response" && href.isNotEmpty()) {
                        val full = baseH.resolve(href)
                        if (full != null && full.encodedPath.trimEnd('/') != baseH.encodedPath.trimEnd('/')) {
                            val seg = full.encodedPath.trimEnd('/').substringAfterLast('/')
                            val name = URLDecoder.decode(seg.replace("+", "%2B"), "UTF-8")
                            if (name.isNotEmpty()) out.add(NasItem(name, full.toString().let { u -> if (dir && !u.endsWith("/")) "$u/" else u }, dir, size, mod))
                        }
                    }
                    tag = ""
                }
            }
            pp.next()
        }
        return out.sortedWith(compareBy<NasItem>({ !it.dir }, { it.name.lowercase() }))
    }
    fun enc(name: String): String = URLEncoder.encode(name, "UTF-8").replace("+", "%20")

    private fun simple(ctx: Context, p: NasProfile, method: String, url: String, dest: String? = null, what: String) {
        val b = req(ctx, p, url).method(method, if (method == "MKCOL" || method == "MOVE" || method == "DELETE") null else ByteArray(0).toRequestBody())
        if (dest != null) { guard(p, dest); b.header("Destination", dest).header("Overwrite", "F") }
        val r = try { client(p).newCall(b.build()).execute() } catch (e: Exception) { net(e) }
        r.use { if (!it.isSuccessful) fail(it.code, what) }
    }
    fun mkdir(ctx: Context, p: NasProfile, dirUrl: String, name: String) = simple(ctx, p, "MKCOL", dirUrl + enc(name) + "/", what = "폴더 만들기")
    fun delete(ctx: Context, p: NasProfile, it: NasItem) = simple(ctx, p, "DELETE", it.url, what = "삭제")
    fun rename(ctx: Context, p: NasProfile, it: NasItem, newName: String) {
        val parent = it.url.trimEnd('/').substringBeforeLast('/') + "/"
        simple(ctx, p, "MOVE", it.url, parent + enc(newName) + if (it.dir) "/" else "", "이름 변경")
    }

    fun download(ctx: Context, p: NasProfile, item: NasItem, progress: (Long) -> Unit, canceled: () -> Boolean): File {
        val dir = File(Environment.getExternalStorageDirectory(), "Download/FileManager2").apply { mkdirs() }
        var dest = File(dir, item.name); var i = 1
        while (dest.exists()) { val dot = item.name.lastIndexOf('.'); dest = File(dir, if (dot > 0) "${item.name.substring(0, dot)} ($i)${item.name.substring(dot)}" else "${item.name} ($i)"); i++ }
        val part = File(dir, ".${dest.name}.fm2part")
        val r = try { client(p).newCall(req(ctx, p, item.url).get().build()).execute() } catch (e: Exception) { net(e) }
        r.use {
            if (!it.isSuccessful) fail(it.code, "받기")
            it.body!!.byteStream().use { input ->
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

    fun upload(ctx: Context, p: NasProfile, dirUrl: String, uri: Uri, name: String, size: Long, progress: (Long) -> Unit, canceled: () -> Boolean) {
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
        val r = try { client(p).newCall(req(ctx, p, dirUrl + enc(name)).put(body).build()).execute() } catch (e: Exception) { net(e) }
        r.use { if (!it.isSuccessful) fail(it.code, "올리기") }
    }
}
