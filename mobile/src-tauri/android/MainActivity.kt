package com.ghostclaw.bibleconcordance

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.util.Locale

// Copied over the generated MainActivity by mobile/scripts/android.ps1 (the generated project is not kept
// in git). Since Android 15 an app is drawn edge to edge, under the status bar and the navigation bar.
// The page pads itself by the size of the bars: the Android WebView does not always report them through
// env(safe-area-inset-*), so the sizes are handed over here, in CSS pixels, both when the page asks
// (window.AndroidInsets.get(), see index.html) and whenever they change (window.__setInsets).
class MainActivity : TauriActivity() {
  private var top = 0f
  private var right = 0f
  private var bottom = 0f
  private var left = 0f
  private var page: WebView? = null

  private fun sizes(): String = String.format(Locale.US, "%.1f,%.1f,%.1f,%.1f", top, right, bottom, left)

  inner class InsetsBridge {
    @JavascriptInterface
    fun get(): String = sizes()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // light icons in the status bar in every theme: the page's header behind them is dark navy
    enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT))
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { _, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val density = resources.displayMetrics.density
      top = bars.top / density
      right = bars.right / density
      bottom = bars.bottom / density
      left = bars.left / density
      page?.post { page?.evaluateJavascript("window.__setInsets&&window.__setInsets(${sizes()})", null) }
      insets
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onWebViewCreate(webView: WebView) {
    page = webView
    webView.addJavascriptInterface(InsetsBridge(), "AndroidInsets")
  }
}
