package kr.eumsoft.purchasenote.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.data.DeadlineKind
import kr.eumsoft.purchasenote.data.Repo
import kr.eumsoft.purchasenote.data.Status
import kr.eumsoft.purchasenote.data.StoredImage

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun DetailScreen(nav: Nav, id: Long) {
    val c = LocalContext.current
    val repo = remember { Repo(c) }
    val p by remember(id) { repo.dao.observe(id) }.collectAsState(initial = null)
    val imgs by remember(id) { repo.dao.imagesOf(id) }.collectAsState(initial = emptyList())
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    var askDelete by remember { mutableStateOf(false) }
    var askStatus by remember { mutableStateOf<Status?>(null) }
    var viewImage by remember { mutableStateOf<StoredImage?>(null) }
    val copied = stringResource(R.string.copied)
    val noApp = stringResource(R.string.err_open_link)
    val item = p

    Scaffold(topBar = { BackBar(item?.productName ?: "", onBack = { nav.back() }) }, snackbarHost = { SnackbarHost(snack) }) { pad ->
        if (item == null) return@Scaffold
        val same by remember(item.orderKey) { repo.dao.sameOrder(item.orderKey, item.id) }.collectAsState(initial = emptyList())
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            if (item.needsReview) InfoBanner(stringResource(R.string.needs_review_long)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { nav.go(Screen.Add(editId = item.id)) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.edit_deadlines)) }
                    TextButton(onClick = { scope.launch { withContext(Dispatchers.IO) { repo.markReviewed(item.id) } } }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.reviewed)) }
                }
            }

            SectionTitle(stringResource(R.string.section_status))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Status.entries.forEach { s ->
                    FilterChip(selected = item.status == s, onClick = {
                        if (s == item.status) return@FilterChip
                        if (s == Status.RETURNED || s == Status.EXCHANGED) askStatus = s
                        else scope.launch { withContext(Dispatchers.IO) { repo.setStatus(item.id, s) } }
                    }, label = { Text(statusLabel(s)) }, leadingIcon = { Icon(if (item.status == s) Icons.Filled.Check else statusIcon(s), null) },
                        modifier = Modifier.heightIn(min = 48.dp))
                }
            }

            SectionTitle(stringResource(R.string.section_deadlines))
            val any = DeadlineKind.entries.filter { item.deadline(it) != null }
            if (any.isEmpty()) Text(stringResource(R.string.no_deadline), style = MaterialTheme.typography.bodyMedium)
            val active = item.activeDeadlines().map { it.first }.toSet()
            any.forEach { k ->
                val d = item.deadline(k)!!
                Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${kindLabel(k)}: ${fmtDate(d)}", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                }
                if (k in active) DeadlineBadge(k, d) else Text(stringResource(R.string.reminder_paused), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            val days = item.daysList()
            if (any.isNotEmpty()) Text(
                if (days.isEmpty() || active.isEmpty()) stringResource(R.string.remind_none)
                else stringResource(R.string.remind_summary, days.sortedDescending().joinToString(", ") { if (it == 0) c.getString(R.string.remind_same_day) else c.resources.getQuantityString(R.plurals.remind_days_before, it, it) }, fmtTime(item.remindMinute)),
                style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 6.dp))

            SectionTitle(stringResource(R.string.section_basic))
            Info(stringResource(R.string.field_store), item.store)
            Info(stringResource(R.string.field_order_date), item.orderDate?.let { fmtDate(it) })
            Info(stringResource(R.string.field_amount), fmtMoney(item))
            item.orderNumber?.let { no ->
                Info(stringResource(R.string.field_order_no), no)
                OutlinedButton(onClick = {
                    c.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("order", no))
                    scope.launch { snack.showSnackbar(copied) }
                }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Filled.ContentCopy, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.copy_order_no)) }
            }
            item.link?.let { l ->
                Info(stringResource(R.string.field_link), l)
                OutlinedButton(onClick = {
                    val u = if (l.startsWith("http://") || l.startsWith("https://")) l else "https://$l"
                    try { c.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    catch (e: Exception) { scope.launch { snack.showSnackbar(noApp) } }
                }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.AutoMirrored.Filled.OpenInNew, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.open_link)) }
            }
            Info(stringResource(R.string.field_memo), item.memo)

            SectionTitle(stringResource(R.string.section_photos))
            if (imgs.isEmpty()) Text(stringResource(R.string.no_photos), style = MaterialTheme.typography.bodyMedium)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                imgs.forEachIndexed { i, img ->
                    Box(Modifier.clickable(onClickLabel = stringResource(R.string.view_large)) { viewImage = img }) { Thumb(img, 120.dp, stringResource(R.string.photo_n, i + 1)) }
                }
            }

            if (same.isNotEmpty()) {
                SectionTitle(pluralStringResource(R.plurals.same_order_items, same.size, same.size))
                same.forEach { o -> PurchaseRow(o) { nav.go(Screen.Detail(o.id)) } }
            }

            Spacer(Modifier.height(16.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { nav.go(Screen.Add(editId = item.id)) }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Icon(Icons.Filled.Edit, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.edit))
                }
                OutlinedButton(onClick = { nav.go(Screen.Add(sameOrderOf = item.id)) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.PlaylistAdd, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.add_same_order))
                }
                OutlinedButton(onClick = { askDelete = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.Delete, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.delete))
                }
            }
            Spacer(Modifier.height(32.dp))
        }
    }
    viewImage?.let { ImageViewerDialog(it) { viewImage = null } }
    if (askDelete) ConfirmDialog(stringResource(R.string.delete_title), stringResource(R.string.delete_text), stringResource(R.string.delete),
        onConfirm = { scope.launch { withContext(Dispatchers.IO) { repo.delete(id) }; nav.back() } }, onDismiss = { askDelete = false })
    askStatus?.let { s ->
        ConfirmDialog(statusLabel(s), stringResource(if (s == Status.RETURNED) R.string.confirm_returned else R.string.confirm_exchanged), stringResource(R.string.ok),
            onConfirm = { scope.launch { withContext(Dispatchers.IO) { repo.setStatus(id, s) } } }, onDismiss = { askStatus = null })
    }
}

@Composable
private fun Info(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp).semantics(mergeDescendants = true) {}) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SelectionContainer { Text(value, style = MaterialTheme.typography.bodyLarge) }
    }
}
