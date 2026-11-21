package kr.eumsoft.notepro.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kr.eumsoft.notepro.R
import kr.eumsoft.notepro.core.PageData
import kr.eumsoft.notepro.core.PageElement
import kr.eumsoft.notepro.data.Io
import kr.eumsoft.notepro.data.NoteRepository

/** 노트 안 검색(PDF 글자·손글씨 인식·OCR·텍스트 주석). 결과를 누르면 그 페이지로 이동. nbId=null 이면 모든 노트. */
@Composable
fun SearchDialog(state: AppState, nbId: String?, onDismiss: () -> Unit, onPick: (NoteRepository.SearchHit) -> Unit) {
    val ctx = LocalContext.current
    var q by remember { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<NoteRepository.SearchHit>>(emptyList()) }
    LaunchedEffect(q) {
        delay(250)
        if (q.trim().length >= 1) Io.async({ state.app.repo.searchText(q, nbId) }) { hits = it.getOrNull().orEmpty() } else hits = emptyList()
    }
    AlertDialog(onDismiss, title = { Text(stringResource(R.string.search_in_note)) }, text = {
        Column {
            OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text(stringResource(R.string.search_text_hint)) }, modifier = Modifier.fillMaxWidth())
            if (q.isNotBlank() && hits.isEmpty()) Text(stringResource(R.string.no_results), Modifier.padding(8.dp), style = MaterialTheme.typography.bodySmall)
            if (q.isNotBlank() && state.app.sync.status.value.loggedIn) TextButton({
                // 자연어 검색: AI가 검색어를 키워드로 바꾼 뒤 기기 안에서 찾는다(노트 내용은 보내지 않음)
                background({
                    val kw = state.app.sync.api.request("POST", "/v1/ai/keywords", org.json.JSONObject().put("text", q).put("consentVersion", AI_CONSENT_VERSION))
                        .getString("text").split(',', '\n').map { it.trim() }.filter { it.isNotEmpty() }.take(8)
                    Io.call { kw.flatMap { state.app.repo.searchText(it, nbId, 50) }.distinctBy { it.pageId } }
                }) { r -> r.onSuccess { hits = it }.onFailure { state.toast = errorText(ctx, it) } }
            }) { Text(stringResource(R.string.ai_search)) }
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                items(hits) { h ->
                    Column(Modifier.fillMaxWidth().clickable { onPick(h) }.padding(vertical = 8.dp)) {
                        Text((if (nbId == null) h.title + " · " else "") + ctx.getString(R.string.page_n, h.pageIndex + 1) + " · " + sourceLabel(ctx, h.source),
                            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
                        Text(h.snippet, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                    }
                }
            }
        }
    }, confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.close)) } })
}

fun sourceLabel(ctx: android.content.Context, s: String) = ctx.getString(when (s) {
    "pdf" -> R.string.src_pdf; "hwr" -> R.string.src_hwr; "ocr" -> R.string.src_ocr; else -> R.string.src_note
})

@Composable
fun BookmarksDialog(pages: List<PageData>, onDismiss: () -> Unit, onPick: (Int) -> Unit) {
    val ctx = LocalContext.current
    val marks = pages.filter { it.bookmarked }
    AlertDialog(onDismiss, title = { Text(stringResource(R.string.bookmarks)) }, text = {
        if (marks.isEmpty()) Text(stringResource(R.string.no_bookmarks))
        else LazyColumn(Modifier.heightIn(max = 360.dp)) {
            items(marks) { p -> Text(ctx.getString(R.string.page_n, p.index + 1), Modifier.fillMaxWidth().clickable { onPick(p.index) }.padding(14.dp)) }
        }
    }, confirmButton = { TextButton(onDismiss) { Text(stringResource(R.string.close)) } })
}

/** 텍스트 주석 작성·수정·삭제. AI가 쓴 주석은 사용자가 고치면 사용자 기록으로 바뀐다. */
@Composable
fun TextElementDialog(initial: PageElement?, onDismiss: () -> Unit, onDelete: () -> Unit, onSave: (String, Float, Int) -> Unit) {
    var text by remember { mutableStateOf(initial?.text ?: "") }
    var size by remember { mutableStateOf(initial?.size ?: 14f) }
    var color by remember { mutableStateOf(initial?.color ?: INK_COLORS[0]) }
    AlertDialog(onDismiss, title = { Text(stringResource(if (initial == null) R.string.add_text_note else R.string.edit_text_note)) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (initial?.author == "ai") Text(stringResource(R.string.ai_written_notice), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
            OutlinedTextField(text, { text = it }, minLines = 3, modifier = Modifier.fillMaxWidth())
            Row { Text(stringResource(R.string.size), Modifier.padding(end = 8.dp)); Slider(size, { size = it }, valueRange = 8f..40f) }
            ColorRow(INK_COLORS, color) { color = it }
        }
    }, confirmButton = { TextButton({ onSave(text, size, color) }, enabled = text.isNotBlank()) { Text(stringResource(R.string.save)) } },
        dismissButton = {
            Row {
                if (initial != null) TextButton(onDelete) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }
                TextButton(onDismiss) { Text(stringResource(R.string.cancel)) }
            }
        })
}

/** 페이지 범위 내보내기(PDF 분할) */
@Composable
fun RangeDialog(count: Int, onDismiss: () -> Unit, onOk: (Int, Int) -> Unit) {
    var from by remember { mutableStateOf("1") }
    var to by remember { mutableStateOf(count.toString()) }
    val f = from.toIntOrNull(); val t = to.toIntOrNull()
    val ok = f != null && t != null && f in 1..count && t in f..count
    AlertDialog(onDismiss, title = { Text(stringResource(R.string.export_range)) }, text = {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(from, { from = it }, label = { Text(stringResource(R.string.from_page)) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
            OutlinedTextField(to, { to = it }, label = { Text(stringResource(R.string.to_page)) }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
        }
    }, confirmButton = { TextButton({ onOk(f!! - 1, t!! - 1) }, enabled = ok) { Text(stringResource(R.string.ok)) } },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.cancel)) } })
}
