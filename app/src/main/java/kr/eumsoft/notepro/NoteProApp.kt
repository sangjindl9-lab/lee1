package kr.eumsoft.notepro

import android.app.Application
import kr.eumsoft.notepro.core.Stroke
import kr.eumsoft.notepro.data.BackupManager
import kr.eumsoft.notepro.data.FileStore
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteDb
import kr.eumsoft.notepro.data.NoteRepository
import kr.eumsoft.notepro.data.Prefs
import kr.eumsoft.notepro.data.SessionManager
import kr.eumsoft.notepro.data.SettingsStore
import kr.eumsoft.notepro.data.VersionManager
import kr.eumsoft.notepro.pdf.PdfStore
import kr.eumsoft.notepro.render.PaperPainter
import kr.eumsoft.notepro.sync.Api
import kr.eumsoft.notepro.sync.SyncEngine
import kr.eumsoft.notepro.sync.TokenStore
import java.io.File

class NoteProApp : Application() {
    lateinit var prefs: Prefs; private set
    lateinit var settings: SettingsStore; private set
    lateinit var files: FileStore; private set
    lateinit var repo: NoteRepository; private set
    lateinit var versions: VersionManager; private set
    lateinit var sessions: SessionManager; private set
    lateinit var pdf: PdfStore; private set
    lateinit var backup: BackupManager; private set
    lateinit var sync: SyncEngine; private set
    /** 라이브러리 화면 새로고침(동기화로 노트가 바뀌었을 때) */
    var onLibraryChanged: (() -> Unit)? = null

    /** 창 사이 복사·붙여넣기용 앱 내부 클립보드(필기 획). */
    var strokeClipboard: List<Stroke> = emptyList()

    /** 지난 실행이 비정상 종료였으면 그 내용(복구 안내용). */
    var previousCrash: String? = null; private set

    override fun onCreate() {
        super.onCreate()
        instance = this
        val crashFile = File(filesDir, "last_crash.txt")
        val runningFlag = File(filesDir, "running.flag")
        previousCrash = when {
            crashFile.exists() -> crashFile.readText().take(4000)
            runningFlag.exists() -> "abnormal-exit"
            else -> null
        }
        crashFile.delete()
        runningFlag.writeText(System.currentTimeMillis().toString())

        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try {
                // DB가 아니라 파일에 즉시 기록(앱이 곧 종료되므로)
                crashFile.writeText("${System.currentTimeMillis()} ${t.name}\n${e.stackTraceToString()}")
            } catch (_: Throwable) { }
            previous?.uncaughtException(t, e)
        }

        prefs = Prefs(this)
        settings = SettingsStore(prefs)
        files = FileStore(this)
        NoteDb.backupBeforeMigration(this)
        repo = NoteRepository(this, NoteDb(this))
        versions = VersionManager(repo, files)
        sessions = SessionManager(repo, versions, settings)
        pdf = PdfStore(this, repo, files)
        backup = BackupManager(this, repo, files)
        PaperPainter.labels = resources.getStringArray(R.array.template_labels)
        val tokens = TokenStore(this)
        sync = SyncEngine(repo, files, tokens, Api(tokens)) { changed ->
            changed.forEach { sessions.reloadFromDb(it) }
            onLibraryChanged?.invoke()
        }
        // 인터넷이 다시 연결되면 자동 동기화
        try {
            (getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager).registerDefaultNetworkCallback(object : android.net.ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: android.net.Network) { Io.main.postDelayed({ sync.requestSync() }, 1500) }
            })
        } catch (_: Exception) { }

        val crash = previousCrash
        Io.run {
            if (crash != null && crash != "abnormal-exit") repo.logError("crash", crash.lineSequence().firstOrNull() ?: "crash", crash)
            if (crash == "abnormal-exit") repo.logError("abnormal-exit", "previous session ended without clean shutdown")
            cleanupTempFiles()
        }
    }

    /** 정상 종료 표시(작업 화면을 떠날 때). */
    fun markCleanExit() { File(filesDir, "running.flag").delete() }
    fun markRunning() { File(filesDir, "running.flag").writeText(System.currentTimeMillis().toString()) }

    private fun cleanupTempFiles() {
        listOf(files.attachmentsDir, files.versionsDir).forEach { d -> d.listFiles()?.filter { it.name.endsWith(".tmp") }?.forEach { it.delete() } }
    }

    companion object {
        lateinit var instance: NoteProApp; private set
    }
}
