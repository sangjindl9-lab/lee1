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

    /** 다른 스레드(동기화 등)에서 DB 작업을 실행하고 결과를 기다린다. Io 스레드 안에서 부르면 안 된다. */
    fun <T> call(work: () -> T): T {
        check(Thread.currentThread().name != "notepro-db") { "Io.call from Io thread" }
        val f = java.util.concurrent.FutureTask<T>(work)
        executor.execute(f)
        try { return f.get() } catch (e: java.util.concurrent.ExecutionException) { throw e.cause ?: e }
    }

    /** 앞서 넣은 작업이 모두 끝날 때까지 기다린다(앱이 백그라운드로 갈 때 저장 완료 보장). */
    fun flush(timeoutMs: Long = 3000): Boolean {
        val latch = CountDownLatch(1)
        executor.execute { latch.countDown() }
        return latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    }
}
