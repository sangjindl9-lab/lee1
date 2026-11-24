package kr.eumsoft.filemanager2.connect

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** NAS 비밀번호가 등록한 주소 밖으로 나가지 않는지 확인 */
class NasScopeTest {
    private val p = NasProfile("t", "t", "https://nas.example.com:5006/home", "u", false)
    @Test fun inside() {
        assertTrue(Nas.inScope(p, "https://nas.example.com:5006/home/"))
        assertTrue(Nas.inScope(p, "https://nas.example.com:5006/home/a/b.txt"))
        assertTrue(Nas.inScope(p, "https://NAS.example.com:5006/home/x"))
    }
    @Test fun outside() {
        listOf(
            "https://evil.example.com:5006/home/x", "https://nas.example.com:5007/home/x", "http://nas.example.com:5006/home/x",
            "https://nas.example.com:5006/homeX/x", "https://nas.example.com:5006/other/x", "https://nas.example.com:5006/home/%2e%2e/etc",
            "https://nas.example.com:5006/home/a%2fb", "https://u:p@nas.example.com:5006/home/x", "https://nas.example.com:5006@evil.com/home/x",
        ).forEach { assertFalse(it, Nas.inScope(p, it)) }
        val base = "https://nas.example.com:5006/home/".toHttpUrl()
        assertFalse(Nas.inScope(p, base.resolve("https://evil.com/home/x").toString()))
        assertFalse(Nas.inScope(p, base.resolve("//evil.com/home/x").toString()))
        assertFalse(Nas.inScope(p, base.resolve("../etc/passwd").toString()))
        assertTrue(Nas.inScope(p, base.resolve("/home/sub/").toString()))
    }
    @Test fun transport() {
        assertNull(Nas.transportProblem("http://192.168.0.10:5005/", false))
        assertNull(Nas.transportProblem("https://192.168.0.10:5006/", true))
        assertNotNull(Nas.transportProblem("http://mynas.synology.me:5005/", false))
        assertNotNull(Nas.transportProblem("https://mynas.synology.me:5006/", true))
        assertNull(Nas.transportProblem("https://mynas.synology.me:5006/", false))
        assertNull(Nas.transportProblem("http://172.20.1.1/", false))
        assertNotNull(Nas.transportProblem("http://172.32.1.1/", false))
    }
}
