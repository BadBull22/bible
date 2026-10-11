package com.ghostclaw.phone

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
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
}

@InvokeArg
class SaveArgs {
  lateinit var name: String
  lateinit var text: String
}

/** What the Bible app needs from the phone itself: the share sheet, the phone's voice,
 * and saving or opening a file where the reader chooses. */
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
    val id = "verse-" + (++utterance)
    if (voice.speak(args.text, TextToSpeech.QUEUE_FLUSH, Bundle(), id) != TextToSpeech.SUCCESS) {
      val invoke = synchronized(this) { val i = speaking; speaking = null; i }
      invoke?.reject("The phone's voice could not read this.")
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
    if (ready) {
      say(args)
      return
    }
    tts = TextToSpeech(activity.applicationContext) { status ->
      val voice = tts
      if (status != TextToSpeech.SUCCESS || voice == null) {
        val waiting = synchronized(this) { val i = speaking; speaking = null; i }
        waiting?.reject("This phone has no voice for reading aloud. One can be added in the phone's settings under Text-to-speech.")
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
      say(args)
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

  // ---------------------------------------------------------------- a file the reader chooses

  private var toSave: String? = null

  @Command
  fun saveText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SaveArgs::class.java)
      toSave = args.text
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

  @ActivityCallback
  fun saved(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    val text = toSave
    toSave = null
    if (result.resultCode != Activity.RESULT_OK || uri == null || text == null) {
      invoke.resolve(JSObject().put("saved", false))
      return
    }
    try {
      val out = activity.contentResolver.openOutputStream(uri, "wt") ?: throw Exception("The file could not be written.")
      out.use { it.write(text.toByteArray(Charsets.UTF_8)) }
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
