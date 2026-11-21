package kr.eumsoft.familyalbum

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kr.eumsoft.familyalbum.databinding.ActivityMainBinding

/**
 * 가족앨범 웹앱(Next.js)을 그대로 감싸는 풀스크린 WebView 앱.
 *
 * - 앱이 열 주소: BuildConfig.APP_URL (빌드 인자 -PappUrl / APP_URL 환경변수 / local.properties 로 교체)
 * - 사진·동영상 다중 선택 업로드: onShowFileChooser + EXTRA_ALLOW_MULTIPLE
 * - 원본·ZIP 다운로드: DownloadListener + DownloadManager (로그인 쿠키 전달)
 * - IndexedDB 업로드 복원: domStorageEnabled / databaseEnabled
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    /** WebView 가 요청한 파일 선택 콜백. 한 번만 응답해야 한다. */
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    /** 첫 화면 자체가 실패했는지(하위 리소스 오류와 구분). */
    private var mainFrameFailed = false

    /** 저장소 권한 승인 뒤 실행할 다운로드(API 28 이하). */
    private var pendingDownload: (() -> Unit)? = null

    private val pickFiles =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback ?: return@registerForActivityResult
            fileChooserCallback = null

            val data = result.data
            val uris: Array<Uri>? = when {
                result.resultCode != RESULT_OK || data == null -> null
                data.clipData != null -> {
                    val clip = data.clipData!!
                    Array(clip.itemCount) { index -> clip.getItemAt(index).uri }
                }
                data.data != null -> arrayOf(data.data!!)
                else -> null
            }
            callback.onReceiveValue(uris)
        }

    private val requestMediaPermissions =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            // 권한을 거부해도 시스템 선택기는 고른 파일의 읽기 권한(URI)을 넘겨주므로 업로드는 계속한다.
            launchFileChooser()
        }

    private val requestStoragePermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val action = pendingDownload
            pendingDownload = null
            if (granted) {
                action?.invoke()
            } else {
                Toast.makeText(this, R.string.error_storage_permission, Toast.LENGTH_LONG).show()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        applyEdgeToEdge()
        setupWebView()
        setupBackNavigation()

        binding.retryButton.setOnClickListener {
            mainFrameFailed = false
            binding.errorView.visibility = View.GONE
            binding.progress.visibility = View.VISIBLE
            if (binding.webView.url.isNullOrEmpty()) {
                loadApp()
            } else {
                binding.webView.reload()
            }
        }

        val restored = savedInstanceState?.getBundle(STATE_WEB_VIEW)
        if (restored != null) {
            binding.webView.restoreState(restored)
        } else {
            loadApp()
        }
    }

    /** 상태바·내비게이션바 아래까지 그리되, 내용은 시스템 바에 가리지 않게 여백을 준다. */
    private fun applyEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = true
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webView = binding.webView
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(false)
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            loadsImagesAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = true
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString FamilyAlbumAndroid/${BuildConfig.VERSION_NAME}"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.app_background))

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?,
            ): Boolean {
                val target = request?.url ?: return false
                return handleUri(target)
            }

            @Deprecated("API 24 미만 호환")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                val target = url ?: return false
                return handleUri(Uri.parse(target))
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                mainFrameFailed = false
                binding.progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                binding.progress.visibility = View.GONE
                if (!mainFrameFailed) {
                    binding.errorView.visibility = View.GONE
                }
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                // 화면 전체를 실패시킨 경우에만 오류 안내를 띄운다(이미지·광고 등 하위 리소스 실패는 무시).
                val failedRequest = request ?: return
                if (!failedRequest.isForMainFrame) return
                if (failedRequest.url.toString().startsWith("data:")) return
                mainFrameFailed = true
                showError(getString(R.string.error_network))
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                binding.progress.progress = newProgress
                binding.progress.visibility =
                    if (newProgress >= 100) View.GONE else View.VISIBLE
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                // 이전 요청이 남아 있으면 반드시 null 로 응답해 WebView 가 멈추지 않게 한다.
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback ?: return true
                requestMediaPermissionsIfNeeded()
                return true
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d(TAG, "[web] ${consoleMessage?.message()} (${consoleMessage?.lineNumber()})")
                return true
            }
        }

        webView.setDownloadListener(
            DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
                enqueueDownload(url, userAgent, contentDisposition, mimeType)
            },
        )
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (binding.webView.canGoBack()) {
                        binding.webView.goBack()
                    } else {
                        finish()
                    }
                }
            },
        )
    }

    private fun loadApp() {
        mainFrameFailed = false
        binding.webView.loadUrl(BuildConfig.APP_URL)
    }

    private fun showError(message: String) {
        binding.progress.visibility = View.GONE
        binding.errorMessage.text = message
        binding.errorView.visibility = View.VISIBLE
    }

    /**
     * 웹뷰 안에서 처리할 주소와 앱 밖으로 넘길 주소를 구분한다.
     * @return true 이면 WebView 가 직접 열지 않는다.
     */
    private fun handleUri(uri: Uri): Boolean {
        return when (uri.scheme?.lowercase()) {
            // 웹앱 화면은 WebView 안에서 이동한다.
            "http", "https", "javascript" -> false
            // 전화·메일·마켓 등은 기기 앱으로 넘긴다.
            else -> {
                openExternally(uri)
                true
            }
        }
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "열 수 있는 앱이 없음: $uri", e)
            Toast.makeText(this, R.string.error_no_app, Toast.LENGTH_SHORT).show()
        }
    }

    private fun enqueueDownload(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        if (!url.startsWith("http")) {
            // blob:·data: 로 만들어진 파일은 WebView 다운로드로 저장할 수 없다.
            Toast.makeText(this, R.string.error_blob_download, Toast.LENGTH_LONG).show()
            return
        }

        // API 28 이하에서는 공용 다운로드 폴더에 쓰려면 저장소 권한이 필요하다.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.WRITE_EXTERNAL_STORAGE,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            pendingDownload = { startDownload(url, userAgent, contentDisposition, mimeType) }
            requestStoragePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }

        startDownload(url, userAgent, contentDisposition, mimeType)
    }

    private fun startDownload(
        url: String,
        userAgent: String,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        try {
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(fileName)
                setDescription(getString(R.string.download_description))
                if (!mimeType.isNullOrBlank()) setMimeType(mimeType)
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED,
                )
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                setAllowedOverMetered(true)
                setAllowedOverRoaming(true)
                // ZIP 다운로드 등은 로그인 세션 쿠키가 있어야 통과한다.
                CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                addRequestHeader(
                    "User-Agent",
                    userAgent.ifBlank { binding.webView.settings.userAgentString },
                )
            }

            val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            manager.enqueue(request)
            Toast.makeText(this, R.string.download_started, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Log.e(TAG, "다운로드 시작 실패: $url", e)
            Toast.makeText(this, R.string.error_download, Toast.LENGTH_LONG).show()
        }
    }

    private fun requiredMediaPermissions(): List<String> = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> listOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO,
        )
        Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2 -> listOf(
            Manifest.permission.READ_EXTERNAL_STORAGE,
        )
        else -> emptyList()
    }

    private fun requestMediaPermissionsIfNeeded() {
        val missing = requiredMediaPermissions().filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            launchFileChooser()
        } else {
            requestMediaPermissions.launch(missing.toTypedArray())
        }
    }

    /** 사진·동영상을 여러 개 고를 수 있는 시스템 선택기를 연다. */
    private fun launchFileChooser() {
        if (fileChooserCallback == null) return

        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        try {
            pickFiles.launch(Intent.createChooser(intent, getString(R.string.upload_chooser_title)))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "파일 선택기를 열 수 없음", e)
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = null
            Toast.makeText(this, R.string.error_no_app, Toast.LENGTH_SHORT).show()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val webState = Bundle()
        binding.webView.saveState(webState)
        outState.putBundle(STATE_WEB_VIEW, webState)
    }

    override fun onPause() {
        binding.webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onDestroy() {
        if (::binding.isInitialized) {
            binding.webView.destroy()
        }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "FamilyAlbum"
        private const val STATE_WEB_VIEW = "web_view_state"
    }
}
