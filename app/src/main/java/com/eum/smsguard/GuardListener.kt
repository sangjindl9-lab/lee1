package com.eum.smsguard

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONObject

class GuardListener: NotificationListenerService() {
 private val worker=Executors.newSingleThreadExecutor()
 override fun onNotificationPosted(sbn:StatusBarNotification) {
  val prefs=getSharedPreferences("settings",MODE_PRIVATE)
  if(!prefs.getBoolean("enabled",false))return
  // Restrict to user-approved messaging packages; other app notifications are never uploaded.
  val packages=(prefs.getString("packages","com.samsung.android.messaging")?:"").split(',').map{it.trim()}
  if(sbn.packageName !in packages)return
  val extras=sbn.notification.extras
  val sender=extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?:return
  val body=extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
   ?:extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?:return
  if(body.isBlank())return
  worker.execute {
   val store=Store(applicationContext)
   val match=store.rules().firstOrNull { body.contains(it,ignoreCase=true) }
   var block=match!=null
   var reason=if(match!=null)"사용자 문구: $match" else "규칙 미일치"
   var verdict=if(block)"block" else "allow"
   if(!block && prefs.getBoolean("cloud_consent",false)) {
    val endpoint=prefs.getString("endpoint","")?:""
    val token=prefs.getString("token","")?:""
    if(endpoint.startsWith("https://")) {
     try {
      val conn=(URL(endpoint).openConnection() as HttpURLConnection)
      conn.requestMethod="POST";conn.connectTimeout=6000;conn.readTimeout=6000
      conn.setRequestProperty("Content-Type","application/json; charset=utf-8")
      if(token.isNotBlank())conn.setRequestProperty("Authorization","Bearer $token")
      conn.doOutput=true
      conn.outputStream.use { it.write(JSONObject().put("sender",sender).put("body",body).toString().toByteArray(Charsets.UTF_8)) }
      if(conn.responseCode in 200..299) {
       val result=JSONObject(conn.inputStream.bufferedReader().use{it.readText()})
       verdict=result.optString("verdict","allow")
       block=verdict=="block";reason=result.optString("reason","AI 분류")
      } else {reason="서버 오류 ${conn.responseCode}: 기본 허용"}
      conn.disconnect()
     } catch(e:Exception) { reason="분석 실패: 기본 허용" }
    }
   }
   store.add(sender,body,reason,verdict,block)
   if(block) { try { cancelNotification(sbn.key) } catch(_:Exception){} }
  }
 }
 override fun onDestroy(){worker.shutdown();super.onDestroy()}
}
