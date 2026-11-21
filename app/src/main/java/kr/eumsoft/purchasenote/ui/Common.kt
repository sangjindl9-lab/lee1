package kr.eumsoft.purchasenote.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.core.Dates
import kr.eumsoft.purchasenote.core.Money
import kr.eumsoft.purchasenote.data.DeadlineKind
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.Status
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Composable fun locale(): Locale = LocalConfiguration.current.locales[0]

@Composable fun fmtDate(epochDay: Long): String =
    DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale()).format(LocalDate.ofEpochDay(epochDay))

@Composable fun fmtMoney(p: Purchase): String? =
    if (p.amountMinor != null && p.currency != null) Money.format(p.amountMinor, p.currency, locale()) else null

@Composable fun statusLabel(s: Status) = stringResource(when (s) {
    Status.KEEPING -> R.string.status_keeping; Status.RETURNING -> R.string.status_returning; Status.EXCHANGING -> R.string.status_exchanging
    Status.RETURNED -> R.string.status_returned; Status.EXCHANGED -> R.string.status_exchanged })

fun statusIcon(s: Status): ImageVector = when (s) {
    Status.KEEPING -> Icons.Filled.Inventory2; Status.RETURNING -> Icons.AutoMirrored.Filled.Undo; Status.EXCHANGING -> Icons.Filled.SwapHoriz
    Status.RETURNED -> Icons.Filled.TaskAlt; Status.EXCHANGED -> Icons.Filled.CheckCircle }

@Composable fun kindLabel(k: DeadlineKind) = stringResource(when (k) {
    DeadlineKind.RETURN -> R.string.deadline_return; DeadlineKind.EXCHANGE -> R.string.deadline_exchange; DeadlineKind.WARRANTY -> R.string.deadline_warranty })

/** 기한 상태: 아이콘 + 글자(색만으로 구분하지 않음) */
@Composable
fun DeadlineBadge(kind: DeadlineKind, epochDay: Long, today: LocalDate = LocalDate.now()) {
    val b = Dates.bucket(LocalDate.ofEpochDay(epochDay), today) ?: return
    val days = (epochDay - today.toEpochDay()).toInt()
    val (icon, text, bg, fg) = when (b) {
        Dates.Bucket.OVERDUE -> Quad(Icons.Filled.ErrorOutline, stringResource(R.string.badge_overdue, kindLabel(kind)), MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer)
        Dates.Bucket.TODAY -> Quad(Icons.Filled.Warning, stringResource(R.string.badge_today, kindLabel(kind)), MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer)
        Dates.Bucket.SOON -> Quad(Icons.Filled.Schedule, androidx.compose.ui.res.pluralStringResource(R.plurals.badge_days_left, days, kindLabel(kind), days), MaterialTheme.colorScheme.tertiaryContainer, MaterialTheme.colorScheme.onTertiaryContainer)
        Dates.Bucket.LATER -> Quad(Icons.Filled.CalendarMonth, stringResource(R.string.badge_until, kindLabel(kind), fmtDate(epochDay)), MaterialTheme.colorScheme.secondaryContainer, MaterialTheme.colorScheme.onSecondaryContainer)
    }
    Surface(color = bg, contentColor = fg, shape = MaterialTheme.shapes.small) {
        Row(Modifier.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp))
            Text(text, style = MaterialTheme.typography.labelLarge)
        }
    }
}
data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) =
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
        modifier = modifier.padding(top = 16.dp, bottom = 8.dp).semantics { heading() })

/** 상단 바. TopAppBar(고정 높이) 대신 내용에 맞게 늘어나서 글자 200%에서도 잘리지 않는다 */
@Composable
fun BackBar(title: String, onBack: (() -> Unit)?, actions: @Composable () -> Unit = {}) {
    Surface(color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().heightIn(min = 64.dp).padding(start = 4.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            else Spacer(Modifier.width(12.dp))
            Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(vertical = 8.dp).semantics { heading() })
            actions()
        }
    }
}

/** 구매 목록 한 줄 */
@Composable
fun PurchaseRow(p: Purchase, onClick: () -> Unit) {
    val today = LocalDate.now()
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp).heightIn(min = 56.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(p.productName, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val meta = listOfNotNull(p.store, p.orderDate?.let { fmtDate(it) }, fmtMoney(p)).joinToString(" · ")
            if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(statusIcon(p.status), null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(statusLabel(p.status), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (p.needsReview) Text(stringResource(R.string.needs_review_short), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.tertiary)
            p.activeDeadlines().sortedBy { it.second }.forEach { (k, d) -> DeadlineBadge(k, d, today) }
        }
    }
}

/** 날짜 입력 칸: 버튼으로 달력 열기, 지우기 버튼 별도(정밀 터치·길게 누르기 불필요) */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(label: String, value: Long?, onChange: (Long?) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    OutlinedCard(onClick = { open = true }, modifier = modifier.fillMaxWidth().heightIn(min = 56.dp)
        .semantics(mergeDescendants = true) {}) {
        Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CalendarMonth, null)
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(if (value != null) fmtDate(value) else stringResource(R.string.date_none), style = MaterialTheme.typography.bodyLarge)
            }
            if (value != null) IconButton(onClick = { onChange(null) }) { Icon(Icons.Filled.Close, stringResource(R.string.clear_field, label)) }
        }
    }
    if (open) {
        val st = rememberDatePickerState(initialSelectedDateMillis = (value ?: LocalDate.now().toEpochDay()) * 86_400_000L)
        DatePickerDialog(onDismissRequest = { open = false },
            confirmButton = { TextButton(onClick = { st.selectedDateMillis?.let { onChange(Math.floorDiv(it, 86_400_000L)) }; open = false }) { Text(stringResource(R.string.ok)) } },
            dismissButton = { TextButton(onClick = { open = false }) { Text(stringResource(R.string.cancel)) } }) {
            DatePicker(st, showModeToggle = true)
        }
    }
}

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(text) },
        confirmButton = { TextButton(onClick = { onConfirm(); onDismiss() }) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable
fun InfoBanner(text: String, icon: ImageVector = Icons.Filled.Warning, color: Color = MaterialTheme.colorScheme.tertiaryContainer,
               action: (@Composable () -> Unit)? = null) {
    Surface(color = color, shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Icon(icon, null); Spacer(Modifier.width(10.dp))
                Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            }
            if (action != null) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) { action() }
        }
    }
}

