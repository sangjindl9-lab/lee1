package kr.eumsoft.notepro.data

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** DB 전용 단일 스레드. 모든 쓰기가 순서대로 실행되어 경쟁 조건이 없다. */
object Io {
    private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "notepro-db").apply { priority = Thread.NORM_PRIORITY - 1 } }
    val main = Handler(Looper.getMainLooper())

    fun run(block: () -> Unit) { executor.execute(block) }

    fun <T> async(work: () -> T, done: (Result<T>) -> Unit) {
        executor.execute {
            val r = runCatching(work)
            main.post { done(r) }
        }
    }

    /** 앞서 넣은 작업이 모두 끝날 때까지 기다린다(앱이 백그라운드로 갈 때 저장 완료 보장). */
    fun flush(timeoutMs: Long = 3000): Boolean {
        val latch = CountDownLatch(1)
        executor.execute { latch.countDown() }
        return latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    }
}
