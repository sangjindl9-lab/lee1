package kr.eumsoft.securitypro.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

/* 모든 테이블에 생성일(createdAt)·수정일(updatedAt)을 둔다. 시각은 epoch millis. */

@Entity(tableName = "scan_sessions", indices = [Index("startedAt")])
data class ScanSession(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: String,                 // QUICK / INSTALLED / APK_FILE / SCHEDULED
    val startedAt: Long,
    val finishedAt: Long? = null,
    val status: String = "RUNNING",   // RUNNING / DONE / CANCELLED / FAILED
    val targetCount: Int = 0,
    val dangerCount: Int = 0,
    val cautionCount: Int = 0,
    val unscannableCount: Int = 0,
    val engines: String = "",
    val dbVersion: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "scan_results",
    foreignKeys = [ForeignKey(entity = ScanSession::class, parentColumns = ["id"], childColumns = ["sessionId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("sessionId"), Index("packageName"), Index("verdict")],
)
data class ScanResult(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sessionId: Long,
    val targetType: String,          // INSTALLED_APP / APK_FILE
    val targetName: String,
    val packageName: String?,
    val versionName: String?,
    val sha256: String?,
    val fileSize: Long?,
    val verdict: String,             // DANGER / CAUTION / CLEAN / UNSCANNABLE
    val enginesRun: String,          // 실행된 엔진 이름·버전
    val ruleVersion: String,
    val notScanned: String,          // 검사하지 못한 항목 설명
    val recommendation: String,
    val scannedAt: Long,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(
    tableName = "scan_findings",
    foreignKeys = [ForeignKey(entity = ScanResult::class, parentColumns = ["id"], childColumns = ["resultId"], onDelete = ForeignKey.CASCADE)],
    indices = [Index("resultId")],
)
data class ScanFinding(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val resultId: Long,
    val engine: String,              // SHA256 / YARA / PATTERN / PERMISSION / APK
    val severity: String,            // HIGH / MEDIUM / LOW / INFO
    val title: String,
    val evidence: String,            // 실제 탐지 근거 (해시, 규칙 이름, 권한 목록 등)
    val source: String,              // 데이터 출처
    val confirmed: Boolean,          // 확정 탐지(해시 정확 일치 등) 여부
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "installed_apps", indices = [Index(value = ["packageName"], unique = true)])
data class InstalledApp(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val packageName: String,
    val label: String,
    val versionName: String?,
    val versionCode: Long,
    val installer: String?,
    val certSha256: String?,
    val lastVerdict: String?,
    val lastScannedAt: Long?,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "threat_sources", indices = [Index(value = ["code"], unique = true)])
data class ThreatSource(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val code: String,
    val name: String,
    val url: String,
    val license: String,
    val isTestData: Boolean,
    val lastCheckedAt: Long,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "threat_hashes", indices = [Index(value = ["sha256"], unique = true), Index("source")])
data class ThreatHash(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sha256: String,
    val threatName: String,
    val threatFamily: String,
    val category: String,
    val severity: String,
    val confidence: Int,
    val source: String,
    val firstSeen: String?,
    val lastSeen: String?,
    val updatedAt: Long = System.currentTimeMillis(),
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "threat_rules", indices = [Index(value = ["kind", "name"], unique = true)])
data class ThreatRule(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val kind: String,                // YARA / PATTERN
    val name: String,
    val body: String,                // YARA 소스 또는 패턴 정의(JSON)
    val severity: String,
    val confidence: Int,
    val source: String,
    val license: String,
    val isTestData: Boolean,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "threat_db_versions", indices = [Index(value = ["component"], unique = true)])
data class ThreatDbVersion(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val component: String,           // HASHES / YARA / PATTERNS / FALSE_POSITIVES / DOMAINS
    val version: Long,
    val itemCount: Int,
    val sha256: String,
    val appliedAt: Long,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "ad_filter_sources", indices = [Index(value = ["code"], unique = true)])
data class AdFilterSource(
    @PrimaryKey val id: Int,          // DnsLibs FilterParams id 로도 쓴다
    val code: String,
    val name: String,
    val category: String,            // AD / TRACKING / PHISHING / MALWARE / CUSTOM
    val url: String,
    val license: String,
    val enabled: Boolean,
    val ruleCount: Int = 0,
    val lastUpdatedAt: Long? = null,
    val lastResult: String? = null,  // OK / FAIL:메시지
    val sha256: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

/** 사용자 지정 규칙(AdGuard 문법)과 소스별 메타. 대용량 목록 본문은 파일로 저장하고 여기에는 사용자 규칙만 둔다. */
@Entity(tableName = "ad_filter_rules", indices = [Index("sourceId")])
data class AdFilterRule(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val sourceId: Int,
    val rule: String,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "blocked_dns_events", indices = [Index("time"), Index("domain")])
data class BlockedDnsEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val time: Long,
    val domain: String,
    val qtype: String,
    val category: String,            // AD / TRACKING / PHISHING / MALWARE / CUSTOM
    val rule: String,
    val filterId: Int?,
    val filterName: String?,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "allowed_domains", indices = [Index(value = ["domain"], unique = true)])
data class AllowedDomain(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val domain: String,
    val note: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "blocked_domains", indices = [Index(value = ["domain"], unique = true)])
data class BlockedDomain(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val domain: String,
    val note: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "vpn_sessions", indices = [Index("startedAt")])
data class VpnSession(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val startedAt: Long,
    val endedAt: Long? = null,
    val endReason: String? = null,
    val queries: Long = 0,
    val blocked: Long = 0,
    val connectMs: Long = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "update_history", indices = [Index("time")])
data class UpdateHistory(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val time: Long,
    val target: String,              // AD_FILTERS / THREAT_DB
    val success: Boolean,
    val fromVersion: String,
    val toVersion: String,
    val message: String,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

/** 보안 관련 키-값 설정(검사 기록 보관 기간 등). 화면 설정은 DataStore 를 쓴다. */
@Entity(tableName = "security_settings")
data class SecuritySetting(
    @PrimaryKey val key: String,
    val value: String,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)
