package com.ghostclaw.phone

import android.app.Activity
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
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
class JsonArgs {
  lateinit var json: String
}

@InvokeArg
class ActionArgs {
  lateinit var action: String
}

@InvokeArg
class LinkArgs {
  /** an https:// address */
  lateinit var url: String
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
  /** the picture, base64 (a PNG unless `mime` says otherwise) */
  lateinit var base64: String
  var text: String? = null
  /** "image/jpeg" for a photograph or painting; PNG when left out */
  var mime: String? = null
  /** the subject line of an e-mail */
  var title: String? = null
}

@InvokeArg
class InstallArgs {
  /** the downloaded APK, in the app's cache under updates/ */
  lateinit var path: String
}

@InvokeArg
class SaveArgs {
  lateinit var name: String
  lateinit var text: String
}

@InvokeArg
class FolderArgs {
  /** a folder the reader chose with pickFolder (its tree URI) */
  lateinit var uri: String
}

@InvokeArg
class FolderWriteArgs {
  lateinit var uri: String
  lateinit var name: String
  lateinit var text: String
}

@InvokeArg
class FileArgs {
  lateinit var name: String
  lateinit var text: String
  /** "application/json" when left out */
  var mime: String? = null
  var title: String? = null
}

@InvokeArg
class UriArgs {
  lateinit var uri: String
}

@InvokeArg
class PicArgs {
  /** the chosen sync folder (its tree address) */
  lateinit var uri: String
  /** the picture's document id (one, or several joined with "|" for `shareComputerPictures`) */
  lateinit var id: String
  var name: String = "picture"
  var mime: String? = null
}

@InvokeArg
class PicturesArgs {
  /** the pictures, base64, joined with "|" (base64 never holds that character) */
  lateinit var base64: String
  /** their file names, joined with "|" */
  lateinit var names: String
  var mime: String? = null
  var text: String? = null
}

/** The folder inside the sync folder where the computer puts the pictures and videos it made. */
const val PICTURES_FOLDER = "pictures"

/** The folder in the phone's Documents that holds the automatic backup copies, and how many dated copies are kept. */
const val BACKUP_DIR = "Bible Concordance backup"
const val BACKUP_KEEP = 3

/** The folder inside the chosen one that holds the sync files (as on the computers). */
const val SYNC_FOLDER = "Bible Concordance sync"

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

  // ---------------------------------------------------------------- the daily notifications, the home-screen widget, and Listen mode (see Daily.kt, ListenService.kt)

  /** The page hands over a plan of notifications (a JSON list of { at, id, title, body, open }) for the next two weeks; the phone keeps and sends them. */
  @Command
  fun scheduleNotifications(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(JsonArgs::class.java)
      val n = Daily.schedule(activity.applicationContext, Daily.parse(args.json))
      invoke.resolve(JSObject().put("scheduled", n).put("allowed", Daily.allowed(activity)).put("exact", Daily.canBeExact(activity)))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @Command
  fun cancelNotifications(invoke: Invoke) {
    Daily.cancelAll(activity.applicationContext)
    invoke.resolve(JSObject().put("cancelled", true))
  }

  /** Shows one notification at once (to see how they look, or that they arrive on this phone). */
  @Command
  fun notifyNow(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(JsonArgs::class.java)
      val o = org.json.JSONObject(args.json)
      Daily.post(activity.applicationContext, o.optInt("id", 5900), o.getString("title"), o.getString("body"), o.optString("open", "scroll"))
      invoke.resolve(JSObject().put("allowed", Daily.allowed(activity)))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** The verses for the widget: a JSON list of { day, ref, text }. */
  @Command
  fun setWidgetData(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(JsonArgs::class.java)
      Daily.setWidgetData(activity.applicationContext, args.json)
      invoke.resolve(JSObject().put("widgets", VerseWidget.ids(activity).size))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** Asks the phone's launcher to put the verse widget on the home screen (the launcher asks the reader to confirm). */
  @Command
  fun pinWidget(invoke: Invoke) {
    val mgr = android.appwidget.AppWidgetManager.getInstance(activity)
    val supported = Build.VERSION.SDK_INT >= 26 && mgr.isRequestPinAppWidgetSupported
    var asked = false
    if (supported) {
      asked = try {
        mgr.requestPinAppWidget(android.content.ComponentName(activity, VerseWidget::class.java), null, null)
      } catch (_: Exception) {
        false
      }
    }
    invoke.resolve(JSObject().put("supported", supported).put("asked", asked).put("widgets", VerseWidget.ids(activity).size))
  }

  /** Where the app was opened to from a notification or the widget ("scroll", "mood", "prayer", "memory", "listen"), once; then none. */
  @Command
  fun takeLaunch(invoke: Invoke) {
    val open = Daily.pendingOpen
    Daily.pendingOpen = null
    invoke.resolve(JSObject().put("open", open))
  }

  /** Starts reading aloud with the screen off: a JSON queue { pieces: [{ t, h, l }], start, rate, voice, sleepMin, token }. */
  @Command
  fun listenStart(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(JsonArgs::class.java)
      ListenService.start(activity.applicationContext, args.json)
      invoke.resolve(JSObject().put("started", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** "toggle" (pause or play), "next", "prev" (chapters) or "stop". */
  @Command
  fun listenControl(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ActionArgs::class.java)
      ListenService.control(activity.applicationContext, args.action)
      invoke.resolve(JSObject().put("done", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @Command
  fun listenStatus(invoke: Invoke) {
    invoke.resolve(JSObject(ListenService.status(activity.applicationContext).toString()))
  }

  override fun load(webView: android.webkit.WebView) {
    // opened from a notification or the widget: where to go (kept until the page asks)
    activity.intent?.getStringExtra(Daily.EXTRA_OPEN)?.let {
      Daily.pendingOpen = it
      activity.intent.removeExtra(Daily.EXTRA_OPEN)
    }
  }

  override fun onNewIntent(intent: Intent) {
    intent.getStringExtra(Daily.EXTRA_OPEN)?.let {
      Daily.pendingOpen = it
      intent.removeExtra(Daily.EXTRA_OPEN)
    }
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
        type = if (args.mime == "image/jpeg") "image/jpeg" else "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        args.text?.let { putExtra(Intent.EXTRA_TEXT, it) }
        args.title?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
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

  /** Shares a text file (a backup) through the share sheet: written to the app's cache and handed over by its FileProvider. */
  @Command
  fun shareFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(FileArgs::class.java)
      val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
      dir.listFiles()?.forEach { it.delete() }
      val safe = args.name.replace(Regex("[^A-Za-z0-9 ._-]"), "").ifBlank { "backup.json" }
      val file = File(dir, safe)
      file.writeText(args.text, Charsets.UTF_8)
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".phone.files", file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = args.mime ?: "application/json"
        putExtra(Intent.EXTRA_STREAM, uri)
        args.title?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
        clipData = ClipData.newRawUri(null, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(send, null))
      invoke.resolve(JSObject().put("shared", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  // ---------------------------------------------------------------- pictures and videos from the computer

  /** The "pictures" folder inside the sync folder the computer fills (its document id), or null when it is not there yet. */
  private fun picturesDir(tree: Uri): String? {
    val sync = syncDir(tree, false) ?: return null
    return children(tree, sync).firstOrNull { it.second == PICTURES_FOLDER && it.third == DocumentsContract.Document.MIME_TYPE_DIR }?.first
  }

  private fun safeName(name: String, fallback: String) = name.replace(Regex("[^A-Za-z0-9 ._()-]"), "-").trim().ifBlank { fallback }

  /** One of those files copied into the app's cache (to read it, share it or open it); the file provider may hand it on. */
  private fun cacheCopy(tree: Uri, id: String, name: String, keepOthers: Boolean): File {
    val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
    if (!keepOthers) dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, safeName(name, "file"))
    val doc = DocumentsContract.buildDocumentUriUsingTree(tree, id)
    activity.contentResolver.openInputStream(doc)?.use { input -> file.outputStream().use { input.copyTo(it) } } ?: throw Exception("The file could not be opened.")
    return file
  }

  /** The pictures and videos the computer put in the sync folder, newest first (at most 80):
   * { found, files: [{ id, name, mime, size, modified }] }. `found` is false when the folder has no "pictures" folder yet. */
  @Command
  fun listComputerPictures(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PicArgs::class.java)
      val tree = Uri.parse(args.uri)
      val dir = picturesDir(tree)
      val list = JSArray()
      if (dir != null) {
        val cols = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        val rows = ArrayList<JSObject>()
        activity.contentResolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir), cols, null, null, null)?.use { c ->
          while (c.moveToNext()) {
            val name = c.getString(1) ?: continue
            val mime = c.getString(2) ?: ""
            if (name.startsWith(".") || !(mime.startsWith("image/") || mime.startsWith("video/"))) continue
            rows.add(JSObject().put("id", c.getString(0)).put("name", name).put("mime", mime).put("size", if (c.isNull(3)) 0L else c.getLong(3)).put("modified", if (c.isNull(4)) 0L else c.getLong(4)))
          }
        }
        rows.sortByDescending { it.optLong("modified") }
        rows.take(80).forEach { list.put(it) }
      }
      invoke.resolve(JSObject().put("found", dir != null).put("files", list))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** A picture's bytes as base64, to show it (pictures up to 15 MB). */
  @Command
  fun readComputerPicture(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PicArgs::class.java)
      val doc = DocumentsContract.buildDocumentUriUsingTree(Uri.parse(args.uri), args.id)
      val bytes = activity.contentResolver.openInputStream(doc)?.use { it.readBytes() } ?: throw Exception("The picture could not be opened.")
      if (bytes.size > 15 * 1024 * 1024) throw Exception("That picture is too large to show here. Save it instead.")
      invoke.resolve(JSObject().put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** Saves a picture or video from the computer in the phone's gallery: Pictures/Bible Concordance or Movies/Bible Concordance (Android 10 and newer,
   * no permission); on older Android in the app's own folder. { saved, already, where } ("already": a file of that name was saved before). */
  @Command
  fun saveComputerPicture(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PicArgs::class.java)
      val tree = Uri.parse(args.uri)
      val name = safeName(args.name, "picture")
      val video = (args.mime ?: "").startsWith("video/")
      val src = DocumentsContract.buildDocumentUriUsingTree(tree, args.id)
      val folder = if (video) "Movies/Bible Concordance" else "Pictures/Bible Concordance"
      if (Build.VERSION.SDK_INT >= 29) {
        val resolver = activity.contentResolver
        val coll = if (video) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        var already = false
        resolver.query(coll, arrayOf(MediaStore.MediaColumns._ID), MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND " + MediaStore.MediaColumns.DISPLAY_NAME + " = ?", arrayOf("$folder/", name), null)?.use { already = it.moveToFirst() }
        if (!already) {
          val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, args.mime ?: if (video) "video/mp4" else "image/png")
            put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }
          val out = resolver.insert(coll, values) ?: throw Exception("The phone would not make the file.")
          try {
            resolver.openInputStream(src)?.use { input -> resolver.openOutputStream(out, "w")?.use { input.copyTo(it) } } ?: throw Exception("The file could not be copied.")
            resolver.update(out, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
          } catch (ex: Exception) {
            resolver.delete(out, null, null)
            throw ex
          }
        }
        invoke.resolve(JSObject().put("saved", true).put("already", already).put("where", folder))
      } else {
        val dir = File(activity.getExternalFilesDir(if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) ?: activity.filesDir, "Bible Concordance").apply { mkdirs() }
        val target = File(dir, name)
        val already = target.exists()
        if (!already) activity.contentResolver.openInputStream(src)?.use { input -> target.outputStream().use { input.copyTo(it) } } ?: throw Exception("The file could not be copied.")
        invoke.resolve(JSObject().put("saved", true).put("already", already).put("where", "the app's own folder"))
      }
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** Shares one or several of those files through the share sheet (`id`: their ids joined with "|"). */
  @Command
  fun shareComputerPictures(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PicArgs::class.java)
      val tree = Uri.parse(args.uri)
      val ids = args.id.split("|").filter { it.isNotBlank() }
      val names = args.name.split("|")
      if (ids.isEmpty()) throw Exception("Nothing chosen to share.")
      val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
      dir.listFiles()?.forEach { it.delete() }
      val uris = ArrayList<Uri>()
      ids.forEachIndexed { i, id ->
        val f = cacheCopy(tree, id, "${i + 1} " + safeName(names.getOrElse(i) { "picture" }, "picture"), true)
        uris.add(FileProvider.getUriForFile(activity, activity.packageName + ".phone.files", f))
      }
      val mime = args.mime ?: "*/*"
      val send = Intent(if (uris.size == 1) Intent.ACTION_SEND else Intent.ACTION_SEND_MULTIPLE).apply {
        type = mime
        if (uris.size == 1) putExtra(Intent.EXTRA_STREAM, uris[0]) else putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        clipData = ClipData.newRawUri(null, uris[0]).also { cd -> uris.drop(1).forEach { cd.addItem(ClipData.Item(it)) } }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(send, null))
      invoke.resolve(JSObject().put("shared", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** Opens one of those files (a video) in the phone's own viewer or player. */
  @Command
  fun openComputerFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PicArgs::class.java)
      val f = cacheCopy(Uri.parse(args.uri), args.id, args.name, false)
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".phone.files", f)
      val view = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, args.mime ?: "video/mp4")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(view)
      invoke.resolve(JSObject().put("opened", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  // ---------------------------------------------------------------- pictures made on the phone: save to the gallery, share several

  /** Saves pictures (base64 joined with "|") in the gallery, in Pictures/Bible Concordance (Android 10 and newer, no permission; older: the app's own
   * folder): { saved: how many, where }. A name already there gets a number added. */
  @Command
  fun saveToGallery(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PicturesArgs::class.java)
      val data = args.base64.split("|").filter { it.isNotBlank() }
      val names = args.names.split("|")
      val mime = args.mime ?: "image/png"
      var saved = 0
      data.forEachIndexed { i, b64 ->
        val bytes = Base64.decode(b64, Base64.DEFAULT)
        val base = safeName(names.getOrElse(i) { "picture" }, "picture")
        if (Build.VERSION.SDK_INT >= 29) {
          val resolver = activity.contentResolver
          val coll = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
          var name = base
          var n = 1
          while (true) {
            var exists = false
            resolver.query(coll, arrayOf(MediaStore.MediaColumns._ID), MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND " + MediaStore.MediaColumns.DISPLAY_NAME + " = ?", arrayOf("Pictures/Bible Concordance/", name), null)?.use { exists = it.moveToFirst() }
            if (!exists) break
            n++
            name = base.substringBeforeLast('.') + " ($n)." + base.substringAfterLast('.', "png")
          }
          val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/Bible Concordance")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }
          val out = resolver.insert(coll, values) ?: throw Exception("The phone would not make the file.")
          try {
            resolver.openOutputStream(out, "w")?.use { it.write(bytes) } ?: throw Exception("The file could not be written.")
            resolver.update(out, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
          } catch (ex: Exception) {
            resolver.delete(out, null, null)
            throw ex
          }
        } else {
          val dir = File(activity.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: activity.filesDir, "Bible Concordance").apply { mkdirs() }
          var f = File(dir, base)
          var n = 1
          while (f.exists()) { n++; f = File(dir, base.substringBeforeLast('.') + " ($n)." + base.substringAfterLast('.', "png")) }
          f.writeBytes(bytes)
        }
        saved++
      }
      invoke.resolve(JSObject().put("saved", saved).put("where", if (Build.VERSION.SDK_INT >= 29) "Pictures/Bible Concordance" else "the app's own folder"))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** Shares one or several pictures (base64 joined with "|") through the share sheet, with some text. */
  @Command
  fun shareImages(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(PicturesArgs::class.java)
      val data = args.base64.split("|").filter { it.isNotBlank() }
      val names = args.names.split("|")
      if (data.isEmpty()) throw Exception("Nothing to share.")
      val dir = File(activity.cacheDir, "shared").apply { mkdirs() }
      dir.listFiles()?.forEach { it.delete() }
      val uris = ArrayList<Uri>()
      data.forEachIndexed { i, b64 ->
        val f = File(dir, "${i + 1} " + safeName(names.getOrElse(i) { "picture.png" }, "picture.png"))
        f.writeBytes(Base64.decode(b64, Base64.DEFAULT))
        uris.add(FileProvider.getUriForFile(activity, activity.packageName + ".phone.files", f))
      }
      val send = Intent(if (uris.size == 1) Intent.ACTION_SEND else Intent.ACTION_SEND_MULTIPLE).apply {
        type = args.mime ?: "image/png"
        if (uris.size == 1) putExtra(Intent.EXTRA_STREAM, uris[0]) else putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        args.text?.let { putExtra(Intent.EXTRA_TEXT, it) }
        clipData = ClipData.newRawUri(null, uris[0]).also { cd -> uris.drop(1).forEach { cd.addItem(ClipData.Item(it)) } }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(send, null))
      invoke.resolve(JSObject().put("shared", true))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  // ---------------------------------------------------------------- the automatic backup copies

  /** The backup copies this app made (name, when, address), newest name first. On Android 10 and newer they are in Documents/Bible Concordance backup
   * (the app can always see the files it made itself, with no permission); on older Android they are in the app's own folder. */
  private fun backupCopies(): List<Triple<String, Long, String>> {
    val out = ArrayList<Triple<String, Long, String>>()
    if (Build.VERSION.SDK_INT >= 29) {
      val coll = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
      val cols = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DISPLAY_NAME, MediaStore.Files.FileColumns.DATE_MODIFIED)
      activity.contentResolver.query(coll, cols, MediaStore.Files.FileColumns.RELATIVE_PATH + " = ? AND " + MediaStore.Files.FileColumns.DISPLAY_NAME + " LIKE ?", arrayOf("Documents/$BACKUP_DIR/", "Bible Concordance backup %.json"), null)?.use { c ->
        while (c.moveToNext()) {
          val uri = Uri.withAppendedPath(coll, c.getLong(0).toString())
          out.add(Triple(c.getString(1), c.getLong(2) * 1000, uri.toString()))
        }
      }
    } else {
      File(activity.getExternalFilesDir(null) ?: activity.filesDir, BACKUP_DIR).listFiles()?.filter { it.isFile && it.name.endsWith(".json") }?.forEach {
        out.add(Triple(it.name, it.lastModified(), Uri.fromFile(it).toString()))
      }
    }
    return out.sortedByDescending { it.first }
  }

  /** Writes a dated backup copy (a day's file is replaced by the same day's newer one) and keeps only the newest three. */
  @Command
  fun saveBackupCopy(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(FileArgs::class.java)
      val name = args.name.replace(Regex("[^A-Za-z0-9 ._-]"), "").ifBlank { "Bible Concordance backup.json" }
      val bytes = args.text.toByteArray(Charsets.UTF_8)
      val where: String
      if (Build.VERSION.SDK_INT >= 29) {
        val resolver = activity.contentResolver
        val coll = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val existing = backupCopies().firstOrNull { it.first == name }?.third?.let { Uri.parse(it) }
        val uri = existing ?: resolver.insert(coll, ContentValues().apply {
          put(MediaStore.Files.FileColumns.DISPLAY_NAME, name)
          put(MediaStore.Files.FileColumns.MIME_TYPE, "application/json")
          put(MediaStore.Files.FileColumns.RELATIVE_PATH, "Documents/$BACKUP_DIR/")
        }) ?: throw Exception("The phone would not make the backup file.")
        resolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } ?: throw Exception("The phone would not open the backup file.")
        backupCopies().drop(BACKUP_KEEP).forEach { resolver.delete(Uri.parse(it.third), null, null) }
        where = "Documents/$BACKUP_DIR"
      } else {
        val dir = File(activity.getExternalFilesDir(null) ?: activity.filesDir, BACKUP_DIR).apply { mkdirs() }
        File(dir, name).writeBytes(bytes)
        backupCopies().drop(BACKUP_KEEP).forEach { File(Uri.parse(it.third).path ?: "").delete() }
        where = "the app's own folder"
      }
      invoke.resolve(JSObject().put("saved", true).put("where", where))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** The backup copies this app made, newest first: { copies: [{ name, modified, uri }] }. */
  @Command
  fun listBackupCopies(invoke: Invoke) {
    try {
      val list = JSArray()
      backupCopies().forEach { list.put(JSObject().put("name", it.first).put("modified", it.second).put("uri", it.third)) }
      invoke.resolve(JSObject().put("copies", list))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** The text of one of the backup copies (an address `listBackupCopies` gave). */
  @Command
  fun readBackupCopy(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(UriArgs::class.java)
      if (backupCopies().none { it.third == args.uri }) throw Exception("That is not one of this app's backup copies.")
      val uri = Uri.parse(args.uri)
      val bytes = if (uri.scheme == "file") File(uri.path ?: "").readBytes() else activity.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw Exception("The backup copy could not be opened.")
      invoke.resolve(JSObject().put("text", String(bytes, Charsets.UTF_8)))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  // ---------------------------------------------------------------- a newer version of the app

  /** Hands a downloaded update to Android's installer. Android shows what is being installed
   * and asks the reader; it refuses any file not signed with this app's own key. The first
   * time, the reader has to allow this app to install apps: their settings are opened at
   * that switch, and the answer says so ({ allow: true }) for the page to explain. */
  /** Where a downloaded update is to be put (the app's cache, under updates/): the folder
   * `installUpdate` accepts a file from, and the file provider may hand to the installer. */
  @Command
  fun updatesDir(invoke: Invoke) {
    try {
      val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
      invoke.resolve(JSObject().put("path", dir.absolutePath))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @Command
  fun installUpdate(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallArgs::class.java)
      val dir = File(activity.cacheDir, "updates").canonicalFile
      val file = File(args.path).canonicalFile
      if (file.parentFile != dir || !file.name.endsWith(".apk") || !file.isFile) {
        invoke.reject("The downloaded update could not be found. Please try again.")
        return
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
        invoke.resolve(JSObject().put("started", false).put("allow", true))
        return
      }
      val uri = FileProvider.getUriForFile(activity, activity.packageName + ".phone.files", file)
      val install = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(install)
      invoke.resolve(JSObject().put("started", true).put("allow", false))
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

  /** Asks for any file (a Bible module to add) and copies it into the app's cache, so the app
   * can read it however large it is: { path, name }, or { path: null } if cancelled. */
  @Command
  fun openFile(invoke: Invoke) {
    try {
      val open = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
      }
      startActivityForResult(invoke, open, "fileOpened")
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @ActivityCallback
  fun fileOpened(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject().put("path", null as String?))
      return
    }
    try {
      val resolver = activity.contentResolver
      var name = "module"
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
      }
      val dir = File(activity.cacheDir, "import")
      dir.deleteRecursively()
      dir.mkdirs()
      val safe = name.replace(Regex("[^A-Za-z0-9._ -]"), "_").take(120).ifEmpty { "module" }
      val file = File(dir, safe)
      val input = resolver.openInputStream(uri) ?: throw Exception("The file could not be read.")
      input.use { stream ->
        file.outputStream().use { out ->
          val chunk = ByteArray(65536)
          var total = 0L
          while (true) {
            val n = stream.read(chunk)
            if (n < 0) break
            out.write(chunk, 0, n)
            total += n
            if (total > 400L * 1024 * 1024) throw Exception("That file is too large to add.")
          }
        }
      }
      invoke.resolve(JSObject().put("path", file.absolutePath).put("name", name))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  // ---------------------------------------------------------------- a web page in the phone's browser

  /** Opens an https:// address in the phone's browser (searching online). */
  @Command
  fun openLink(invoke: Invoke) {
    val args = invoke.parseArgs(LinkArgs::class.java)
    if (!args.url.startsWith("https://")) {
      invoke.reject("Only web addresses can be opened.")
      return
    }
    try {
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(args.url))
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
      invoke.resolve(JSObject().put("opened", true))
    } catch (ex: Exception) {
      invoke.reject("There is no web browser on this phone to open it in.")
    }
  }

  // ---------------------------------------------------------------- running in the background (the reminder)

  /** Asks Android to let the app run in the background, so the daily reminder comes on time:
   * Android's own question, or (already allowed, or not offered) the app's settings page. */
  @Command
  fun batterySettings(invoke: Invoke) {
    try {
      val power = activity.getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
      val pkg = activity.packageName
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !power.isIgnoringBatteryOptimizations(pkg)) {
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg"))
      } else {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
      }
      activity.startActivity(intent)
      invoke.resolve(JSObject().put("asked", true))
    } catch (ex: Exception) {
      try {
        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${activity.packageName}")))
        invoke.resolve(JSObject().put("asked", true))
      } catch (ex2: Exception) {
        invoke.reject(ex2.message)
      }
    }
  }

  // ---------------------------------------------------------------- a shared folder (keeping in step)
  //
  // The reader chooses a folder once (Android's folder picker); the app keeps the right to
  // read and write it. In it, like the computers, each device keeps one file of its own in
  // "Bible Concordance sync" and reads the others'.

  @Command
  fun pickFolder(invoke: Invoke) {
    try {
      val pick = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }
      startActivityForResult(invoke, pick, "folderPicked")
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @ActivityCallback
  fun folderPicked(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.resolve(JSObject().put("uri", null as String?))
      return
    }
    try {
      activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      val rootId = DocumentsContract.getTreeDocumentId(uri)
      var name = rootId.substringAfterLast(':').ifEmpty { rootId }
      activity.contentResolver.query(DocumentsContract.buildDocumentUriUsingTree(uri, rootId), arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
      }
      invoke.resolve(JSObject().put("uri", uri.toString()).put("name", name))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** The documents in a folder of the tree: (id, name, mime type). */
  private fun children(tree: Uri, parentId: String): List<Triple<String, String, String>> {
    val out = ArrayList<Triple<String, String, String>>()
    val cols = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE)
    activity.contentResolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId), cols, null, null, null)?.use { c ->
      while (c.moveToNext()) out.add(Triple(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: ""))
    }
    return out
  }

  /** The sync folder's document id in the chosen folder (made when `create`), or null. */
  private fun syncDir(tree: Uri, create: Boolean): String? {
    val rootId = DocumentsContract.getTreeDocumentId(tree)
    // the sync folder itself was chosen: use it as it is, not another one made inside it
    activity.contentResolver.query(DocumentsContract.buildDocumentUriUsingTree(tree, rootId), arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst() && c.getString(0) == SYNC_FOLDER) return rootId
    }
    children(tree, rootId).firstOrNull { it.second == SYNC_FOLDER && it.third == DocumentsContract.Document.MIME_TYPE_DIR }?.let { return it.first }
    if (!create) return null
    val made = DocumentsContract.createDocument(activity.contentResolver, DocumentsContract.buildDocumentUriUsingTree(tree, rootId), DocumentsContract.Document.MIME_TYPE_DIR, SYNC_FOLDER)
      ?: throw Exception("The folder \"$SYNC_FOLDER\" could not be made there.")
    return DocumentsContract.getDocumentId(made)
  }

  /** Every device's sync file: { files: [{ name, text }] }. */
  @Command
  fun syncRead(invoke: Invoke) {
    try {
      val tree = Uri.parse(invoke.parseArgs(FolderArgs::class.java).uri)
      val files = JSArray()
      val dir = syncDir(tree, false)
      if (dir != null) {
        for ((id, name, _) in children(tree, dir)) {
          if (!name.endsWith(".json") || name.startsWith(".")) continue
          val text = activity.contentResolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id))?.use { String(it.readBytes(), Charsets.UTF_8) } ?: continue
          files.put(JSObject().put("name", name).put("text", text))
        }
      }
      invoke.resolve(JSObject().put("files", files))
    } catch (ex: SecurityException) {
      invoke.reject("The app may no longer use that folder: choose it again.")
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** Writes this device's sync file (made the first time). */
  @Command
  fun syncWrite(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(FolderWriteArgs::class.java)
      val tree = Uri.parse(args.uri)
      val dir = syncDir(tree, true)!!
      val existing = children(tree, dir).firstOrNull { it.second == args.name }?.first
      val doc = if (existing != null) DocumentsContract.buildDocumentUriUsingTree(tree, existing)
        else DocumentsContract.createDocument(activity.contentResolver, DocumentsContract.buildDocumentUriUsingTree(tree, dir), "application/json", args.name)
          ?: throw Exception("The sync file could not be made.")
      val out = activity.contentResolver.openOutputStream(doc, "wt") ?: throw Exception("The sync file could not be written.")
      out.use { it.write(args.text.toByteArray(Charsets.UTF_8)) }
      invoke.resolve(JSObject().put("written", true))
    } catch (ex: SecurityException) {
      invoke.reject("The app may no longer use that folder: choose it again.")
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
