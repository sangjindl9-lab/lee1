package kr.eumsoft.purchasenote.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kr.eumsoft.purchasenote.R
import kr.eumsoft.purchasenote.core.ImportParser
import kr.eumsoft.purchasenote.core.Money
import kr.eumsoft.purchasenote.data.Prefs
import kr.eumsoft.purchasenote.data.Purchase
import kr.eumsoft.purchasenote.data.Repo
import kr.eumsoft.purchasenote.shop.RuleStore
import org.json.JSONArray
import java.util.UUID

/** 가져온 한 줄 + 선택 상태 */
class ImportRow(val item: ImportParser.Item, val exists: Boolean) {
    var checked by mutableStateOf(!exists)
    var withReturn by mutableStateOf(item.returnBy != null)
}

/**
 * 화면 글자 읽기: 보이는 글자 + 사진 설명(대체 텍스트, ImportParser.IMG 표시). 입력칸 값·숨은 요소는 읽지 않는다.
 */
private const val READ_JS = """(function(){
var out=[];
function walk(n){
 if(n.nodeType===3){var t=n.textContent.replace(/\s+/g,' ').trim(); if(t) out.push(t); return;}
 if(n.nodeType!==1) return;
 var tag=n.tagName;
 if(/^(SCRIPT|STYLE|NOSCRIPT|SVG|INPUT|TEXTAREA|SELECT|IFRAME)$/.test(tag)) return;
 var st=window.getComputedStyle(n); if(st.display==='none'||st.visibility==='hidden') return;
 if(tag==='IMG'){var a=(n.getAttribute('alt')||'').replace(/\s+/g,' ').trim(); if(a) out.push('\n[IMG] '+a+'\n'); return;}
 var block=!/^(SPAN|B|STRONG|EM|I|SMALL|LABEL|SUP|SUB|MARK|FONT)$/.test(tag) && st.display!=='inline';
 if(block) out.push('\n');
 for(var c=n.firstChild;c;c=c.nextSibling) walk(c);
 if(block) out.push('\n');
}
walk(document.body);
return out.join(' ').replace(/[ \t]*\n[ \t\n]*/g,'\n');
})()"""

private fun expandJs(pattern: String) = """(function(){
var re=new RegExp(${JSONArray(listOf(pattern)).toString().removePrefix("[").removeSuffix("]")}); var n=0;
var hits=[];
document.querySelectorAll('button,[role=button],div,span').forEach(function(e){
 var t=(e.innerText||'').replace(/\s+/g,' ').trim();
 if(t.length<40 && re.test(t) && !e.closest('a[href]') && e.offsetParent!==null) hits.push(e);
});
// 같은 버튼을 감싼 바깥 요소까지 누르면 다시 접히므로 가장 안쪽 것만
hits.filter(function(e){ return !hits.some(function(o){ return o!==e && e.contains(o); }); }).forEach(function(e){ e.click(); n++; });
return n;
})()"""

/** 쇼핑몰 고르기 */
@Composable
fun ImportPickScreen(nav: Nav) {
    val c = LocalContext.current
    var rules by remember { mutableStateOf(RuleStore.load(c)) }
    LaunchedEffect(Unit) { if (RuleStore.refresh(c)) rules = RuleStore.load(c) }
    val lang = locale().language
    Scaffold(topBar = { BackBar(stringResource(R.string.import_title), onBack = { nav.back() }) }) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item { InfoBanner(stringResource(R.string.import_login_note), Icons.Filled.Lock, MaterialTheme.colorScheme.secondaryContainer) }
            itemsIndexed(rules.malls, key = { _, m -> m.id }) { _, m ->
                OutlinedCard(onClick = { nav.go(Screen.ShopBrowser(m.id)) }, modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp)) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Storefront, null); Spacer(Modifier.width(12.dp))
                        Text(m.name(lang), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                        Text(m.currency, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            item {
                Text(stringResource(R.string.import_other_note), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp))
                Text(stringResource(R.string.import_unverified), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * 앱 안 브라우저. 사용자가 쇼핑몰에 직접 로그인한다(앱은 입력값을 읽지 않음, 자바스크립트 연결 객체 없음).
 * '이 화면 가져오기'를 누를 때만 지금 보이는 페이지의 글자를 읽는다.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ShopBrowserScreen(nav: Nav, s: Screen.ShopBrowser) {
    val c = LocalContext.current
    val rule = remember { RuleStore.load(c).malls.firstOrNull { it.id == s.mallId } }
    if (rule == null) { LaunchedEffect(Unit) { nav.back() }; return }
    val lang = locale().language
    var web by remember { mutableStateOf<WebView?>(null) }
    var loading by remember { mutableStateOf(true) }
    var reading by remember { mutableStateOf(false) }
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val noneMsg = stringResource(R.string.import_none)

    BackHandler { val w = web; if (w != null && w.canGoBack()) w.goBack() else nav.back() }

    fun read(w: WebView) {
        w.evaluateJavascript(READ_JS) { res ->
            val text = runCatching { JSONArray("[$res]").getString(0) }.getOrDefault("")
            val url = w.url
            scope.launch {
                val items = withContext(Dispatchers.Default) { ImportParser.parse(text, rule) }
                reading = false
                if (items.isEmpty()) { snack.showSnackbar(noneMsg); return@launch }
                val existing = withContext(Dispatchers.IO) { Repo(c).dao.allOnce() }
                val rows = items.map { item ->
                    ImportRow(item, existing.any { p -> p.productName == item.product &&
                        (if (item.orderNo != null) p.orderNumber == item.orderNo else p.orderDate == item.orderDate?.toEpochDay()) })
                }
                nav.go(Screen.ImportReview(rule.id, rows, url?.takeIf { ImportParser.hostAllowed(it) }))
            }
        }
    }

    fun grab() {
        val w = web ?: return
        reading = true
        val ex = rule.expand
        if (ex == null) { read(w); return }
        // 접힌 상품 목록('N개 상품 모두 보기')을 먼저 펼친 뒤 읽는다. 링크(<a href>)는 누르지 않아 다른 화면으로 넘어가지 않음
        w.evaluateJavascript(expandJs(ex)) { res ->
            val n = res?.trim('"')?.toIntOrNull() ?: 0
            if (n > 0) w.postDelayed({ read(w) }, 1500) else read(w)
        }
    }

    Scaffold(
        topBar = {
            Surface(color = MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth().padding(top = 0.dp)) {
                    BackBar(rule.name(lang), onBack = { nav.back() }) {
                        TextButton(onClick = { web?.loadUrl(rule.ordersUrl) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Icon(Icons.AutoMirrored.Filled.ListAlt, null); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.import_go_orders))
                        }
                    }
                    if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }
        },
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Text(stringResource(R.string.import_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = { grab() }, enabled = !reading && !loading, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(top = 6.dp)) {
                    Icon(Icons.Filled.Download, null); Spacer(Modifier.width(8.dp))
                    Text(stringResource(if (reading) R.string.import_loading else R.string.import_this_page), style = MaterialTheme.typography.titleMedium)
                }
            }
        },
    ) { pad ->
        AndroidView(modifier = Modifier.padding(pad).fillMaxSize(), factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true          // 쇼핑몰 사이트 동작에 필요
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.allowContentAccess = false
                settings.setSupportMultipleWindows(false)
                settings.javaScriptCanOpenWindowsAutomatically = false
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true) // 일부 로그인 화면에 필요
                webViewClient = object : WebViewClient() {
                    // https 페이지만 앱 안에서 열고, 쇼핑몰 앱 실행 링크(intent:, coupang: 등)는 막는다
                    override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean =
                        req.url.scheme != "https"
                    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { loading = true }
                    override fun onPageFinished(view: WebView, url: String?) { loading = false }
                }
                loadUrl(rule.ordersUrl)
                web = this
            }
        }, onRelease = { it.stopLoading(); it.destroy() })
    }
}

/** 가져온 주문 확인 → 고른 것만 저장 */
@Composable
fun ImportReviewScreen(nav: Nav, s: Screen.ImportReview) {
    val c = LocalContext.current
    val view = LocalView.current
    val rule = remember { RuleStore.load(c).malls.firstOrNull { it.id == s.mallId } }
    val prefs = remember { Prefs.get(c) }
    val scope = rememberCoroutineScope()
    val lang = locale().language
    var saving by remember { mutableStateOf(false) }
    val rows = s.rows
    val n = rows.count { it.checked }
    if (rule == null) { LaunchedEffect(Unit) { nav.back() }; return }

    val savedText = pluralStringResource(R.plurals.import_saved, n, n)
    Scaffold(
        topBar = { BackBar(stringResource(R.string.import_review_title), onBack = { nav.back() }) },
        bottomBar = {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
                Button(onClick = {
                    saving = true
                    scope.launch {
                        val repo = Repo(c)
                        withContext(Dispatchers.IO) {
                            rows.filter { it.checked }.forEach { r ->
                                val it = r.item
                                val minor = it.amount?.let { a -> Money.parse(a, rule.currency) }
                                repo.save(Purchase(
                                    orderKey = rule.id + ":" + (it.orderNo ?: UUID.randomUUID().toString()),
                                    productName = it.product, store = rule.name(lang), orderDate = it.orderDate?.toEpochDay(),
                                    amountMinor = minor, currency = if (minor != null) rule.currency else null,
                                    orderNumber = it.orderNo, link = s.pageUrl,
                                    returnBy = if (r.withReturn) it.returnBy?.toEpochDay() else null,
                                    remindDays = prefs.defaultDays, remindMinute = prefs.defaultMinute,
                                ), emptyList())
                            }
                        }
                        view.announceForAccessibility(savedText)
                        nav.home()
                    }
                }, enabled = n > 0 && !saving, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                    Icon(Icons.Filled.Check, null); Spacer(Modifier.width(8.dp))
                    Text(pluralStringResource(R.plurals.import_save_n, n, n), style = MaterialTheme.typography.titleMedium)
                }
            }
        },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize().padding(horizontal = 16.dp)) {
            item {
                Text(rule.name(lang), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                InfoBanner(stringResource(R.string.import_unverified), Icons.Filled.Info)
            }
            itemsIndexed(rows) { _, r -> ReviewRow(r, rule.currency) }
        }
    }
}

@Composable
private fun ReviewRow(r: ImportRow, currency: String) {
    val it = r.item
    Card(Modifier.fillMaxWidth().padding(vertical = 4.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(r.checked, enabled = !r.exists, role = Role.Checkbox) { v -> r.checked = v },
                verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = r.checked, onCheckedChange = null, enabled = !r.exists)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(it.product, style = MaterialTheme.typography.titleSmall)
                    val amt = it.amount?.let { a -> Money.parse(a, currency) }?.let { m -> Money.format(m, currency, locale()) }
                    val meta = listOfNotNull(it.orderDate?.let { d -> fmtDate(d.toEpochDay()) }, amt, it.orderNo).joinToString(" · ")
                    if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (r.exists) Text(stringResource(R.string.import_already), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.tertiary)
                    it.dateNoYear?.let { raw -> Text(stringResource(R.string.import_no_year, raw), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.tertiary) }
                }
            }
            val ret = it.returnBy
            if (ret != null && !r.exists) Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(start = 32.dp)
                .toggleable(r.withReturn, role = Role.Checkbox) { v -> r.withReturn = v }, verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = r.withReturn, onCheckedChange = null); Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.import_return_from_page, fmtDate(ret.toEpochDay())), style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        }
    }
}
