package kr.eumsoft.quick.ui

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.StatusBarManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.TextUtils
import android.text.TextWatcher
import android.util.Size
import android.view.Gravity
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kr.eumsoft.quick.R
import kr.eumsoft.quick.core.Clip
import kr.eumsoft.quick.core.Db
import kr.eumsoft.quick.core.ImageStore
import kr.eumsoft.quick.core.Prefs
import kr.eumsoft.quick.core.TextTools
import kr.eumsoft.quick.ime.EumKeyboard
import kr.eumsoft.quick.service.HelperService
import kr.eumsoft.quick.service.Notifier
import kr.eumsoft.quick.service.QuickTile
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var db: Db
    private lateinit var content: FrameLayout
    private lateinit var nav: LinearLayout
    private var tab = 0
    private var clipTab = 0
    private var query = ""
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this); db = Db.get(this)
        db.purge(prefs.retentionDays)
        val root = vbox()
        root.setBackgroundColor(0xFFF9FAFB.toInt())
        val head = hbox(); head.setPadding(dp(16), dp(10), dp(16), dp(10)); head.setBackgroundColor(Color.WHITE)
        val logo = ImageView(this); logo.setImageResource(R.drawable.ic_logo)
        head.addView(logo, LinearLayout.LayoutParams(dp(28), dp(28)))
        val name = TextView(this); name.text = getString(R.string.app_name); name.textSize = 17f
        name.setTextColor(0xFF111827.toInt()); name.setPadding(dp(10), 0, 0, 0); name.setTypeface(name.typeface, android.graphics.Typeface.BOLD)
        head.addView(name)
        root.addView(head)
        content = FrameLayout(this)
        root.add(content, MATCH, 0, 1f)
        nav = hbox(); nav.setBackgroundColor(Color.WHITE)
        root.addView(nav)
        applyInsets(root)
        setContentView(root)
        tab = intent.getIntExtra("tab", 0)
    }

    override fun onResume() { super.onResume(); render() }

    private fun render() {
        nav.removeAllViews()
        listOf("홈", "클립 보관함", "캡처 보관함", "설정").forEachIndexed { i, t ->
            val v = TextView(this)
            v.text = t; v.gravity = Gravity.CENTER; v.textSize = 13f
            v.setTextColor(if (i == tab) brand else GRAY)
            if (i == tab) v.setTypeface(v.typeface, android.graphics.Typeface.BOLD)
            v.setPadding(0, dp(12), 0, dp(12))
            v.setOnClickListener { tab = i; render() }
            nav.add(v, 0, WRAP, 1f)
        }
        content.removeAllViews()
        val sc = ScrollView(this)
        val box = vbox(16)
        sc.addView(box)
        content.addView(sc)
        when (tab) { 0 -> home(box); 1 -> clips(box); 2 -> captures(box); else -> settings(box) }
    }

    // ================= 홈 =================
    private fun a11yOn(): Boolean {
        val s = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
        return s.split(':').any { it.equals(ComponentName(this, HelperService::class.java).flattenToString(), true) ||
            it.equals("$packageName/.service.HelperService", true) }
    }

    private fun imeEnabled() = getSystemService(InputMethodManager::class.java).enabledInputMethodList.any { it.packageName == packageName }
    private fun imeDefault() = (Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) ?: "").startsWith("$packageName/")

    private fun statusRow(box: LinearLayout, name: String, ok: Boolean, okText: String, badText: String, action: String?, onAction: (() -> Unit)?) {
        val r = box.add(hbox(), topDp = 6)
        val dot = TextView(this); dot.text = "●"; dot.setTextColor(if (ok) 0xFF16A34A.toInt() else 0xFFDC2626.toInt())
        r.addView(dot)
        val t = TextView(this); t.text = "  $name: ${if (ok) okText else badText}"; t.textSize = 14f; t.setTextColor(0xFF111827.toInt())
        r.add(t, 0, WRAP, 1f)
        if (action != null && onAction != null) r.btn(action) { onAction() }
    }

    private fun home(box: LinearLayout) {
        val svc = HelperService.instance
        val on = a11yOn()
        box.title("상태")
        statusRow(box, "도우미(접근성)", on && prefs.consentA11y && svc?.ready == true, "실행 중",
            if (!prefs.consentA11y) "안내 동의 필요" else if (!on) "꺼짐" else "시작 대기", if (on && svc?.ready == true) null else "켜기") { askConsent() }
        val mode = if (imeDefault()) "전용 키보드 모드" else "일반 모드 (기존 키보드 유지)"
        statusRow(box, "현재 모드", true, mode, mode, null, null)
        if (Build.VERSION.SDK_INT >= 33) {
            val n = checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
            statusRow(box, "알림(일시정지·캡처 버튼)", n, "허용", "허용 안 됨", if (n) null else "허용") {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 5)
            }
        }
        box.sw("전체 기능 일시정지", prefs.paused, "도우미 버튼·캡처·기록을 모두 멈춥니다. 알림에서도 켜고 끌 수 있습니다.") {
            prefs.paused = it; HelperService.instance?.setPaused(it)
        }
        box.sw("붙여넣기 도우미", prefs.pasteEnabled) { prefs.pasteEnabled = it; HelperService.instance?.recheckSoon() }
        box.sw("캡처 도우미", prefs.captureEnabled) { prefs.captureEnabled = it; HelperService.instance?.recheckSoon() }

        box.title("클립 확보")
        box.label(
            if (imeDefault()) "전용 키보드가 기본 키보드로 설정되어, 키보드가 실행 중일 때 복사한 내용을 기록합니다. " +
                "키보드 사용 시작 이전의 기록이나 앱이 종료되어 있던 동안 복사한 내용은 기록되지 않을 수 있습니다."
            else "일반 모드에서는 아래 방법으로 확보한 내용만 기록합니다. 다른 앱에서 복사한 내용이 자동으로 기록되지 않으며, " +
                "기존 키보드의 클립보드 기록은 읽을 수 없습니다.\n· 가져오기 버튼(앱 화면 또는 도우미 패널)\n· 다른 앱의 공유 메뉴 → 이음 퀵도우미\n· 앱에서 직접 등록\n· 캡처 글자 추출",
            13f, color = GRAY
        )
        box.buttons("지금 클립보드 가져오기" to { importClipboard() }, "문구 직접 등록" to {
            inputDialog("최근 클립에 등록", "", true) { t -> report(db.addRecent(t, "직접 등록", prefs, force = true)) }
        })

        box.title("캡처")
        box.label("도우미 버튼 세 번 터치 · 길게 누르기 · 빠른 설정 타일 · 알림의 캡처 버튼으로 캡처합니다. " +
            "캡처 시 도우미는 자동으로 숨겨지고 상태표시줄·내비게이션 영역은 잘라서 저장합니다.", 13f, color = GRAY)
        val r = box.add(hbox())
        r.btn("갤러리 이미지 글자 추출", weight = 1f) { pickImage() }
        if (Build.VERSION.SDK_INT >= 33) r.btn("빠른 설정에 타일 추가", weight = 1f) { addTile() }

        box.title("앱 정보")
        box.label("클립 기록과 캡처 이미지는 기기에만 저장되며 서버로 전송하지 않습니다. 버전 ${packageManager.getPackageInfo(packageName, 0).versionName}", 12f, color = GRAY)
    }

    private fun report(r: Db.AddResult) = toast(when (r) {
        Db.AddResult.SAVED -> "최근 클립에 저장했습니다."
        Db.AddResult.MOVED -> "이미 있는 내용이라 최근 항목으로 올렸습니다."
        Db.AddResult.EMPTY -> "가져올 텍스트가 없습니다."
        Db.AddResult.SENSITIVE -> "인증번호 등 민감 정보로 보여 저장하지 않았습니다. (설정에서 변경 가능)"
        Db.AddResult.PAUSED -> "기록 수집이 일시정지되어 있습니다."
    })

    private fun importClipboard() {
        val cm = getSystemService(ClipboardManager::class.java)
        val clip = cm.primaryClip
        if (clip == null || clip.itemCount == 0) { toast("클립보드가 비어 있습니다."); return }
        val text = clip.getItemAt(0).coerceToText(this)?.toString() ?: ""
        report(db.addRecent(text, "가져오기", prefs))
        if (tab == 1) render()
    }

    private fun askConsent() {
        AlertDialog.Builder(this).setTitle("접근성 권한 사용 안내").setMessage(getString(R.string.a11y_disclosure))
            .setPositiveButton("동의하고 설정 열기") { _, _ ->
                prefs.consentA11y = true
                HelperService.instance?.start()
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                toast("'설치된 앱' 또는 '설치된 서비스'에서 이음 퀵도우미를 켜 주세요.")
            }
            .setNegativeButton("동의 안 함") { _, _ -> prefs.consentA11y = false }
            .show()
    }

    private fun addTile() {
        if (Build.VERSION.SDK_INT < 33) return
        getSystemService(StatusBarManager::class.java).requestAddTileService(
            ComponentName(this, QuickTile::class.java), "이음 캡처", Icon.createWithResource(this, R.drawable.ic_tile), mainExecutor
        ) { }
    }

    private fun pickImage() {
        startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE), 10)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data ?: return
        if (resultCode != RESULT_OK) return
        when (requestCode) {
            10 -> startActivity(Intent(this, OcrActivity::class.java).putExtra("uri", uri.toString()))
            11 -> {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                prefs.treeUri = uri.toString(); toast("저장 폴더를 변경했습니다."); render()
            }
        }
    }

    // ================= 클립 보관함 =================
    private fun clips(box: LinearLayout) {
        val tabs = box.add(hbox())
        listOf("최근 기록", "자주 쓰는", "템플릿", "순서").forEachIndexed { i, t ->
            tabs.btn(t, primary = clipTab == i, weight = 1f) { clipTab = i; query = ""; render() }
        }
        when (clipTab) {
            0 -> {
                searchBox(box)
                box.buttons("클립보드 가져오기" to { importClipboard() }, "전체 삭제" to {
                    confirm("최근 기록 전체 삭제", "고정 항목을 포함한 최근 기록을 모두 삭제합니다.") { db.deleteAllRecent(); render() }
                })
                val items = if (query.isBlank()) db.recent(200) else db.search(query, "recent")
                box.label("보관 기간: ${if (prefs.retentionDays == 0) "무기한" else "${prefs.retentionDays}일"} (고정 항목 제외) · ${items.size}개", 12f, color = GRAY, topDp = 6)
                clipRows(box, items)
            }
            1 -> {
                searchBox(box)
                box.buttons("문구 추가" to { addFavorite(null) })
                val items = if (query.isBlank()) db.favorites(null) else db.search(query, "fav")
                for (f in Db.FOLDERS) {
                    val inF = items.filter { it.folder == f }
                    box.title("$f (${inF.size})")
                    clipRows(box, inF)
                }
                val other = items.filter { it.folder !in Db.FOLDERS }
                if (other.isNotEmpty()) { box.title("기타"); clipRows(box, other) }
            }
            2 -> {
                box.label("{이름}처럼 중괄호로 빈칸을 만들면, 사용할 때 빈칸을 채워 완성 문구를 붙여넣습니다.", 12f, color = GRAY, topDp = 8)
                box.buttons("템플릿 추가" to { editTemplate(null) })
                for (c in db.templates()) clipRow(box, c)
                if (db.templates().isEmpty()) box.label("예시 템플릿 추가 →", 12f, color = GRAY).setOnClickListener {
                    db.addItem("안녕하세요. {회사명} {이름}입니다.\n{현장명} 관련 자료를 송부드립니다.", "tpl", title = "자료 송부")
                    render()
                }
            }
            else -> sequenceEditor(box)
        }
    }

    private fun searchBox(box: LinearLayout) {
        val e = EditText(this); e.hint = "검색"; e.setText(query); e.textSize = 14f; e.setSingleLine()
        box.add(e, topDp = 6)
        e.setOnEditorActionListener { _, _, _ -> query = e.text.toString(); render(); true }
        e.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { if (s.isNullOrEmpty() && query.isNotEmpty()) { query = ""; render() } }
        })
    }

    private fun clipRows(box: LinearLayout, items: List<Clip>) {
        if (items.isEmpty()) box.label("항목 없음", 12f, color = GRAY, topDp = 4)
        items.forEach { clipRow(box, it) }
    }

    private fun clipRow(box: LinearLayout, c: Clip) {
        val card = box.add(vbox(10), topDp = 6)
        card.background = round(Color.WHITE, dp(10).toFloat(), LINE, dp(1))
        val t = card.label((if (c.title.isNotEmpty()) "[${c.title}] " else "") + c.text, 14f)
        t.maxLines = 4; t.ellipsize = TextUtils.TruncateAt.END
        card.label(timeText(c.created) + " · " + (if (c.kind == "fav") c.folder else c.source) + if (c.pinned) " · 고정됨" else "", 11f, color = GRAY)
        val r = card.add(hbox())
        r.btn("복사") { copy(c.text) }
        r.btn("수정") {
            if (c.kind == "tpl") editTemplate(c) else startActivity(Intent(this, ClipEditActivity::class.java).putExtra("id", c.id))
        }
        if (c.kind == "recent") {
            r.btn(if (c.pinned) "고정해제" else "고정") { db.setPinned(c.id, !c.pinned); render() }
            r.btn("즐겨찾기") { addFavorite(c.text) }
        }
        r.btn("삭제") { db.delete(c.id); render() }
    }

    private fun copy(text: String) {
        prefs.markSelfClip(text)
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("EUM QUICK", text))
        toast("복사했습니다.")
    }

    private fun addFavorite(initial: String?) {
        val names = Db.FOLDERS.toTypedArray()
        AlertDialog.Builder(this).setTitle("폴더 선택").setItems(names) { _, which ->
            if (initial != null) { db.addItem(initial, "fav", names[which]); toast("${names[which]}에 저장했습니다."); render() }
            else inputDialog("${names[which]} 문구 추가", "", true, "회사명, 주소, 이메일, 서명 등") { t ->
                if (t.isNotBlank()) { db.addItem(t, "fav", names[which]); render() }
            }
        }.show()
    }

    private fun editTemplate(c: Clip?) {
        val v = vbox(16)
        val name = EditText(this); name.hint = "템플릿 이름"; name.setText(c?.title ?: ""); v.add(name)
        val body = EditText(this); body.hint = "내용 (빈칸은 {이름} 형식)"; body.setText(c?.text ?: ""); body.minLines = 4; v.add(body)
        AlertDialog.Builder(this).setTitle(if (c == null) "템플릿 추가" else "템플릿 수정").setView(v)
            .setPositiveButton("저장") { _, _ ->
                val b = body.text.toString()
                if (b.isBlank()) return@setPositiveButton
                if (c == null) db.addItem(b, "tpl", title = name.text.toString()) else db.updateText(c.id, b, name.text.toString())
                render()
            }.setNegativeButton("취소", null).show()
    }

    private fun sequenceEditor(box: LinearLayout) {
        box.label("이름 → 연락처 → 주소처럼 순서를 등록하세요. 다른 앱에서 다음 입력칸을 직접 선택하고 도우미 패널의 '순서' 탭에서 " +
            "'다음 붙여넣기'를 누를 때마다 한 항목씩 넣습니다. 입력칸 이동·제출은 자동으로 하지 않습니다.", 12f, color = GRAY, topDp = 8)
        val seq = db.sequence().map { it.second }.toMutableList()
        box.label("현재 위치: ${(prefs.sequenceIndex + 1).coerceAtMost(seq.size + 1)}번째 항목", 12f, color = brand, topDp = 4)
        seq.forEachIndexed { i, t ->
            val card = box.add(vbox(8), topDp = 4)
            card.background = round(if (i == prefs.sequenceIndex) 0xFFE8F0FE.toInt() else Color.WHITE, dp(8).toFloat(), LINE, dp(1))
            card.label("${i + 1}. $t", 14f)
            val r = card.add(hbox())
            r.btn("위로") { if (i > 0) { seq.add(i - 1, seq.removeAt(i)); db.setSequence(seq); render() } }
            r.btn("아래로") { if (i < seq.size - 1) { seq.add(i + 1, seq.removeAt(i)); db.setSequence(seq); render() } }
            r.btn("수정") { inputDialog("항목 수정", t, true) { n -> seq[i] = n; db.setSequence(seq); render() } }
            r.btn("삭제") { seq.removeAt(i); db.setSequence(seq); render() }
        }
        box.buttons("항목 추가" to { inputDialog("순서 항목 추가", "", true) { n -> if (n.isNotBlank()) { seq.add(n); db.setSequence(seq); render() } } },
            "처음 위치로" to { prefs.sequenceIndex = 0; render() })
    }

    // ================= 캡처 보관함 =================
    private fun captures(box: LinearLayout) {
        box.buttons("갤러리 이미지 가져와 글자 추출" to { pickImage() })
        val list = db.captures()
        box.label("${list.size}개 · 저장 위치: ${if (prefs.treeUri.isNotEmpty()) "선택한 폴더" else "사진/${prefs.folderName}"}", 12f, color = GRAY, topDp = 6)
        for (c in list) {
            val card = box.add(hbox(), topDp = 6)
            card.setPadding(dp(8), dp(8), dp(8), dp(8))
            card.background = round(Color.WHITE, dp(10).toFloat(), LINE, dp(1))
            val img = ImageView(this); img.scaleType = ImageView.ScaleType.CENTER_CROP
            card.addView(img, LinearLayout.LayoutParams(dp(64), dp(96)))
            io.execute {
                val bmp = try { contentResolver.loadThumbnail(Uri.parse(c.uri), Size(dp(128), dp(192)), null) } catch (e: Exception) { null }
                runOnUiThread { if (bmp != null) img.setImageBitmap(bmp) else img.setBackgroundColor(LINE) }
            }
            val col = vbox(); col.setPadding(dp(10), 0, 0, 0)
            card.add(col, 0, WRAP, 1f)
            col.label(c.name, 13f, true)
            col.label(timeText(c.created) + (if (c.origUri.isNotEmpty()) " · 원본 보관" else ""), 11f, color = GRAY)
            val r1 = col.add(hbox())
            r1.btn("편집") { openEdit(c.id, "crop") }
            r1.btn("가리기") { openEdit(c.id, "mask") }
            val r2 = col.add(hbox())
            r2.btn("글자") { startActivity(Intent(this, OcrActivity::class.java).putExtra("captureId", c.id)) }
            r2.btn("공유") { openEdit(c.id, "share") }
            r2.btn("삭제") {
                confirm("캡처 삭제", "${c.name} 파일을 삭제합니다.") {
                    val st = ImageStore(this); st.delete(c.uri); st.delete(c.origUri); db.deleteCapture(c.id); render()
                }
            }
        }
    }

    private fun openEdit(id: Long, mode: String) =
        startActivity(Intent(this, ImageEditActivity::class.java).putExtra("id", id).putExtra("mode", mode))

    // ================= 설정 =================
    private fun settings(box: LinearLayout) {
        val svc = { HelperService.instance?.recheckSoon(); Unit }
        box.title("도우미 버튼")
        box.seek("크기", 32, 72, prefs.helperSizeDp, "dp") { prefs.helperSizeDp = it; svc() }
        box.seek("투명도(불투명 정도)", 30, 100, prefs.helperAlpha, "%") { prefs.helperAlpha = it; svc() }
        box.seek("사용하지 않으면 접기", 0, 30, prefs.collapseSec, "초 (0=접지 않음)") { prefs.collapseSec = it; svc() }
        val cr = box.add(hbox())
        Prefs.COLOR_NAMES.forEachIndexed { i, n ->
            val v = TextView(this); v.text = n; v.gravity = Gravity.CENTER; v.setTextColor(Color.WHITE); v.textSize = 12f
            v.background = round(Prefs.COLORS[i], dp(14).toFloat(), if (i == prefs.helperColor) Color.BLACK else Color.TRANSPARENT, dp(2))
            v.setPadding(0, dp(6), 0, dp(6))
            v.setOnClickListener { prefs.helperColor = i; svc(); render() }
            val lp = LinearLayout.LayoutParams(0, WRAP, 1f); lp.setMargins(dp(2), dp(6), dp(2), 0)
            cr.addView(v, lp)
        }
        box.sw("입력창 옆에 표시", prefs.nearField, "입력창 위치를 확인할 수 있는 앱에서만 옆으로 이동하고, 확인할 수 없으면 가장자리에 고정됩니다.") { prefs.nearField = it; svc() }
        box.btn("앱별 도우미 제외 (${prefs.excluded.size}개)") { chooseExcluded() }

        box.title("캡처 제스처")
        box.seek("세 번 터치 간격", 250, 900, prefs.tripleMs, "ms") { prefs.tripleMs = it }
        box.sw("버튼 길게 눌러 캡처", prefs.longPressCapture) { prefs.longPressCapture = it }
        box.sw("가장자리 작은 터치 영역 (세 번 터치 → 캡처)", prefs.edgeZone, "도우미 버튼 반대쪽 가장자리에 좁은 영역을 둡니다.") { prefs.edgeZone = it; svc() }
        box.label("화면 아무 곳이나 세 번 터치: 지원하지 않음 — 다른 앱의 터치를 가로채지 않고는 구현할 수 없어 비활성화했습니다.", 12f, color = GRAY, topDp = 4)

        box.title("자동 크롭")
        box.sw("위쪽(상태표시줄) 제거", prefs.cropTop) { prefs.cropTop = it }
        box.sw("아래쪽(내비게이션) 제거", prefs.cropBottom) { prefs.cropBottom = it }
        box.sw("가로 화면 좌우 시스템 영역 제거", prefs.cropSides) { prefs.cropSides = it }
        box.seek("위쪽 추가 여백", -50, 200, prefs.extraTop, "px") { prefs.extraTop = it }
        box.seek("아래쪽 추가 여백", -50, 200, prefs.extraBottom, "px") { prefs.extraBottom = it }
        val presets = prefs.presetPackages()
        box.label("앱별 자르기 프리셋: ${if (presets.isEmpty()) "없음 (편집 화면에서 '이 앱 기본값으로 저장')" else presets.joinToString { appLabel(it) }}", 12f, color = GRAY, topDp = 4)
        if (presets.isNotEmpty()) box.btn("앱별 프리셋 모두 삭제") { presets.forEach { prefs.setPreset(it, null) }; render() }

        box.title("저장 방식")
        box.sw("캡처 후 자동 저장", prefs.autoSave, "끄면 미리보기에서 '편집 후 저장'을 눌러 저장합니다.") { prefs.autoSave = it }
        box.sw("원본(자르기 전)도 함께 보관", prefs.keepOriginal) { prefs.keepOriginal = it }
        box.sw("JPEG로 저장 (끄면 PNG)", prefs.jpeg) { prefs.jpeg = it; render() }
        if (prefs.jpeg) box.seek("JPEG 화질", 50, 100, prefs.jpegQuality, "") { prefs.jpegQuality = it }
        box.label("저장 폴더: ${if (prefs.treeUri.isNotEmpty()) Uri.parse(prefs.treeUri).lastPathSegment else "사진/${prefs.folderName}"}", 13f, topDp = 6)
        box.buttons("다른 폴더 선택" to { startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE), 11) },
            "기본 폴더로" to { prefs.treeUri = ""; render() },
            "폴더 이름" to { inputDialog("사진 폴더 이름", prefs.folderName) { prefs.folderName = it.ifBlank { "EUM_QUICK" }; render() } })
        box.label("파일명 규칙: ${prefs.namePattern}  예) ${kr.eumsoft.quick.core.FileNames.build(prefs.namePattern, java.util.Date())}", 13f, topDp = 6)
        box.btn("파일명 규칙 변경") {
            inputDialog("파일명 규칙 ({date}=날짜, {time}=시각)", prefs.namePattern) { prefs.namePattern = it.ifBlank { "EUM_{date}_{time}" }; render() }
        }

        box.title("개인정보")
        box.sw("클립 수집 일시정지", prefs.collectPaused) { prefs.collectPaused = it }
        box.sw("인증번호·카드번호 등으로 보이는 내용 저장 제외", prefs.excludeSensitive,
            "형식으로 추정하는 것이라 놓치거나 잘못 판단할 수 있습니다. 민감 표시가 있는 클립은 항상 제외합니다.") { prefs.excludeSensitive = it }
        box.seek("최근 기록 보관 기간", 0, 365, prefs.retentionDays, "일 (0=무기한)") { prefs.retentionDays = it }
        box.buttons("기간 지난 기록 지금 정리" to { toast("${db.purge(prefs.retentionDays)}개 삭제했습니다.") },
            "최근 기록 전체 삭제" to { confirm("전체 삭제", "최근 기록을 모두 삭제합니다.") { db.deleteAllRecent(); toast("삭제했습니다.") } })
        box.btn("접근성 사용 안내 다시 보기") { askConsent() }

        box.title("키보드 선택 안내")
        box.label("전용 키보드는 선택 사항입니다. 기본 키보드로 지정하면 키보드가 실행 중일 때 복사한 내용을 OS가 허용하는 범위에서 기록하고, " +
            "커서 위치에 클립을 바로 넣을 수 있습니다. 기존 키보드로 돌아가려면 키보드의 '🌐 키보드 전환'을 누르거나 길게 눌러 선택하세요.", 12f, color = GRAY)
        statusRow(box, "전용 키보드", imeEnabled(), if (imeDefault()) "사용 중(기본)" else "활성화됨", "비활성", null, null)
        box.buttons("1. 키보드 목록에서 켜기" to { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) },
            "2. 기본 키보드 선택" to { getSystemService(InputMethodManager::class.java).showInputMethodPicker() })
        if (EumKeyboard.instance != null) box.label("전용 키보드 기록 시작 시각 이후 복사한 내용만 표시합니다.", 12f, color = GRAY)
    }

    private fun appLabel(pkg: String) = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (e: Exception) { pkg }

    private fun chooseExcluded() {
        val apps = packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .map { it.activityInfo.packageName to it.loadLabel(packageManager).toString() }
            .distinctBy { it.first }.filter { it.first != packageName }.sortedBy { it.second }
        val cur = prefs.excluded.toMutableSet()
        val checked = apps.map { it.first in cur }.toBooleanArray()
        AlertDialog.Builder(this).setTitle("도우미를 숨길 앱")
            .setMultiChoiceItems(apps.map { it.second }.toTypedArray(), checked) { _, i, on ->
                if (on) cur.add(apps[i].first) else cur.remove(apps[i].first)
            }
            .setPositiveButton("저장") { _, _ -> prefs.excluded = cur; HelperService.instance?.recheckSoon(); render() }
            .setNegativeButton("취소", null).show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        HelperService.instance?.let { if (it.ready) Notifier.show(it) }
        render()
    }
}
