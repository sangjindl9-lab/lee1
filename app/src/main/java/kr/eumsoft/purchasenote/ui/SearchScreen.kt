package kr.eumsoft.purchasenote.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.data.AppDb
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.Status
import java.time.LocalDate
import java.time.ZoneId

object SearchLogic {
    enum class Period { ALL, D30, D90, Y1 }

    /** 상품명·구매처·주문번호 검색 + 구매처/상태/기간 필터 + 최근순/기한순 정렬 */
    fun filter(all: List<Purchase>, q: String, store: String?, status: Status?, period: Period, byDeadline: Boolean, today: LocalDate): List<Purchase> {
        val qq = q.trim().lowercase()
        val from = when (period) { Period.ALL -> null; Period.D30 -> today.minusDays(30); Period.D90 -> today.minusDays(90); Period.Y1 -> today.minusYears(1) }
        return all.filter { p ->
            (qq.isEmpty() || listOfNotNull(p.productName, p.store, p.orderNumber).any { it.lowercase().contains(qq) }) &&
                (store == null || p.store == store) && (status == null || p.status == status) &&
                (from == null || (p.orderDate ?: java.time.Instant.ofEpochMilli(p.createdAt).atZone(ZoneId.systemDefault()).toLocalDate().toEpochDay()) >= from.toEpochDay())
        }.let { l ->
            if (byDeadline) l.filter { it.nearestDeadline() != null }.sortedBy { it.nearestDeadline() } + l.filter { it.nearestDeadline() == null }
            else l.sortedByDescending { it.orderDate?.let { d -> d * 86_400_000L } ?: it.createdAt }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(nav: Nav, s: Screen.Search) {
    val c = LocalContext.current
    val all by remember { AppDb.get(c).dao().all() }.collectAsState(initial = emptyList())
    var q by rememberSaveable { mutableStateOf("") }
    var store by rememberSaveable { mutableStateOf<String?>(null) }
    var status by rememberSaveable { mutableStateOf<Status?>(null) }
    var period by rememberSaveable { mutableStateOf(SearchLogic.Period.ALL) }
    var byDeadline by rememberSaveable { mutableStateOf(s.byDeadline) }
    val result = remember(all, q, store, status, period, byDeadline) { SearchLogic.filter(all, q, store, status, period, byDeadline, LocalDate.now()) }

    Scaffold(topBar = { BackBar(stringResource(if (s.byDeadline) R.string.check_deadlines else R.string.find_purchase), onBack = { nav.back() }) }) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize().padding(horizontal = 16.dp)) {
            item {
                OutlinedTextField(q, { q = it }, label = { Text(stringResource(R.string.search_hint)) }, leadingIcon = { Icon(Icons.Filled.Search, null) },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
            }
            item {
                FlowRow(Modifier.padding(vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    FilterChip(selected = !byDeadline, onClick = { byDeadline = false }, label = { Text(stringResource(R.string.sort_recent)) }, modifier = Modifier.heightIn(min = 48.dp))
                    FilterChip(selected = byDeadline, onClick = { byDeadline = true }, label = { Text(stringResource(R.string.sort_deadline)) }, modifier = Modifier.heightIn(min = 48.dp))
                    Picker(stringResource(R.string.field_store), store, listOf<String?>(null) + all.mapNotNull { it.store }.distinct().sorted(),
                        { it ?: c.getString(R.string.all) }) { store = it }
                    Picker(stringResource(R.string.section_status), status, listOf<Status?>(null) + Status.entries,
                        { it?.let { st -> c.getString(statusRes(st)) } ?: c.getString(R.string.all) }) { status = it }
                    Picker(stringResource(R.string.period), period, SearchLogic.Period.entries, { c.getString(periodRes(it)) }) { period = it }
                }
            }
            item {
                Text(pluralStringResource(R.plurals.result_count, result.size, result.size), style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 4.dp).semantics { liveRegion = LiveRegionMode.Polite })
            }
            items(result, key = { it.id }) { p -> PurchaseRow(p) { nav.go(Screen.Detail(p.id)) } }
        }
    }
}

fun statusRes(s: Status) = when (s) {
    Status.KEEPING -> R.string.status_keeping; Status.RETURNING -> R.string.status_returning; Status.EXCHANGING -> R.string.status_exchanging
    Status.RETURNED -> R.string.status_returned; Status.EXCHANGED -> R.string.status_exchanged }
fun periodRes(p: SearchLogic.Period) = when (p) {
    SearchLogic.Period.ALL -> R.string.period_all; SearchLogic.Period.D30 -> R.string.period_30; SearchLogic.Period.D90 -> R.string.period_90; SearchLogic.Period.Y1 -> R.string.period_1y }

@Composable
private fun <T> Picker(label: String, value: T, options: List<T>, name: (T) -> String, onPick: (T) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }, modifier = Modifier.heightIn(min = 48.dp)) {
            Text("$label: ${name(value)}"); Icon(Icons.Filled.ArrowDropDown, null)
        }
        DropdownMenu(open, { open = false }) {
            options.forEach { o -> DropdownMenuItem(text = { Text(name(o)) }, onClick = { onPick(o); open = false }, modifier = Modifier.heightIn(min = 48.dp)) }
        }
    }
}
