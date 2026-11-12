package ph.docuvault.go

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebViewAssetLoader
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * DocuVault Go: the screens are the web app in assets/www, served from a private https address
 * (appassets.androidplatform.net) so storage and server calls work like a normal website.
 * The phone-only parts are here: Google's document scanner and on-phone text reader.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var loader: WebViewAssetLoader
    private val host = "appassets.androidplatform.net"
    private val scansDir by lazy { File(cacheDir, "scans").apply { mkdirs() } }
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val scannerLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        if (result.resultCode != Activity.RESULT_OK) { sendResult(JSONObject().put("ok", false).put("error", "cancelled")); return@registerForActivityResult }
        val scan = GmsDocumentScanningResult.fromActivityResultIntent(result.data)
        if (scan == null) { sendResult(JSONObject().put("ok", false).put("error", "The scanner returned nothing.")); return@registerForActivityResult }
        handleScan(scan)
    }

    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cleanOldScans()
        loader = WebViewAssetLoader.Builder()
            .setDomain(host)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/scans/", WebViewAssetLoader.InternalStoragePathHandler(this, scansDir))
            .build()

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == host) return false
                // Links to other sites open in the phone's browser.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try { fileLauncher.launch(params.createIntent()); true } catch (e: Exception) { fileCallback = null; false }
            }
        }
        web.addJavascriptInterface(Bridge(), "GoNative")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { if (web.canGoBack()) web.goBack() else finish() }
        })
        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("https://$host/assets/www/index.html")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    inner class Bridge {
        @JavascriptInterface
        fun scan(mode: String) { runOnUiThread { startScanner(mode) } }

        @JavascriptInterface
        fun version(): String = runCatching { packageManager.getPackageInfo(packageName, 0).versionName ?: "" }.getOrDefault("")
    }

    private fun startScanner(mode: String) {
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(if (mode == "receipt") 3 else 30)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG, GmsDocumentScannerOptions.RESULT_FORMAT_PDF)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(this)
            .addOnSuccessListener { sender -> scannerLauncher.launch(IntentSenderRequest.Builder(sender).build()) }
            .addOnFailureListener { e ->
                sendResult(JSONObject().put("ok", false).put("error", "The scanner could not start: ${e.message}. Update Google Play services and try again."))
            }
    }

    private fun handleScan(scan: GmsDocumentScanningResult) {
        val id = UUID.randomUUID().toString().replace("-", "").take(16)
        val pdfUri = scan.pdf?.uri
        if (pdfUri == null) { sendResult(JSONObject().put("ok", false).put("error", "The scanner made no PDF.")); return }
        val pdfFile = File(scansDir, "$id.pdf")
        copy(pdfUri, pdfFile)
        val pageUris = scan.pages?.map { it.imageUri } ?: emptyList()
        val pageUrls = JSONArray()
        pageUris.forEachIndexed { i, uri ->
            val f = File(scansDir, "$id-${i + 1}.jpg")
            copy(uri, f)
            pageUrls.put("https://$host/scans/${f.name}")
        }
        // Read the text of every page on the phone, then hand everything to the web screens.
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
        val jobs: List<Task<Text>> = pageUris.map { uri -> recognizer.process(InputImage.fromFilePath(this, uri)) }
        Tasks.whenAllComplete(jobs).addOnCompleteListener {
            val text = jobs.mapNotNull { t -> if (t.isSuccessful) t.result?.text else null }.joinToString("\n\n")
            sendResult(JSONObject().put("ok", true).put("pdf", "https://$host/scans/${pdfFile.name}").put("pages", pageUrls).put("text", text))
        }
    }

    private fun copy(from: Uri, to: File) {
        contentResolver.openInputStream(from)?.use { input -> to.outputStream().use { input.copyTo(it) } }
    }

    private fun sendResult(json: JSONObject) {
        runOnUiThread { web.evaluateJavascript("window.goNativeResult && window.goNativeResult(${JSONObject.quote(json.toString())})", null) }
    }

    private fun cleanOldScans() {
        val cutoff = System.currentTimeMillis() - 24 * 3600 * 1000L
        scansDir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }
    }
}
