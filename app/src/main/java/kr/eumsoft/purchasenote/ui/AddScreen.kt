package kr.eumsoft.purchasenote.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PlaylistAdd
import androidx.compose.material.icons.filled.RemoveCircle
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.TextSnippet
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.core.Money
import kr.eumsoft.purchasenote.core.ReceiptParser
import kr.eumsoft.purchasenote.data.ImageStore
import kr.eumsoft.purchasenote.data.Prefs
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.Repo
import kr.eumsoft.purchasenote.data.Status
import kr.eumsoft.purchasenote.data.StoredImage
import kr.eumsoft.purchasenote.ocr.Recognizer
import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.UUID

/** 작성 중인 구매(화면 회전에도 유지) */
class Draft {
    var loaded = false
    var sharedDone = false
    var editId: Long = 0
    var orderKey: String = UUID.randomUUID().toString()
    var createdAt: Long = System.currentTimeMillis()
    var status: Status = Status.KEEPING
    var needsReview = false
    var product by mutableStateOf("")
    var store by mutableStateOf("")
    var orderDate by mutableStateOf<Long?>(null)
    var amount by mutableStateOf("")
    var currency by mutableStateOf<String?>(null)
    /** OCR에서 기호가 모호할 때(‘$’, ‘¥’) 사용자에게 보여줄 후보 */
    var currencyHint by mutableStateOf<Money.CurrencyGuess?>(null)
    var orderNumber by mutableStateOf("")
    var link by mutableStateOf("")
    var memo by mutableStateOf("")
    var returnBy by mutableStateOf<Long?>(null)
    var exchangeBy by mutableStateOf<Long?>(null)
    var warrantyBy by mutableStateOf<Long?>(null)
    var days by mutableStateOf(setOf(3, 0))
    var minute by mutableStateOf(9 * 60)
    val images = mutableStateListOf<StoredImage>()
    var showMore by mutableStateOf<Boolean?>(null)
    var reading by mutableStateOf(false)
    var readMessage by mutableStateOf<String?>(null)
    var result by mutableStateOf<ReceiptParser.Result?>(null)
    var lines by mutableStateOf<List<String>>(emptyList())
    var script by mutableStateOf(Recognizer.Script.AUTO)
    var dupOf by mutableStateOf<Pair<StoredImage, List<Purchase>>?>(null)
    var productError by mutableStateOf(false)
    var currencyError by mutableStateOf(false)
    var amountError by mutableStateOf(false)
    val dirty get() = product.isNotBlank() || images.isNotEmpty() || store.isNotBlank() || amount.isNotBlank()

    fun loadFrom(p: Purchase, imgs: List<StoredImage>) {
        editId = p.id; orderKey = p.orderKey; createdAt = p.createdAt; status = p.status; needsReview = p.needsReview
        product = p.productName; store = p.store ?: ""; orderDate = p.orderDate
        amount = if (p.amountMinor != null && p.currency != null) Money.toPlain(p.amountMinor, p.currency) else ""
        currency = p.currency; orderNumber = p.orderNumber ?: ""; link = p.link ?: ""; memo = p.memo ?: ""
        returnBy = p.returnBy; exchangeBy = p.exchangeBy; warrantyBy = p.warrantyBy
        days = p.daysList().toSet(); minute = p.remindMinute
        images.clear(); images.addAll(imgs)
    }

    /** 같은 주문의 다른 상품: 주문 정보·사진만 이어받고 상품·금액·기한은 비운다 */
    fun loadSameOrder(p: Purchase, imgs: List<StoredImage>) {
        orderKey = p.orderKey; store = p.store ?: ""; orderDate = p.orderDate; currency = p.currency
        orderNumber = p.orderNumber ?: ""; link = p.link ?: ""; days = p.daysList().toSet(); minute = p.remindMinute
        images.clear(); images.addAll(imgs)
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun AddScreen(nav: Nav, s: Screen.Add) {
    val c = LocalContext.current
    val view = LocalView.current
    val repo = remember { Repo(c) }
    val prefs = remember { Prefs.get(c) }
    val simple by prefs.simple.collectAsState()
    val d = s.draft
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    val productFocus = remember { FocusRequester() }
    var askDiscard by remember { mutableStateOf(false) }
    var viewImage by remember { mutableStateOf<StoredImage?>(null) }
    var timeOpen by remember { mutableStateOf(false) }
    var saveAndNext by remember { mutableStateOf(false) }
    val showMore = d.showMore ?: !simple

    val msgImport = mapOf(
        ImageStore.Reason.NOT_IMAGE to stringResource(R.string.err_not_image),
        ImageStore.Reason.TOO_LARGE to stringResource(R.string.err_too_large),
        ImageStore.Reason.COPY_FAILED to stringResource(R.string.err_copy_failed))
    val savedMsg = stringResource(R.string.saved)

    suspend fun addUri(u: android.net.Uri) {
        try {
            val r = repo.importImage(u)
            if (d.images.none { it.id == r.image.id }) d.images.add(r.image)
            val others = r.existing.filter { it.id != d.editId }
            if (others.isNotEmpty()) d.dupOf = r.image to others
        } catch (e: ImageStore.ImportError) { snack.showSnackbar(msgImport[e.reason] ?: "") }
    }

    LaunchedEffect(s) {
        if (!d.loaded) {
            d.loaded = true
            d.days = prefs.defaultDays.split(',').mapNotNull { it.toIntOrNull() }.toSet(); d.minute = prefs.defaultMinute
            d.currency = prefs.lastCurrency
            s.editId?.let { id -> repo.dao.get(id)?.let { d.loadFrom(it, repo.dao.imagesOfOnce(id)) } }
            s.sameOrderOf?.let { id -> repo.dao.get(id)?.let { d.loadSameOrder(it, repo.dao.imagesOfOnce(id)) } }
        }
        if (!d.sharedDone) {
            d.sharedDone = true
            s.shared.forEach { addUri(it) }
            s.sharedText?.takeIf { it.isNotBlank() }?.let { t ->
                Regex("https?://\\S+").find(t)?.let { if (d.link.isBlank()) d.link = it.value }
                val ls = t.lines().filter { it.isNotBlank() }
                d.lines = ls; d.result = ReceiptParser.parse(ls)
            }
        }
    }

    fun leave() { Repo.release(d.images.map { it.id }); scope.launch { withContext(Dispatchers.IO) { repo.cleanupOrphans() } }; nav.back() }
    BackHandler { if (d.dirty && d.editId == 0L) askDiscard = true else leave() }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris ->
        scope.launch { uris.forEach { addUri(it) } }
    }

    fun runOcr() {
        if (d.images.isEmpty()) return
        d.reading = true; d.readMessage = null
        scope.launch {
            val all = ArrayList<String>(); var failed = 0
            for (img in d.images.toList()) {
                val cached = img.ocrText
                if (cached != null && d.script == Recognizer.Script.AUTO) { all += cached.lines(); continue }
                val bmp = withContext(Dispatchers.IO) { ImageStore.loadBitmap(ImageStore.file(c, img.fileName), 2400) }
                if (bmp == null) { failed++; continue }
                try {
                    val (_, ls) = Recognizer.read(bmp, d.script)
                    all += ls
                    withContext(Dispatchers.IO) { repo.dao.setOcr(img.id, ls.joinToString("\n")) }
                } catch (e: Exception) { failed++ }
            }
            d.lines = all
            d.result = if (all.isEmpty()) null else ReceiptParser.parse(all)
            d.readMessage = when {
                all.isEmpty() && failed > 0 -> c.getString(R.string.ocr_failed)
                all.isEmpty() -> c.getString(R.string.ocr_nothing)
                else -> c.resources.getQuantityString(R.plurals.ocr_done, all.size, all.size)
            }
            d.reading = false
        }
    }

    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { doSave(nav, repo, prefs, d, saveAndNext, view, savedMsg, scope) }

    fun trySave(next: Boolean) {
        d.productError = d.product.isBlank()
        val amt = d.amount.trim()
        d.currencyError = amt.isNotEmpty() && d.currency == null
        d.amountError = amt.isNotEmpty() && d.currency != null && Money.parse(amt, d.currency!!) == null
        if (d.productError) { runCatching { productFocus.requestFocus() }; return }
        if (d.currencyError || d.amountError) { d.showMore = true; return }
        saveAndNext = next
        val wantsReminder = d.days.isNotEmpty() && (d.returnBy != null || d.exchangeBy != null || d.warrantyBy != null)
        if (wantsReminder && Build.VERSION.SDK_INT >= 33 && !prefs.askedNotification &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            prefs.askedNotification = true
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else doSave(nav, repo, prefs, d, next, view, savedMsg, scope)
    }

    Scaffold(
        topBar = { BackBar(stringResource(if (s.editId != null) R.string.title_edit else R.string.title_add),
            onBack = { if (d.dirty && d.editId == 0L) askDiscard = true else leave() }) },
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            Column(Modifier.fillMaxWidth().imePadding().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { trySave(false) }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Icon(Icons.Filled.Check, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.save), style = MaterialTheme.typography.titleMedium)
                }
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
            // ---- 사진 ----
            SectionTitle(stringResource(R.string.section_photos))
            if (d.images.isEmpty()) Text(stringResource(R.string.photos_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                d.images.forEachIndexed { i, img ->
                    val desc = stringResource(R.string.photo_n, i + 1)
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.clickable(onClickLabel = stringResource(R.string.view_large)) { viewImage = img }) { Thumb(img, 96.dp, desc) }
                        TextButton(onClick = { d.images.remove(img); Repo.release(listOf(img.id)) }) {
                            Icon(Icons.Filled.RemoveCircle, null); Text(stringResource(R.string.remove))
                        }
                    }
                }
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.AddPhotoAlternate, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.add_photo))
                }
                if (d.images.isNotEmpty()) Button(onClick = { runOcr() }, enabled = !d.reading, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.Filled.TextSnippet, null); Spacer(Modifier.width(6.dp)); Text(stringResource(R.string.read_text))
                }
            }
            if (d.images.isNotEmpty()) ScriptPicker(d.script) { d.script = it }
            if (d.reading) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
                CircularProgressIndicator(Modifier.width(24.dp).height(24.dp)); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.reading))
            }
            d.readMessage?.let { Text(it, Modifier.padding(vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.bodyMedium) }
            d.result?.let { CandidatePanel(d, it) }

            // ---- 기본 정보 ----
            SectionTitle(stringResource(R.string.section_basic))
            val reqErr = stringResource(R.string.err_product_required)
            OutlinedTextField(d.product, { d.product = it; if (it.isNotBlank()) d.productError = false },
                label = { Text(stringResource(R.string.field_product) + " *") },
                isError = d.productError,
                supportingText = { Text(if (d.productError) reqErr else stringResource(R.string.required_only_product)) },
                modifier = Modifier.fillMaxWidth().focusRequester(productFocus).semantics { if (d.productError) error(reqErr) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))

            TextButton(onClick = { d.showMore = !showMore }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(if (showMore) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null)
                Text(stringResource(if (showMore) R.string.less_fields else R.string.more_fields))
            }
            if (showMore) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(d.store, { d.store = it }, label = { Text(stringResource(R.string.field_store)) }, modifier = Modifier.fillMaxWidth())
                    DateField(stringResource(R.string.field_order_date), d.orderDate, { d.orderDate = it })
                    AmountRow(d)
                    OutlinedTextField(d.orderNumber, { d.orderNumber = it }, label = { Text(stringResource(R.string.field_order_no)) }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(d.link, { d.link = it }, label = { Text(stringResource(R.string.field_link)) }, modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                    OutlinedTextField(d.memo, { d.memo = it }, label = { Text(stringResource(R.string.field_memo)) }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                }
            }

            // ---- 기한 ----
            SectionTitle(stringResource(R.string.section_deadlines))
            Text(stringResource(R.string.deadline_rule), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(8.dp))
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                DateField(stringResource(R.string.deadline_return), d.returnBy, { d.returnBy = it })
                DateField(stringResource(R.string.deadline_exchange), d.exchangeBy, { d.exchangeBy = it })
                DateField(stringResource(R.string.deadline_warranty), d.warrantyBy, { d.warrantyBy = it })
            }

            // ---- 알림 ----
            SectionTitle(stringResource(R.string.section_reminders))
            ReminderChips(d.days) { d.days = it }
            OutlinedButton(onClick = { timeOpen = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(Icons.Filled.Schedule, null); Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.remind_time, fmtTime(d.minute)))
            }
            if (!kr.eumsoft.purchasenote.reminder.Reminders.notificationsAllowed(c) && prefs.askedNotification)
                InfoBanner(stringResource(R.string.notif_off_info), Icons.Filled.NotificationsOff)
            Spacer(Modifier.height(16.dp))
            if (s.editId == null) OutlinedButton(onClick = { trySave(true) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Filled.PlaylistAdd, null); Spacer(Modifier.width(8.dp)); Text(stringResource(R.string.save_and_next))
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (timeOpen) {
        val st = rememberTimePickerState(d.minute / 60, d.minute % 60)
        AlertDialog(onDismissRequest = { timeOpen = false }, title = { Text(stringResource(R.string.pick_time)) },
            text = { TimePicker(st) },
            confirmButton = { TextButton(onClick = { d.minute = st.hour * 60 + st.minute; timeOpen = false }) { Text(stringResource(R.string.ok)) } },
            dismissButton = { TextButton(onClick = { timeOpen = false }) { Text(stringResource(R.string.cancel)) } })
    }
    viewImage?.let { ImageViewerDialog(it) { viewImage = null } }
    if (askDiscard) ConfirmDialog(stringResource(R.string.discard_title), stringResource(R.string.discard_text), stringResource(R.string.discard),
        onConfirm = { leave() }, onDismiss = { askDiscard = false })
    d.dupOf?.let { (img, list) ->
        AlertDialog(onDismissRequest = { d.dupOf = null },
            title = { Text(stringResource(R.string.dup_title)) },
            text = {
                Column {
                    Text(stringResource(R.string.dup_text))
                    list.take(5).forEach { p -> TextButton(onClick = { d.dupOf = null; nav.go(Screen.Detail(p.id)) }, modifier = Modifier.heightIn(min = 48.dp)) { Text(p.productName) } }
                }
            },
            confirmButton = { TextButton(onClick = { d.dupOf = null }) { Text(stringResource(R.string.dup_add_other)) } },
            dismissButton = { TextButton(onClick = { d.images.remove(img); Repo.release(listOf(img.id)); d.dupOf = null }) { Text(stringResource(R.string.dup_cancel)) } })
    }
}

private fun doSave(nav: Nav, repo: Repo, prefs: Prefs, d: Draft, next: Boolean, view: android.view.View, savedMsg: String, scope: kotlinx.coroutines.CoroutineScope) {
    val cur = d.currency
    val amt = d.amount.trim().takeIf { it.isNotEmpty() }?.let { a -> cur?.let { Money.parse(a, it) } }
    val p = Purchase(
        id = d.editId, orderKey = d.orderKey, productName = d.product.trim(),
        store = d.store.trim().ifEmpty { null }, orderDate = d.orderDate,
        amountMinor = amt, currency = if (amt != null) cur else null,
        orderNumber = d.orderNumber.trim().ifEmpty { null }, link = d.link.trim().ifEmpty { null }, memo = d.memo.trim().ifEmpty { null },
        status = d.status, returnBy = d.returnBy, exchangeBy = d.exchangeBy, warrantyBy = d.warrantyBy,
        remindDays = d.days.sortedDescending().joinToString(","), remindMinute = d.minute,
        // 사용자가 기한을 직접 수정·저장하면 '다시 확인' 상태를 해제
        needsReview = false, createdAt = d.createdAt,
    )
    scope.launch {
        val id = withContext(Dispatchers.IO) { repo.save(p, d.images.map { it.id }) }
        Repo.release(d.images.map { it.id })
        if (amt != null && cur != null) prefs.lastCurrency = cur
        view.announceForAccessibility(savedMsg)
        if (next) {
            val n = Screen.Add(sameOrderOf = id)
            n.draft.result = d.result; n.draft.lines = d.lines; n.draft.readMessage = null
            nav.replace(n)
        } else nav.replace(Screen.Detail(id))
    }
}

@Composable
fun fmtTime(minute: Int): String = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale()).format(LocalTime.of(minute / 60, minute % 60))

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReminderChips(days: Set<Int>, onChange: (Set<Int>) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf(7, 3, 1, 0).forEach { n ->
            val on = n in days
            FilterChip(selected = on, onClick = { onChange(if (on) days - n else days + n) },
                label = { Text(if (n == 0) stringResource(R.string.remind_same_day) else pluralStringResource(R.plurals.remind_days_before, n, n)) },
                leadingIcon = if (on) { { Icon(Icons.Filled.Check, null) } } else null,
                modifier = Modifier.heightIn(min = 48.dp))
        }
    }
    if (days.isEmpty()) Text(stringResource(R.string.remind_none), style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun ScriptPicker(v: Recognizer.Script, onChange: (Recognizer.Script) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val label = @Composable { s: Recognizer.Script -> stringResource(when (s) {
        Recognizer.Script.AUTO -> R.string.script_auto; Recognizer.Script.KOREAN -> R.string.script_ko
        Recognizer.Script.JAPANESE -> R.string.script_ja; Recognizer.Script.LATIN -> R.string.script_latin }) }
    Box {
        TextButton(onClick = { open = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text(stringResource(R.string.script_label, label(v))) }
        DropdownMenu(open, { open = false }) {
            Recognizer.Script.entries.forEach { s -> DropdownMenuItem(text = { Text(label(s)) }, onClick = { onChange(s); open = false }, modifier = Modifier.heightIn(min = 48.dp)) }
        }
    }
    Text(stringResource(R.string.script_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AmountRow(d: Draft) {
    var open by remember { mutableStateOf(false) }
    val curErr = stringResource(R.string.err_currency)
    val amtErr = stringResource(R.string.err_amount)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        OutlinedTextField(d.amount, { d.amount = it; d.amountError = false }, label = { Text(stringResource(R.string.field_amount)) },
            isError = d.amountError, supportingText = if (d.amountError) { { Text(amtErr) } } else null,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.weight(1f).semantics { if (d.amountError) error(amtErr) })
        Box {
            OutlinedButton(onClick = { open = true }, modifier = Modifier.heightIn(min = 56.dp).padding(top = 8.dp)
                .semantics { if (d.currencyError) error(curErr) }) {
                Text(d.currency ?: stringResource(R.string.pick_currency))
            }
            DropdownMenu(open, { open = false }) {
                (d.currencyHint?.options.orEmpty() + Money.COMMON).distinct().forEach { code ->
                    DropdownMenuItem(text = { Text("$code · ${runCatching { java.util.Currency.getInstance(code).getDisplayName(locale()) }.getOrDefault(code)}") },
                        onClick = { d.currency = code; d.currencyError = false; d.currencyHint = null; open = false }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
        }
    }
    if (d.currencyError) Text(curErr, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
    d.currencyHint?.let { h ->
        if (h.code == null) {
            InfoBanner(stringResource(R.string.currency_ambiguous, h.marker), Icons.Filled.Info) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    h.options.forEach { code -> SuggestionChip(onClick = { d.currency = code; d.currencyHint = null; d.currencyError = false }, label = { Text(code) }, modifier = Modifier.heightIn(min = 48.dp)) }
                }
            }
        }
    }
    val cur = d.currency
    val parsed = if (cur != null && d.amount.isNotBlank()) Money.parse(d.amount, cur) else null
    if (parsed != null && cur != null) Text(stringResource(R.string.amount_preview, Money.format(parsed, cur, locale())), style = MaterialTheme.typography.bodyMedium)
}

/** 인식 결과 후보. 누르면 해당 칸에 들어가고, 사용자가 확인·수정한다. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CandidatePanel(d: Draft, r: ReceiptParser.Result) {
    var showRaw by remember { mutableStateOf(false) }
    val year = LocalDate.now().year
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(R.string.cand_title), style = MaterialTheme.typography.titleSmall)
        Text(stringResource(R.string.cand_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        if (r.productCandidates.isNotEmpty()) {
            Text(stringResource(R.string.field_product), style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                r.productCandidates.forEach { t -> SuggestionChip(onClick = { d.product = t; d.productError = false }, label = { Text(t) }, modifier = Modifier.heightIn(min = 48.dp)) }
            }
            Text(stringResource(R.string.field_store), style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                r.productCandidates.take(4).forEach { t -> SuggestionChip(onClick = { d.store = t; d.showMore = true }, label = { Text(t) }, modifier = Modifier.heightIn(min = 48.dp)) }
            }
        }

        val orderish = r.dates.filter { it.kind in setOf(ReceiptParser.DateKind.ORDER, ReceiptParser.DateKind.PAYMENT, ReceiptParser.DateKind.OTHER, ReceiptParser.DateKind.DELIVERY) }
        if (orderish.isNotEmpty()) {
            Text(stringResource(R.string.cand_dates), style = MaterialTheme.typography.labelLarge)
            orderish.forEach { ld -> DateCandidate(ld, year) { d.orderDate = it; d.showMore = true } }
        }
        val deadlines = r.dates.filter { it.kind in setOf(ReceiptParser.DateKind.RETURN, ReceiptParser.DateKind.EXCHANGE, ReceiptParser.DateKind.WARRANTY) }
        if (deadlines.isNotEmpty()) {
            Text(stringResource(R.string.cand_deadlines), style = MaterialTheme.typography.labelLarge)
            deadlines.forEach { ld -> DateCandidate(ld, year) { v ->
                when (ld.kind) { ReceiptParser.DateKind.RETURN -> d.returnBy = v; ReceiptParser.DateKind.EXCHANGE -> d.exchangeBy = v; else -> d.warrantyBy = v }
            } }
        }
        r.relativeDeadlineTexts.forEach { InfoBanner(stringResource(R.string.relative_deadline, it)) }

        if (r.amounts.isNotEmpty()) {
            Text(stringResource(R.string.cand_amounts), style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                r.amounts.take(8).forEach { a ->
                    val kind = stringResource(when (a.kind) {
                        ReceiptParser.AmountKind.TOTAL -> R.string.amt_total; ReceiptParser.AmountKind.ITEM -> R.string.amt_item
                        ReceiptParser.AmountKind.SUBTOTAL -> R.string.amt_subtotal; ReceiptParser.AmountKind.SHIPPING -> R.string.amt_shipping
                        ReceiptParser.AmountKind.DISCOUNT -> R.string.amt_discount; ReceiptParser.AmountKind.OTHER -> R.string.amt_other })
                    SuggestionChip(onClick = {
                        d.amount = a.raw; d.showMore = true; d.amountError = false
                        val g = a.currency
                        if (g?.code != null) { d.currency = g.code; d.currencyHint = null }
                        else if (g != null) { d.currency = null; d.currencyHint = g }
                    }, label = { Text("$kind  ${a.currency?.marker ?: ""} ${a.raw}".trim()) }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
        }
        if (r.orderNumbers.isNotEmpty()) {
            Text(stringResource(R.string.field_order_no), style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                r.orderNumbers.forEach { o -> SuggestionChip(onClick = { d.orderNumber = o; d.showMore = true }, label = { Text(o) }, modifier = Modifier.heightIn(min = 48.dp)) }
            }
        }
        if (r.trackingNumbers.isNotEmpty())
            Text(stringResource(R.string.tracking_found, r.trackingNumbers.joinToString(", ")), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

        TextButton(onClick = { showRaw = !showRaw }, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(if (showRaw) R.string.hide_raw else R.string.show_raw))
        }
        if (showRaw) SelectionContainer { Text(d.lines.joinToString("\n"), style = MaterialTheme.typography.bodySmall) }
        HorizontalDivider()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DateCandidate(ld: ReceiptParser.LabeledDate, year: Int, onPick: (Long) -> Unit) {
    val kind = stringResource(when (ld.kind) {
        ReceiptParser.DateKind.ORDER -> R.string.dk_order; ReceiptParser.DateKind.PAYMENT -> R.string.dk_payment
        ReceiptParser.DateKind.DELIVERY -> R.string.dk_delivery; ReceiptParser.DateKind.RETURN -> R.string.deadline_return
        ReceiptParser.DateKind.EXCHANGE -> R.string.deadline_exchange; ReceiptParser.DateKind.WARRANTY -> R.string.deadline_warranty
        ReceiptParser.DateKind.OTHER -> R.string.dk_other })
    val f = ld.found
    Column {
        val note = when {
            f.needsYear -> stringResource(R.string.date_need_year, f.raw)
            f.options.size > 1 -> stringResource(R.string.date_ambiguous, f.raw)
            else -> null
        }
        Text("$kind · “${f.raw}”", style = MaterialTheme.typography.bodyMedium)
        note?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val opts = if (f.needsYear) f.options.flatMap { o -> listOf(o.withYear(year), o.withYear(year - 1)) }.distinct() else f.options
            opts.forEach { o -> SuggestionChip(onClick = { onPick(o.toEpochDay()) }, label = { Text(fmtDate(o.toEpochDay())) }, modifier = Modifier.heightIn(min = 48.dp)) }
        }
    }
}

