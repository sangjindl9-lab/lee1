package kr.eumsoft.notepro.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.ai.Recognition
import kr.eumsoft.notepro.core.BackgroundType
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageElement
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NotebookSession
import kr.eumsoft.notepro.sync.ApiException
import org.json.JSONObject
import java.util.UUID

const val AI_CONSENT_VERSION = "1"

private val FEATURES = listOf(
    "summarize" to R.string.ai_summarize, "meeting_minutes" to R.string.ai_minutes, "key_points" to R.string.ai_key_points,
    "todos" to R.string.ai_todos, "study_summary" to R.string.ai_study, "quiz" to R.string.ai_quiz, "translate" to R.string.ai_translate,
    "proofread" to R.string.ai_proofread, "polish" to R.string.ai_polish, "qa" to R.string.ai_qa,
)
private val LANGS = listOf("ko" to "한국어", "en" to "English", "ja" to "日本語", "zh-CN" to "简体中文", "zh-TW" to "繁體中文", "es" to "Español", "fr" to "Français", "de" to "Deutsch", "pt" to "Português", "ar" to "العربية")

/** 페이지들의 글자(PDF 글자·손글씨 인식·OCR·텍스트 주석)를 모은다 — Io 스레드에서. */
fun collectText(state: AppState, notesByPage: Map<String, List<String>>, pages: List<PageData>): String {
    val repo = state.app.repo
    val sb = StringBuilder()
    for (p in pages) {
        val parts = repo.db.rawQuery("SELECT source, text FROM page_text WHERE page_id=? ORDER BY source", arrayOf(p.id)).use { c ->
            val l = ArrayList<String>(); while (c.moveToNext()) l.add(c.getString(1)); l
        }
        val notes = notesByPage[p.id].orEmpty()
        if (parts.isEmpty() && notes.isEmpty()) continue
        sb.append("[p.").append(p.index + 1).append("]\n")
        parts.forEach { sb.append(it).append('\n') }
        notes.forEach { sb.append(it).append('\n') }
    }
    return sb.toString().trim()
}

@Composable
fun AiToolsDialog(state: AppState, pane: PaneState, session: NotebookSession, onDismiss: () -> Unit) {
    val app = state.app
    val ctx = LocalContext.current
    val sp = remember { ctx.getSharedPreferences("notepro", Context.MODE_PRIVATE) }
    var consented by remember { mutableStateOf(sp.getString("aiConsent", null) == AI_CONSENT_VERSION) }
    var wholeNote by remember { mutableStateOf(false) }
    var hwrLang by remember { mutableStateOf(if (java.util.Locale.getDefault().language == "ko") "ko" else "en") }
    var target by remember { mutableStateOf(if (java.util.Locale.getDefault().language == "ko") "en" else "ko") }
    var question by remember { mutableStateOf("") }
    var result by remember { mutableStateOf<Pair<String, String>?>(null) } // (종류, 글자)
    var hwrResult by remember { mutableStateOf<String?>(null) }
    var askDownload by remember { mutableStateOf(false) }
    val page = session.pages.getOrNull(pane.pageIndex)

    fun scopePages() = if (wholeNote) session.pages else listOfNotNull(page)

    fun runHwr(afterDownload: Boolean = false) {
        val p = page ?: return
        val strokes = session.strokesOf(p.id).toList()
        if (strokes.isEmpty()) { state.toast = ctx.getString(R.string.no_handwriting); return }
        state.busy = ctx.getString(if (afterDownload) R.string.downloading_model else R.string.recognizing)
        background({
            if (afterDownload) Recognition.downloadModel(hwrLang)
            Recognition.recognizeHandwriting(strokes, hwrLang).joinToString("\n")
        }) { r ->
            state.busy = null
            r.onSuccess { hwrResult = it }
            r.onFailure { e -> if (e is Recognition.ModelMissing) askDownload = true else state.toast = ctx.getString(R.string.recognition_failed) + " " + e.message }
        }
    }

    fun runOcr() {
        val targets = scopePages().filter { it.bgType != BackgroundType.PAPER }
        if (targets.isEmpty()) { state.toast = ctx.getString(R.string.ocr_only_documents); return }
        state.busy = ctx.getString(R.string.recognizing)
        background({
            var n = 0
            for (p in targets) {
                val bmp = app.pdf.renderSync(p, 1800) ?: continue
                val text = try { Recognition.ocr(bmp) } finally { bmp.recycle() }
                if (text.isNotBlank()) { Io.call { app.repo.setPageText(p.id, session.notebook.id, "ocr", text) }; n++ }
            }
            n
        }) { r -> state.busy = null; state.toast = r.fold({ ctx.getString(R.string.ocr_done_n, it) }, { ctx.getString(R.string.recognition_failed) + " " + it.message }) }
    }

    fun runAi(feature: String) {
        if (!app.sync.status.value.loggedIn) { state.toast = ctx.getString(R.string.ai_needs_login); return }
        val pages = scopePages()
        val notes = pages.associate { p -> p.id to session.elementsOf(p.id).map { it.text } } // 메인 스레드에서 복사
        state.busy = ctx.getString(R.string.ai_working)
        background({
            val text = Io.call { collectText(state, notes, pages) }
            if (text.isBlank()) throw IllegalStateException("no_text")
            val body = JSONObject().put("text", text).put("consentVersion", AI_CONSENT_VERSION).put("notebookId", session.notebook.id)
            if (feature == "translate") body.put("targetLang", target)
            if (feature == "qa") body.put("question", question)
            app.sync.api.request("POST", "/v1/ai/$feature", body).getString("text")
        }) { r ->
            state.busy = null
            r.onSuccess { result = feature to it }
            r.onFailure { e ->
                state.toast = when {
                    e.message == "no_text" -> ctx.getString(R.string.ai_no_text)
                    (e as? ApiException)?.code == "ai_limit_reached" -> ctx.getString(R.string.ai_limit)
                    (e as? ApiException)?.code == "ai_not_configured" -> ctx.getString(R.string.ai_not_configured)
                    else -> errorText(ctx, e)
                }
            }
        }
    }

    if (!consented) {
        AlertDialog(onDismiss, title = { Text(stringResource(R.string.ai_consent_title)) }, text = { Text(stringResource(R.string.ai_consent_body)) },
            confirmButton = { TextButton({ sp.edit().putString("aiConsent", AI_CONSENT_VERSION).apply(); consented = true }) { Text(stringResource(R.string.agree)) } },
            dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } })
        return
    }

    AlertDialog(onDismiss, title = { Text(stringResource(R.string.ai_tools)) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.on_device_recognition), style = MaterialTheme.typography.titleSmall)
            ChipRow {
                FilterChip(hwrLang == "ko", { hwrLang = "ko" }, { Text("한국어") })
                FilterChip(hwrLang == "en", { hwrLang = "en" }, { Text("English") })
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ runHwr() }) { Text(stringResource(R.string.hwr_to_text)) }
                OutlinedButton({ runOcr() }) { Text(stringResource(R.string.ocr_pages)) }
            }
            HorizontalDivider()
            Text(stringResource(R.string.ai_assistant), style = MaterialTheme.typography.titleSmall)
            ChipRow {
                FilterChip(!wholeNote, { wholeNote = false }, { Text(stringResource(R.string.scope_page)) })
                FilterChip(wholeNote, { wholeNote = true }, { Text(stringResource(R.string.scope_note)) })
            }
            Text(stringResource(R.string.ai_translate_to), style = MaterialTheme.typography.labelMedium)
            ChipRow { LANGS.forEach { (k, l) -> FilterChip(target == k, { target = k }, { Text(l) }) } }
            OutlinedTextField(question, { question = it }, label = { Text(stringResource(R.string.ai_question)) }, modifier = Modifier.fillMaxWidth())
            FEATURES.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { (f, label) -> OutlinedButton({ runAi(f) }, Modifier.weight(1f), enabled = f != "qa" || question.isNotBlank()) { Text(stringResource(label)) } }
                }
            }
            Text(stringResource(R.string.ai_privacy_short), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }, confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.close)) } })

    if (askDownload) AlertDialog({ askDownload = false }, title = { Text(stringResource(R.string.download_model_title)) }, text = { Text(stringResource(R.string.download_model_body)) },
        confirmButton = { TextButton({ askDownload = false; runHwr(afterDownload = true) }) { Text(stringResource(R.string.download)) } },
        dismissButton = { TextButton({ askDownload = false }) { Text(stringResource(R.string.cancel)) } })

    // 손글씨 인식 결과: 고친 뒤 넣기(원본 손글씨는 그대로)
    hwrResult?.let { initial ->
        var text by remember(initial) { mutableStateOf(initial) }
        AlertDialog({ hwrResult = null }, title = { Text(stringResource(R.string.hwr_result)) }, text = {
            Column {
                Text(stringResource(R.string.hwr_result_hint), style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(text, { text = it }, minLines = 4, modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp))
            }
        }, confirmButton = {
            TextButton({
                hwrResult = null
                val p = page ?: return@TextButton
                val strokes = session.strokesOf(p.id)
                val bottom = strokes.maxOfOrNull { it.bounds.b } ?: 40f
                val left = strokes.minOfOrNull { it.bounds.l }?.coerceAtLeast(24f) ?: 36f
                val y = (bottom + 12f).coerceAtMost(p.height - 60f)
                session.commitElements(listOf(PageElement(UUID.randomUUID().toString(), p.id, session.notebook.id, "text", left, y, (p.width - left - 24f).coerceAtLeast(120f), text, author = "ai", createdAt = System.currentTimeMillis())), emptyList())
                val corrected = text
                Io.run {
                    app.repo.setPageText(p.id, session.notebook.id, "hwr", corrected)
                    // 정확도 개선용 피드백: 사용자가 고친 경우 기기에 기록(서버 전송은 별도 동의 후 — 미구현)
                    if (corrected != initial) app.repo.logError("hwr.feedback", "edited", "before=$initial\nafter=$corrected")
                }
            }) { Text(stringResource(R.string.insert_as_text)) }
        }, dismissButton = {
            TextButton({
                hwrResult = null
                val p = page ?: return@TextButton
                val t = text
                Io.run { app.repo.setPageText(p.id, session.notebook.id, "hwr", t) }
                state.toast = ctx.getString(R.string.saved_for_search)
            }) { Text(stringResource(R.string.save_for_search_only)) }
        })
    }

    result?.let { (feature, text) ->
        AlertDialog({ result = null }, title = { Text(stringResource(FEATURES.first { it.first == feature }.second)) }, text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.ai_result_label), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
                Text(text)
            }
        }, confirmButton = {
            TextButton({
                result = null
                // AI 결과는 현재 페이지 다음에 새 페이지로 넣고 "AI" 표시(사용자 필기와 섞이지 않게)
                val newPage = session.addPage(pane.pageIndex)
                session.commitElements(listOf(PageElement(UUID.randomUUID().toString(), newPage.id, session.notebook.id, "text", 40f, 70f, newPage.width - 80f, text, size = 13f, author = "ai", createdAt = System.currentTimeMillis())), emptyList())
                Io.main.postDelayed({ pane.view?.scrollToPage(newPage.index) }, 80)
                onDismiss()
            }) { Text(stringResource(R.string.insert_new_page)) }
        }, dismissButton = {
            TextButton({ (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("AI", text)); state.toast = ctx.getString(R.string.copied_text) }) {
                Text(stringResource(R.string.copy))
            }
        })
    }
}
