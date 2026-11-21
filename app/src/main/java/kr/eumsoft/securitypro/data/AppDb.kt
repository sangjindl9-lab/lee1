package kr.eumsoft.securitypro.data

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    version = 1,
    exportSchema = true,
    entities = [
        ScanSession::class, ScanResult::class, ScanFinding::class, InstalledApp::class,
        ThreatHash::class, ThreatRule::class, ThreatSource::class, ThreatDbVersion::class,
        AdFilterRule::class, AdFilterSource::class, BlockedDnsEvent::class,
        AllowedDomain::class, BlockedDomain::class, VpnSession::class,
        UpdateHistory::class, SecuritySetting::class,
    ],
)
abstract class AppDb : RoomDatabase() {
    abstract fun scan(): ScanDao
    abstract fun apps(): InstalledAppDao
    abstract fun threat(): ThreatDao
    abstract fun dns(): DnsDao

    companion object {
        const val NAME = "eum_security.db"
        /** 향후 스키마 변경 시 여기에 Migration 을 추가한다 (androidTest/MigrationTest 로 검증). */
        val MIGRATIONS = arrayOf<androidx.room.migration.Migration>()
    }
}
