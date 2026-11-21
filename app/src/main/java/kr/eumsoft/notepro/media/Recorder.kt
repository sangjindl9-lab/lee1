package kr.eumsoft.notepro.media

import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kr.eumsoft.notepro.data.FileStore
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteRepository
import java.security.MessageDigest
import java.util.UUID

/**
 * 녹음 + 필기 연동. 녹음 중 쓴 획은 획의 작성 시각(createdAt)으로 녹음 구간과 연결되며,
 * 재생 모드에서 획을 누르면 그 시각(2초 앞)부터 재생한다. 녹음 파일은 첨부로 저장·동기화된다.
 */
class Recorder(private val context: Context, private val repo: NoteRepository, private val files: FileStore) {
    data class Rec(val id: String, val attachmentId: String, val startedAt: Long, val durationMs: Long)
    data class State(val recordingNb: String? = null, val startedAt: Long = 0, val paused: Boolean = false, val playing: String? = null)

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state
    private var recorder: MediaRecorder? = null
    private var attachId: String? = null
    private var pausedTotal = 0L
    private var pausedAt = 0L
    private var player: MediaPlayer? = null

    fun start(nbId: String) {
        if (recorder != null) return
        val id = UUID.randomUUID().toString()
        val f = files.attachmentFile(id)
        val r = (if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()).apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioEncodingBitRate(64_000); setAudioSamplingRate(44_100)
            setOutputFile(f.path)
            prepare(); start()
        }
        recorder = r; attachId = id; pausedTotal = 0
        _state.value = State(recordingNb = nbId, startedAt = System.currentTimeMillis())
    }

    fun pauseResume() {
        val r = recorder ?: return
        if (_state.value.paused) { r.resume(); pausedTotal += System.currentTimeMillis() - pausedAt; _state.value = _state.value.copy(paused = false) }
        else { r.pause(); pausedAt = System.currentTimeMillis(); _state.value = _state.value.copy(paused = true) }
    }

    /** 녹음 끝: 파일을 첨부·녹음 기록으로 저장(Io 스레드). */
    fun stop(onSaved: () -> Unit = {}) {
        val r = recorder ?: return
        val st = _state.value
        try { r.stop() } catch (_: Exception) { }
        r.release(); recorder = null
        val id = attachId ?: return
        val nb = st.recordingNb ?: return
        val dur = System.currentTimeMillis() - st.startedAt - pausedTotal
        _state.value = State()
        Io.async({
            val f = files.attachmentFile(id)
            val sha = MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }
            repo.tx {
                repo.addAttachment(id, nb, "audio", "recording-${st.startedAt}.m4a", "audio/mp4", f.length(), sha)
                repo.opEntity("attachment", id, nb, "upsert")
                repo.db.execSQL("INSERT INTO recordings(id, notebook_id, attachment_id, started_at, duration_ms, consent_at, created_at) VALUES(?,?,?,?,?,?,?)",
                    arrayOf(UUID.randomUUID().toString(), nb, id, st.startedAt, dur, st.startedAt, System.currentTimeMillis()))
            }
        }) { onSaved() }
    }

    fun recordings(nbId: String): List<Rec> = repo.db.rawQuery(
        "SELECT id, attachment_id, started_at, duration_ms FROM recordings WHERE notebook_id=? AND deleted=0 ORDER BY started_at", arrayOf(nbId),
    ).use { c -> val l = ArrayList<Rec>(); while (c.moveToNext()) l.add(Rec(c.getString(0), c.getString(1), c.getLong(2), c.getLong(3))); l }

    /** 획 작성 시각에 해당하는 녹음 구간 재생. 반환: 재생했으면 true */
    fun playAt(recs: List<Rec>, timeMs: Long): Boolean {
        val rec = recs.lastOrNull { timeMs >= it.startedAt && timeMs <= it.startedAt + it.durationMs + 5_000 } ?: return false
        play(rec, (timeMs - rec.startedAt - 2_000).coerceAtLeast(0))
        return true
    }

    fun play(rec: Rec, fromMs: Long = 0) {
        stopPlayback()
        player = MediaPlayer().apply {
            setDataSource(files.attachmentFile(rec.attachmentId).path)
            prepare(); seekTo(fromMs.toInt()); start()
            setOnCompletionListener { stopPlayback() }
        }
        _state.value = _state.value.copy(playing = rec.id)
    }

    fun stopPlayback() {
        player?.let { runCatching { it.stop() }; it.release() }
        player = null
        _state.value = _state.value.copy(playing = null)
    }
}
