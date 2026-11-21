package kr.eumsoft.balju

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
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
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import kr.eumsoft.balju.databinding.ActivityMainBinding
import java.io.File

/**
 * 이음 발주서 웹앱을 감싸는 WebView 앱.
 * - 앱이 여는 주소: BuildConfig.APP_URL
 * - 도장 이미지 올리기: onShowFileChooser (이미지 한 장)
 * - PDF 저장: 웹이 window.BaljuApp.savePdf(base64, 파일명)을 부르면 다운로드 폴더에 저장하고 열기/공유를 띄운다.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var mainFrameFailed = false

    private val pickImage =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback ?: return@registerForActivityResult
            fileChooserCallback = null
            val uri = if (result.resultCode == RESULT_OK) result.data?.data else null
            callback.onReceiveValue(uri?.let { arrayOf(it) })
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        applyEdgeToEdge()
        setupWebView()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) binding.webView.goBack() else finish()
            }
        })

        binding.retryButton.setOnClickListener {
            mainFrameFailed = false
            binding.errorView.visibility = View.GONE
            binding.progress.visibility = View.VISIBLE
            if (binding.webView.url.isNullOrEmpty()) loadApp() else binding.webView.reload()
        }

        val restored = savedInstanceState?.getBundle(STATE_WEB_VIEW)
        if (restored != null) binding.webView.restoreState(restored) else loadApp()
    }

    private fun applyEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightStatusBars = true
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
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
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString EumBaljuAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        webView.setBackgroundColor(ContextCompat.getColor(this, R.color.app_background))
        webView.addJavascriptInterface(PdfBridge(), "BaljuApp")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val target = request?.url ?: return false
                return handleUri(target)
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                mainFrameFailed = false
                binding.progress.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                binding.progress.visibility = View.GONE
                if (!mainFrameFailed) binding.errorView.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame != true) return
                mainFrameFailed = true
                binding.progress.visibility = View.GONE
                binding.errorView.visibility = View.VISIBLE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                binding.progress.progress = newProgress
                binding.progress.visibility = if (newProgress >= 100) View.GONE else View.VISIBLE
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback ?: return true
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                }
                try {
                    pickImage.launch(Intent.createChooser(intent, getString(R.string.stamp_chooser_title)))
                } catch (e: ActivityNotFoundException) {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = null
                    Toast.makeText(this@MainActivity, R.string.error_no_app, Toast.LENGTH_SHORT).show()
                }
                return true
            }
        }
    }

    private fun loadApp() {
        mainFrameFailed = false
        binding.webView.loadUrl(BuildConfig.APP_URL)
    }

    /** 앱 주소는 WebView 안에서, 다른 주소(개인정보처리방침 새 창, 메일 등)는 기기 앱으로 연다. */
    private fun handleUri(uri: Uri): Boolean {
        val appHost = Uri.parse(BuildConfig.APP_URL).host
        return when (uri.scheme?.lowercase()) {
            "http", "https" -> if (uri.host.equals(appHost, ignoreCase = true)) false else { openExternally(uri); true }
            else -> { openExternally(uri); true }
        }
    }

    private fun openExternally(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(this, R.string.error_no_app, Toast.LENGTH_SHORT).show()
        }
    }

    /** 웹에서 만든 PDF를 받아 저장한다. */
    inner class PdfBridge {
        @JavascriptInterface
        fun savePdf(base64: String, fileName: String) {
            val safeName = fileName.replace(Regex("[\\\\/:*?\"<>|]"), "").ifBlank { "발주서.pdf" }
            val bytes = try {
                Base64.decode(base64, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                runOnUiThread { Toast.makeText(this@MainActivity, R.string.error_pdf, Toast.LENGTH_LONG).show() }
                return
            }
            runOnUiThread { savePdfBytes(bytes, safeName) }
        }
    }

    private fun savePdfBytes(bytes: ByteArray, name: String) {
        try {
            // 앱 전용 캐시에 한 부 두고 FileProvider 로 열기·공유한다.
            val dir = File(cacheDir, "pdf").apply { mkdirs() }
            val cacheFile = File(dir, name).apply { writeBytes(bytes) }
            val shareUri = FileProvider.getUriForFile(this, "$packageName.files", cacheFile)

            // Android 10 이상: 다운로드 폴더에도 저장 (권한 없이 MediaStore 사용)
            var savedToDownloads = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/이음발주서")
                }
                contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)?.let { uri ->
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    savedToDownloads = true
                }
            }
            Toast.makeText(
                this,
                if (savedToDownloads) R.string.pdf_saved_downloads else R.string.pdf_ready,
                Toast.LENGTH_LONG,
            ).show()

            val send = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, shareUri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val view = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(shareUri, "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = Intent.createChooser(send, getString(R.string.pdf_share_title))
                .putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(view))
            startActivity(chooser)
        } catch (e: Exception) {
            Log.e(TAG, "PDF 저장 실패", e)
            Toast.makeText(this, R.string.error_pdf, Toast.LENGTH_LONG).show()
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
        binding.webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "EumBalju"
        private const val STATE_WEB_VIEW = "web_view_state"
    }
}
