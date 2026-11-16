package com.ghostclaw.phone

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

// The daily things the phone does by itself, without the app open: the notifications (a different one each day, planned two weeks ahead by the page), and the
// home-screen widget with the verse for the day. The page hands over the plan (PhonePlugin.scheduleNotifications / setWidgetData); this keeps it and acts on it, and
// again after the phone restarts. A tap on a notification or the widget opens the app on the screen named in the plan (`open`).

object Daily {
  const val CHANNEL = "daily"
  const val PREFS = "phone_daily"
  const val EXTRA_OPEN = "open"
  const val ACTION_NOTIFY = "com.ghostclaw.phone.NOTIFY"
  const val ACTION_REFRESH = "com.ghostclaw.phone.WIDGET_REFRESH"

  /** where a notification or the widget was tapped to (scroll, mood, prayer, memory), until the page asks */
  @Volatile var pendingOpen: String? = null

  class Item(val at: Long, val id: Int, val title: String, val body: String, val open: String)

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun parse(json: String): List<Item> {
    val arr = JSONArray(json)
    return (0 until arr.length()).map {
      val o = arr.getJSONObject(it)
      Item(o.getLong("at"), o.getInt("id"), o.getString("title"), o.getString("body"), o.optString("open", "scroll"))
    }
  }

  private fun toJson(items: List<Item>): String {
    val arr = JSONArray()
    items.forEach { arr.put(JSONObject().put("at", it.at).put("id", it.id).put("title", it.title).put("body", it.body).put("open", it.open)) }
    return arr.toString()
  }

  /** The app's own start-up intent, carrying where to go. */
  fun launchIntent(ctx: Context, open: String): Intent? =
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
      putExtra(EXTRA_OPEN, open)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }

  private fun alarmFor(ctx: Context, item: Item, flags: Int): PendingIntent? {
    val intent = Intent(ctx, NotifyReceiver::class.java)
      .setAction(ACTION_NOTIFY)
      .setData(Uri.parse("notify://daily/${item.id}"))
      .putExtra("id", item.id)
      .putExtra("title", item.title)
      .putExtra("body", item.body)
      .putExtra(EXTRA_OPEN, item.open)
    return PendingIntent.getBroadcast(ctx, item.id, intent, flags or PendingIntent.FLAG_IMMUTABLE)
  }

  /** Whether the phone lets this app set alarms to the minute (otherwise they come within a few minutes, which suits a daily verse). */
  fun canBeExact(ctx: Context): Boolean {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
  }

  private fun setAlarm(ctx: Context, item: Item) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = alarmFor(ctx, item, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
    try {
      if (canBeExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pi)
      else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pi)
    } catch (_: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, pi)
    }
  }

  fun cancelAll(ctx: Context) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val stored = prefs(ctx).getString("items", null) ?: return
    try {
      parse(stored).forEach { item -> alarmFor(ctx, item, PendingIntent.FLAG_UPDATE_CURRENT)?.let { am.cancel(it) } }
    } catch (_: Exception) {
      /* an unreadable list: nothing to cancel by */
    }
    prefs(ctx).edit().remove("items").apply()
  }

  /** Replaces the planned notifications with these (those whose time has passed are left out). Returns how many were set. */
  fun schedule(ctx: Context, items: List<Item>): Int {
    cancelAll(ctx)
    val now = System.currentTimeMillis()
    val keep = items.filter { it.at > now }
    prefs(ctx).edit().putString("items", toJson(keep)).apply()
    keep.forEach { setAlarm(ctx, it) }
    return keep.size
  }

  /** After a restart (alarms do not survive one) or an update of the app: the stored plan is set again. */
  fun reschedule(ctx: Context) {
    val stored = prefs(ctx).getString("items", null) ?: return
    val now = System.currentTimeMillis()
    try {
      parse(stored).filter { it.at > now }.forEach { setAlarm(ctx, it) }
    } catch (_: Exception) {
      /* an unreadable list */
    }
  }

  fun allowed(ctx: Context): Boolean =
    Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  fun channel(ctx: Context) {
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, ctx.getString(R.string.notify_channel), NotificationManager.IMPORTANCE_DEFAULT))
    }
  }

  fun post(ctx: Context, id: Int, title: String, body: String, open: String) {
    if (!allowed(ctx)) return
    channel(ctx)
    val tap = launchIntent(ctx, open)?.let { PendingIntent.getActivity(ctx, id, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val n = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.ic_notify)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setContentIntent(tap)
      .build()
    (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, n)
  }

  // ---------------------------------------------------------------- the widget's verses: [{day, ref, text}], one a day for the next two weeks

  fun setWidgetData(ctx: Context, json: String) {
    prefs(ctx).edit().putString("widget", json).apply()
    VerseWidget.updateAll(ctx)
  }

  fun today(): String {
    val c = Calendar.getInstance()
    return String.format("%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
  }

  /** (reference, words) of today's verse, or null when the page has not handed one over for today. */
  fun verseForToday(ctx: Context): Pair<String, String>? {
    val stored = prefs(ctx).getString("widget", null) ?: return null
    return try {
      val arr = JSONArray(stored)
      val day = today()
      (0 until arr.length()).map { arr.getJSONObject(it) }.firstOrNull { it.optString("day") == day }?.let { Pair(it.optString("ref"), it.optString("text")) }
    } catch (_: Exception) {
      null
    }
  }
}

class NotifyReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    Daily.post(ctx, intent.getIntExtra("id", 5000), intent.getStringExtra("title") ?: "Bible Concordance", intent.getStringExtra("body") ?: "", intent.getStringExtra(Daily.EXTRA_OPEN) ?: "scroll")
  }
}

class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    Daily.reschedule(ctx)
    VerseWidget.updateAll(ctx)
  }
}

/** The home-screen widget: today's verse (from the plan the page handed over); a tap opens the Daily Scroll. */
class VerseWidget : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    ids.forEach { update(ctx, mgr, it) }
    scheduleNextDay(ctx)
  }

  override fun onReceive(ctx: Context, intent: Intent) {
    super.onReceive(ctx, intent)
    if (intent.action == Daily.ACTION_REFRESH) {
      updateAll(ctx)
      scheduleNextDay(ctx)
    }
  }

  companion object {
    fun update(ctx: Context, mgr: AppWidgetManager, id: Int) {
      val views = RemoteViews(ctx.packageName, R.layout.verse_widget)
      val verse = Daily.verseForToday(ctx)
      if (verse != null && verse.second.isNotBlank()) {
        views.setTextViewText(R.id.widget_text, "“" + verse.second.trim() + "”")
        views.setTextViewText(R.id.widget_ref, verse.first)
      } else {
        views.setTextViewText(R.id.widget_text, if (verse != null) "Today's verse is ${verse.first}. Tap to read it." else ctx.getString(R.string.widget_empty).replace("\\'", "'"))
        views.setTextViewText(R.id.widget_ref, verse?.first ?: "")
      }
      Daily.launchIntent(ctx, "scroll")?.let {
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(ctx, 7001, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      }
      mgr.updateAppWidget(id, views)
    }

    fun ids(ctx: Context): IntArray = AppWidgetManager.getInstance(ctx).getAppWidgetIds(ComponentName(ctx, VerseWidget::class.java))

    fun updateAll(ctx: Context) {
      val mgr = AppWidgetManager.getInstance(ctx)
      ids(ctx).forEach { update(ctx, mgr, it) }
    }

    /** A little after midnight the widget changes to the new day's verse by itself. */
    fun scheduleNextDay(ctx: Context) {
      if (ids(ctx).isEmpty()) return
      val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val next = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_MONTH, 1)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 1)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
      }
      val pi = PendingIntent.getBroadcast(ctx, 7002, Intent(ctx, VerseWidget::class.java).setAction(Daily.ACTION_REFRESH), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      am.set(AlarmManager.RTC, next.timeInMillis, pi)
    }
  }
}
