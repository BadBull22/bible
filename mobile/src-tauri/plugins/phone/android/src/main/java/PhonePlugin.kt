package com.ghostclaw.phone

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.JSArray
import app.tauri.plugin.Plugin
import java.io.File
import java.util.Locale

@InvokeArg
class ShareArgs {
  lateinit var text: String
  var title: String? = null
}

@InvokeArg
class SpeakArgs {
  lateinit var text: String
  var rate: Float = 1.0f
  /** one of the names `voices` lists; null for the phone's default voice */
  var voice: String? = null
}

@InvokeArg
class ImageArgs {
  lateinit var name: String
  /** the picture, PNG, base64 */
  lateinit var base64: String
  var text: String? = null
}

@InvokeArg
class SaveArgs {
  lateinit var name: String
  lateinit var text: String
}

/** What the Bible app needs from the phone itself: the share sheet (text or a picture), the
 * phone's voices, and saving or opening a file where the reader chooses. */
@TauriPlugin
class PhonePlugin(private val activity: Activity) : Plugin(activity) {
  // ---------------------------------------------------------------- share

  @Command
  fun share(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ShareArgs::class.java)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, args.text)
        args.title?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
      }
      activity.startActivity(Intent.createChooser(send, args.title))
      invoke.resolve(JSObject().put("shared", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  // ---------------------------------------------------------------- the phone's voice
  //
  // One piece of text is spoken at a time; `speak` answers when it has been said (or was
  // stopped), so the page can go on to the next verse.

  private var tts: TextToSpeech? = null
  private var ready = false
  private var speaking: Invoke? = null
  private var utterance = 0

  private fun finish(finished: Boolean) {
    val invoke = synchronized(this) { val i = speaking; speaking = null; i }
    invoke?.resolve(JSObject().put("finished", finished))
  }

  private fun say(args: SpeakArgs) {
    val voice = tts ?: return
    voice.setSpeechRate(args.rate.coerceIn(0.5f, 2.5f))
    // the voice the reader chose, if the phone still has it; otherwise the default
    val chosen = args.voice?.let { name -> try { voice.voices?.firstOrNull { it.name == name } } catch (_: Exception) { null } }
    if (chosen != null && voice.voice?.name != chosen.name) voice.voice = chosen
    else if (chosen == null && args.voice == null && voice.voice != voice.defaultVoice && voice.defaultVoice != null) voice.voice = voice.defaultVoice
    val id = "verse-" + (++utterance)
    if (voice.speak(args.text, TextToSpeech.QUEUE_FLUSH, Bundle(), id) != TextToSpeech.SUCCESS) {
      val invoke = synchronized(this) { val i = speaking; speaking = null; i }
      invoke?.reject("The phone's voice could not read this.")
    }
  }

  /** Starts the phone's voice once; `then` runs when it is ready (or with false if it can't). */
  private fun withVoice(then: (Boolean) -> Unit) {
    if (ready) {
      then(true)
      return
    }
    tts = TextToSpeech(activity.applicationContext) { status ->
      val voice = tts
      if (status != TextToSpeech.SUCCESS || voice == null) {
        then(false)
        return@TextToSpeech
      }
      // the Bible text is English, whatever language the phone is set to
      val language = voice.setLanguage(Locale.getDefault().takeIf { it.language == "en" } ?: Locale.US)
      if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) voice.setLanguage(Locale.ENGLISH)
      voice.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onDone(utteranceId: String?) {
          if (utteranceId == "verse-$utterance") finish(true)
        }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
          if (utteranceId == "verse-$utterance") finish(false)
        }
        override fun onStop(utteranceId: String?, interrupted: Boolean) {
          if (utteranceId == "verse-$utterance") finish(false)
        }
      })
      ready = true
      then(true)
    }
  }

  @Command
  fun speak(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(SpeakArgs::class.java)
    } catch (ex: Exception) {
      invoke.reject(ex.message)
      return
    }
    finish(false) // anything still being said gives way
    synchronized(this) { speaking = invoke }
    withVoice { ok ->
      if (ok) say(args)
      else {
        val waiting = synchronized(this) { val i = speaking; speaking = null; i }
        waiting?.reject("This phone has no voice for reading aloud. One can be added in the phone's settings under Text-to-speech.")
      }
    }
  }

  /** The phone's English voices, the ones that work without the internet first. */
  @Command
  fun voices(invoke: Invoke) {
    withVoice { ok ->
      val list = JSArray()
      if (ok) {
        val all: Set<Voice> = try { tts?.voices ?: emptySet() } catch (_: Exception) { emptySet() }
        all.filter { it.locale.language == "en" && !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) }
          .sortedWith(compareBy({ it.isNetworkConnectionRequired }, { it.locale.displayCountry }, { it.name }))
          .forEach { v ->
            val country = v.locale.displayCountry.ifEmpty { "English" }
            val kind = if (v.quality >= Voice.QUALITY_HIGH) "high quality" else "standard"
            list.put(JSObject().put("name", v.name).put("label", "$country · $kind").put("local", !v.isNetworkConnectionRequired))
          }
      }
      invoke.resolve(JSObject().put("voices", list))
    }
  }

  @Command
  fun stopSpeaking(invoke: Invoke) {
    tts?.stop()
    finish(false)
    invoke.resolve(JSObject().put("stopped", true))
  }

  override fun onPause() {
    // leaving the app stops the reading
    tts?.stop()
    finish(false)
  }

  override fun onDestroy() {
    tts?.shutdown()
    tts = null
    ready = false
  }

  // ---------------------------------------------------------------- a picture to share

  /** Shares a PNG through the share sheet: written to the app's cache and handed over by its
   * FileProvider (declared in this plugin's manifest), so the receiving app can read it. */
  @Command
  fun shareImage(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ImageArgs::class.java)
      val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
      dir.listFiles()?.forEach { it.delete() } // only the latest picture is kept
      val safe = args.name.replace(Regex("[^A-Za-z0-9 ._-]"), "").ifBlank { "verse.png" }
      val file = File(dir, safe)
      file.writeBytes(Base64.decode(args.base64, Base64.DEFAULT))
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".phone.files", file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        args.text?.let { putExtra(Intent.EXTRA_TEXT, it) }
        // some apps read the picture only from the clip data
        clipData = ClipData.newRawUri(null, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(send, null))
      invoke.resolve(JSObject().put("shared", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  // ---------------------------------------------------------------- a file the reader chooses

  private var toSave: ByteArray? = null

  @Command
  fun saveText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SaveArgs::class.java)
      toSave = args.text.toByteArray(Charsets.UTF_8)
      val create = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "application/json"
        putExtra(Intent.EXTRA_TITLE, args.name)
      }
      startActivityForResult(invoke, create, "saved")
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** Asks where to save a PNG (e.g. in Pictures) and writes it there. */
  @Command
  fun saveImage(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ImageArgs::class.java)
      toSave = Base64.decode(args.base64, Base64.DEFAULT)
      val create = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "image/png"
        putExtra(Intent.EXTRA_TITLE, args.name)
      }
      startActivityForResult(invoke, create, "saved")
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @ActivityCallback
  fun saved(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    val bytes = toSave
    toSave = null
    if (result.resultCode != Activity.RESULT_OK || uri == null || bytes == null) {
      invoke.resolve(JSObject().put("saved", false))
      return
    }
    try {
      val out = activity.contentResolver.openOutputStream(uri, "wt") ?: throw Exception("The file could not be written.")
      out.use { it.write(bytes) }
      invoke.resolve(JSObject().put("saved", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @Command
  fun openText(invoke: Invoke) {
    try {
      val open = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
      }
      startActivityForResult(invoke, open, "opened")
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @ActivityCallback
  fun opened(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject().put("text", null as String?))
      return
    }
    try {
      val input = activity.contentResolver.openInputStream(uri) ?: throw Exception("The file could not be read.")
      val bytes = input.use { stream ->
        // a backup is small; anything huge is not one
        val buffer = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(65536)
        while (true) {
          val n = stream.read(chunk)
          if (n < 0) break
          buffer.write(chunk, 0, n)
          if (buffer.size() > 20 * 1024 * 1024) throw Exception("That file is too large to be a backup.")
        }
        buffer.toByteArray()
      }
      invoke.resolve(JSObject().put("text", String(bytes, Charsets.UTF_8)))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }
}
