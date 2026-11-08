package dev.r16a.r16a_vault

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    // Timestamp of our last sensitive clip, so clearing can tell whether the user copied
    // something else without reading the clip, which Android 12+ announces with a toast.
    private var ownedClipTimestamp: Long? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "dev.r16a.vault/clipboard")
            .setMethodCallHandler { call, result ->
                val manager = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                when (call.method) {
                    "copySensitive" -> {
                        val clip = ClipData.newPlainText("", call.argument<String>("text") ?: "")
                        // Android 13 hides clips flagged as sensitive from the copy preview and keyboard suggestions.
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            clip.description.extras = PersistableBundle().apply {
                                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
                            }
                        }
                        manager.setPrimaryClip(clip)
                        ownedClipTimestamp = manager.primaryClipDescription?.timestamp
                        result.success(true)
                    }
                    "clearIfOurs" -> {
                        val owned = ownedClipTimestamp
                        if (owned != null && manager.primaryClipDescription?.timestamp == owned) {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                                manager.clearPrimaryClip()
                            } else {
                                manager.setPrimaryClip(ClipData.newPlainText("", ""))
                            }
                        }
                        ownedClipTimestamp = null
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
