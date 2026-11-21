package kr.eumsoft.securitypro.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

data class CategoryCount(val category: String, val n: Int)
data class HourCount(val hour: Long, val n: Int)

@Dao
interface ScanDao {
    @Insert suspend fun insertSession(s: ScanSession): Long
    @Update suspend fun updateSession(s: ScanSession)
    @Insert suspend fun insertResult(r: ScanResult): Long
    @Insert suspend fun insertFindings(f: List<ScanFinding>)
    @Query("SELECT * FROM scan_sessions ORDER BY startedAt DESC LIMIT 100") fun sessions(): Flow<List<ScanSession>>
    @Query("SELECT * FROM scan_sessions WHERE status != 'RUNNING' ORDER BY startedAt DESC LIMIT 1") fun lastSession(): Flow<ScanSession?>
    @Query("SELECT * FROM scan_sessions WHERE id = :id") suspend fun session(id: Long): ScanSession?
    @Query("SELECT * FROM scan_results WHERE sessionId = :sid ORDER BY CASE verdict WHEN 'DANGER' THEN 0 WHEN 'CAUTION' THEN 1 WHEN 'UNSCANNABLE' THEN 2 ELSE 3 END, targetName")
    fun results(sid: Long): Flow<List<ScanResult>>
    @Query("SELECT * FROM scan_results WHERE id = :id") suspend fun result(id: Long): ScanResult?
    @Query("SELECT * FROM scan_findings WHERE resultId = :rid") suspend fun findings(rid: Long): List<ScanFinding>
    @Query("""SELECT COUNT(DISTINCT packageName) FROM scan_results WHERE verdict = 'DANGER' AND targetType = 'INSTALLED_APP'
              AND sessionId = (SELECT id FROM scan_sessions WHERE status = 'DONE' AND kind IN ('QUICK','INSTALLED','SCHEDULED') ORDER BY startedAt DESC LIMIT 1)""")
    fun dangerAppsInLastScan(): Flow<Int>
    @Query("DELETE FROM scan_sessions") suspend fun clearAll()
    @Query("DELETE FROM scan_sessions WHERE startedAt < :before") suspend fun deleteOlderThan(before: Long)
    @Query("UPDATE scan_sessions SET status = 'FAILED', finishedAt = :now WHERE status = 'RUNNING'") suspend fun failStale(now: Long)
}

@Dao
interface InstalledAppDao {
    @Upsert suspend fun upsert(a: InstalledApp)
    @Query("SELECT * FROM installed_apps WHERE packageName = :p") suspend fun get(p: String): InstalledApp?
}

@Dao
interface ThreatDao {
    @Query("SELECT * FROM threat_hashes WHERE sha256 = :h LIMIT 1") suspend fun findHash(h: String): ThreatHash?
    @Query("SELECT COUNT(*) FROM threat_hashes") fun hashCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM threat_rules WHERE kind = :kind") fun ruleCount(kind: String): Flow<Int>
    @Query("SELECT * FROM threat_rules WHERE kind = :kind") suspend fun rules(kind: String): List<ThreatRule>
    @Query("SELECT * FROM threat_db_versions") fun versions(): Flow<List<ThreatDbVersion>>
    @Query("SELECT * FROM threat_db_versions WHERE component = :c") suspend fun version(c: String): ThreatDbVersion?
    @Query("SELECT * FROM threat_sources ORDER BY name") fun sources(): Flow<List<ThreatSource>>
    @Query("SELECT value FROM security_settings WHERE `key` = :k") suspend fun setting(k: String): String?
    @Upsert suspend fun putSetting(s: SecuritySetting)

    @Query("DELETE FROM threat_hashes") suspend fun clearHashes()
    @Query("DELETE FROM threat_rules") suspend fun clearRules()
    @Query("DELETE FROM threat_sources") suspend fun clearSources()
    @Query("DELETE FROM threat_hashes WHERE sha256 IN (:hashes)") suspend fun deleteHashes(hashes: List<String>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertHashes(h: List<ThreatHash>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertRules(r: List<ThreatRule>)
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun insertSources(s: List<ThreatSource>)
    @Upsert suspend fun putVersion(v: ThreatDbVersion)

    /** 위협 DB 전체를 한 트랜잭션으로 교체한다 (원자적 교체 — 중간에 실패하면 기존 데이터 유지). */
    @Transaction
    suspend fun replaceAll(
        hashes: List<ThreatHash>, rules: List<ThreatRule>, sources: List<ThreatSource>,
        falsePositives: List<String>, versions: List<ThreatDbVersion>,
    ) {
        clearHashes(); clearRules(); clearSources()
        hashes.chunked(500).forEach { insertHashes(it) }
        insertRules(rules); insertSources(sources)
        falsePositives.chunked(500).forEach { deleteHashes(it) }
        versions.forEach { putVersion(it) }
    }
}

@Dao
interface DnsDao {
    @Query("SELECT * FROM ad_filter_sources ORDER BY id") fun sources(): Flow<List<AdFilterSource>>
    @Query("SELECT * FROM ad_filter_sources ORDER BY id") suspend fun sourcesNow(): List<AdFilterSource>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertSourcesIfMissing(s: List<AdFilterSource>)
    @Update suspend fun updateSource(s: AdFilterSource)
    @Query("UPDATE ad_filter_sources SET enabled = :on, updatedAt = :now WHERE category = :cat") suspend fun setCategoryEnabled(cat: String, on: Boolean, now: Long = System.currentTimeMillis())

    @Insert suspend fun insertEvents(e: List<BlockedDnsEvent>)
    @Query("SELECT * FROM blocked_dns_events ORDER BY time DESC LIMIT 300") fun recentBlocked(): Flow<List<BlockedDnsEvent>>
    @Query("SELECT COUNT(*) FROM blocked_dns_events WHERE time >= :since") fun blockedSince(since: Long): Flow<Int>
    @Query("SELECT category, COUNT(*) AS n FROM blocked_dns_events GROUP BY category") fun byCategory(): Flow<List<CategoryCount>>
    @Query("SELECT (time / 3600000) * 3600000 AS hour, COUNT(*) AS n FROM blocked_dns_events WHERE time >= :since GROUP BY hour ORDER BY hour")
    fun hourly(since: Long): Flow<List<HourCount>>
    @Query("DELETE FROM blocked_dns_events WHERE time < :before") suspend fun deleteEventsOlderThan(before: Long)
    @Query("DELETE FROM blocked_dns_events") suspend fun clearEvents()

    @Query("SELECT * FROM allowed_domains ORDER BY domain") fun allowed(): Flow<List<AllowedDomain>>
    @Query("SELECT * FROM allowed_domains") suspend fun allowedNow(): List<AllowedDomain>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun allow(d: AllowedDomain)
    @Query("DELETE FROM allowed_domains WHERE domain = :d") suspend fun unallow(d: String)
    @Query("SELECT * FROM blocked_domains ORDER BY domain") fun blocked(): Flow<List<BlockedDomain>>
    @Query("SELECT * FROM blocked_domains") suspend fun blockedNow(): List<BlockedDomain>
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun block(d: BlockedDomain)
    @Query("DELETE FROM blocked_domains WHERE domain = :d") suspend fun unblock(d: String)
    @Query("SELECT * FROM ad_filter_rules WHERE sourceId = :sid") suspend fun customRules(sid: Int): List<AdFilterRule>

    @Insert suspend fun insertVpnSession(s: VpnSession): Long
    @Query("UPDATE vpn_sessions SET endedAt = :end, endReason = :reason, queries = :q, blocked = :b, updatedAt = :end WHERE id = :id")
    suspend fun endVpnSession(id: Long, end: Long, reason: String, q: Long, b: Long)
    @Query("SELECT * FROM vpn_sessions ORDER BY startedAt DESC LIMIT 20") fun vpnSessions(): Flow<List<VpnSession>>

    @Insert suspend fun insertHistory(h: UpdateHistory)
    @Query("SELECT * FROM update_history ORDER BY time DESC LIMIT 50") fun history(): Flow<List<UpdateHistory>>
}
