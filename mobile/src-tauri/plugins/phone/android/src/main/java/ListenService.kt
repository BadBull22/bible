package com.ghostclaw.phone

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import org.json.JSONObject
import java.util.Locale

// Listen mode: the Bible read aloud with the phone's voice, going on with the screen off and the app out of sight. A foreground service (type media playback) with a
// notification and lock-screen controls (previous chapter, pause, next chapter, stop). The page hands over everything to read in one go (chapters of verses), because
// the page itself is paused when the screen goes off; this reads it through and stops at the end, or when the sleep timer runs out. Where it got to is kept, so the
// page can mark the chapters that were listened to as read when it comes back.

class ListenService : Service() {
  companion object {
    const val ACTION_START = "com.ghostclaw.phone.LISTEN_START"
    const val ACTION_TOGGLE = "com.ghostclaw.phone.LISTEN_TOGGLE"
    const val ACTION_NEXT = "com.ghostclaw.phone.LISTEN_NEXT"
    const val ACTION_PREV = "com.ghostclaw.phone.LISTEN_PREV"
    const val ACTION_STOP = "com.ghostclaw.phone.LISTEN_STOP"
    private const val CHANNEL = "listen"
    private const val NOTE_ID = 6001
    private const val PREFS = "phone_listen"

    /** What the page may ask: is it going, where is it. */
    @Volatile var running = false
    @Volatile var playing = false
    @Volatile var index = 0
    @Volatile var total = 0
    @Volatile var label = ""
    @Volatile var finished = false

    fun status(ctx: Context): JSONObject {
      if (!running) {
        // not running: what the last listening reached (so the page can mark chapters as read)
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return JSONObject().put("running", false).put("playing", false).put("index", p.getInt("index", 0)).put("total", p.getInt("total", 0)).put("label", p.getString("label", "")).put("finished", p.getBoolean("finished", false)).put("token", p.getString("token", ""))
      }
      val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      return JSONObject().put("running", true).put("playing", playing).put("index", index).put("total", total).put("label", label).put("finished", finished).put("token", p.getString("token", ""))
    }

    fun start(ctx: Context, json: String) {
      val i = Intent(ctx, ListenService::class.java).setAction(ACTION_START).putExtra("queue", json)
      if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun control(ctx: Context, action: String) {
      val a = when (action) {
        "toggle" -> ACTION_TOGGLE
        "next" -> ACTION_NEXT
        "prev" -> ACTION_PREV
        else -> ACTION_STOP
      }
      if (!running && a != ACTION_STOP) return
      ctx.startService(Intent(ctx, ListenService::class.java).setAction(a))
    }
  }

  private class Piece(val text: String, val head: Boolean, val label: String)

  private var pieces: List<Piece> = emptyList()
  private var at = 0
  private var isPlaying = false
  private var tts: TextToSpeech? = null
  private var ready = false
  private var rate = 1.0f
  private var voiceName: String? = null
  private var generation = 0
  private var token = ""
  private val main = Handler(Looper.getMainLooper())
  private var session: MediaSession? = null
  private var wake: PowerManager.WakeLock? = null
  private var focus: AudioFocusRequest? = null
  private var resumeAfterFocus = false
  private var sleepRunnable: Runnable? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    session = MediaSession(this, "bible-listen").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() = toggle(true)
        override fun onPause() = toggle(false)
        override fun onSkipToNext() = skip(1)
        override fun onSkipToPrevious() = skip(-1)
        override fun onStop() = finishAll(false)
      })
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> begin(intent.getStringExtra("queue") ?: "")
      ACTION_TOGGLE -> toggle(!isPlaying)
      ACTION_NEXT -> skip(1)
      ACTION_PREV -> skip(-1)
      ACTION_STOP -> finishAll(false)
      else -> if (!running) stopSelf()
    }
    return START_NOT_STICKY
  }

  // ---------------------------------------------------------------- start

  private fun begin(json: String) {
    // the notification first: a foreground service must show one within a few seconds
    showNote("Getting ready…", "")
    try {
      val o = JSONObject(json)
      val arr = o.getJSONArray("pieces")
      pieces = (0 until arr.length()).map { val p = arr.getJSONObject(it); Piece(p.getString("t"), p.optBoolean("h"), p.optString("l")) }
      at = o.optInt("start", 0).coerceIn(0, (pieces.size - 1).coerceAtLeast(0))
      rate = o.optDouble("rate", 1.0).toFloat().coerceIn(0.5f, 2.5f)
      voiceName = if (o.isNull("voice")) null else o.optString("voice").ifBlank { null }
      token = o.optString("token", System.currentTimeMillis().toString())
      val minutes = o.optInt("sleepMin", 0)
      sleepRunnable?.let { main.removeCallbacks(it) }
      if (minutes > 0) {
        sleepRunnable = Runnable { finishAll(false) }
        main.postDelayed(sleepRunnable!!, minutes * 60_000L)
      }
    } catch (_: Exception) {
      finishAll(false)
      return
    }
    if (pieces.isEmpty()) {
      finishAll(false)
      return
    }
    running = true
    finished = false
    total = pieces.size
    getSystemService(Context.POWER_SERVICE).let { pm ->
      wake?.let { if (it.isHeld) it.release() }
      wake = (pm as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bible:listen").apply { setReferenceCounted(false); acquire(5 * 60 * 60 * 1000L) }
    }
    startVoice {
      if (it) {
        requestFocus()
        isPlaying = true
        speak()
      } else {
        showNote("No voice for reading aloud", "Add one in the phone's settings, under Text-to-speech.")
        main.postDelayed({ finishAll(false) }, 4000)
      }
    }
  }

  private fun startVoice(then: (Boolean) -> Unit) {
    if (ready) {
      then(true)
      return
    }
    tts = TextToSpeech(applicationContext) { status ->
      val v = tts
      if (status != TextToSpeech.SUCCESS || v == null) {
        then(false)
        return@TextToSpeech
      }
      val lang = v.setLanguage(Locale.getDefault().takeIf { it.language == "en" } ?: Locale.US)
      if (lang == TextToSpeech.LANG_MISSING_DATA || lang == TextToSpeech.LANG_NOT_SUPPORTED) v.setLanguage(Locale.ENGLISH)
      v.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}
        override fun onDone(utteranceId: String?) {
          val gen = utteranceId?.substringAfter("-")?.toIntOrNull() ?: return
          main.post { if (gen == generation && isPlaying) advance() }
        }
        @Deprecated("Deprecated in Java")
        override fun onError(utteranceId: String?) {
          val gen = utteranceId?.substringAfter("-")?.toIntOrNull() ?: return
          main.post { if (gen == generation && isPlaying) advance() }
        }
      })
      ready = true
      then(true)
    }
  }

  // ---------------------------------------------------------------- speaking

  private fun speak() {
    val v = tts ?: return
    if (at >= pieces.size) {
      finishAll(true)
      return
    }
    val piece = pieces[at]
    v.setSpeechRate(rate)
    val chosen = voiceName?.let { n -> try { v.voices?.firstOrNull { it.name == n } } catch (_: Exception) { null } }
    if (chosen != null && v.voice?.name != chosen.name) v.voice = chosen
    generation++
    index = at
    if (piece.label.isNotBlank()) label = piece.label
    keepPlace()
    showNote(label, snippet(piece.text))
    if (v.speak(piece.text, TextToSpeech.QUEUE_FLUSH, Bundle(), "p-$generation") != TextToSpeech.SUCCESS) advance()
  }

  private fun advance() {
    at++
    if (at >= pieces.size) finishAll(true) else speak()
  }

  private fun toggle(play: Boolean) {
    if (!running) return
    if (play && !isPlaying) {
      requestFocus()
      isPlaying = true
      speak()
    } else if (!play && isPlaying) {
      isPlaying = false
      generation++
      tts?.stop()
      showNote(label, "Paused")
    }
    playing = isPlaying
  }

  /** `dir` 1: the start of the next chapter; -1: the start of this chapter, or of the one before when this one has only just begun. */
  private fun skip(dir: Int) {
    if (!running || pieces.isEmpty()) return
    val heads = pieces.indices.filter { pieces[it].head }
    val here = heads.lastOrNull { it <= at } ?: 0
    val target = if (dir > 0) heads.firstOrNull { it > at } else if (at - here > 3) here else heads.lastOrNull { it < here } ?: here
    if (target == null) {
      finishAll(true)
      return
    }
    at = target
    generation++
    tts?.stop()
    isPlaying = true
    speak()
  }

  private fun finishAll(completed: Boolean) {
    finished = completed
    keepPlace()
    sleepRunnable?.let { main.removeCallbacks(it) }
    generation++
    tts?.stop()
    tts?.shutdown()
    tts = null
    ready = false
    isPlaying = false
    playing = false
    running = false
    wake?.let { if (it.isHeld) it.release() }
    abandonFocus()
    session?.isActive = false
    if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE) else @Suppress("DEPRECATION") stopForeground(true)
    stopSelf()
  }

  override fun onDestroy() {
    if (running) finishAll(false)
    session?.release()
    session = null
    super.onDestroy()
  }

  /** The place reached, kept for the page (which marks the chapters that were heard to the end as read). */
  private fun keepPlace() {
    playing = isPlaying
    getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("index", at).putInt("total", pieces.size).putString("label", label).putBoolean("finished", finished).putString("token", token).apply()
  }

  // ---------------------------------------------------------------- audio focus

  // One focus request for the whole listening, asked again (not made anew) after a pause: a second request with a new listener would tell the first one that focus was
  // lost, and the reading would pause itself.
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    main.post {
      when (change) {
        AudioManager.AUDIOFOCUS_LOSS -> toggle(false)
        AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> if (isPlaying) { resumeAfterFocus = true; toggle(false) }
        AudioManager.AUDIOFOCUS_GAIN -> if (resumeAfterFocus) { resumeAfterFocus = false; toggle(true) }
      }
    }
  }

  private fun requestFocus() {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= 26) {
      val req = focus ?: AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setOnAudioFocusChangeListener(focusListener)
        .build()
      focus = req
      am.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION") am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
    }
  }

  private fun abandonFocus() {
    val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= 26) focus?.let { am.abandonAudioFocusRequest(it) }
    focus = null
  }

  // ---------------------------------------------------------------- the notification

  private fun snippet(text: String): String = if (text.length <= 70) text else text.take(70).replace(Regex("\\s+\\S*$"), "") + "…"

  private fun action(icon: Int, title: String, act: String): Notification.Action {
    val pi = PendingIntent.getService(this, act.hashCode(), Intent(this, ListenService::class.java).setAction(act), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return Notification.Action.Builder(Icon.createWithResource(this, icon), title, pi).build()
  }

  private fun showNote(title: String, text: String) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.listen_channel), NotificationManager.IMPORTANCE_LOW).apply { setSound(null, null) })
    }
    val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    session?.setPlaybackState(
      PlaybackState.Builder()
        .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_STOP)
        .setState(if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
        .build()
    )
    val tap = Daily.launchIntent(this, "listen")?.let { PendingIntent.getActivity(this, 6002, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    b.setSmallIcon(R.drawable.ic_notify)
      .setContentTitle(title.ifBlank { "Bible Concordance" })
      .setContentText(text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(tap)
      .addAction(action(R.drawable.ic_prev, "Previous chapter", ACTION_PREV))
      .addAction(if (isPlaying) action(R.drawable.ic_pause, "Pause", ACTION_TOGGLE) else action(R.drawable.ic_play, "Play", ACTION_TOGGLE))
      .addAction(action(R.drawable.ic_next, "Next chapter", ACTION_NEXT))
      .addAction(action(R.drawable.ic_stop, "Stop", ACTION_STOP))
      .setStyle(Notification.MediaStyle().setShowActionsInCompactView(0, 1, 2).also { s -> session?.let { s.setMediaSession(it.sessionToken) } })
    val n = b.build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(NOTE_ID, n)
  }
}
