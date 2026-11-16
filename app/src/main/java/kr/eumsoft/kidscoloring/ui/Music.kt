package kr.eumsoft.kidscoloring.ui

/** 배경 음악(색칠·놀이터): res/raw 의 곡을 번갈아 되풀이한다. */
class BgmPlayer(private val ctx: android.content.Context) {
    private val tracks = intArrayOf(kr.eumsoft.kidscoloring.R.raw.coloring_bgm_1, kr.eumsoft.kidscoloring.R.raw.coloring_bgm_2)
    private var index = 0
    private var player: android.media.MediaPlayer? = null
    private var playing = false

    fun start() {
        if (playing) return
        playing = true
        val p = player
        if (p != null) { try { p.start() } catch (e: IllegalStateException) { player = null; open() } } else open()
    }

    private fun open() {
        val p = try { android.media.MediaPlayer.create(ctx.applicationContext, tracks[index]) } catch (e: Exception) { null } ?: return
        p.setVolume(0.45f, 0.45f)
        p.setOnCompletionListener {
            it.release(); player = null
            index = (index + 1) % tracks.size
            if (playing) open()
        }
        player = p
        p.start()
    }

    /** 잠시 멈춤: 다시 start() 하면 이어서 나온다 */
    fun pause() {
        playing = false
        try { player?.pause() } catch (e: IllegalStateException) {}
    }

    fun release() {
        playing = false
        player?.release(); player = null
    }
}
