package kr.eumsoft.kidscoloring

import android.app.Application
import kr.eumsoft.kidscoloring.data.AppDb
import kr.eumsoft.kidscoloring.data.Repository
import kr.eumsoft.kidscoloring.data.SettingsStore

class EumApp : Application() {
    lateinit var repo: Repository
        private set

    override fun onCreate() {
        super.onCreate()
        I18n.init(this)
        repo = Repository(this, AppDb.open(this), SettingsStore(this))
    }
}
