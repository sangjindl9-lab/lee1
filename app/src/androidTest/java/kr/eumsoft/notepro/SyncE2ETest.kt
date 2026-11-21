package kr.eumsoft.notepro

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kr.eumsoft.notepro.core.NotebookData
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageTemplate
import kr.eumsoft.notepro.core.PaperStyle
import kr.eumsoft.notepro.core.PenType
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.core.StrokeCodec
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.sync.Api
import kr.eumsoft.notepro.sync.TokenStore
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * 실제 서버(에뮬레이터 호스트 10.0.2.2:8080)와 기기 사이 동기화 검증.
 * 서버가 없으면 건너뛴다(결과 파일에 SKIPPED 기록).
 */
@RunWith(AndroidJUnit4::class)
class SyncE2ETest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as NoteProApp
    private val server = "http://10.0.2.2:8080"

    private fun syncAndWait(): Throwable? {
        val latch = CountDownLatch(1); var err: Throwable? = null
        Io.main.post { app.sync.requestSync { e -> err = e; latch.countDown() } }
        assertTrue("sync timeout", latch.await(90, TimeUnit.SECONDS))
        return err
    }

    @Test fun twoDevicesSyncThroughRealServer() {
        val out = File(app.filesDir, "sync_result.txt")
        app.sync.tokens.serverUrl = server
        val ok = try { java.net.URL("$server/health").openStream().use { it.readBytes() }; true } catch (e: Exception) { false }
        if (!ok) { out.writeText("SKIPPED no server"); return }
        val email = "e2e-${System.currentTimeMillis()}@test.com"
        // 기기 A(이 앱): 가입 → 노트·필기 → 동기화
        app.sync.signup(email, "password123", app.prefs.deviceId, "ko")
        val now = System.currentTimeMillis()
        val nb = NotebookData(UUID.randomUUID().toString(), null, "sync-test", "", -1, false, false, false, now, now, 0, false, listOf("동기화"))
        val pg = PageData(UUID.randomUUID().toString(), nb.id, 0, 595f, 842f, PaperStyle.LINED, PageTemplate.NONE, createdAt = now, updatedAt = now)
        val pts = FloatArray(40) { if (it % 4 == 2) 0.5f else it.toFloat() }
        Io.call {
            app.repo.createNotebook(nb, listOf(pg))
            app.repo.applyStrokes(nb.id, (0 until 30).map { Stroke(Stroke.newId(), pg.id, PenType.BALLPOINT, -16777216, 2f, 1f, pts, now) }, emptyList(), "t")
        }
        assertNull(syncAndWait())
        assertEquals(0, Io.call { app.repo.db.rawQuery("SELECT COUNT(*) FROM sync_operations WHERE status='pending' AND notebook_id=?", arrayOf(nb.id)).use { it.moveToFirst(); it.getInt(0) } })

        // 기기 B(다른 기기를 API로 흉내): 로그인 → 받기 → 획 5개 추가 → 보내기
        val tb = TokenStore(app).apply { serverUrl = server }
        val apiB = Api(tb)
        val devB = UUID.randomUUID().toString()
        apiB.saveTokens(apiB.request("POST", "/v1/auth/login", apiB.deviceInfo(JSONObject().put("email", email).put("password", "password123"), devB), auth = false))
        val pulled = apiB.request("GET", "/v1/sync/pull?since=0&limit=1000").getJSONArray("changes")
        // 이 기기에 원래 있던 다른 노트도 계정에 함께 올라가므로, 이번 노트의 획만 센다
        val strokesOnB = (0 until pulled.length()).map { pulled.getJSONObject(it) }
            .count { it.getString("entityType") == "stroke" && it.getJSONObject("data").optString("notebookId") == nb.id }
        assertEquals(30, strokesOnB)
        val blob = android.util.Base64.encodeToString(StrokeCodec.encode(pts), android.util.Base64.NO_WRAP)
        val ops = JSONArray()
        repeat(5) {
            ops.put(JSONObject().put("opId", UUID.randomUUID().toString()).put("entityType", "stroke").put("entityId", UUID.randomUUID().toString())
                .put("opType", "upsert").put("baseRev", 0).put("data", JSONObject().put("pageId", pg.id).put("notebookId", nb.id).put("pen", 1).put("color", 255).put("width", 3).put("opacity", 1).put("points", blob)))
        }
        val res = apiB.request("POST", "/v1/sync/push", JSONObject().put("ops", ops)).getJSONArray("results")
        assertTrue((0 until res.length()).all { res.getJSONObject(it).getString("status") == "applied" })

        // 기기 A: 받아서 35개가 되어야 함
        assertNull(syncAndWait())
        val local = Io.call { app.repo.strokes(nb.id).size }
        out.writeText("device_a_strokes_after_pull=$local (expected 35) device_b_received=$strokesOnB")
        assertEquals(35, local)
        // 로그아웃해도 기기 노트는 그대로
        app.sync.logout()
        assertEquals(35, Io.call { app.repo.strokes(nb.id).size })
        // 이 기기의 refresh 토큰 정리(다른 테스트 영향 방지)
        tb.refreshToken = null
    }
}
